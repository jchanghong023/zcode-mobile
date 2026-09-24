package dev.jchanghong.zcode;

import android.net.Uri;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebView;
import com.getcapacitor.Bridge;
import com.getcapacitor.BridgeWebViewClient;

/**
 * 官方同源宿主的请求分流（唯一所有者，见 apps/android/SPEC.md）：
 *
 * 界面与静态资源由 Capacitor 本地资产服务响应（含 html5mode 的 SPA 回退）；
 * 应用同源的 /api、/ws 放行（return null）给 WebView 自身网络栈直连官方服务；
 * /remote/* 同样放行：官方托管的手机远控客户端（/remote/v4/latest/*）不在本仓库源码内，
 * 由官方站点直接提供，与手机浏览器打开同一链接完全一致。
 * WebSocket 本身不经 shouldInterceptRequest，天然直连。
 */
public class ZCodeWebViewClient extends BridgeWebViewClient {

    // BridgeWebViewClient 的 bridge 字段为 private，子类需要自持引用以读取应用同源 host。
    private final Bridge bridgeRef;

    public ZCodeWebViewClient(Bridge bridge) {
        super(bridge);
        this.bridgeRef = bridge;
    }

    @Override
    public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
        Uri url = request.getUrl();
        String path = url.getPath();
        if (path != null && (path.startsWith("/api") || path.startsWith("/ws") || path.startsWith("/remote"))) {
            String appHost = bridgeRef.getHost();
            if (appHost != null && appHost.equalsIgnoreCase(url.getHost())) {
                return null;
            }
        }
        return super.shouldInterceptRequest(view, request);
    }
}
