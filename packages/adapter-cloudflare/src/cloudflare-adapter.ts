import { readFile } from "node:fs/promises";
import {
  AdapterExecutionError,
  type AdapterContext,
  type CapsuleAdapter,
  type CapabilityMap,
  type DeployEdgeSpec,
  type EdgeDeployment
} from "@capsule/core";
import { CloudflareClient, type CloudflareClientOptions } from "./cloudflare-client.js";

export interface CloudflareAdapterOptions extends CloudflareClientOptions {
  compatibilityDate?: string;
  workersDevSubdomain?: string;
}

const provider = "cloudflare";
const adapter = "cloudflare";

export const cloudflareCapabilities: CapabilityMap = {
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
    deploy: "unsupported",
    update: "unsupported",
    delete: "unsupported",
    status: "unsupported",
    logs: "unsupported",
    url: "unsupported"
  },
  edge: {
    deploy: "native",
    version: "unsupported",
    release: "unsupported",
    rollback: "unsupported",
    routes: "native",
    bindings: "unsupported",
    logs: "unsupported",
    url: "experimental"
  },
  database: {
    branchCreate: "unsupported",
    branchDelete: "unsupported",
    connectionString: "unsupported"
  },
  preview: {
    create: "unsupported",
    destroy: "unsupported",
    status: "unsupported",
    logs: "unsupported",
    urls: "unsupported"
  },
  machine: {
    create: "unsupported",
    exec: "unsupported",
    start: "unsupported",
    stop: "unsupported",
    destroy: "unsupported"
  }
};

function edgeNotes(spec: DeployEdgeSpec): string[] {
  const notes = ["Cloudflare Worker upload is native; route creation is native when routes and a zone ID are provided."];
  if (spec.env && Object.keys(spec.env).length > 0) {
    notes.push("Plain text environment variables were uploaded as Worker vars; Cloudflare Worker secrets are not created by this adapter.");
  }
  if (spec.routes && spec.routes.length > 0) {
    notes.push("Routes were configured through the Cloudflare Workers Routes API.");
  }
  return notes;
}

function plainTextBindings(env: Record<string, string> | undefined): Array<Record<string, string>> {
  return Object.entries(env ?? {}).map(([name, text]) => ({ type: "plain_text", name, text }));
}

function workerUrl(name: string, subdomain: string | undefined): string | undefined {
  return subdomain ? `https://${name}.${subdomain}.workers.dev` : undefined;
}

function resolveEntrypoint(spec: DeployEdgeSpec): string {
  const entrypoint = spec.source?.entrypoint ?? spec.source?.path?.split("/").filter(Boolean).at(-1);
  if (!entrypoint) {
    throw new AdapterExecutionError("Cloudflare edge.deploy requires source.path and/or source.entrypoint.");
  }
  return entrypoint;
}

async function resolveSource(spec: DeployEdgeSpec): Promise<string | Uint8Array> {
  if (!spec.source?.path) {
    throw new AdapterExecutionError("Cloudflare edge.deploy requires source.path for the Worker module file.");
  }
  return await readFile(spec.source.path);
}

function assertSupportedSpec(spec: DeployEdgeSpec, options: CloudflareAdapterOptions): void {
  if (spec.bindings && Object.keys(spec.bindings).length > 0) {
    throw new AdapterExecutionError("Cloudflare edge.deploy does not support provider-specific bindings yet. Use env for plain text Worker vars.");
  }
  if (spec.routes && spec.routes.length > 0 && !(options.zoneId ?? process.env.CLOUDFLARE_ZONE_ID)) {
    throw new AdapterExecutionError("Cloudflare edge.deploy requires zoneId or CLOUDFLARE_ZONE_ID when routes are provided.");
  }
}

export function cloudflare(options: CloudflareAdapterOptions = {}): CapsuleAdapter {
  const getClient = () => new CloudflareClient(options);
  return {
    name: adapter,
    provider,
    capabilities: cloudflareCapabilities,
    raw: { baseUrl: options.baseUrl ?? "https://api.cloudflare.com/client/v4" },
    edge: {
      deploy: async (spec: DeployEdgeSpec, context: AdapterContext): Promise<EdgeDeployment> => {
        if (spec.runtime && spec.runtime !== "workers" && spec.runtime !== "edge") {
          throw new AdapterExecutionError(`Cloudflare adapter supports runtime "workers" or "edge", received "${spec.runtime}".`);
        }
        assertSupportedSpec(spec, options);
        context.evaluatePolicy({ env: spec.env });
        const startedAt = new Date();
        const client = getClient();
        const entrypoint = resolveEntrypoint(spec);
        const source = await resolveSource(spec);
        const metadata = {
          main_module: entrypoint,
          compatibility_date: options.compatibilityDate,
          bindings: plainTextBindings(spec.env)
        };
        const result = await client.uploadWorkerModule({
          scriptName: spec.name,
          entrypoint,
          source,
          metadata
        });
        const routes = await Promise.all((spec.routes ?? []).map((route) => client.createWorkerRoute({ pattern: route, scriptName: spec.name })));
        const url = workerUrl(spec.name, options.workersDevSubdomain);
        const receipt = context.receipts
          ? context.createReceipt({
              type: "edge.deploy",
              capabilityPath: "edge.deploy",
              startedAt,
              source: {
                path: spec.source?.path,
                entrypoint,
                repo: spec.source?.repo,
                ref: spec.source?.ref
              },
              policy: { decision: "allowed", applied: context.policy, notes: edgeNotes(spec) },
              resource: {
                id: result.id ?? spec.name,
                name: spec.name,
                status: "ready",
                url
              },
              metadata: {
                runtime: spec.runtime ?? "workers",
                compatibilityDate: result.compatibility_date ?? options.compatibilityDate,
                entryPoint: result.entry_point ?? entrypoint,
                routes,
                labels: spec.labels
              }
            })
          : undefined;
        return {
          id: result.id ?? spec.name,
          provider,
          name: spec.name,
          status: "ready",
          url,
          receipt
        };
      }
    }
  };
}
