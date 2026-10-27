// Bounded provider HTTP exchange (EDGE-05, PERF-07). Kept per package on purpose: each edge adapter is a
// small direct-HTTP client and core does not yet export a shared request helper. The four copies in
// packages/{cloudflare,fly,neon,vercel}/src/http-response.ts are identical and must stay that way.
//
// Guarantees:
// - The HTTP status is checked before any parse, so an HTML or text error page keeps its status, its
//   Retry-After header and its typed retry category instead of surfacing as a SyntaxError.
// - Response bodies are read incrementally against a byte budget and the rest is cancelled; an error
//   body is read only up to a small diagnostic budget and never echoed raw.
// - One client-side deadline covers the request and the body. When it expires the body is cancelled.
//   A timed-out GET is a retryable provider error; a timed-out mutation is an unknown outcome, because
//   the provider may already have applied it.
import {
  AdapterExecutionError,
  CaptureLimitError,
  UnknownOutcomeError,
  classifyProviderError,
  defaultCaptureBounds,
  providerExecutionError,
  type ProviderErrorClassification
} from "@capsule-sdk/core";

export const defaultRequestTimeoutMs = defaultCaptureBounds.deadlineMs;
export const defaultMaxResponseBytes = defaultCaptureBounds.maxBytes;
/** Error bodies are diagnostics only; read at most this many bytes of them. */
export const maxErrorBodyBytes = 64 * 1024;

export interface HttpLimitOptions {
  /** Client-side deadline in milliseconds for one request, including reading its body. Default 60000. */
  requestTimeoutMs?: number;
  /** Maximum accepted size of a successful response body in bytes. Default 16 MiB. */
  maxResponseBytes?: number;
}

export interface HttpLimits {
  requestTimeoutMs: number;
  maxResponseBytes: number;
}

export function resolveHttpLimits(options: HttpLimitOptions): HttpLimits {
  return {
    requestTimeoutMs: positiveInteger(options.requestTimeoutMs ?? defaultRequestTimeoutMs, "requestTimeoutMs"),
    maxResponseBytes: positiveInteger(options.maxResponseBytes ?? defaultMaxResponseBytes, "maxResponseBytes")
  };
}

export interface BoundedHttpResponse {
  status: number;
  ok: boolean;
  headers: Headers;
  text: string;
  /** Bytes kept in `text`. */
  bytes: number;
  /** True when the body was larger than the budget and the rest was cancelled. */
  overflowed: boolean;
}

export interface BoundedFetchInput {
  /** Display name for messages, for example "Fly". */
  provider: string;
  fetchImpl: typeof fetch;
  url: string | URL;
  init: RequestInit;
  limits: HttpLimits;
}

export async function fetchWithinLimits(input: BoundedFetchInput): Promise<BoundedHttpResponse> {
  const method = (input.init.method ?? "GET").toUpperCase();
  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort(new Error(`${input.provider} API request deadline of ${input.limits.requestTimeoutMs}ms expired.`));
  }, input.limits.requestTimeoutMs);
  try {
    const response = await untilAborted(input.fetchImpl(input.url, { ...input.init, signal: controller.signal }), controller.signal);
    const declared = Number(response.headers.get("content-length"));
    if (response.ok && Number.isFinite(declared) && declared > input.limits.maxResponseBytes) {
      await response.body?.cancel().catch(() => undefined);
      throw overflowError(input, 0);
    }
    const body = await readCapped(response, response.ok ? input.limits.maxResponseBytes : maxErrorBodyBytes, controller.signal);
    if (timedOut) throw timeoutError(input, method, controller.signal.reason);
    if (response.ok && body.overflowed) throw overflowError(input, body.bytes);
    return { status: response.status, ok: response.ok, headers: response.headers, ...body };
  } catch (error) {
    if (timedOut && !(error instanceof AdapterExecutionError) && !(error instanceof CaptureLimitError)) {
      throw timeoutError(input, method, error);
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

/** Parses a successful body. Empty means undefined; malformed JSON is rejected with its status. */
export function parseSuccessJson(provider: string, response: BoundedHttpResponse, parse: (text: string) => unknown = JSON.parse): unknown {
  if (!response.text.trim()) return undefined;
  try {
    return parse(response.text);
  } catch (error) {
    throw new AdapterExecutionError(`${provider} API returned a malformed JSON body with status ${response.status}.`, {
      status: response.status,
      bodyBytes: response.bytes,
      cause: error
    });
  }
}

/** Parses an error body when it is JSON; returns undefined for HTML, text or truncated bodies. */
export function parseErrorJson(response: BoundedHttpResponse): unknown {
  if (response.overflowed || !response.text.trim()) return undefined;
  try {
    return JSON.parse(response.text);
  } catch {
    return undefined;
  }
}

/** Safe description of a non-JSON error body: type and size, never its raw content. */
export function errorBodyDiagnostics(response: BoundedHttpResponse): Record<string, unknown> {
  return {
    contentType: response.headers.get("content-type") ?? undefined,
    bodyBytes: response.bytes,
    ...(response.overflowed ? { bodyTruncated: true } : {})
  };
}

export function httpErrorClassification(response: BoundedHttpResponse, data: unknown): ProviderErrorClassification {
  return classifyProviderError({ status: response.status, headers: response.headers, error: data });
}

function untilAborted<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(signal.reason);
    if (signal.aborted) return onAbort();
    signal.addEventListener("abort", onAbort, { once: true });
    promise.then(
      (value) => {
        signal.removeEventListener("abort", onAbort);
        resolve(value);
      },
      (error: unknown) => {
        signal.removeEventListener("abort", onAbort);
        reject(error);
      }
    );
  });
}

/** Reads at most maxBytes of a body, cancelling the rest, and cancels the read when signal aborts. */
export async function readCapped(response: Response, maxBytes: number, signal: AbortSignal): Promise<{ text: string; bytes: number; overflowed: boolean }> {
  const stream = response.body;
  if (!stream) return { text: "", bytes: 0, overflowed: false };
  const reader = stream.getReader();
  const onAbort = () => {
    void reader.cancel(signal.reason).catch(() => undefined);
  };
  if (signal.aborted) onAbort();
  else signal.addEventListener("abort", onAbort, { once: true });
  const decoder = new TextDecoder();
  let text = "";
  let bytes = 0;
  let overflowed = false;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      const room = maxBytes - bytes;
      if (value.byteLength > room) {
        text += decoder.decode(value.subarray(0, room), { stream: true });
        bytes += room;
        overflowed = true;
        await reader.cancel().catch(() => undefined);
        break;
      }
      bytes += value.byteLength;
      text += decoder.decode(value, { stream: true });
    }
  } finally {
    signal.removeEventListener("abort", onAbort);
    // No releaseLock: the body is closed, cancelled or errored here and nothing reads it again. In Node,
    // releaseLock builds an "invalid state" error whose first use creates a vm context (about 1 ms per
    // process), which made the first request slower than response.text() at 7d3a28a.
  }
  return { text: text + decoder.decode(), bytes, overflowed };
}

function timeoutError(input: BoundedFetchInput, method: string, cause: unknown): AdapterExecutionError {
  const operation = `${method} ${safePath(input.url)}`;
  const message = `${input.provider} API request ${operation} did not complete within ${input.limits.requestTimeoutMs}ms.`;
  if (method === "GET" || method === "HEAD") {
    return providerExecutionError(message, classifyProviderError({ code: "timeout" }), { timeoutMs: input.limits.requestTimeoutMs, cause });
  }
  return new UnknownOutcomeError(`${message} The provider may already have applied it; observe the resource before retrying.`, { operation }, cause);
}

function overflowError(input: BoundedFetchInput, capturedBytes: number): CaptureLimitError {
  return new CaptureLimitError(
    `${input.provider} API response body exceeded maxResponseBytes (${input.limits.maxResponseBytes}); the rest of the body was cancelled.`,
    { truncated: true, reason: "bytes", capturedBytes, limit: input.limits.maxResponseBytes }
  );
}

/** Path only: query strings can carry tokens or team identifiers and never belong in an error message. */
function safePath(url: string | URL): string {
  try {
    return new URL(String(url)).pathname;
  } catch {
    return String(url).replace(/[?#].*$/s, "");
  }
}

function positiveInteger(value: number, name: string): number {
  if (!Number.isInteger(value) || value <= 0) {
    throw new RangeError(`${name} must be a positive integer.`);
  }
  return value;
}
