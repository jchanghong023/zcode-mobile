package dev.jchanghong.zcode;

import android.Manifest;
import android.app.DownloadManager;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Environment;
import android.view.View;
import android.webkit.CookieManager;
import android.webkit.URLUtil;
import android.webkit.WebView;
import android.widget.Toast;
import androidx.activity.result.ActivityResultLauncher;
import androidx.activity.result.contract.ActivityResultContracts;
import androidx.activity.OnBackPressedCallback;
import androidx.core.content.ContextCompat;
import androidx.core.graphics.Insets;
import androidx.core.view.ViewCompat;
import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsCompat;
import com.getcapacitor.BridgeActivity;
import java.util.ArrayDeque;

/**
 * 只做 UI 宿主与平台适配（返回键、下载、insets、深链），不承载业务状态；
 * 业务网络由 WebView 直连官方服务，请求分流见 ZCodeWebViewClient。
 */
public class MainActivity extends BridgeActivity {

    /** 记录最后一次远控链接：桌面图标冷启动时恢复，避免落在本地 SPA 的空壳根路径上。 */
    private static final String SHELL_PREFS = "zcode_shell";
    private static final String KEY_LAST_REMOTE_URL = "lastRemoteUrl";
    private NativeNavigation nativeNavigation;
    private final ArrayDeque<DownloadManager.Request> pendingDownloads = new ArrayDeque<>();
    private boolean requestingStoragePermission;
    private final ActivityResultLauncher<String> storagePermissionLauncher = registerForActivityResult(
        new ActivityResultContracts.RequestPermission(),
        granted -> {
            requestingStoragePermission = false;
            if (!granted) {
                pendingDownloads.clear();
                Toast.makeText(this, "未获得存储权限，无法下载文件", Toast.LENGTH_SHORT).show();
                return;
            }
            while (!pendingDownloads.isEmpty()) {
                enqueueDownload(pendingDownloads.removeFirst());
            }
        }
    );

    @Override
    public void onCreate(Bundle savedInstanceState) {
        // 冷启动最早时刻触发 WebView 进程/renderer/官方域名连接预热（失败静默降级）。
        WebViewWarmup.warmUp(this);
        registerPlugin(BlobSavePlugin.class);
        super.onCreate(savedInstanceState);
        if (bridge == null) {
            return;
        }
        bridge.setWebViewClient(new ZCodeWebViewClient(bridge, this::onWebRouteChanged));
        String savedLink = getSharedPreferences(SHELL_PREFS, MODE_PRIVATE)
            .getString(KEY_LAST_REMOTE_URL, null);
        nativeNavigation = new NativeNavigation(
            this,
            savedLink,
            this::saveAndConnectRemoteLink,
            this::navigateToWebTab
        );
        applyWindowInsets();
        registerBackHandling();
        registerDownloadHandling();
        loadDeepLinkIfPresent(getIntent());
        restoreLastRemoteUrlIfLauncherColdStart();
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        // Capacitor 会在 super.onCreate 内部的 load() 里回调 onNewIntent（singleTask 冷启动深链场景），
        // 此时 nativeNavigation 尚未初始化，直接处理会 NPE 崩溃（实测深链冷启动闪退）。
        // 冷启动深链统一由 onCreate 末尾的 loadDeepLinkIfPresent(getIntent()) 处理；
        // 这里仅在导航层就绪后才处理，覆盖应用存活期间的热启动深链。
        if (nativeNavigation != null) {
            loadDeepLinkIfPresent(intent);
        }
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
                nativeNavigation.applyInsets(bars.top, bars.bottom, ime.bottom, imeHeightCap);
                int bottom = nativeNavigation.contentBottomInset(bars.bottom, ime.bottom, imeHeightCap);
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
                        if (nativeNavigation.isSettingsVisible()) {
                            nativeNavigation.showSettings(false);
                            return;
                        }
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
                    Uri source = Uri.parse(url);
                    if (!"https".equalsIgnoreCase(source.getScheme()) &&
                        !"http".equalsIgnoreCase(source.getScheme())) {
                        // blob 文件通过平台保存能力写入用户选择的位置；DownloadManager 只能处理网络 URI。
                        Toast.makeText(MainActivity.this, "无法下载此类型的链接", Toast.LENGTH_SHORT).show();
                        return;
                    }
                    DownloadManager.Request request = new DownloadManager.Request(source);
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
                    if (
                        Build.VERSION.SDK_INT <= 28 &&
                        ContextCompat.checkSelfPermission(this, Manifest.permission.WRITE_EXTERNAL_STORAGE) !=
                            PackageManager.PERMISSION_GRANTED
                    ) {
                        // API 24–28 的公共 Downloads 写入需要运行时授权；保留用户已发起的下载。
                        pendingDownloads.addLast(request);
                        if (!requestingStoragePermission) {
                            requestingStoragePermission = true;
                            storagePermissionLauncher.launch(Manifest.permission.WRITE_EXTERNAL_STORAGE);
                        }
                        return;
                    }
                    enqueueDownload(request);
                } catch (Exception error) {
                    Toast.makeText(MainActivity.this, "下载失败：" + error.getMessage(), Toast.LENGTH_LONG).show();
                }
            }
        );
    }

    private void enqueueDownload(DownloadManager.Request request) {
        try {
            DownloadManager manager = (DownloadManager) getSystemService(DOWNLOAD_SERVICE);
            manager.enqueue(request);
        } catch (Exception error) {
            Toast.makeText(this, "下载失败：" + error.getMessage(), Toast.LENGTH_LONG).show();
        }
    }

    /**
     * https://zcode.z.ai 深链：singleTask 下冷启动走 onCreate、热启动走 onNewIntent。
     * v4 链接先转为本地 UI 的连接配置；分享等其他同源路由仍由本地资产处理。
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
            if ("/remote/v4".equals(data.getPath())) {
                nativeNavigation.setLink(data.toString());
                nativeNavigation.selectWebTab("projects");
            }
            webView.loadUrl(toLocalEntryUrl(data));
            nativeNavigation.showSettings(false);
        }
    }

    /** 设置页只接受本站的完整 v4 配对链接，避免把任意网页当作应用入口载入。 */
    private void saveAndConnectRemoteLink(String raw) {
        Uri link;
        try {
            link = Uri.parse(raw);
            String timestamp = link.getQueryParameter("t");
            if (
                !"https".equalsIgnoreCase(link.getScheme()) ||
                !bridge.getHost().equalsIgnoreCase(link.getHost()) ||
                !"/remote/v4".equals(link.getPath()) ||
                link.getQueryParameter("sid") == null ||
                link.getQueryParameter("hash") == null ||
                timestamp == null ||
                Long.parseLong(timestamp) <= 0
            ) {
                throw new IllegalArgumentException("Invalid remote link");
            }
        } catch (RuntimeException error) {
            Toast.makeText(this, "请输入完整的 ZCode v4 远控链接", Toast.LENGTH_SHORT).show();
            return;
        }
        rememberLastRemoteUrl(link);
        nativeNavigation.setLink(link.toString());
        bridge.getWebView().loadUrl(toLocalEntryUrl(link));
        nativeNavigation.selectWebTab("projects");
        nativeNavigation.showSettings(false);
    }

    /** 原生底栏只改变本地 Web UI 的页签，不重新加载页面或断开远程会话。 */
    private void navigateToWebTab(String tab) {
        String fragment = "chat".equals(tab) ? "chat" : "projects";
        bridge.getWebView().evaluateJavascript("window.location.hash = '#" + fragment + "'", null);
    }

    private void onWebRouteChanged(String url) {
        if (nativeNavigation == null) return;
        String fragment = Uri.parse(url).getFragment();
        if ("chat".equals(fragment) || "projects".equals(fragment)) {
            nativeNavigation.selectWebTab(fragment);
        }
    }

    /**
     * 桌面图标冷启动时恢复最后一次 v4 连接配置，进入 APK 内置 UI。
     * 失效的配对由 Web 入口显示错误和重试操作，避免空白页。
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
            webView.loadUrl(toLocalEntryUrl(Uri.parse(last)));
        }
    }

    /** 仅记住 v4 配对链接；本地 SPA 的 / 与分享页不作为图标启动的恢复目标。 */
    private void rememberLastRemoteUrl(Uri url) {
        String path = url.getPath();
        if ("/remote/v4".equals(path)) {
            getSharedPreferences(SHELL_PREFS, MODE_PRIVATE)
                .edit()
                .putString(KEY_LAST_REMOTE_URL, url.toString())
                .apply();
        }
    }

    /**
     * 修复旧入口直接加载官网 /remote/v4 页面的问题：远控链接只提供配对参数，
     * 实际页面始终走 APK 内置的 packages/web 首页。
     */
    private String toLocalEntryUrl(Uri link) {
        if (!"/remote/v4".equals(link.getPath())) {
            return link.toString();
        }
        Uri.Builder local = new Uri.Builder()
            .scheme("https")
            .authority(bridge.getHost())
            .path("/")
            .appendQueryParameter("zcode-remote-v4", "1")
            .fragment("projects");
        for (String key : new String[] { "sid", "hash", "t", "mid", "name", "app_version" }) {
            String value = link.getQueryParameter(key);
            if (value != null) {
                local.appendQueryParameter(key, value);
            }
        }
        return local.build().toString();
    }
}
