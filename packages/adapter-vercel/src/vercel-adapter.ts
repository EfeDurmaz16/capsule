import { readFile } from "node:fs/promises";
import { basename } from "node:path";
import {
  AdapterExecutionError,
  type AdapterContext,
  type CapsuleAdapter,
  type CapabilityMap,
  type DeployEdgeSpec,
  type EdgeDeployment,
  type EdgeRelease,
  type EdgeStatusResult,
  type EdgeStatusSpec,
  type ReleaseEdgeVersionSpec
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
    status: "native",
    release: "native",
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
      },
      status: async (spec: EdgeStatusSpec, context: AdapterContext): Promise<EdgeStatusResult> => {
        const startedAt = new Date();
        const deployment = await getClient().getDeployment(spec.id);
        const status = statusFromReadyState(deployment.readyState);
        const url = deploymentUrl(deployment.url);
        const receipt = context.receipts
          ? context.createReceipt({
              type: "edge.status",
              capabilityPath: "edge.status",
              startedAt,
              policy: {
                decision: "allowed",
                applied: context.policy,
                notes: ["Vercel deployment status is read from the deployments API."]
              },
              resource: { id: deployment.id, name: deployment.name, status, url },
              metadata: { readyState: deployment.readyState, inspectorUrl: deployment.inspectorUrl, createdAt: deployment.createdAt }
            })
          : undefined;
        return { id: deployment.id, provider, name: deployment.name, status, url, receipt, metadata: { readyState: deployment.readyState, deployment } };
      },
      release: async (spec: ReleaseEdgeVersionSpec, context: AdapterContext): Promise<EdgeRelease> => {
        const startedAt = new Date();
        const deploymentId = spec.deploymentId ?? spec.versionId;
        const alias = spec.alias ?? spec.routes?.[0];
        if (!alias) {
          throw new AdapterExecutionError("Vercel edge.release requires spec.alias or the first spec.routes entry.");
        }
        const result = await getClient().assignAlias(deploymentId, { alias, redirect: spec.redirect });
        const url = deploymentUrl(result.alias) ?? `https://${result.alias}`;
        const receipt = context.receipts
          ? context.createReceipt({
              type: "edge.release",
              capabilityPath: "edge.release",
              startedAt,
              policy: {
                decision: "allowed",
                applied: context.policy,
                notes: ["Vercel alias assignment is native and moves the alias from any previous deployment."]
              },
              resource: { id: result.uid, name: result.alias, status: "ready", url },
              metadata: { deploymentId, oldDeploymentId: result.oldDeploymentId, created: result.created }
            })
          : undefined;
        return {
          id: result.uid,
          provider,
          versionId: spec.versionId,
          deploymentId,
          alias: result.alias,
          status: "ready",
          url,
          receipt,
          metadata: { oldDeploymentId: result.oldDeploymentId, created: result.created }
        };
      }
    }
  };
}
