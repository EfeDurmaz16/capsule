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
    const url = new URL(`${this.baseUrl}/v13/deployments`);
    if (this.options.teamId) url.searchParams.set("teamId", this.options.teamId);
    if (this.options.slug) url.searchParams.set("slug", this.options.slug);
    const response = await this.fetchImpl(url, {
      method: "POST",
      headers: {
        accept: "application/json",
        authorization: `Bearer ${this.token}`,
        "content-type": "application/json"
      },
      body: JSON.stringify({
        name: input.name,
        project: input.project,
        target: input.target,
        files: input.files,
        meta: input.meta
      })
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
    return data as VercelDeploymentResponse;
  }
}
