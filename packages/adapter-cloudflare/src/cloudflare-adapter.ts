import { readFile } from "node:fs/promises";
import {
  AdapterExecutionError,
  type AdapterContext,
  type CapsuleAdapter,
  type CapabilityMap,
  type DeployEdgeSpec,
  type EdgeDeployment,
  type EdgeRollback,
  type EdgeVersion,
  type RollbackEdgeSpec,
  type VersionEdgeSpec
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
    version: "native",
    release: "unsupported",
    rollback: "native",
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
  const notes = ["Cloudflare Worker upload is native through the Workers Scripts API; route creation is native when routes and a zone ID are provided."];
  if (spec.env && Object.keys(spec.env).length > 0) {
    notes.push("Plain text environment variables were uploaded as Worker vars; Cloudflare Worker secrets are not created by this adapter.");
  }
  if (spec.routes && spec.routes.length > 0) {
    notes.push("Routes were configured through the Cloudflare Workers Routes API.");
  }
  return notes;
}

function versionNotes(spec: VersionEdgeSpec): string[] {
  const notes = ["Cloudflare Worker version upload is native through the Workers Versions API and does not deploy traffic by itself."];
  if (spec.env && Object.keys(spec.env).length > 0) {
    notes.push("Plain text environment variables were uploaded as Worker vars on the version; Cloudflare Worker secrets are not created by this adapter.");
  }
  return notes;
}

function rollbackNotes(spec: RollbackEdgeSpec, targetVersionId: string): string[] {
  const notes = [`Cloudflare Worker rollback is modeled as a native Workers Deployment with 100% traffic to version ${targetVersionId}.`];
  if (!spec.targetVersionId) {
    notes.push("No targetVersionId was supplied; Capsule selected the previous deployment's version from the Workers Deployments API.");
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
    throw new AdapterExecutionError("Cloudflare edge operation requires source.path and/or source.entrypoint.");
  }
  return entrypoint;
}

async function resolveSource(spec: DeployEdgeSpec | VersionEdgeSpec): Promise<string | Uint8Array> {
  if (!spec.source?.path) {
    throw new AdapterExecutionError("Cloudflare edge operation requires source.path for the Worker module file.");
  }
  return await readFile(spec.source.path);
}

function assertSupportedBindings(spec: DeployEdgeSpec | VersionEdgeSpec, operation: "deploy" | "version"): void {
  if (spec.bindings && Object.keys(spec.bindings).length > 0) {
    throw new AdapterExecutionError(`Cloudflare edge.${operation} does not support provider-specific bindings or secret bindings yet. Use env for plain text Worker vars.`);
  }
}

function assertSupportedDeploySpec(spec: DeployEdgeSpec, options: CloudflareAdapterOptions): void {
  assertSupportedBindings(spec, "deploy");
  if (spec.routes && spec.routes.length > 0 && !(options.zoneId ?? process.env.CLOUDFLARE_ZONE_ID)) {
    throw new AdapterExecutionError("Cloudflare edge.deploy requires zoneId or CLOUDFLARE_ZONE_ID when routes are provided.");
  }
}

function stringProviderOption(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function rollbackScriptName(spec: RollbackEdgeSpec): string {
  const scriptName = stringProviderOption(spec.providerOptions?.scriptName) ?? stringProviderOption(spec.providerOptions?.name);
  if (!scriptName) {
    throw new AdapterExecutionError(
      "Cloudflare edge.rollback requires providerOptions.scriptName because Cloudflare Workers Deployments are scoped by script name, not Capsule deployment id."
    );
  }
  return scriptName;
}

async function resolveRollbackTargetVersion(client: CloudflareClient, scriptName: string, spec: RollbackEdgeSpec): Promise<string> {
  if (spec.targetVersionId) {
    return spec.targetVersionId;
  }
  const deployments = (await client.listWorkerDeployments(scriptName)).deployments ?? [];
  const previousDeployment = deployments[1];
  const previousVersion = previousDeployment?.versions?.find((version) => version.percentage === 100) ?? previousDeployment?.versions?.[0];
  if (!previousVersion?.version_id) {
    throw new AdapterExecutionError("Cloudflare edge.rollback requires targetVersionId when the previous Worker deployment cannot be inferred.");
  }
  return previousVersion.version_id;
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
        assertSupportedDeploySpec(spec, options);
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
      },
      version: async (spec: VersionEdgeSpec, context: AdapterContext): Promise<EdgeVersion> => {
        if (spec.runtime && spec.runtime !== "workers" && spec.runtime !== "edge") {
          throw new AdapterExecutionError(`Cloudflare adapter supports runtime "workers" or "edge", received "${spec.runtime}".`);
        }
        assertSupportedBindings(spec, "version");
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
        const result = await client.uploadWorkerVersion({
          scriptName: spec.name,
          entrypoint,
          source,
          metadata
        });
        const receipt = context.receipts
          ? context.createReceipt({
              type: "edge.version",
              capabilityPath: "edge.version",
              startedAt,
              source: {
                path: spec.source?.path,
                entrypoint,
                repo: spec.source?.repo,
                ref: spec.source?.ref
              },
              policy: { decision: "allowed", applied: context.policy, notes: versionNotes(spec) },
              resource: {
                id: result.id ?? spec.name,
                name: spec.name,
                status: "ready"
              },
              metadata: {
                runtime: spec.runtime ?? "workers",
                compatibilityDate: stringProviderOption(result.metadata?.compatibility_date) ?? options.compatibilityDate,
                entryPoint: entrypoint,
                versionNumber: result.number,
                deploymentId: spec.deploymentId,
                labels: spec.labels
              }
            })
          : undefined;
        return {
          id: result.id ?? spec.name,
          provider,
          name: spec.name,
          deploymentId: spec.deploymentId,
          status: "ready",
          receipt,
          metadata: {
            versionNumber: result.number,
            resources: result.resources
          }
        };
      },
      rollback: async (spec: RollbackEdgeSpec, context: AdapterContext): Promise<EdgeRollback> => {
        const startedAt = new Date();
        const client = getClient();
        const scriptName = rollbackScriptName(spec);
        const targetVersionId = await resolveRollbackTargetVersion(client, scriptName, spec);
        const deployment = await client.createWorkerDeployment({
          scriptName,
          versionId: targetVersionId,
          message: spec.reason
        });
        const receipt = context.receipts
          ? context.createReceipt({
              type: "edge.rollback",
              capabilityPath: "edge.rollback",
              startedAt,
              policy: { decision: "allowed", applied: context.policy, notes: rollbackNotes(spec, targetVersionId) },
              resource: {
                id: deployment.id ?? spec.deploymentId,
                name: scriptName,
                status: "ready"
              },
              providerOptions: spec.providerOptions,
              metadata: {
                requestedDeploymentId: spec.deploymentId,
                targetVersionId,
                deployment
              }
            })
          : undefined;
        return {
          id: deployment.id ?? spec.deploymentId,
          provider,
          deploymentId: spec.deploymentId,
          targetVersionId,
          status: "ready",
          receipt,
          metadata: {
            scriptName,
            deployment
          }
        };
      }
    }
  };
}
