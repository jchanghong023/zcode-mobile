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
import {
  isRetryableRemoteError,
  RemoteConnectionError,
  RESUME_PROBE_AFTER_MS,
  RESUME_PROBE_TIMEOUT_MS,
  retryDelayMs,
} from "./connectionRecovery.js";
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
  const pendingConnect = useRef<AbortController | null>(null);
  const retryTimer = useRef<number | null>(null);
  const failedAttempts = useRef(0);
  const automaticRetry = useRef(true);
  const hiddenAt = useRef<number | null>(null);
  const probingConnection = useRef<V4Connection | null>(null);
  const connectRef = useRef<() => void>(() => {});
  const mounted = useRef(true);

  const clearRetry = useCallback(() => {
    if (retryTimer.current !== null) {
      window.clearTimeout(retryTimer.current);
      retryTimer.current = null;
    }
  }, []);

  const handleFailure = useCallback(
    (reason: Error) => {
      if (!mounted.current) return;
      setError(reason.message);
      automaticRetry.current = isRetryableRemoteError(reason);
      if (!automaticRetry.current) return;
      const delay = retryDelayMs(++failedAttempts.current);
      // 后台计时器会被 WebView 节流；回来时直接重试，避免恢复后继续等待旧倒计时。
      if (document.hidden) return;
      clearRetry();
      retryTimer.current = window.setTimeout(() => {
        retryTimer.current = null;
        connectRef.current();
      }, delay);
    },
    [clearRetry],
  );

  const connect = useCallback(async () => {
    if (!mounted.current || pendingConnect.current || activeConnection.current) return;
    clearRetry();
    setError(null);
    setRecentProjects([]);
    const abort = new AbortController();
    pendingConnect.current = abort;
    let next: V4Connection;
    try {
      next = await connectV4Remote(
        params,
        (reason) => {
          if (activeConnection.current !== next || !mounted.current) return;
          activeConnection.current = null;
          teardownConnection(next);
          setConnection(null);
          handleFailure(reason);
        },
        abort.signal,
      );
    } catch (reason) {
      if (pendingConnect.current === abort) pendingConnect.current = null;
      if (!mounted.current) return;
      if (reason instanceof Error && reason.name === "AbortError") {
        if (!document.hidden && automaticRetry.current) connectRef.current();
        return;
      }
      handleFailure(reason instanceof Error ? reason : new Error(String(reason)));
      return;
    }
    if (pendingConnect.current === abort) pendingConnect.current = null;
    if (!mounted.current || abort.signal.aborted) {
      teardownConnection(next);
      return;
    }
    if (!next.isOpen()) {
      // 握手刚成功时的关闭事件可能早于 await 恢复；此时尚无 activeConnection 接收断线回调。
      teardownConnection(next);
      handleFailure(new RemoteConnectionError("Remote WebSocket closed", true));
      return;
    }
    teardownConnection(activeConnection.current);
    activeConnection.current = next;
    failedAttempts.current = 0;
    automaticRetry.current = true;
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
  }, [clearRetry, handleFailure, params]);
  connectRef.current = () => void connect();

  const replaceStaleConnection = useCallback((stale: V4Connection) => {
    if (!mounted.current || activeConnection.current !== stale) return;
    // 返回前台时 WebSocket 可能仍报 OPEN，但 RPC 已无法往返；重新配对并
    // 建立新桥接，旧代服务先注销，避免迟到响应污染恢复后的会话。
    activeConnection.current = null;
    teardownConnection(stale);
    setConnection(null);
    failedAttempts.current = 0;
    automaticRetry.current = true;
    connectRef.current();
  }, []);

  const probeConnection = useCallback(
    (current: V4Connection) => {
      if (probingConnection.current === current) return;
      probingConnection.current = current;
      let timeoutId: number | null = null;
      const timeout = new Promise<never>((_, reject) => {
        timeoutId = window.setTimeout(
          () => reject(new Error("Remote connection probe timed out")),
          RESUME_PROBE_TIMEOUT_MS,
        );
      });
      void Promise.race([
        Promise.resolve().then(() => current.services.settingService.get()),
        timeout,
      ])
        .catch(() => replaceStaleConnection(current))
        .finally(() => {
          if (timeoutId !== null) window.clearTimeout(timeoutId);
          if (probingConnection.current === current) probingConnection.current = null;
        });
    },
    [replaceStaleConnection],
  );

  useEffect(() => {
    mounted.current = true;
    const updateTab = () => setTab(currentTab());
    const resumeConnection = (forceProbe: boolean) => {
      if (document.hidden) return;
      const current = activeConnection.current;
      if (!current) {
        if (automaticRetry.current) {
          clearRetry();
          connectRef.current();
        }
        return;
      }
      if (!current.isOpen()) {
        replaceStaleConnection(current);
        return;
      }
      if (forceProbe) probeConnection(current);
    };
    const onVisibilityChange = () => {
      if (document.hidden) {
        hiddenAt.current = Date.now();
        clearRetry();
        pendingConnect.current?.abort();
        return;
      }
      const backgroundDuration = hiddenAt.current === null ? 0 : Date.now() - hiddenAt.current;
      hiddenAt.current = null;
      resumeConnection(backgroundDuration >= RESUME_PROBE_AFTER_MS);
    };
    const onOnline = () => {
      // 网络恢复后旧握手可能仍在等待超时；取消后由 AbortError 路径立即发起新连接。
      if (pendingConnect.current) {
        pendingConnect.current.abort();
        return;
      }
      resumeConnection(true);
    };
    window.addEventListener("hashchange", updateTab);
    window.addEventListener("online", onOnline);
    document.addEventListener("visibilitychange", onVisibilityChange);
    void connect();
    return () => {
      mounted.current = false;
      clearRetry();
      pendingConnect.current?.abort();
      pendingConnect.current = null;
      teardownConnection(activeConnection.current);
      activeConnection.current = null;
      window.removeEventListener("hashchange", updateTab);
      window.removeEventListener("online", onOnline);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [clearRetry, connect, probeConnection, replaceStaleConnection]);

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
              onClick={() => {
                automaticRetry.current = true;
                failedAttempts.current = 0;
                void connect();
              }}
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
