// Android v4 远控手机视口的壳层判定与页签导航。
// Fork 专属逻辑集中于此，避免散落在上游布局组件里制造合并冲突。

/** 当前页面是否运行在 Android v4 远控手机视口（壳层深链注入的查询参数）。 */
export function isMobileRemoteV4Page(): boolean {
  return (
    typeof window !== "undefined" &&
    new URLSearchParams(window.location.search).get("zcode-remote-v4") === "1"
  );
}

/** 切到手机「聊天」页签；与原生底栏共用 hash 协议，不重载页面、不断开 v4 连接。 */
export function navigateToMobileChatTab(): void {
  window.location.hash = "chat";
}

export interface MobileRemoteWorkspaceRequest {
  workspacePath: string;
  workspaceIdentity?: string;
  taskId?: string;
}

const MOBILE_REMOTE_WORKSPACE_REQUEST = "zcode:mobile-remote-workspace-request";

/** 返回 true 表示远控入口已接管跨项目桥接，调用方不能先切入未连接的聊天页。 */
export function requestMobileRemoteWorkspace(request: MobileRemoteWorkspaceRequest): boolean {
  const event = new CustomEvent<MobileRemoteWorkspaceRequest>(MOBILE_REMOTE_WORKSPACE_REQUEST, {
    cancelable: true,
    detail: request,
  });
  window.dispatchEvent(event);
  return event.defaultPrevented;
}

export function onMobileRemoteWorkspaceRequest(
  listener: (event: CustomEvent<MobileRemoteWorkspaceRequest>) => void,
): () => void {
  window.addEventListener(MOBILE_REMOTE_WORKSPACE_REQUEST, listener as EventListener);
  return () => window.removeEventListener(MOBILE_REMOTE_WORKSPACE_REQUEST, listener as EventListener);
}
