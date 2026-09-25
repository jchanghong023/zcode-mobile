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
