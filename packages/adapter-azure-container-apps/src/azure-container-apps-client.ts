import { AdapterExecutionError } from "@capsule/core";

export interface AzureContainerAppsClientOptions {
  accessToken?: string;
  subscriptionId?: string;
  resourceGroupName?: string;
  apiVersion?: string;
  baseUrl?: string;
  fetch?: typeof fetch;
}

export interface AzureContainerAppsRequestOptions {
  method?: "GET" | "POST" | "PUT" | "DELETE";
  path: string;
  body?: unknown;
}

export class AzureContainerAppsClient {
  readonly subscriptionId: string;
  readonly resourceGroupName: string;
  readonly apiVersion: string;
  private readonly accessToken: string;
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;

  constructor(options: AzureContainerAppsClientOptions = {}) {
    const accessToken = options.accessToken ?? process.env.AZURE_ACCESS_TOKEN;
    const subscriptionId = options.subscriptionId ?? process.env.AZURE_SUBSCRIPTION_ID;
    const resourceGroupName = options.resourceGroupName ?? process.env.AZURE_RESOURCE_GROUP;
    if (!accessToken) throw new AdapterExecutionError("Azure Container Apps adapter requires accessToken or AZURE_ACCESS_TOKEN.");
    if (!subscriptionId) throw new AdapterExecutionError("Azure Container Apps adapter requires subscriptionId or AZURE_SUBSCRIPTION_ID.");
    if (!resourceGroupName) throw new AdapterExecutionError("Azure Container Apps adapter requires resourceGroupName or AZURE_RESOURCE_GROUP.");
    this.accessToken = accessToken;
    this.subscriptionId = subscriptionId;
    this.resourceGroupName = resourceGroupName;
    this.apiVersion = options.apiVersion ?? "2025-01-01";
    this.baseUrl = options.baseUrl ?? "https://management.azure.com";
    this.fetchImpl = options.fetch ?? globalThis.fetch;
  }

  resourcePath(kind: "containerApps" | "jobs", name: string, suffix = ""): string {
    return `/subscriptions/${encodeURIComponent(this.subscriptionId)}/resourceGroups/${encodeURIComponent(this.resourceGroupName)}/providers/Microsoft.App/${kind}/${encodeURIComponent(name)}${suffix}?api-version=${encodeURIComponent(this.apiVersion)}`;
  }

  async request<T>(options: AzureContainerAppsRequestOptions): Promise<T> {
    const response = await this.fetchImpl(`${this.baseUrl}${options.path}`, {
      method: options.method ?? "GET",
      headers: {
        accept: "application/json",
        authorization: `Bearer ${this.accessToken}`,
        ...(options.body === undefined ? {} : { "content-type": "application/json" })
      },
      body: options.body === undefined ? undefined : JSON.stringify(options.body)
    });
    const text = await response.text();
    const data = text ? JSON.parse(text) : undefined;
    if (!response.ok) {
      const message = typeof data?.error?.message === "string" ? data.error.message : `Azure Container Apps API request failed with status ${response.status}`;
      throw new AdapterExecutionError(message, { status: response.status, data });
    }
    return data as T;
  }
}
