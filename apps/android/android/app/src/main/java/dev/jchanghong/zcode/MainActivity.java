package dev.jchanghong.zcode;

import android.app.DownloadManager;
import android.content.Intent;
import android.net.Uri;
import android.os.Bundle;
import android.os.Environment;
import android.view.View;
import android.webkit.CookieManager;
import android.webkit.URLUtil;
import android.webkit.WebView;
import android.widget.Toast;
import androidx.activity.OnBackPressedCallback;
import androidx.core.graphics.Insets;
import androidx.core.view.ViewCompat;
import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsCompat;
import com.getcapacitor.BridgeActivity;

/**
 * 只做 UI 宿主与平台适配（返回键、下载、insets、深链），不承载业务状态；
 * 业务网络由 WebView 直连官方服务，请求分流见 ZCodeWebViewClient。
 */
public class MainActivity extends BridgeActivity {

    /** 记录最后一次远控链接：桌面图标冷启动时恢复，避免落在本地 SPA 的空壳根路径上。 */
    private static final String SHELL_PREFS = "zcode_shell";
    private static final String KEY_LAST_REMOTE_URL = "lastRemoteUrl";

    @Override
    public void onCreate(Bundle savedInstanceState) {
        // 冷启动最早时刻触发 WebView 进程/renderer/官方域名连接预热（失败静默降级）。
        WebViewWarmup.warmUp(this);
        super.onCreate(savedInstanceState);
        if (bridge == null) {
            return;
        }
        bridge.setWebViewClient(new ZCodeWebViewClient(bridge));
        applyWindowInsets();
        registerBackHandling();
        registerDownloadHandling();
        loadDeepLinkIfPresent(getIntent());
        restoreLastRemoteUrlIfLauncherColdStart();
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        loadDeepLinkIfPresent(intent);
    }

    /**
     * Android 15+ 强制 edge-to-edge：显式声明不依赖 decor fits，并对 WebView 容器按
     * systemBars | displayCutout | ime insets 加 padding。
     *
     * ime 高度必须封顶：部分中文输入法（实测微信输入法 wetype）以近乎全屏的透明窗口承载
     * 键盘（窗口请求 2279/2670px），Type.ime() insets 随之虚高到约 70% 屏高，直接采用会把
     * WebView 压成一条、输入框被顶到屏幕顶部并留出大片空白。按容器高度 45% 封顶后，
     * 输入框停靠在可见键盘上方，与手机浏览器观感一致。
     */
    private void applyWindowInsets() {
        WindowCompat.setDecorFitsSystemWindows(getWindow(), false);
        WebView webView = bridge.getWebView();
        if (webView == null) {
            return;
        }
        View container = (View) webView.getParent();
        int imeHeightCap = (int) (getResources().getDisplayMetrics().heightPixels * 0.45f);
        ViewCompat.setOnApplyWindowInsetsListener(
            container,
            (v, insets) -> {
                Insets bars = insets.getInsets(
                    WindowInsetsCompat.Type.systemBars() | WindowInsetsCompat.Type.displayCutout()
                );
                Insets ime = insets.getInsets(WindowInsetsCompat.Type.ime());
                int bottom = Math.max(bars.bottom, Math.min(ime.bottom, imeHeightCap));
                v.setPadding(bars.left, bars.top, bars.right, bottom);
                return WindowInsetsCompat.CONSUMED;
            }
        );
    }

    /** 有历史（如 OAuth 授权跳转链）则历史后退，否则回桌面保留进程与 WS 连接。 */
    private void registerBackHandling() {
        getOnBackPressedDispatcher()
            .addCallback(
                this,
                new OnBackPressedCallback(true) {
                    @Override
                    public void handleOnBackPressed() {
                        WebView webView = bridge.getWebView();
                        if (webView != null && webView.canGoBack()) {
                            webView.goBack();
                        } else {
                            moveTaskToBack(true);
                        }
                    }
                }
            );
    }

    /** 文件下载交给系统 DownloadManager（公共 Downloads 目录，带进度通知）。 */
    private void registerDownloadHandling() {
        WebView webView = bridge.getWebView();
        if (webView == null) {
            return;
        }
        webView.setDownloadListener(
            (url, userAgent, contentDisposition, mimeType, contentLength) -> {
                try {
                    DownloadManager.Request request = new DownloadManager.Request(Uri.parse(url));
                    String cookies = CookieManager.getInstance().getCookie(url);
                    if (cookies != null) {
                        request.addRequestHeader("Cookie", cookies);
                    }
                    request.addRequestHeader("User-Agent", userAgent);
                    request.setMimeType(mimeType);
                    String fileName = URLUtil.guessFileName(url, contentDisposition, mimeType);
                    request.setDestinationInExternalPublicDir(Environment.DIRECTORY_DOWNLOADS, fileName);
                    request.setNotificationVisibility(
                        DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED
                    );
                    DownloadManager manager = (DownloadManager) getSystemService(DOWNLOAD_SERVICE);
                    manager.enqueue(request);
                } catch (Exception error) {
                    Toast.makeText(MainActivity.this, "下载失败：" + error.getMessage(), Toast.LENGTH_LONG).show();
                }
            }
        );
    }

    /**
     * https://zcode.z.ai 深链（分享页、?remote= 远控链接）：singleTask 下冷启动走
     * onCreate、热启动走 onNewIntent；同源 URL 交给 WebView 加载即可命中本地资产
     * 与 SPA 回退，与浏览器打开同一链接行为一致。
     */
    private void loadDeepLinkIfPresent(Intent intent) {
        if (intent == null || !Intent.ACTION_VIEW.equals(intent.getAction())) {
            return;
        }
        Uri data = intent.getData();
        if (data == null || !"https".equals(data.getScheme())) {
            return;
        }
        String appHost = bridge != null ? bridge.getHost() : null;
        if (appHost == null || !appHost.equalsIgnoreCase(data.getHost())) {
            return;
        }
        WebView webView = bridge.getWebView();
        if (webView != null) {
            rememberLastRemoteUrl(data);
            webView.loadUrl(data.toString());
        }
    }

    /**
     * 桌面图标冷启动（非深链）时恢复最后一次远控链接：本地 SPA 根路径连接官方 /ws
     * 后只会永久空等（官方不为未配对客户端提供独立会话），表现为一片黑屏"打不开"。
     * 恢复的链接若已过期，官方客户端会展示自己的"回到桌面端重新连接"提示页，不再黑屏。
     */
    private void restoreLastRemoteUrlIfLauncherColdStart() {
        Intent intent = getIntent();
        if (intent != null && Intent.ACTION_VIEW.equals(intent.getAction()) && intent.getData() != null) {
            // 深链冷启动已由 loadDeepLinkIfPresent 处理，不覆盖。
            return;
        }
        String last = getSharedPreferences(SHELL_PREFS, MODE_PRIVATE).getString(KEY_LAST_REMOTE_URL, null);
        WebView webView = bridge.getWebView();
        if (last != null && webView != null) {
            webView.loadUrl(last);
        }
    }

    /** 仅记住远控入口（/remote/*）：本地 SPA 的 / 与分享页不作为图标启动的恢复目标。 */
    private void rememberLastRemoteUrl(Uri url) {
        String path = url.getPath();
        if (path != null && path.startsWith("/remote/")) {
            getSharedPreferences(SHELL_PREFS, MODE_PRIVATE)
                .edit()
                .putString(KEY_LAST_REMOTE_URL, url.toString())
                .apply();
        }
    }
}
