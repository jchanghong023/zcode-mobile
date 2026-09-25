/** 仅把网络中断和握手超时交给自动重连；明确的协议/配对拒绝留给用户处理。 */
export class RemoteConnectionError extends Error {
  constructor(
    message: string,
    readonly retryable: boolean,
  ) {
    super(message);
    this.name = "RemoteConnectionError";
  }
}

export function isRetryableRemoteError(error: unknown): boolean {
  return error instanceof RemoteConnectionError && error.retryable;
}

export function retryDelayMs(failedAttempts: number): number {
  return Math.min(30_000, 1_000 * 2 ** Math.min(Math.max(failedAttempts - 1, 0), 5));
}

export const RESUME_PROBE_AFTER_MS = 15_000;
export const RESUME_PROBE_TIMEOUT_MS = 8_000;
