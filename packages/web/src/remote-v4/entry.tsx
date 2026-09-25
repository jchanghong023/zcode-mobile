// v4 手机入口分流：查询参数命中时由本模块接管 root 渲染，否则返回 false 交还原启动路径。
// 收口成单文件调用，main.tsx 只保留一行分支，减小与上游入口的合并冲突面。
import type { createRoot } from "react-dom/client";
import type { IPlatformService } from "@zcode/shared";
import { MobileRemoteApp } from "./MobileRemoteApp.js";

export function renderMobileRemoteAppIfRequested(
  params: URLSearchParams,
  root: ReturnType<typeof createRoot>,
  createPlatform: () => IPlatformService,
): boolean {
  if (params.get("zcode-remote-v4") !== "1" && window.location.pathname !== "/remote/v4") {
    return false;
  }
  document.title = "ZCode - Remote";
  root.render(<MobileRemoteApp params={params} platform={createPlatform()} />);
  return true;
}
