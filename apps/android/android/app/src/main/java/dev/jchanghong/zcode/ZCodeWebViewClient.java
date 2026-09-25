package dev.jchanghong.zcode;

import android.net.Uri;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebView;
import com.getcapacitor.Bridge;
import com.getcapacitor.BridgeWebViewClient;
import java.util.function.Consumer;

/**
 * 同源请求分流的唯一所有者：页面与静态资源从 APK 本地资产读取，
 * /api 与 /ws 交给 WebView 网络栈直连官方服务。WebSocket 不经过此拦截器。
 */
public class ZCodeWebViewClient extends BridgeWebViewClient {

    // BridgeWebViewClient 的 bridge 字段为 private，子类需要自持引用以读取应用同源 host。
    private final Bridge bridgeRef;
    private final Consumer<String> routeChanged;

    public ZCodeWebViewClient(Bridge bridge, Consumer<String> routeChanged) {
        super(bridge);
        this.bridgeRef = bridge;
        this.routeChanged = routeChanged;
    }

    @Override
    public void doUpdateVisitedHistory(WebView view, String url, boolean isReload) {
        super.doUpdateVisitedHistory(view, url, isReload);
        routeChanged.accept(url);
    }

    @Override
    public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
        Uri url = request.getUrl();
        String path = url.getPath();
        if (path != null && (path.startsWith("/api") || path.startsWith("/ws"))) {
            String appHost = bridgeRef.getHost();
            if (appHost != null && appHost.equalsIgnoreCase(url.getHost())) {
                return null;
            }
        }
        return super.shouldInterceptRequest(view, request);
    }
}
