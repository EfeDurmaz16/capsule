import {
  AdapterExecutionError,
  CaptureLimitError,
  providerExecutionError,
  resolveCaptureBounds,
  type CaptureBounds,
  type CaptureTruncation,
  type ResolvedCaptureBounds
} from "@capsule-sdk/core";
import {
  errorBodyDiagnostics,
  fetchWithinLimits,
  httpErrorClassification,
  maxErrorBodyBytes,
  parseErrorJson,
  parseSuccessJson,
  readCapped,
  resolveHttpLimits,
  type BoundedHttpResponse,
  type HttpLimitOptions,
  type HttpLimits
} from "./http-response.js";

export interface VercelClientOptions extends HttpLimitOptions {
  token?: string;
  teamId?: string;
  slug?: string;
  baseUrl?: string;
  fetch?: typeof fetch;
}

export interface CreateDeploymentInput {
  name: string;
  project?: string;
  target?: "production" | "staging" | "preview" | string;
  files: Array<{ file: string; data: string; encoding?: "utf-8" | "base64" }>;
  meta?: Record<string, string>;
}

export interface VercelDeploymentResponse {
  id: string;
  name?: string;
  url?: string;
  readyState?: "QUEUED" | "BUILDING" | "READY" | "ERROR" | "CANCELED" | string;
  inspectorUrl?: string;
  createdAt?: number;
}

export interface VercelAliasResponse {
  uid: string;
  alias: string;
  created?: string;
  oldDeploymentId?: string | null;
}

export interface VercelDeploymentEvent {
  type?: string;
  created?: number;
  payload?: {
    text?: string;
    message?: string;
    created?: number;
    date?: number;
    statusCode?: number;
    deploymentId?: string;
    id?: string;
    info?: {
      type?: string;
      name?: string;
      step?: string;
      readyState?: string;
    };
  };
}

export interface VercelRuntimeLog {
  level?: string;
  message?: string;
  rowId?: string;
  source?: string;
  timestampInMs?: number;
  domain?: string;
  messageTruncated?: boolean;
  requestMethod?: string;
  requestPath?: string;
  responseStatusCode?: number;
}

function parseJsonStream(text: string): unknown {
  if (!text.trim()) return undefined;
  try {
    return JSON.parse(text);
  } catch (error) {
    const values = text
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => JSON.parse(line));
    if (values.length > 0) return values;
    throw error;
  }
}

export interface ReadRuntimeLogsInput {
  projectId: string;
  deploymentId: string;
  /** Client-side capture bounds. maxRecords, maxBytes and deadlineMs stop the read and cancel the stream. */
  bounds?: CaptureBounds | ResolvedCaptureBounds;
}

export interface VercelRuntimeLogRead {
  logs: VercelRuntimeLog[];
  truncation: CaptureTruncation;
  /** Lines that were not valid JSON records; they are skipped, never guessed. */
  malformedRecords: number;
  /** Why reading stopped: the stream ended, Vercel sent its runtime-limit delimiter, or a client bound was reached. */
  endedBy: "end-of-stream" | "provider-limit" | "bounds";
}

function isRuntimeLimitDelimiter(log: VercelRuntimeLog): boolean {
  return log.rowId === "" && log.level === "error" && log.source === "delimiter";
}

function record(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined;
}

export class VercelClient {
  private readonly token: string;
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;
  private readonly limits: HttpLimits;

  constructor(private readonly options: VercelClientOptions = {}) {
    const token = options.token ?? process.env.VERCEL_TOKEN;
    if (!token) {
      throw new AdapterExecutionError("Vercel adapter requires a token. Pass token or set VERCEL_TOKEN.");
    }
    this.token = token;
    this.baseUrl = options.baseUrl ?? "https://api.vercel.com";
    this.fetchImpl = options.fetch ?? globalThis.fetch;
    this.limits = resolveHttpLimits(options);
  }

  async createDeployment(input: CreateDeploymentInput): Promise<VercelDeploymentResponse> {
    return await this.request<VercelDeploymentResponse>({
      method: "POST",
      path: "/v13/deployments",
      body: {
        name: input.name,
        project: input.project,
        target: input.target,
        files: input.files,
        meta: input.meta
      }
    });
  }

  async getDeployment(idOrUrl: string): Promise<VercelDeploymentResponse> {
    return await this.request<VercelDeploymentResponse>({ method: "GET", path: `/v13/deployments/${encodeURIComponent(idOrUrl)}` });
  }

  async getDeploymentEvents(input: { idOrUrl: string; since?: number; until?: number; limit?: number; follow?: boolean }): Promise<VercelDeploymentEvent[]> {
    return await this.request<VercelDeploymentEvent[]>({
      method: "GET",
      path: `/v3/deployments/${encodeURIComponent(input.idOrUrl)}/events`,
      query: {
        ...(input.since === undefined ? {} : { since: String(input.since) }),
        ...(input.until === undefined ? {} : { until: String(input.until) }),
        ...(input.limit === undefined ? {} : { limit: String(input.limit) }),
        ...(input.follow === undefined ? {} : { follow: input.follow ? "1" : "0" })
      }
    });
  }

  /**
   * Reads runtime logs within bounds and returns the records only. Kept for compatibility; prefer
   * readRuntimeLogs, which also reports truncation and malformed records.
   */
  async getRuntimeLogs(input: ReadRuntimeLogsInput): Promise<VercelRuntimeLog[]> {
    return (await this.readRuntimeLogs(input)).logs;
  }

  /**
   * Reads the runtime logs endpoint incrementally (EDGE-02, PERF-04). The endpoint is a live stream of
   * newline-delimited JSON records (format=lines, as used by the Vercel CLI) that may never close, so the
   * read stops at the record cap, the byte cap or the deadline, whichever comes first, and cancels the
   * body. Memory stays bounded by the kept records plus at most one partial line of maxBytes.
   */
  async readRuntimeLogs(input: ReadRuntimeLogsInput): Promise<VercelRuntimeLogRead> {
    const bounds = resolveCaptureBounds(input.bounds);
    const url = this.url(`/v1/projects/${encodeURIComponent(input.projectId)}/deployments/${encodeURIComponent(input.deploymentId)}/runtime-logs`, {
      format: "lines"
    });
    const controller = new AbortController();
    let deadlineHit = false;
    const timer = setTimeout(() => {
      deadlineHit = true;
      controller.abort(new Error(`Vercel runtime log read deadline of ${bounds.deadlineMs}ms expired.`));
    }, bounds.deadlineMs);
    const logs: VercelRuntimeLog[] = [];
    let capturedBytes = 0;
    let malformedRecords = 0;
    let stopped: { reason: "bytes" | "records" | "deadline"; limit: number } | undefined;
    let providerLimit = false;

    const accept = (line: string): void => {
      const trimmed = line.trim();
      if (!trimmed) return;
      let parsed: unknown;
      try {
        parsed = JSON.parse(trimmed);
      } catch {
        malformedRecords += 1;
        return;
      }
      // Older or proxied responses may carry a JSON array of records on one line.
      const items = Array.isArray(parsed) ? parsed : [parsed];
      for (const item of items) {
        if (stopped || providerLimit) return;
        const log = record(item) as VercelRuntimeLog | undefined;
        if (!log) {
          malformedRecords += 1;
          continue;
        }
        if (isRuntimeLimitDelimiter(log)) {
          providerLimit = true;
          return;
        }
        // UTF-8 size without encoding a copy: the line for one record, the record itself inside an array.
        const size = Buffer.byteLength(items.length === 1 ? trimmed : JSON.stringify(item), "utf8");
        if (capturedBytes + size > bounds.maxBytes) {
          stopped = { reason: "bytes", limit: bounds.maxBytes };
          return;
        }
        capturedBytes += size;
        logs.push(log);
        if (logs.length >= bounds.maxRecords) stopped = { reason: "records", limit: bounds.maxRecords };
      }
    };

    try {
      let response: Response;
      try {
        response = await untilAborted(this.fetchImpl(url, { method: "GET", headers: this.headers(), signal: controller.signal }), controller.signal);
      } catch (error) {
        if (!deadlineHit) throw error;
        stopped = { reason: "deadline", limit: bounds.deadlineMs };
        return this.runtimeLogResult(bounds, logs, capturedBytes, malformedRecords, stopped, providerLimit);
      }
      if (!response.ok) await this.throwRuntimeLogError(response, controller.signal);
      const body = response.body;
      if (body) {
        const reader = body.getReader();
        const onAbort = () => {
          void reader.cancel(controller.signal.reason).catch(() => undefined);
        };
        controller.signal.addEventListener("abort", onAbort, { once: true });
        const decoder = new TextDecoder();
        let pending = "";
        let pendingBytes = 0;
        try {
          while (!stopped && !providerLimit) {
            let chunk: ReadableStreamReadResult<Uint8Array>;
            try {
              chunk = await reader.read();
            } catch (error) {
              if (deadlineHit) break;
              throw error;
            }
            if (chunk.done) {
              pending += decoder.decode();
              accept(pending);
              pending = "";
              break;
            }
            const decoded = decoder.decode(chunk.value, { stream: true });
            pending += decoded;
            if (decoded.includes("\n")) {
              let newline = pending.indexOf("\n");
              while (newline !== -1 && !stopped && !providerLimit) {
                accept(pending.slice(0, newline));
                pending = pending.slice(newline + 1);
                newline = pending.indexOf("\n");
              }
              // The remainder is at most the tail of this chunk, so re-measuring it stays linear overall.
              pendingBytes = Buffer.byteLength(pending, "utf8");
            } else {
              pendingBytes += chunk.value.byteLength;
            }
            // A partial line that can no longer fit the byte budget will never become a kept record.
            if (!stopped && pendingBytes > bounds.maxBytes - capturedBytes) {
              stopped = { reason: "bytes", limit: bounds.maxBytes };
            }
          }
          if (deadlineHit && !stopped) stopped = { reason: "deadline", limit: bounds.deadlineMs };
        } finally {
          controller.signal.removeEventListener("abort", onAbort);
          if (stopped || providerLimit) await reader.cancel().catch(() => undefined);
          reader.releaseLock();
        }
      } else if (deadlineHit) {
        stopped = { reason: "deadline", limit: bounds.deadlineMs };
      }
      return this.runtimeLogResult(bounds, logs, capturedBytes, malformedRecords, stopped, providerLimit);
    } finally {
      clearTimeout(timer);
    }
  }

  async assignAlias(id: string, input: { alias: string; redirect?: string | null }): Promise<VercelAliasResponse> {
    return await this.request<VercelAliasResponse>({
      method: "POST",
      path: `/v2/deployments/${encodeURIComponent(id)}/aliases`,
      body: { alias: input.alias, redirect: input.redirect ?? null }
    });
  }

  private runtimeLogResult(
    bounds: ResolvedCaptureBounds,
    logs: VercelRuntimeLog[],
    capturedBytes: number,
    malformedRecords: number,
    stopped: { reason: "bytes" | "records" | "deadline"; limit: number } | undefined,
    providerLimit: boolean
  ): VercelRuntimeLogRead {
    const truncation: CaptureTruncation = {
      truncated: stopped !== undefined,
      ...(stopped ? { reason: stopped.reason, limit: stopped.limit } : {}),
      capturedBytes,
      ...(logs.length > 0 ? { capturedRecords: logs.length } : {})
    };
    if (stopped && stopped.reason !== "records" && bounds.overflow === "error") {
      throw new CaptureLimitError(`Vercel runtime log read stopped at its ${stopped.reason} bound (${stopped.limit}).`, truncation);
    }
    return { logs, truncation, malformedRecords, endedBy: stopped ? "bounds" : providerLimit ? "provider-limit" : "end-of-stream" };
  }

  private async throwRuntimeLogError(response: Response, signal: AbortSignal): Promise<never> {
    const body = await readCapped(response, maxErrorBodyBytes, signal);
    this.throwHttpError({ status: response.status, ok: false, headers: response.headers, ...body });
  }

  private throwHttpError(response: BoundedHttpResponse): never {
    const data = parseErrorJson(response);
    const dataRecord = record(data);
    const errorRecord = record(dataRecord?.error);
    const message =
      typeof errorRecord?.message === "string"
        ? errorRecord.message
        : typeof dataRecord?.message === "string"
          ? dataRecord.message
          : `Vercel API request failed with status ${response.status}`;
    throw providerExecutionError(message, httpErrorClassification(response, dataRecord?.error ?? data), {
      status: response.status,
      ...(data === undefined ? errorBodyDiagnostics(response) : { error: dataRecord?.error })
    });
  }

  private url(path: string, query: Record<string, string> = {}): URL {
    const url = new URL(`${this.baseUrl}${path}`);
    for (const [key, value] of Object.entries(query)) {
      url.searchParams.set(key, value);
    }
    if (this.options.teamId) url.searchParams.set("teamId", this.options.teamId);
    if (this.options.slug) url.searchParams.set("slug", this.options.slug);
    return url;
  }

  private headers(body = false): Record<string, string> {
    return {
      accept: "application/json",
      authorization: `Bearer ${this.token}`,
      ...(body ? { "content-type": "application/json" } : {})
    };
  }

  private async request<T>(input: { method: "GET" | "POST"; path: string; query?: Record<string, string>; body?: unknown }): Promise<T> {
    const response = await fetchWithinLimits({
      provider: "Vercel",
      fetchImpl: this.fetchImpl,
      url: this.url(input.path, input.query),
      limits: this.limits,
      init: {
        method: input.method,
        headers: this.headers(input.body !== undefined),
        body: input.body === undefined ? undefined : JSON.stringify(input.body)
      }
    });
    if (!response.ok) this.throwHttpError(response);
    return parseSuccessJson("Vercel", response, parseJsonStream) as T;
  }
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
