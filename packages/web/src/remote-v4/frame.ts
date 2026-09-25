import { Emitter, VSBuffer } from "@zcode/rpc";

export interface Bridge {
  bridgeSessionId: string;
  bridgeGeneration: number;
  workspaceKey: string;
  workspacePath: string;
  workspaceIdentity?: string;
  initialTaskId?: string;
}

interface RpcFrame {
  zcode_type: "rpc-frame";
  bridgeSessionId: string;
  bridgeGeneration: number;
  seq: number;
  messageSeq: number;
  fragmentIndex: number;
  fragmentCount: number;
  messageBytes: number;
  checksum: { algorithm: "crc32"; value: string };
  dataBase64: string;
}

interface PendingMessage {
  fragmentCount: number;
  messageBytes: number;
  checksum: string;
  fragments: Array<Uint8Array | undefined>;
  received: number;
}

const crcTable = Uint32Array.from({ length: 256 }, (_, index) => {
  let value = index;
  for (let bit = 0; bit < 8; bit += 1) {
    value = (value >>> 1) ^ (value & 1 ? 0xedb88320 : 0);
  }
  return value >>> 0;
});

// 热路径改为四路查表，每次迭代处理四个字节。中继使用反射形式的
// CRC-32/ISO-HDLC，因此该表与上面的逐字节实现等价。
const crcTable1 = Uint32Array.from(
  { length: 256 },
  (_, index) => ((crcTable[index]! >>> 8) ^ crcTable[crcTable[index]! & 0xff]!) >>> 0,
);
const crcTable2 = Uint32Array.from(
  { length: 256 },
  (_, index) => ((crcTable1[index]! >>> 8) ^ crcTable[crcTable1[index]! & 0xff]!) >>> 0,
);
const crcTable3 = Uint32Array.from(
  { length: 256 },
  (_, index) => ((crcTable2[index]! >>> 8) ^ crcTable[crcTable2[index]! & 0xff]!) >>> 0,
);

function crc32(bytes: Uint8Array): string {
  let value = 0xffffffff;
  let index = 0;
  for (; index + 4 <= bytes.length; index += 4) {
    value ^=
      bytes[index]! |
      (bytes[index + 1]! << 8) |
      (bytes[index + 2]! << 16) |
      (bytes[index + 3]! << 24);
    value =
      crcTable3[value & 0xff]! ^
      crcTable2[(value >>> 8) & 0xff]! ^
      crcTable1[(value >>> 16) & 0xff]! ^
      crcTable[(value >>> 24) & 0xff]!;
  }
  // 尾部不足四字节时逐字节处理，避免创建临时补齐缓冲区。
  for (; index < bytes.length; index += 1) {
    value = crcTable[(value ^ bytes[index]!) & 0xff]! ^ (value >>> 8);
  }
  return ((value ^ 0xffffffff) >>> 0).toString(16).padStart(8, "0");
}

export function encodeBase64(bytes: Uint8Array): string {
  const nativeBase64 = (bytes as Uint8Array & { toBase64?: () => string }).toBase64;
  if (typeof nativeBase64 === "function") return nativeBase64.call(bytes);

  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  }
  return btoa(binary);
}

function decodeBase64(value: string): Uint8Array {
  const nativeFromBase64 = (
    Uint8Array as typeof Uint8Array & { fromBase64?: (input: string) => Uint8Array }
  ).fromBase64;
  if (typeof nativeFromBase64 === "function") return nativeFromBase64(value);

  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  // 保持单个紧凑的索引循环；Uint8Array.from 会在 Chromium 中为每个字节
  // 调用回调，流式 RPC 输出下会产生额外开销。
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

/**
 * 官方 v4 relay 只转发配对与已确认的 RPC 帧；此适配器唯一持有序号和 ACK。
 * 页面 UI 继续使用 @zcode/client 的服务代理，不复制服务端状态。
 */
export class V4RpcBridge {
  private readonly messages = new Emitter<VSBuffer>();
  private readonly pending = new Map<number, PendingMessage>();
  private physicalSeq = 1;
  private messageSeq = 1;
  private lastInboundMessageSeq = 0;
  private lastAckedMessageSeq = 0;
  private readonly outbound = new Map<number, RpcFrame[]>();

  readonly protocol = {
    onMessage: this.messages.event,
    send: (buffer: VSBuffer) => this.send(buffer.buffer),
    drain: () => Promise.resolve(),
  };

  constructor(
    private readonly bridge: Bridge,
    private readonly sendPayload: (payload: object) => void,
  ) {}

  accept(payload: Record<string, unknown>): boolean {
    if (payload.bridgeSessionId !== this.bridge.bridgeSessionId) return false;
    if (payload.bridgeGeneration !== this.bridge.bridgeGeneration) return false;
    if (payload.zcode_type === "rpc-frame-ack") {
      const ack = payload.ackMessageSeq;
      if (typeof ack === "number" && ack >= this.lastAckedMessageSeq && ack < this.messageSeq) {
        this.lastAckedMessageSeq = ack;
        for (const seq of this.outbound.keys()) if (seq <= ack) this.outbound.delete(seq);
      }
      return true;
    }
    if (payload.zcode_type !== "rpc-frame") return false;
    const frame = payload as unknown as RpcFrame;
    if (
      !Number.isSafeInteger(frame.messageSeq) ||
      !Number.isSafeInteger(frame.fragmentIndex) ||
      !Number.isSafeInteger(frame.fragmentCount) ||
      !Number.isSafeInteger(frame.messageBytes) ||
      frame.fragmentCount < 1 ||
      frame.fragmentCount > 64 ||
      frame.messageBytes < 1 ||
      frame.messageBytes > 16 * 1024 * 1024 ||
      frame.fragmentIndex < 0 ||
      frame.fragmentIndex >= frame.fragmentCount ||
      frame.checksum?.algorithm !== "crc32" ||
      typeof frame.dataBase64 !== "string"
    ) {
      throw new Error("Invalid v4 RPC frame");
    }
    if (frame.messageSeq <= this.lastInboundMessageSeq) {
      this.ack(this.lastInboundMessageSeq);
      return true;
    }
    let message = this.pending.get(frame.messageSeq);
    if (!message) {
      message = {
        fragmentCount: frame.fragmentCount,
        messageBytes: frame.messageBytes,
        checksum: frame.checksum.value,
        fragments: new Array(frame.fragmentCount),
        received: 0,
      };
      this.pending.set(frame.messageSeq, message);
    }
    if (
      message.fragmentCount !== frame.fragmentCount ||
      message.messageBytes !== frame.messageBytes ||
      message.checksum !== frame.checksum.value
    ) {
      throw new Error("Conflicting v4 RPC fragments");
    }
    const bytes = decodeBase64(frame.dataBase64);
    if (!message.fragments[frame.fragmentIndex]) {
      message.fragments[frame.fragmentIndex] = bytes;
      message.received += 1;
    }
    if (message.received !== message.fragmentCount) return true;
    const joined = new Uint8Array(message.messageBytes);
    let offset = 0;
    for (const part of message.fragments) {
      if (!part || offset + part.length > joined.length) throw new Error("Invalid v4 RPC length");
      joined.set(part, offset);
      offset += part.length;
    }
    if (offset !== joined.length || crc32(joined) !== message.checksum) {
      throw new Error("Invalid v4 RPC checksum");
    }
    this.pending.delete(frame.messageSeq);
    this.lastInboundMessageSeq = frame.messageSeq;
    this.messages.fire(VSBuffer.wrap(joined));
    this.ack(frame.messageSeq);
    return true;
  }

  private ack(messageSeq: number): void {
    this.sendPayload({
      zcode_type: "rpc-frame-ack",
      bridgeSessionId: this.bridge.bridgeSessionId,
      bridgeGeneration: this.bridge.bridgeGeneration,
      ackMessageSeq: messageSeq,
    });
  }

  private send(bytes: Uint8Array): void {
    if (bytes.length === 0 || bytes.length > 16 * 1024 * 1024) throw new Error("Invalid RPC size");
    // 256 KiB 片连同 base64/JSON 仍低于 relay 的 1 MiB 帧上限；64 片可覆盖 16 MiB 消息。
    const chunkSize = 256 * 1024;
    const fragmentCount = Math.ceil(bytes.length / chunkSize);
    if (fragmentCount > 64) throw new Error("RPC fragment limit exceeded");
    const checksum = { algorithm: "crc32" as const, value: crc32(bytes) };
    const messageSeq = this.messageSeq++;
    const frames: RpcFrame[] = [];
    for (let index = 0; index < fragmentCount; index += 1) {
      frames.push({
        zcode_type: "rpc-frame",
        bridgeSessionId: this.bridge.bridgeSessionId,
        bridgeGeneration: this.bridge.bridgeGeneration,
        seq: this.physicalSeq++,
        messageSeq,
        fragmentIndex: index,
        fragmentCount,
        messageBytes: bytes.length,
        checksum,
        dataBase64: encodeBase64(bytes.subarray(index * chunkSize, (index + 1) * chunkSize)),
      });
    }
    this.outbound.set(messageSeq, frames);
    for (const frame of frames) this.sendPayload(frame);
  }

  replayUnacknowledged(): void {
    for (const frames of this.outbound.values()) {
      for (const frame of frames) this.sendPayload(frame);
    }
  }

  dispose(): void {
    this.messages.dispose();
    this.pending.clear();
    this.outbound.clear();
  }
}
