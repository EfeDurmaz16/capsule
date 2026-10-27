import { readFile } from "node:fs/promises";
import {
  AdapterExecutionError,
  CleanupFailureError,
  PartialEffectsError,
  UnknownOutcomeError,
  providerRuntimeMetadata,
  resourceLocator,
  type CleanupStatus,
  type PartialEffects,
  type AdapterContext,
  type CapsuleAdapter,
  type CapabilityMap,
  type DeployEdgeSpec,
  type EdgeDeployment,
  type EdgeRollback,
  type EdgeVersion,
  type RollbackEdgeSpec,
  type VersionEdgeSpec
} from "@capsule-sdk/core";
import { CloudflareClient, type CloudflareClientOptions, type CloudflareWorkerRoute } from "./cloudflare-client.js";

export interface CloudflareAdapterOptions extends CloudflareClientOptions {
  compatibilityDate?: string;
  workersDevSubdomain?: string;
}

const provider = "cloudflare";
const adapter = "cloudflare";
const adapterVersion = "0.1.1";
const providerApiVersion = "client/v4";

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
    // Live Worker tail (GET .../scripts/{name}/tails) is a WebSocket stream, which Capsule's bounded
    // fetch-only log model does not consume. A non-WebSocket bounded read does exist via the Workers
    // Observability telemetry query API (POST .../workers/observability/telemetry/query), but it is
    // opt-in per Worker (observability defaults off), sampled under load, retained only a few days, and
    // its per-event body schema is handler-dependent and unversioned. Normalizing that into LogEntry
    // without a live account to verify the message/timestamp fields would fake a support level, so edge
    // logs stay unsupported until the telemetry event shape is pinned against a real account. See
    // docs/log-normalization.md ("Cloudflare Workers") for the full rationale.
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

function cloudflareReceiptMetadata(metadata: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    ...providerRuntimeMetadata({ providerApiVersion, adapterVersion }),
    ...metadata
  };
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
    throw new AdapterExecutionError(
      `Cloudflare edge.${operation} does not support provider-specific bindings or secret bindings yet. Use env for plain text Worker vars.`
    );
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
  // Cloudflare lists deployments latest first. Rollback deploys one version at 100%, so it may only infer
  // the target when the previous deployment served exactly one version at 100%. A traffic split such as
  // 10/90 is never collapsed into one of its members (EDGE-07).
  const previousDeployment = deployments[1];
  const servingVersions = (previousDeployment?.versions ?? []).filter((version) => version.percentage > 0);
  const onlyVersion = servingVersions.length === 1 && servingVersions[0]?.percentage === 100 ? servingVersions[0] : undefined;
  if (!onlyVersion?.version_id) {
    const reason = !previousDeployment
      ? "there is no previous Worker deployment"
      : servingVersions.length > 1
        ? `the previous deployment ${previousDeployment.id ?? ""} split traffic across ${servingVersions
            .map((version) => `${version.version_id}=${version.percentage}%`)
            .join(", ")}`
        : `the previous deployment ${previousDeployment.id ?? ""} has no single version at 100%`;
    throw new AdapterExecutionError(`Cloudflare edge.rollback requires targetVersionId because ${reason}.`);
  }
  return onlyVersion.version_id;
}

interface RouteDeployContext {
  scriptName: string;
  workerId: string;
  accountId?: string;
  zoneId?: string;
}

/**
 * Creates routes after a successful Worker upload. When a route fails, routes created by this call are
 * deleted and the failure is reported with every identity involved (EDGE-06a): the uploaded Worker, the
 * created routes, the cleanup outcome and the primary error. The Worker upload is never reverted: it may
 * have replaced an existing production Worker, so deleting it is not a safe compensation.
 */
async function createRoutesWithCleanup(client: CloudflareClient, routes: string[], deploy: RouteDeployContext) {
  const createdRoutes: CloudflareWorkerRoute[] = [];
  let failedPattern: string | undefined;
  try {
    for (const route of routes) {
      failedPattern = route;
      createdRoutes.push(await client.createWorkerRoute({ pattern: route, scriptName: deploy.scriptName }));
    }
    return createdRoutes;
  } catch (primaryError) {
    throw await routeFailure(client, deploy, createdRoutes, failedPattern, primaryError);
  }
}

async function routeFailure(
  client: CloudflareClient,
  deploy: RouteDeployContext,
  createdRoutes: CloudflareWorkerRoute[],
  failedPattern: string | undefined,
  primaryError: unknown
): Promise<Error> {
  const zoneScope = { zone: deploy.zoneId };
  const worker = resourceLocator({ provider, kind: "worker", nativeId: deploy.scriptName, scope: { account: deploy.accountId } });
  const routeLocator = (route: CloudflareWorkerRoute) =>
    resourceLocator({ provider, kind: "route", nativeId: route.id ?? route.pattern ?? "unknown", scope: { ...zoneScope, pattern: route.pattern } });
  const cleanable = createdRoutes.filter((route) => route.id);
  const unidentified = createdRoutes.filter((route) => !route.id).map(routeLocator);
  const settled = await Promise.allSettled(cleanable.map((route) => client.deleteWorkerRoute({ routeId: route.id! })));
  const cleanupErrors = settled.flatMap((result) => (result.status === "rejected" ? [result.reason as unknown] : []));
  const remainingRoutes = cleanable.filter((_route, index) => settled[index]?.status === "rejected").map(routeLocator);
  const primaryUnknown = primaryError instanceof UnknownOutcomeError;
  // A route POST whose outcome is unknown may have created a route Capsule has no ID for.
  const maybeCreated = primaryUnknown && failedPattern ? [resourceLocator({ provider, kind: "route-pattern", nativeId: failedPattern, scope: zoneScope })] : [];
  const cleanupUnresolved = cleanupErrors.some((error) => error instanceof UnknownOutcomeError);
  const cleanupStatus: CleanupStatus =
    cleanable.length === 0
      ? "not-attempted"
      : cleanupErrors.length === 0
        ? "succeeded"
        : cleanupUnresolved && cleanupErrors.every((error) => error instanceof UnknownOutcomeError)
          ? "unknown"
          : "failed";
  const cleanupError =
    cleanupErrors.length === 0
      ? undefined
      : cleanupErrors.length === 1
        ? cleanupErrors[0]
        : new AggregateError(cleanupErrors, "Several Worker route deletions failed.");
  const effects: PartialEffects = {
    operation: "edge.deploy",
    outcome: primaryUnknown ? "unknown" : "failed",
    resources: [worker, ...createdRoutes.map(routeLocator), ...maybeCreated],
    primaryError,
    cleanup: {
      status: cleanupStatus,
      resources: cleanable.map(routeLocator),
      residual: [worker, ...remainingRoutes, ...unidentified, ...maybeCreated],
      ...(cleanupError === undefined ? {} : { error: cleanupError })
    }
  };
  const primaryMessage = primaryError instanceof Error ? primaryError.message : String(primaryError);
  const createdIds = createdRoutes.map((route) => route.id ?? route.pattern).join(", ");
  const cleanupText =
    cleanupStatus === "not-attempted"
      ? "No routes were created, so none were removed."
      : cleanupStatus === "succeeded"
        ? `Created routes ${createdIds} were removed.`
        : `Removing created routes ${createdIds} ${cleanupStatus === "unknown" ? "was not confirmed" : "failed"}: ${errorMessages(cleanupErrors)}.`;
  const message = `Cloudflare Worker ${deploy.scriptName} was uploaded, but creating route ${failedPattern ?? ""} failed: ${primaryMessage}. ${cleanupText} The Worker upload was not reverted because it may have replaced an existing Worker.`;
  if (cleanupStatus === "failed") {
    return new CleanupFailureError(
      message,
      { scriptName: deploy.scriptName, workerId: deploy.workerId, routes: remainingRoutes, errors: cleanupErrors },
      primaryError,
      effects
    );
  }
  return new PartialEffectsError(message, effects);
}

function errorMessages(errors: unknown[]): string {
  return errors.map((error) => (error instanceof Error ? error.message : String(error))).join("; ");
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
        const routes = await createRoutesWithCleanup(client, spec.routes ?? [], {
          scriptName: spec.name,
          workerId: result.id ?? spec.name,
          accountId: options.accountId ?? process.env.CLOUDFLARE_ACCOUNT_ID,
          zoneId: options.zoneId ?? process.env.CLOUDFLARE_ZONE_ID
        });
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
              metadata: cloudflareReceiptMetadata({
                runtime: spec.runtime ?? "workers",
                compatibilityDate: result.compatibility_date ?? options.compatibilityDate,
                entryPoint: result.entry_point ?? entrypoint,
                routes,
                labels: spec.labels
              })
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
              metadata: cloudflareReceiptMetadata({
                runtime: spec.runtime ?? "workers",
                compatibilityDate: stringProviderOption(result.metadata?.compatibility_date) ?? options.compatibilityDate,
                entryPoint: entrypoint,
                versionNumber: result.number,
                deploymentId: spec.deploymentId,
                labels: spec.labels
              })
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
              metadata: cloudflareReceiptMetadata({
                requestedDeploymentId: spec.deploymentId,
                targetVersionId,
                deployment
              })
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
