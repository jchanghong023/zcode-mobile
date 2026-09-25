import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AppErrorBoundary,
  Root,
  ZCodeIntlProvider,
  registerRemoteWorkspaceSession,
  unregisterRemoteWorkspaceSession,
  useRemoteWorkspaceSessionStore,
} from "@zcode/ui";
import type { IPlatformService } from "@zcode/shared";
import { connectV4Remote, type V4Connection } from "./connection.js";
import "./mobile.css";

interface Props {
  params: URLSearchParams;
  platform: IPlatformService;
}

function currentTab(): "projects" | "chat" {
  return window.location.hash === "#chat" ? "chat" : "projects";
}

function remoteSessionIdOf(connection: V4Connection): string {
  return `v4-${connection.bridge.bridgeSessionId}`;
}

/** 断开或换代时注销 identity 绑定的 remote session，避免残留的 services 指向已关闭连接。 */
function teardownConnection(connection: V4Connection | null): void {
  if (!connection) return;
  unregisterRemoteWorkspaceSession(remoteSessionIdOf(connection));
  connection.dispose();
}

export function MobileRemoteApp({ params, platform }: Props) {
  const [tab, setTab] = useState(currentTab);
  const [connection, setConnection] = useState<V4Connection | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [recentProjects, setRecentProjects] = useState<ReadonlyArray<string>>([]);
  const activeConnection = useRef<V4Connection | null>(null);
  const mounted = useRef(true);

  const connect = useCallback(async () => {
    setError(null);
    setRecentProjects([]);
    let next: V4Connection;
    try {
      next = await connectV4Remote(params, (reason) => {
        if (activeConnection.current !== next || !mounted.current) return;
        activeConnection.current = null;
        teardownConnection(next);
        setConnection(null);
        setError(reason.message);
      });
    } catch (reason) {
      if (mounted.current) setError(reason instanceof Error ? reason.message : String(reason));
      return;
    }
    if (!mounted.current) {
      teardownConnection(next);
      return;
    }
    teardownConnection(activeConnection.current);
    activeConnection.current = next;
    // v4 工作区带 identity，会被 workspace services 判定为 remote 目标；
    // 必须把这条连接注册为 identity 绑定的 remote session，聊天面板的
    // V4ConversationProvider 才能拿到 rpcReady=true，否则一直渲染 null。
    registerRemoteWorkspaceSession({
      sessionId: remoteSessionIdOf(next),
      services: next.services,
    });
    const sessionRegistry = useRemoteWorkspaceSessionStore.getState();
    if (next.bridge.workspaceIdentity) {
      sessionRegistry.bindWorkspaceIdentity(next.bridge.workspaceIdentity, remoteSessionIdOf(next));
    } else {
      sessionRegistry.bindWorkspacePath(next.bridge.workspacePath, remoteSessionIdOf(next));
    }
    setConnection(next);
    // 桌面端最近项目是项目页列表的兜底数据源；读取失败不阻塞主连接。
    try {
      const settings = await next.services.settingService.get();
      // 旧连接的设置请求可能晚于新桥接返回，不能把旧项目列表写进新连接。
      if (
        mounted.current &&
        activeConnection.current === next &&
        Array.isArray(settings?.recentProjects)
      ) {
        setRecentProjects(settings.recentProjects);
      }
    } catch {
      /* 项目页仍有 bootstrap 工作区列表可用 */
    }
  }, [params]);

  useEffect(() => {
    mounted.current = true;
    const updateTab = () => setTab(currentTab());
    window.addEventListener("hashchange", updateTab);
    void connect();
    return () => {
      mounted.current = false;
      teardownConnection(activeConnection.current);
      activeConnection.current = null;
      window.removeEventListener("hashchange", updateTab);
    };
  }, [connect]);

  // 项目页完整列表 = 桥接/可桥接工作区（带 identity）+ 桌面端最近项目（path 兜底），按路径去重。
  const initialWorkspaceTabs = useMemo(() => {
    const byPath = new Map<string, { workspacePath: string; workspaceIdentity?: string }>();
    for (const item of connection?.availableWorkspaces ?? []) {
      byPath.set(item.workspacePath, item);
    }
    for (const path of recentProjects) {
      if (path && !byPath.has(path)) byPath.set(path, { workspacePath: path });
    }
    return [...byPath.values()];
  }, [connection, recentProjects]);

  return (
    <div
      className="zcode-v4-mobile relative size-full min-h-0 bg-background text-foreground"
      data-mobile-tab={tab}
    >
      {connection ? (
        <AppErrorBoundary>
          <ZCodeIntlProvider
            settingService={connection.services.settingService}
            broadcastService={connection.services.broadcastService}
          >
            <Root
              key={connection.bridge.bridgeSessionId}
              services={connection.services}
              platform={platform}
              initialWorkspaceAbsPath={connection.bridge.workspacePath}
              initialWorkspaceIdentity={connection.bridge.workspaceIdentity}
              initialTaskId={connection.bridge.initialTaskId}
              initialWorkspaceTabs={initialWorkspaceTabs}
              restoreSession={false}
              allowOpenWorkspace={false}
              allowRemoteWorkspace={false}
              supportsSettings={false}
              preferDirectoryBrowser
              supportsEmbeddedBrowser={false}
            />
          </ZCodeIntlProvider>
        </AppErrorBoundary>
      ) : (
        <div className="flex size-full flex-col items-center justify-center gap-3 px-6 text-ui-base">
          <p>{error ?? "正在连接桌面端…"}</p>
          {error ? (
            <button
              type="button"
              onClick={() => void connect()}
              className="rounded-lg border border-border px-4 py-2"
            >
              重试
            </button>
          ) : null}
        </div>
      )}
    </div>
  );
}
