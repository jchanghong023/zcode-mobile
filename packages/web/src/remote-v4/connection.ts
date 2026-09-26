import { connectViaProtocol } from "@zcode/client";
import { V4RpcBridge, encodeBase64, type Bridge } from "./frame.js";
import { RemoteConnectionError } from "./connectionRecovery.js";

interface Pairing {
  sid: string;
  hash: string;
  timestamp: number;
  mid?: string;
  appVersion?: string;
}

interface Workspace {
  kind: string;
  workspacePath: string;
  workspaceIdentity?: string;
  remoteSessionId?: string;
}

export interface V4WorkspaceTarget {
  workspacePath: string;
  workspaceIdentity?: string;
}

export interface V4ConnectionOptions {
  workspace?: V4WorkspaceTarget;
  taskId?: string;
}

export interface V4Connection {
  services: ReturnType<typeof connectViaProtocol>;
  bridge: Bridge;
  /** bootstrap 下发的全部可桥接工作区；桥接项在首位。用于项目页完整列表展示。 */
  availableWorkspaces: ReadonlyArray<{
    workspacePath: string;
    workspaceIdentity?: string;
  }>;
  isOpen: () => boolean;
  dispose: () => void;
}

interface Bootstrap {
  workspaces: Workspace[];
  mobileViewState?: { activeWorkspaceKey?: string; activeTaskId?: string };
  initialViewState?: { activeWorkspaceKey?: string; activeTaskId?: string };
}

interface RelayMessage {
  type?: string;
  nonce?: string;
  pair_status?: string;
  code?: string;
  payload?: Record<string, unknown>;
}

const textEncoder = new TextEncoder();
export function parseV4Pairing(params: URLSearchParams): Pairing | null {
  const sid = params.get("sid")?.trim();
  const hash = params.get("hash")?.trim();
  const timestamp = Number(params.get("t"));
  if (!sid || !hash || !Number.isFinite(timestamp) || timestamp <= 0) return null;
  return {
    sid,
    hash,
    timestamp,
    ...(params.get("mid") ? { mid: params.get("mid")! } : {}),
    ...(params.get("app_version") ? { appVersion: params.get("app_version")! } : {}),
  };
}

function workspaceKey(workspace: Workspace): string {
  return workspace.workspaceIdentity?.trim() || workspace.workspacePath;
}

function isBridgeable(workspace: Workspace): boolean {
  return (
    workspace.kind !== "remote" || Boolean(workspace.workspaceIdentity && workspace.remoteSessionId)
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export async function connectV4Remote(
  params: URLSearchParams,
  onDisconnect: (error: Error) => void,
  signal?: AbortSignal,
  options?: V4ConnectionOptions,
): Promise<V4Connection> {
  const pairing = parseV4Pairing(params);
  if (!pairing) throw new Error("Invalid v4 remote link");
  if (signal?.aborted) {
    const error = new Error("Remote connection canceled");
    error.name = "AbortError";
    throw error;
  }
  const url = new URL(`${location.protocol === "https:" ? "wss:" : "ws:"}//${location.host}/ws`);
  if (pairing.mid) url.searchParams.set("mid", pairing.mid);
  const socket = new WebSocket(url);
  let rpc: V4RpcBridge | undefined;
  let paired = false;
  let settled = false;
  let disposed = false;
  let pendingRequestId: string | undefined;
  let expectedBridgeSessionId: string | undefined;
  let lastBootstrapWorkspaces: Array<{ workspacePath: string; workspaceIdentity?: string }> = [];
  const timeout = window.setTimeout(
    () => fail(new RemoteConnectionError("Remote pairing timed out", true)),
    30_000,
  );

  const send = (value: object) => {
    if (socket.readyState !== WebSocket.OPEN) {
      throw new RemoteConnectionError("Remote socket is closed", true);
    }
    socket.send(JSON.stringify(value));
  };
  const sendPayload = (payload: object) => {
    send({ type: "data", payload, client_ts: Date.now() });
  };

  let resolveConnection!: (result: V4Connection) => void;
  let rejectConnection!: (reason: Error) => void;
  const connection = new Promise<V4Connection>((resolve, reject) => {
    resolveConnection = resolve;
    rejectConnection = reject;
  });

  const onAbort = () => {
    if (disposed) return;
    disposed = true;
    window.clearTimeout(timeout);
    rpc?.dispose();
    socket.close();
    if (!settled) {
      settled = true;
      const error = new Error("Remote connection canceled");
      error.name = "AbortError";
      rejectConnection(error);
    }
  };
  signal?.addEventListener("abort", onAbort, { once: true });

  function fail(error: Error) {
    if (disposed) return;
    disposed = true;
    signal?.removeEventListener("abort", onAbort);
    window.clearTimeout(timeout);
    rpc?.dispose();
    socket.close();
    if (settled) {
      onDisconnect(error);
    } else {
      settled = true;
      rejectConnection(error);
    }
  }

  socket.addEventListener("open", () => {
    send({
      type: "auth_init",
      role: "terminal",
      device_sid: pairing.sid,
      meta: { platform: "web", version: pairing.appVersion ?? "web", name: "mobile-browser" },
      client_ts: Date.now(),
    });
  });

  socket.addEventListener("message", (event: MessageEvent<string>) => {
    void (async () => {
      let message: RelayMessage;
      try {
        message = JSON.parse(event.data) as RelayMessage;
      } catch {
        return;
      }
      if (message.type === "auth_challenge" && message.nonce) {
        const key = await crypto.subtle.importKey(
          "raw",
          textEncoder.encode(pairing.hash),
          { name: "HMAC", hash: "SHA-256" },
          false,
          ["sign"],
        );
        const signed = await crypto.subtle.sign(
          "HMAC",
          key,
          textEncoder.encode(`${message.nonce}|terminal|${pairing.sid}`),
        );
        const proof = encodeBase64(new Uint8Array(signed))
          .replaceAll("+", "-")
          .replaceAll("/", "_")
          .replace(/=+$/u, "");
        send({ type: "auth_response", device_sid: pairing.sid, proof, client_ts: Date.now() });
        return;
      }
      if (
        (message.type === "auth_ack" || message.type === "pair_status_ack") &&
        message.pair_status === "matched"
      ) {
        if (!paired) {
          paired = true;
          pendingRequestId = crypto.randomUUID();
          sendPayload({ zcode_type: "bootstrap-request", requestId: pendingRequestId });
        } else {
          rpc?.replayUnacknowledged();
        }
        return;
      }
      if (message.type === "error") {
        fail(new Error(`Remote relay error: ${message.code ?? "unknown"}`));
        return;
      }
      if (message.type !== "data" || !isRecord(message.payload)) return;
      const payload = message.payload;
      if (rpc?.accept(payload)) return;
      if (payload.zcode_type === "bootstrap-response" && payload.requestId === pendingRequestId) {
        const result = payload.result as Bootstrap | undefined;
        const available = result?.workspaces?.filter(isBridgeable) ?? [];
        // 保存全量可桥接列表：桥接只选一个 workspace，但项目页要展示全部。
        lastBootstrapWorkspaces = available.map((item) => ({
          workspacePath: item.workspacePath,
          ...(item.workspaceIdentity ? { workspaceIdentity: item.workspaceIdentity } : {}),
        }));
        const preferred = result?.mobileViewState ?? result?.initialViewState;
        const requested = options?.workspace;
        const workspace = requested
          ? available.find(
              (item) =>
                item.workspacePath === requested.workspacePath &&
                (item.workspaceIdentity ?? undefined) === (requested.workspaceIdentity ?? undefined),
            )
          : (available.find((item) => workspaceKey(item) === preferred?.activeWorkspaceKey) ??
            available[0]);
        if (!workspace) {
          fail(new Error(requested ? "所选项目当前不可连接" : "No bridgeable desktop workspace"));
          return;
        }
        pendingRequestId = crypto.randomUUID();
        const bridgeSessionId = crypto.randomUUID();
        expectedBridgeSessionId = bridgeSessionId;
        sendPayload({
          zcode_type: "workspace-bridge-open",
          requestId: pendingRequestId,
          bridgeSessionId,
          bridgeGeneration: 1,
          workspaceKey: workspaceKey(workspace),
          ...(options?.taskId
            ? { taskId: options.taskId }
            : preferred?.activeTaskId && workspaceKey(workspace) === preferred.activeWorkspaceKey
              ? { taskId: preferred.activeTaskId }
              : {}),
        });
        return;
      }
      if (payload.zcode_type === "workspace-bridge-ready" && isRecord(payload.bridge)) {
        const bridge = payload.bridge as unknown as Bridge;
        if (
          bridge.bridgeSessionId !== expectedBridgeSessionId ||
          bridge.bridgeGeneration !== 1 ||
          !bridge.workspacePath
        ) {
          fail(new Error("Invalid remote workspace bridge"));
          return;
        }
        rpc = new V4RpcBridge(bridge, sendPayload);
        settled = true;
        signal?.removeEventListener("abort", onAbort);
        window.clearTimeout(timeout);
        resolveConnection({
          services: connectViaProtocol(rpc.protocol),
          bridge,
          // bootstrap 全量列表 + 桥接项置顶；顺序供项目页展示与去重使用。
          availableWorkspaces: [
            {
              workspacePath: bridge.workspacePath,
              ...(bridge.workspaceIdentity ? { workspaceIdentity: bridge.workspaceIdentity } : {}),
            },
            ...lastBootstrapWorkspaces.filter(
              (item) =>
                item.workspacePath !== bridge.workspacePath ||
                (item.workspaceIdentity ?? undefined) !== (bridge.workspaceIdentity ?? undefined),
            ),
          ],
          isOpen: () => socket.readyState === WebSocket.OPEN,
          dispose: () => {
            disposed = true;
            signal?.removeEventListener("abort", onAbort);
            rpc?.dispose();
            socket.close();
          },
        });
      }
    })().catch((error: unknown) => {
      fail(error instanceof Error ? error : new Error(String(error)));
    });
  });

  socket.addEventListener("error", () =>
    fail(new RemoteConnectionError("Remote WebSocket failed", true)),
  );
  socket.addEventListener("close", () =>
    fail(new RemoteConnectionError("Remote WebSocket closed", true)),
  );
  return connection;
}
