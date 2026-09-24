package dev.jchanghong.zcode;

import android.content.Context;
import android.util.Log;

import androidx.annotation.OptIn;
import androidx.webkit.Profile;
import androidx.webkit.ProfileStore;
import androidx.webkit.WebViewCompat;
import androidx.webkit.WebViewFeature;
import androidx.webkit.WebViewOutcomeReceiver;
import androidx.webkit.WebViewStartUpConfig;
import androidx.webkit.WebViewStartUpResult;
import androidx.webkit.WebViewStartupException;

import java.util.Collections;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/**
 * WebView 宿主层冷启动预热：在 MainActivity 的 super.onCreate 之前触发，
 * 让 WebView/Chromium 进程初始化与到官方域名 https://zcode.z.ai 的
 * DNS/TCP/TLS 建连（含 QUIC hint）和首帧渲染并行进行，缩短业务页首次打开时间。
 *
 * 为什么放宿主层：业务网络由 WebView 直连官方 https://zcode.z.ai，宿主不注入任何
 * JS、不做网络代理、不缓存 API 响应，只提前"暖机"，不影响业务行为。
 *
 * API 依据（androidx.webkit 1.17.1，Google Maven 最新稳定版，已下载官方
 * aar/sources 逐一核验类与方法签名）：
 * - WebViewCompat#startUpWebView(Context, WebViewStartUpConfig,
 *   WebViewOutcomeReceiver)：异步触发一次性的 WebView startup（后台部分跑在传入
 *   Executor 上）；官方 javadoc 明确无需 WebViewFeature 检查，旧 Provider 不支持
 *   异步时库内部自动回退同步路径，安全。
 * - Profile#warmUpRendererProcess / preconnect / enqueuePreconnect / addQuicHints
 *   为 RequiresOptIn 实验性 API，Java 侧用 androidx.annotation.OptIn(markerClass=…)
 *   显式选择加入；且各自有对应 WebViewFeature 常量，调用前先 isFeatureSupported
 *   守卫（不支持的 Provider 上这些方法会抛 UnsupportedOperationException）。
 *
 * 所有预热步骤独立 try/catch（含 Error）：预热只是锦上添花，任何一步失败只记一条
 * Log.w 并静默降级，绝不能让 App 崩溃。
 */
public final class WebViewWarmup {

    private static final String TAG = "WebViewWarmup";

    /** 官方业务域名，与 Manifest 深链 host、capacitor server.hostname 同源一致。 */
    private static final String OFFICIAL_ORIGIN = "https://zcode.z.ai";

    /**
     * startUpWebView 要求传入后台 Executor；持有静态引用防止预热期间线程池被回收，
     * 进程退出时由系统统一回收，无需显式 shutdown。
     */
    private static final ExecutorService WARMUP_EXECUTOR =
            Executors.newSingleThreadExecutor(runnable -> {
                Thread thread = new Thread(runnable, "webview-warmup");
                thread.setDaemon(true);
                return thread;
            });

    private WebViewWarmup() {
    }

    /**
     * 唯一公开入口。MainActivity.onCreate 在 super.onCreate(savedInstanceState)
     * 之前调用：此时主线程尚未被首帧与 Capacitor bridge 初始化占用，预热启动最早、
     * 收益最大。本类自包含，不依赖 MainActivity 的任何字段或方法。
     */
    public static void warmUp(Context context) {
        // 先把官方域名的 preconnect 排队（该 API 明确不触发 WebView startup，
        // WebView 启动完成的瞬间即建连），再异步启动 WebView。
        enqueueOfficialPreconnect();
        startUpWebViewAsync(context.getApplicationContext());
    }

    /**
     * 步骤一：向默认 Profile 排队官方域名的网络 preconnect。enqueuePreconnect 是
     * preconnect 的"不触发 startup"变体，专为冷启动这种"WebView 还没起来"的场景设计。
     */
    @OptIn(markerClass = Profile.ExperimentalPreconnect.class)
    private static void enqueueOfficialPreconnect() {
        try {
            if (!WebViewFeature.isFeatureSupported(WebViewFeature.MULTI_PROFILE)
                    || !WebViewFeature.isFeatureSupported(WebViewFeature.ENQUEUE_PRECONNECT)) {
                Log.w(TAG, "enqueuePreconnect 跳过：当前 WebView Provider 不支持");
                return;
            }
            Profile profile = ProfileStore.getInstance()
                    .getOrCreateProfile(Profile.DEFAULT_PROFILE_NAME);
            profile.enqueuePreconnect(OFFICIAL_ORIGIN);
        } catch (Throwable t) {
            Log.w(TAG, "enqueuePreconnect 失败，忽略", t);
        }
    }

    /**
     * 步骤二：异步触发 WebView startup（进程级一次性初始化）。回调在主线程；
     * startup 完成后再做 renderer 预热等后续步骤，以获得该 API 的最大异步收益
     * （官方 javadoc：回调前调用其他 webkit API 会削弱异步收益）。
     */
    private static void startUpWebViewAsync(Context appContext) {
        try {
            WebViewStartUpConfig config = new WebViewStartUpConfig.Builder(WARMUP_EXECUTOR)
                    // UI 线程部分的 startup 任务照常执行（默认即 true，显式写出表意）。
                    .setShouldRunUiThreadStartUpTasks(true)
                    // startup 期间顺带加载默认 Profile，把 Profile 存储初始化也并入预热。
                    .setProfilesToLoadDuringStartup(
                            Collections.singleton(Profile.DEFAULT_PROFILE_NAME))
                    .build();
            WebViewCompat.startUpWebView(appContext, config,
                    new WebViewOutcomeReceiver<WebViewStartUpResult, WebViewStartupException>() {
                        @Override
                        public void onResult(WebViewStartUpResult result) {
                            warmUpAfterStartup();
                        }

                        @Override
                        public void onError(WebViewStartupException error) {
                            Log.w(TAG, "WebView startup 失败，跳过后续预热", error);
                        }
                    });
        } catch (Throwable t) {
            Log.w(TAG, "startUpWebView 触发失败，忽略", t);
        }
    }

    /**
     * 步骤三：startup 完成后的主线程收尾——renderer 进程预热、QUIC hint、
     * preconnect 兜底直连。各步独立 feature 守卫，缺失即跳过。
     */
    @OptIn(markerClass = {Profile.ExperimentalWarmUpRendererProcess.class,
            Profile.ExperimentalAddQuicHints.class,
            Profile.ExperimentalPreconnect.class})
    private static void warmUpAfterStartup() {
        try {
            if (!WebViewFeature.isFeatureSupported(WebViewFeature.MULTI_PROFILE)) {
                Log.w(TAG, "Profile 预热跳过：当前 WebView Provider 不支持 MULTI_PROFILE");
                return;
            }
            Profile profile = ProfileStore.getInstance()
                    .getOrCreateProfile(Profile.DEFAULT_PROFILE_NAME);

            if (WebViewFeature.isFeatureSupported(WebViewFeature.WARM_UP_RENDERER_PROCESS)) {
                // renderer 预热：提前拉起渲染进程，首个 WebView 创建时无需冷启 renderer。
                profile.warmUpRendererProcess();
            }
            if (WebViewFeature.isFeatureSupported(WebViewFeature.ADD_QUIC_HINTS_V1)) {
                // QUIC hint：告诉网络栈该 origin 可能走 QUIC/HTTP3，提前完成握手准备。
                profile.addQuicHints(Collections.singleton(OFFICIAL_ORIGIN));
            }
            if (WebViewFeature.isFeatureSupported(WebViewFeature.PRECONNECT)) {
                // preconnect 兜底：enqueuePreconnect 不受支持时这里也能直接建连；
                // 已建连时重复调用无额外开销（官方文档注明对已访问 origin 无额外收益）。
                profile.preconnect(OFFICIAL_ORIGIN);
            }
        } catch (Throwable t) {
            Log.w(TAG, "startup 后预热失败，忽略", t);
        }
    }
}
