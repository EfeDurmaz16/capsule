import { AdapterExecutionError } from "@capsule/core";

export interface VercelClientOptions {
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

export class VercelClient {
  private readonly token: string;
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;

  constructor(private readonly options: VercelClientOptions = {}) {
    const token = options.token ?? process.env.VERCEL_TOKEN;
    if (!token) {
      throw new AdapterExecutionError("Vercel adapter requires a token. Pass token or set VERCEL_TOKEN.");
    }
    this.token = token;
    this.baseUrl = options.baseUrl ?? "https://api.vercel.com";
    this.fetchImpl = options.fetch ?? globalThis.fetch;
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

  async assignAlias(id: string, input: { alias: string; redirect?: string | null }): Promise<VercelAliasResponse> {
    return await this.request<VercelAliasResponse>({
      method: "POST",
      path: `/v2/deployments/${encodeURIComponent(id)}/aliases`,
      body: { alias: input.alias, redirect: input.redirect ?? null }
    });
  }

  private async request<T>(input: { method: "GET" | "POST"; path: string; body?: unknown }): Promise<T> {
    const url = new URL(`${this.baseUrl}${input.path}`);
    if (this.options.teamId) url.searchParams.set("teamId", this.options.teamId);
    if (this.options.slug) url.searchParams.set("slug", this.options.slug);
    const response = await this.fetchImpl(url, {
      method: input.method,
      headers: {
        accept: "application/json",
        authorization: `Bearer ${this.token}`,
        ...(input.body === undefined ? {} : { "content-type": "application/json" })
      },
      body: input.body === undefined ? undefined : JSON.stringify(input.body)
    });
    const text = await response.text();
    const data = text ? JSON.parse(text) : undefined;
    if (!response.ok) {
      const message =
        typeof data?.error?.message === "string"
          ? data.error.message
          : typeof data?.message === "string"
            ? data.message
            : `Vercel API request failed with status ${response.status}`;
      throw new AdapterExecutionError(message, { status: response.status, error: data?.error });
    }
    return data as T;
  }
}
