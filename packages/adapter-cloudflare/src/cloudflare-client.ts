import { AdapterExecutionError } from "@capsule/core";

export interface CloudflareClientOptions {
  apiToken?: string;
  accountId?: string;
  baseUrl?: string;
  fetch?: typeof fetch;
}

export interface UploadWorkerModuleInput {
  scriptName: string;
  entrypoint: string;
  source: string | Uint8Array;
  metadata: Record<string, unknown>;
}

interface CloudflareEnvelope<T> {
  success: boolean;
  result?: T;
  errors?: Array<{ code?: number; message?: string }>;
  messages?: Array<{ code?: number; message?: string }>;
}

export interface CloudflareWorkerScript {
  id?: string;
  script_name?: string;
  entry_point?: string;
  compatibility_date?: string;
  modified_on?: string;
}

export class CloudflareClient {
  private readonly apiToken: string;
  private readonly accountId: string;
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;

  constructor(options: CloudflareClientOptions = {}) {
    const apiToken = options.apiToken ?? process.env.CLOUDFLARE_API_TOKEN;
    const accountId = options.accountId ?? process.env.CLOUDFLARE_ACCOUNT_ID;
    if (!apiToken) {
      throw new AdapterExecutionError("Cloudflare adapter requires an API token. Pass apiToken or set CLOUDFLARE_API_TOKEN.");
    }
    if (!accountId) {
      throw new AdapterExecutionError("Cloudflare adapter requires an account ID. Pass accountId or set CLOUDFLARE_ACCOUNT_ID.");
    }
    this.apiToken = apiToken;
    this.accountId = accountId;
    this.baseUrl = options.baseUrl ?? "https://api.cloudflare.com/client/v4";
    this.fetchImpl = options.fetch ?? globalThis.fetch;
  }

  async uploadWorkerModule(input: UploadWorkerModuleInput): Promise<CloudflareWorkerScript> {
    const url = `${this.baseUrl}/accounts/${encodeURIComponent(this.accountId)}/workers/scripts/${encodeURIComponent(input.scriptName)}`;
    const form = new FormData();
    form.set("metadata", JSON.stringify(input.metadata));
    const moduleSource = typeof input.source === "string" ? input.source : new Uint8Array(input.source).buffer;
    form.set(input.entrypoint, new Blob([moduleSource], { type: "application/javascript+module" }), input.entrypoint);

    const response = await this.fetchImpl(url, {
      method: "PUT",
      headers: {
        authorization: `Bearer ${this.apiToken}`
      },
      body: form
    });

    const text = await response.text();
    const data = text ? (JSON.parse(text) as CloudflareEnvelope<CloudflareWorkerScript>) : undefined;
    if (!response.ok || data?.success === false) {
      const message = data?.errors?.find((error) => error.message)?.message ?? `Cloudflare API request failed with status ${response.status}`;
      throw new AdapterExecutionError(message, { status: response.status, errors: data?.errors, messages: data?.messages });
    }
    return data?.result ?? {};
  }
}
