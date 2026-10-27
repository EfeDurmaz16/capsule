import type { ProtocolErrorCode } from "./wire.js";

// Framing of bridge protocol v1: a u32 little-endian length N, then exactly N bytes of UTF-8 holding
// one JSON object and nothing after it. This is Fabric's client framing (fabric-client/src/frame.rs,
// sdk/typescript/src/frame.ts) reused as is. A reader checks N against its cap before it buffers a
// single body byte, so an oversize frame is refused unread.

const HEADER_BYTES = 4;

/** A framing failure. It cannot be resynchronized: the worker answers it once and exits. */
export class FrameError extends Error {
  constructor(
    readonly code: Exclude<ProtocolErrorCode, "unexpected">,
    message: string
  ) {
    super(message);
    this.name = "FrameError";
  }
}

/**
 * Incremental frame reader. `cap` is read for every header, so the cap can drop from the handshake
 * limit to the negotiated one between frames.
 */
export class FrameReader {
  private chunks: Buffer[] = [];
  private buffered = 0;
  private bodyLength: number | undefined;

  constructor(private readonly cap: () => number) {}

  /** Bytes buffered and not yet returned as a frame. */
  get pendingBytes(): number {
    return this.buffered;
  }

  push(chunk: Uint8Array): void {
    if (chunk.byteLength === 0) return;
    this.chunks.push(Buffer.from(chunk.buffer, chunk.byteOffset, chunk.byteLength));
    this.buffered += chunk.byteLength;
  }

  /**
   * The next whole frame body, or undefined until it has arrived. Throws FrameError as soon as a
   * header is refused (empty or oversize), before any of that frame's body is buffered further.
   */
  next(): Buffer | undefined {
    if (this.bodyLength === undefined) {
      if (this.buffered < HEADER_BYTES) return undefined;
      const length = this.take(HEADER_BYTES).readUInt32LE(0);
      if (length === 0) throw new FrameError("empty", "frame of 0 bytes");
      const cap = this.cap();
      if (length > cap) throw new FrameError("oversize", `frame of ${length} bytes exceeds the cap of ${cap}`);
      this.bodyLength = length;
    }
    if (this.buffered < this.bodyLength) return undefined;
    const body = this.take(this.bodyLength);
    this.bodyLength = undefined;
    return body;
  }

  /** End of stream. Throws `truncated` when a partial header or body is left. */
  end(): void {
    if (this.bodyLength !== undefined) {
      throw new FrameError("truncated", `stream ended after ${this.buffered} of ${this.bodyLength} body bytes`);
    }
    if (this.buffered > 0) {
      throw new FrameError("truncated", `stream ended after ${this.buffered} of ${HEADER_BYTES} length bytes`);
    }
  }

  private take(bytes: number): Buffer {
    const joined = this.chunks.length === 1 ? this.chunks[0]! : Buffer.concat(this.chunks, this.buffered);
    const taken = joined.subarray(0, bytes);
    const rest = joined.subarray(bytes);
    this.chunks = rest.byteLength > 0 ? [rest] : [];
    this.buffered = rest.byteLength;
    // Copy the frame out so a retained message never pins a large shared chunk.
    return Buffer.from(taken);
  }
}

/**
 * What a number written with a fraction, an exponent or as -0 parses to. Every number in bridge v1 is
 * an integer, and serde_json reads such a number as a float, so a schema refuses this marker wherever
 * it reads an integer (bad_integer) and refuses it with the unknown field elsewhere.
 */
export const NOT_AN_INTEGER: unique symbol = Symbol("a number not written as an integer");

const INTEGER = /^(?:0|-?[1-9][0-9]*)$/;
// Most bodies hold no fraction, exponent or -0 and skip the slower reviver parse.
const MAYBE_NOT_AN_INTEGER = /[0-9][.eE]|-0/;
// Fatal, so bytes that are not UTF-8 refuse the frame instead of becoming U+FFFD. A leading byte order
// mark is kept as U+FEFF, which JSON.parse refuses, as serde_json does.
const decoder = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });

function markNonIntegers(_key: string, value: unknown, context?: { readonly source?: string }): unknown {
  return typeof value === "number" && context?.source !== undefined && !INTEGER.test(context.source) ? NOT_AN_INTEGER : value;
}

/** Decodes one frame body to a JSON object, or throws FrameError("malformed"). */
export function decodeBody(body: Uint8Array): Record<string, unknown> {
  let text: string;
  try {
    text = decoder.decode(body);
  } catch {
    throw new FrameError("malformed", "frame body is not UTF-8");
  }
  let value: unknown;
  try {
    value = MAYBE_NOT_AN_INTEGER.test(text) ? JSON.parse(text, markNonIntegers) : JSON.parse(text);
  } catch {
    throw new FrameError("malformed", "frame body is not one JSON value");
  }
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new FrameError("malformed", "frame body is not a JSON object");
  }
  if (!isUnicodeJson(value)) {
    throw new FrameError("malformed", "a string holds a lone UTF-16 surrogate");
  }
  return value as Record<string, unknown>;
}

/** The frame for one message. Throws FrameError("oversize") when it would exceed `cap`. */
export function encodeFrame(message: object, cap: number): Buffer {
  const body = Buffer.from(JSON.stringify(message), "utf8");
  if (body.byteLength > cap) {
    throw new FrameError("oversize", `outgoing frame of ${body.byteLength} bytes exceeds the cap of ${cap}`);
  }
  const frame = Buffer.allocUnsafe(HEADER_BYTES + body.byteLength);
  frame.writeUInt32LE(body.byteLength, 0);
  body.copy(frame, HEADER_BYTES);
  return frame;
}

const LONE_SURROGATE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;

function isUnicodeJson(value: unknown): boolean {
  if (typeof value === "string") return !LONE_SURROGATE.test(value);
  if (Array.isArray(value)) return value.every(isUnicodeJson);
  if (typeof value === "object" && value !== null) {
    return Object.entries(value).every(([key, field]) => !LONE_SURROGATE.test(key) && isUnicodeJson(field));
  }
  return true;
}
