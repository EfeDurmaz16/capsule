import type { CapabilityPath } from "./capabilities.js";
import type { CapsuleDomain } from "./types.js";

export interface ProviderServiceClassification {
  provider: string;
  service: string;
  title: string;
  domains: CapsuleDomain[];
  likelyCapabilities: CapabilityPath[];
  notCapabilities: CapabilityPath[];
  notes: string[];
  aliases?: string[];
}

export interface ClassifyProviderServiceInput {
  provider: string;
  service: string;
}

export interface ClassifyProviderServiceResult {
  provider: string;
  service: string;
  classification?: ProviderServiceClassification;
  matchedBy?: "exact" | "alias";
  notes: string[];
}

function key(provider: string, service: string): string {
  return `${normalize(provider)}/${normalize(service)}`;
}

function normalize(value: string): string {
  return value.trim().toLowerCase().replace(/[_\s]+/g, "-");
}

const classifications: ProviderServiceClassification[] = [
  {
    provider: "cloudflare",
    service: "workers",
    title: "Cloudflare Workers",
    aliases: ["worker", "workers-free"],
    domains: ["edge"],
    likelyCapabilities: ["edge.deploy", "edge.version", "edge.rollback", "edge.routes", "edge.url"],
    notCapabilities: ["database.branchCreate", "machine.create", "service.deploy"],
    notes: ["Workers are an edge/runtime target. Bindings, secrets, logs, and gradual traffic release require provider-specific modeling."]
  },
  {
    provider: "cloudflare",
    service: "d1",
    title: "Cloudflare D1",
    domains: ["database", "resource"],
    likelyCapabilities: ["database.migrate"],
    notCapabilities: ["database.branchCreate", "machine.create", "edge.deploy"],
    notes: ["D1 is a database/resource primitive, not a service or edge deployment by itself. Branch semantics are not equivalent to Neon branches."]
  },
  {
    provider: "cloudflare",
    service: "r2",
    title: "Cloudflare R2",
    domains: ["resource"],
    likelyCapabilities: [],
    notCapabilities: ["database.branchCreate", "edge.deploy", "machine.create"],
    notes: ["R2 is object storage. Capsule does not currently model object storage as a first-class runtime domain."]
  },
  {
    provider: "neon",
    service: "postgres",
    title: "Neon Postgres",
    aliases: ["postgresql", "database", "branch"],
    domains: ["database", "resource"],
    likelyCapabilities: ["database.branchCreate", "database.branchDelete", "database.branchReset", "database.connectionString"],
    notCapabilities: ["service.deploy", "edge.deploy", "machine.create"],
    notes: ["Neon maps cleanly to Capsule's database/resource branch domain. It should not be modeled as a service deployment."]
  },
  {
    provider: "vercel",
    service: "project",
    title: "Vercel Project",
    aliases: ["deployment", "web"],
    domains: ["edge", "service"],
    likelyCapabilities: ["edge.deploy", "edge.status", "edge.release", "edge.logs", "edge.url"],
    notCapabilities: ["database.branchCreate", "machine.create", "sandbox.exec"],
    notes: ["Vercel is a web/edge deployment target. Project, alias, build, and runtime-log semantics should stay provider-specific."]
  },
  {
    provider: "fly",
    service: "machines",
    title: "Fly Machines",
    aliases: ["machine"],
    domains: ["machine", "job"],
    likelyCapabilities: ["machine.create", "machine.status", "machine.start", "machine.stop", "machine.destroy", "job.run", "job.env"],
    notCapabilities: ["database.branchCreate", "edge.deploy"],
    notes: ["Fly Machines are lower-level machine/job primitives. Service routing, volumes, and app networking need separate provider modeling."]
  },
  {
    provider: "fly",
    service: "mpg",
    title: "Fly Managed Postgres",
    aliases: ["postgres", "managed-postgres"],
    domains: ["database", "resource"],
    likelyCapabilities: ["database.connectionString"],
    notCapabilities: ["machine.create", "job.run", "edge.deploy"],
    notes: ["Fly mpg is a managed Postgres resource. It does not satisfy Capsule's Fly Machines adapter requirements."]
  },
  {
    provider: "supabase",
    service: "postgres",
    title: "Supabase Postgres",
    aliases: ["database"],
    domains: ["database", "resource"],
    likelyCapabilities: ["database.connectionString", "database.migrate"],
    notCapabilities: ["machine.create", "service.deploy"],
    notes: ["Supabase spans database, auth, storage, and edge functions. A Capsule adapter should split domains instead of flattening Supabase into one primitive."]
  },
  {
    provider: "railway",
    service: "service",
    title: "Railway Service",
    aliases: ["app", "deployment"],
    domains: ["service"],
    likelyCapabilities: ["service.deploy", "service.status", "service.logs", "service.url"],
    notCapabilities: ["sandbox.exec", "database.branchCreate", "machine.create"],
    notes: ["Railway-style platforms map primarily to service deployment. Database add-ons should be classified as database/resources separately."]
  },
  {
    provider: "render",
    service: "service",
    title: "Render Service",
    aliases: ["web-service", "worker"],
    domains: ["service", "job"],
    likelyCapabilities: ["service.deploy", "service.status", "service.logs", "service.url", "job.run"],
    notCapabilities: ["sandbox.exec", "machine.create"],
    notes: ["Render service and worker primitives should be modeled explicitly; do not present background workers as generic machines."]
  },
  {
    provider: "aws",
    service: "lambda",
    title: "AWS Lambda",
    domains: ["job", "function"],
    likelyCapabilities: ["job.run", "job.status", "job.logs"],
    notCapabilities: ["service.deploy", "machine.create", "database.branchCreate"],
    notes: ["Lambda invocation maps to finite job/function execution. Deployment/version management needs a separate adapter surface."]
  },
  {
    provider: "aws",
    service: "ecs",
    title: "AWS ECS/Fargate",
    aliases: ["fargate"],
    domains: ["job", "service"],
    likelyCapabilities: ["job.run", "job.status", "job.cancel", "service.deploy", "service.status", "service.delete", "service.logs"],
    notCapabilities: ["edge.deploy", "database.branchCreate"],
    notes: ["ECS/Fargate overlaps naturally with jobs and services, but task definitions, networking, and IAM are provider-specific."]
  },
  {
    provider: "google",
    service: "cloud-run",
    title: "Google Cloud Run",
    aliases: ["gcp-cloud-run"],
    domains: ["job", "service"],
    likelyCapabilities: ["job.run", "job.status", "job.cancel", "job.logs", "service.deploy", "service.status", "service.logs", "service.url"],
    notCapabilities: ["edge.deploy", "machine.create"],
    notes: ["Cloud Run maps cleanly to job and service domains. IAM/public URL behavior should not be hidden."]
  },
  {
    provider: "kubernetes",
    service: "cluster",
    title: "Kubernetes Cluster",
    aliases: ["jobs", "deployments"],
    domains: ["job", "service"],
    likelyCapabilities: ["job.run", "job.status", "job.cancel", "job.logs", "service.deploy", "service.status", "service.delete", "service.logs"],
    notCapabilities: ["edge.deploy", "database.branchCreate"],
    notes: ["Kubernetes can host many runtime shapes, but Capsule should model Jobs, Deployments, Services, and logs as explicit domain operations."]
  },
  {
    provider: "docker",
    service: "daemon",
    title: "Docker Engine",
    aliases: ["docker"],
    domains: ["sandbox", "job"],
    likelyCapabilities: ["sandbox.create", "sandbox.exec", "sandbox.fileRead", "sandbox.fileWrite", "sandbox.fileList", "sandbox.destroy", "job.run"],
    notCapabilities: ["edge.deploy", "database.branchCreate", "service.deploy"],
    notes: ["Docker is useful for local trusted execution and jobs. It is not safe for hostile untrusted code without host hardening."]
  }
];

const byKey = new Map(classifications.map((entry) => [key(entry.provider, entry.service), entry]));
const aliasEntries = classifications.flatMap((entry) => (entry.aliases ?? []).map((alias) => [key(entry.provider, alias), entry] as const));
const byAlias = new Map(aliasEntries);

export const providerServiceClassifications: readonly ProviderServiceClassification[] = classifications;

export function classifyProviderService(input: ClassifyProviderServiceInput): ClassifyProviderServiceResult {
  const normalizedProvider = normalize(input.provider);
  const normalizedService = normalize(input.service);
  const exact = byKey.get(key(normalizedProvider, normalizedService));
  if (exact) {
    return {
      provider: normalizedProvider,
      service: normalizedService,
      classification: exact,
      matchedBy: "exact",
      notes: exact.notes
    };
  }
  const alias = byAlias.get(key(normalizedProvider, normalizedService));
  if (alias) {
    return {
      provider: normalizedProvider,
      service: normalizedService,
      classification: alias,
      matchedBy: "alias",
      notes: alias.notes
    };
  }
  return {
    provider: normalizedProvider,
    service: normalizedService,
    notes: [
      "No built-in Capsule classification exists for this provider service.",
      "Add an explicit classification before claiming domain or capability support."
    ]
  };
}
