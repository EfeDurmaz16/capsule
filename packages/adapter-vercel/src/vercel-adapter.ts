import { readFile } from "node:fs/promises";
import { basename } from "node:path";
import {
  AdapterExecutionError,
  type AdapterContext,
  type CapsuleAdapter,
  type CapabilityMap,
  type DeployEdgeSpec,
  type EdgeDeployment
} from "@capsule/core";
import { VercelClient, type VercelClientOptions } from "./vercel-client.js";

export interface VercelAdapterOptions extends VercelClientOptions {
  project?: string;
  target?: "production" | "staging" | "preview" | string;
}

const provider = "vercel";
const adapter = "vercel";

export const vercelCapabilities: CapabilityMap = {
  sandbox: {
    create: "unsupported",
    exec: "unsupported",
    fileRead: "unsupported",
    fileWrite: "unsupported",
    fileList: "unsupported",
    destroy: "unsupported"
  },
  job: {
    run: "unsupported",
    status: "unsupported",
    cancel: "unsupported",
    logs: "unsupported",
    artifacts: "unsupported",
    timeout: "unsupported",
    env: "unsupported"
  },
  service: {
    deploy: "experimental",
    update: "unsupported",
    delete: "unsupported",
    status: "experimental",
    logs: "unsupported",
    url: "native"
  },
  edge: {
    deploy: "native",
    version: "experimental",
    release: "experimental",
    rollback: "unsupported",
    routes: "unsupported",
    bindings: "unsupported",
    logs: "unsupported",
    url: "native"
  },
  database: {
    branchCreate: "unsupported",
    branchDelete: "unsupported",
    connectionString: "unsupported"
  },
  preview: {
    create: "experimental",
    destroy: "unsupported",
    status: "experimental",
    logs: "unsupported",
    urls: "native"
  },
  machine: {
    create: "unsupported",
    exec: "unsupported",
    start: "unsupported",
    stop: "unsupported",
    destroy: "unsupported"
  }
};

function statusFromReadyState(readyState: string | undefined): EdgeDeployment["status"] {
  if (readyState === "ERROR" || readyState === "CANCELED") return "failed";
  if (readyState === "READY") return "ready";
  return "deploying";
}

function deploymentUrl(url: string | undefined): string | undefined {
  if (!url) return undefined;
  return url.startsWith("http://") || url.startsWith("https://") ? url : `https://${url}`;
}

async function inlineFile(spec: DeployEdgeSpec): Promise<{ file: string; data: string; encoding: "utf-8" }> {
  if (!spec.source?.path) {
    throw new AdapterExecutionError("Vercel edge.deploy requires source.path for the first inline deployment adapter.");
  }
  const file = spec.source.entrypoint ?? basename(spec.source.path);
  const data = await readFile(spec.source.path, "utf8");
  return { file, data, encoding: "utf-8" };
}

export function vercel(options: VercelAdapterOptions = {}): CapsuleAdapter {
  const getClient = () => new VercelClient(options);
  return {
    name: adapter,
    provider,
    capabilities: vercelCapabilities,
    raw: { baseUrl: options.baseUrl ?? "https://api.vercel.com", teamId: options.teamId, slug: options.slug },
    edge: {
      deploy: async (spec: DeployEdgeSpec, context: AdapterContext): Promise<EdgeDeployment> => {
        context.evaluatePolicy({ env: spec.env });
        const startedAt = new Date();
        if (spec.env && Object.keys(spec.env).length > 0) {
          throw new AdapterExecutionError("Vercel adapter does not create deployment environment variables yet; configure project env separately.");
        }
        const client = getClient();
        const file = await inlineFile(spec);
        const deployment = await client.createDeployment({
          name: spec.name,
          project: options.project,
          target: options.target ?? "preview",
          files: [file],
          meta: {
            capsule: "true",
            ...(spec.source?.repo ? { repo: spec.source.repo } : {}),
            ...(spec.source?.ref ? { ref: spec.source.ref } : {})
          }
        });
        const status = statusFromReadyState(deployment.readyState);
        const url = deploymentUrl(deployment.url);
        const receipt = context.receipts
          ? context.createReceipt({
              type: "edge.deploy",
              capabilityPath: "edge.deploy",
              startedAt,
              source: spec.source,
              policy: {
                decision: "allowed",
                applied: context.policy,
                notes: [
                  "Vercel deployment creation is native.",
                  "This first adapter uses inline deployment files; large project uploads should use Vercel file upload/SHA flow.",
                  "Environment variables, aliases, domains, logs, and rollback are not modified."
                ]
              },
              resource: { id: deployment.id, name: deployment.name ?? spec.name, status, url },
              metadata: { readyState: deployment.readyState, inspectorUrl: deployment.inspectorUrl, target: options.target ?? "preview" }
            })
          : undefined;
        return { id: deployment.id, provider, name: deployment.name ?? spec.name, status, url, receipt };
      }
    }
  };
}
