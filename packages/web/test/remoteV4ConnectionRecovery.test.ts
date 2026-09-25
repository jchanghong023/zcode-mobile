import assert from "node:assert/strict";
import test from "node:test";
import { connectV4Remote } from "../src/remote-v4/connection.js";
import { isRetryableRemoteError, retryDelayMs } from "../src/remote-v4/connectionRecovery.js";

test("retries are bounded and invalid pairing stops automatic recovery", async () => {
  assert.deepEqual(
    [1, 2, 3, 4, 5, 6, 7].map(retryDelayMs),
    [1_000, 2_000, 4_000, 8_000, 16_000, 30_000, 30_000],
  );
  await assert.rejects(
    connectV4Remote(new URLSearchParams(), () => {}),
    (error: unknown) => error instanceof Error && !isRetryableRemoteError(error),
  );
});

test("canceled pairing closes its socket; an established network loss is retryable", async () => {
  const previousWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
  const previousLocation = Object.getOwnPropertyDescriptor(globalThis, "location");
  const previousWebSocket = Object.getOwnPropertyDescriptor(globalThis, "WebSocket");
  const sockets: FakeWebSocket[] = [];

  class FakeWebSocket {
    static readonly OPEN = 1;
    readyState = 0;
    readonly sent: Array<Record<string, unknown>> = [];
    private readonly listeners = new Map<string, Array<(event: { data?: string }) => void>>();

    constructor(readonly url: string) {
      sockets.push(this);
    }

    addEventListener(type: string, listener: (event: { data?: string }) => void): void {
      const listeners = this.listeners.get(type) ?? [];
      listeners.push(listener);
      this.listeners.set(type, listeners);
    }

    send(raw: string): void {
      this.sent.push(JSON.parse(raw) as Record<string, unknown>);
    }

    emit(type: string, payload?: object): void {
      const event = payload ? { data: JSON.stringify(payload) } : {};
      for (const listener of this.listeners.get(type) ?? []) listener(event);
    }

    open(): void {
      this.readyState = FakeWebSocket.OPEN;
      this.emit("open");
    }

    close(): void {
      this.readyState = 3;
      this.emit("close");
    }
  }

  Object.defineProperty(globalThis, "window", { configurable: true, value: globalThis });
  Object.defineProperty(globalThis, "location", {
    configurable: true,
    value: { protocol: "https:", host: "relay.example" },
  });
  Object.defineProperty(globalThis, "WebSocket", { configurable: true, value: FakeWebSocket });

  try {
    const params = new URLSearchParams("sid=test&hash=test&t=1");
    const abort = new AbortController();
    let canceledDisconnects = 0;
    const canceled = connectV4Remote(params, () => canceledDisconnects++, abort.signal);
    abort.abort();
    await assert.rejects(canceled, { name: "AbortError" });
    assert.equal(sockets[0]?.readyState, 3);
    assert.equal(canceledDisconnects, 0);

    let disconnectReason: Error | null = null;
    const connected = connectV4Remote(params, (reason) => {
      disconnectReason = reason;
    });
    const socket = sockets[1]!;
    socket.open();
    socket.emit("message", { type: "auth_ack", pair_status: "matched" });
    const bootstrap = socket.sent.at(-1)?.payload as { requestId: string };
    socket.emit("message", {
      type: "data",
      payload: {
        zcode_type: "bootstrap-response",
        requestId: bootstrap.requestId,
        result: { workspaces: [{ kind: "local", workspacePath: "/work" }] },
      },
    });
    const open = socket.sent.at(-1)?.payload as {
      requestId: string;
      bridgeSessionId: string;
    };
    socket.emit("message", {
      type: "data",
      payload: {
        zcode_type: "workspace-bridge-ready",
        requestId: open.requestId,
        bridge: {
          bridgeSessionId: open.bridgeSessionId,
          bridgeGeneration: 1,
          workspaceKey: "/work",
          workspacePath: "/work",
        },
      },
    });
    const session = await connected;
    assert.equal(session.isOpen(), true);
    socket.close();
    assert.equal(session.isOpen(), false);
    assert.equal(isRetryableRemoteError(disconnectReason), true);
  } finally {
    for (const [name, descriptor] of [
      ["window", previousWindow],
      ["location", previousLocation],
      ["WebSocket", previousWebSocket],
    ] as const) {
      if (descriptor) Object.defineProperty(globalThis, name, descriptor);
      else Reflect.deleteProperty(globalThis, name);
    }
  }
});
