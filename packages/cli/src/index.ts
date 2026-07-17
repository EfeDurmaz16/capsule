#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { createPublicKey, verify as verifySignature } from "node:crypto";
import { readFileSync } from "node:fs";
import { access, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import {
  Capsule,
  capabilityDiff,
  capabilityModelDocsUrl,
  classifyProviderService,
  explainPolicy,
  explainSupportLevel,
  getProviderSelectionRecipe,
  isProviderSelectionRecipeId,
  providerCompatibilityScore,
  rankProvidersByRecipe,
  redactSensitiveText,
  uniqueCapabilityPaths,
  unsupportedCapabilitySafeRetryGuidance,
  verifyReceipt,
  type CapabilityDiffEntry,
  type CapabilityMap,
  type CapabilityPath,
  type CapsuleAdapter,
  type CapsuleApprovalResourceScope,
  type CapsuleDomain,
  type CapsulePolicy,
  type CapsuleReceipt,
  type ClassifyProviderServiceResult,
  type CreateDatabaseBranchSpec,
  type CreatePreviewSpec,
  type DeployEdgeSpec,
  type DeployServiceSpec,
  type PolicyInput,
  type ReceiptVerifier,
  type PreviewEnvironment,
  type ProviderSelectionRecipe,
  type ProviderSelectionRecipeId,
  type ProviderSelectionResult,
  type ProviderCompatibilityScore,
  type RunJobSpec,
  type SupportLevelExplanation
} from "@capsule-sdk/core";
import {
  mockCloudRun,
  mockCloudflare,
  mockDaytona,
  mockE2B,
  mockEC2,
  mockECS,
  mockKubernetes,
  mockLambda,
  mockModal,
  mockNeon,
  mockVercel
} from "@capsule-sdk/mock";
import { azureContainerApps } from "@capsule-sdk/azure";
import { cloudflare } from "@capsule-sdk/cloudflare";
import { cloudRun } from "@capsule-sdk/cloud-run";
import { daytona } from "@capsule-sdk/daytona";
import { docker, dockerAvailable } from "@capsule-sdk/docker";
import { e2b } from "@capsule-sdk/e2b";
import { ec2 } from "@capsule-sdk/ec2";
import { ecs } from "@capsule-sdk/ecs";
import { fly } from "@capsule-sdk/fly";
import { kubernetes } from "@capsule-sdk/kubernetes";
import { lambda } from "@capsule-sdk/lambda";
import { modal } from "@capsule-sdk/modal";
import { neon } from "@capsule-sdk/neon";
import {
  cleanupPreviewEnvironment,
  createPreviewDryRunReceiptBundle,
  createPreviewGraph,
  type PreviewCleanupPlan,
  type PreviewCleanupDisposition,
  type PreviewDryRunReceiptBundle,
  type PreviewPlan,
  type PreviewResourceKind,
  type PreviewResourceRecord
} from "@capsule-sdk/preview";
import { presetCatalog, type PresetCatalogEntry } from "@capsule-sdk/presets";
import { vercel } from "@capsule-sdk/vercel";
import { jsonlReceiptStore } from "@capsule-sdk/store-jsonl";

interface ParsedArgs {
  command?: string;
  image?: string;
  adapter?: string;
  leftAdapter?: string;
  rightAdapter?: string;
  provider?: string;
  recipe?: string;
  capability?: string;
  policyFile?: string;
  specFile?: string;
  configFile?: string;
  cleanupFile?: string;
  domains?: string[];
  outDir?: string;
  receiptFile?: string;
  id?: string;
  project?: string;
  name?: string;
  parent?: string;
  branchId?: string;
  database?: string;
  role?: string;
  entrypoint?: string;
  compatibilityDate?: string;
  workersDevSubdomain?: string;
  zoneId?: string;
  routes?: string[];
  projectId?: string;
  location?: string;
  projectName?: string;
  target?: string;
  namespace?: string;
  context?: string;
  kubeconfig?: string;
  region?: string;
  functionName?: string;
  subscriptionId?: string;
  resourceGroup?: string;
  environmentId?: string;
  cluster?: string;
  taskDefinition?: string;
  containerName?: string;
  subnets?: string[];
  securityGroups?: string[];
  subnetId?: string;
  imageId?: string;
  instanceType?: string;
  apiUrl?: string;
  appName?: string;
  port?: number;
  force?: boolean;
  hardDelete?: boolean;
  explain?: boolean;
  json?: boolean;
  requireSignature?: boolean;
  publicKey?: string;
  allowUnverifiedSignatures?: boolean;
  dryRun?: boolean;
  reason?: string;
  rest: string[];
}

interface CredentialRequirement {
  provider: string;
  requiredAll?: string[];
  requiredAny?: string[];
  aliases?: Record<string, string[]>;
  notes?: string[];
}

interface ProviderCredentialDiagnostic {
  provider: string;
  status: "configured" | "missing";
  configuredEnv: string[];
  missingEnv: string[];
  requiredEnv: string[];
  notes: string[];
}

interface DoctorReport {
  docker: "available" | "unavailable";
  node: {
    version: string;
    requirement: string;
    supported: boolean;
  };
  workspace: {
    root: string;
    status: "ok" | "missing-files";
    packageManager?: string;
    rootVersion?: string;
    missingFiles: string[];
  };
  packages: Array<{
    name: string;
    version: string;
    private: boolean;
    path: string;
  }>;
  releaseAudit: {
    status: "available" | "missing-scripts";
    command: string;
    scripts: string[];
    missingScripts: string[];
  };
  providers: ProviderCredentialDiagnostic[];
}

interface LiveTestPlan {
  provider: string;
  testPath: string;
  requiredEnv: string[];
  optionalEnv: string[];
  aliases?: Record<string, string[]>;
  costRisk: "none" | "read-only" | "billable";
  costAcknowledgementEnv?: string;
  maxResourceCount?: number;
  maxResourceCountEnv?: string;
  safeCommands: string[];
  notes: string[];
  quarantine?: LiveTestQuarantine;
}

interface LiveTestQuarantine {
  reason: string;
  lastObservedFailure: string;
  owner: string;
  revalidationCommand: string;
}

interface ProviderCapabilityComparison {
  left: {
    provider: string;
    compatibility: ProviderCompatibilityScore;
  };
  right: {
    provider: string;
    compatibility: ProviderCompatibilityScore;
  };
  diff: CapabilityDiffEntry[];
}

interface CapabilityReport {
  adapter: string;
  capabilities: CapabilityMap;
  entries: SupportLevelExplanation[];
}

interface PolicyExplainReport {
  adapter: string;
  capabilityPath: CapabilityPath;
  supportLevel: string;
  policy: ReturnType<typeof explainPolicy>;
}

interface ReceiptVerifyReport {
  store: {
    path: string;
    readable: boolean;
    receiptCount: number;
    error?: string;
  };
  summary: {
    valid: boolean;
    checked: number;
    failed: number;
  };
  notes: string[];
  receipts: Array<
    ReturnType<typeof verifyReceipt> & {
      id?: string;
      type?: string;
      capabilityPath?: string;
      notes?: string[];
    }
  >;
}

interface PreviewConfigResource<TSpec> {
  adapter: string;
  options?: Record<string, unknown>;
  spec: TSpec;
}

interface PreviewConfigFile {
  name: string;
  source?: CreatePreviewSpec["source"];
  ttlMs?: number;
  requireRealProviders?: boolean;
  allowMockProviders?: boolean;
  labels?: Record<string, string>;
  databases?: Array<PreviewConfigResource<CreateDatabaseBranchSpec>>;
  services?: Array<PreviewConfigResource<DeployServiceSpec>>;
  edges?: Array<PreviewConfigResource<DeployEdgeSpec>>;
  jobs?: Array<PreviewConfigResource<RunJobSpec>>;
}

interface SerializedPreviewCleanupAction {
  actionId?: string;
  cleanupOrder?: number;
  kind: PreviewResourceKind;
  adapter: string;
  options?: Record<string, unknown>;
  capabilityPath: CapabilityPath;
  spec: Record<string, unknown>;
  idempotencyKey?: string;
  reversible?: true;
}

interface SerializedPreviewResourceRecord {
  type: string;
  kind: PreviewResourceKind;
  id: string;
  provider: string;
  name?: string;
  url?: string;
  status?: string;
  receipt?: CapsuleReceipt;
  cleanupActionId?: string;
  cleanupOrder?: number;
  cleanup?: SerializedPreviewCleanupAction;
  cleanupDisposition?: PreviewCleanupDisposition;
}

interface PreviewCleanupPlanFile {
  schema: typeof previewCleanupPlanFileSchema | typeof legacyPreviewCleanupPlanFileSchema;
  id: string;
  previewId: string;
  createdAt: string;
  cleanupOrder: "reverse-create-order";
  cleanupActionCount: number;
  unsupportedCleanupCount: number;
  actions: PreviewCleanupPlan["actions"];
  preview: PreviewEnvironment;
  resources: SerializedPreviewResourceRecord[];
}

interface PreviewCreateReport {
  preview: PreviewEnvironment;
  resources: SerializedPreviewResourceRecord[];
  receipts: CapsuleReceipt[];
  cleanupPlan: {
    schema: PreviewCleanupPlanFile["schema"];
    id: string;
    previewId: string;
    cleanupOrder: PreviewCleanupPlanFile["cleanupOrder"];
    path?: string;
    resourceCount: number;
    cleanupActionCount: number;
    unsupportedCleanupCount: number;
  };
}

interface PreviewDestroyReport {
  previewId: string;
  status: "cleaned" | "unsupported" | "partial";
  summary: {
    cleaned: number;
    partial: number;
    failed: number;
    unsupported: number;
    leaked: number;
  };
  dispositions: Array<{
    resource: SerializedPreviewResourceRecord;
    disposition: PreviewCleanupDisposition;
    receipt?: CapsuleReceipt;
    error?: string;
    notes?: string[];
  }>;
  receipts: CapsuleReceipt[];
  receipt: CapsuleReceipt;
}

interface ProviderSelectionReport {
  recipe: ProviderSelectionRecipe;
  results: ProviderSelectionResult[];
}

interface ProviderVerificationEntry {
  provider: string;
  status: "passed" | "ready" | "missing" | "unavailable" | "quarantined" | "blocked";
  liveTestEnabled: boolean;
  configuredEnv: string[];
  missingEnv: string[];
  requiredEnv: string[];
  testPath?: string;
  safeCommands: string[];
  notes: string[];
  quarantine?: LiveTestQuarantine;
  quarantineRevalidationEnv?: string;
  missingCiOptInEnv?: string[];
  ciOptInEnv?: string;
  ciOptInLabel?: string;
  ciUntrustedFork?: boolean;
}

interface ProviderVerificationReport {
  providers: ProviderVerificationEntry[];
}

interface LiveEnvironmentValidationEntry {
  provider: string;
  status: "ready" | "blocked" | "quarantined";
  liveTestEnabled: boolean;
  costRisk: LiveTestPlan["costRisk"];
  costAcknowledged: boolean;
  resourceLimit?: {
    env: string;
    required: number;
    configured?: number;
    satisfied: boolean;
  };
  configuredEnv: string[];
  missingEnv: string[];
  missingCostEnv: string[];
  missingResourceLimitEnv: string[];
  requiredEnv: string[];
  testPath: string;
  safeCommands: string[];
  notes: string[];
  quarantine?: LiveTestQuarantine;
  quarantineRevalidationEnv?: string;
  missingCiOptInEnv?: string[];
  ciOptInEnv?: string;
  ciOptInLabel?: string;
  ciUntrustedFork?: boolean;
}

interface LiveEnvironmentValidationReport {
  providers: LiveEnvironmentValidationEntry[];
}

interface AdapterScaffoldFile {
  path: string;
  content: string;
}

interface AdapterScaffoldPlan {
  provider: string;
  packageName: string;
  factoryName: string;
  packageDir: string;
  domains: AdapterScaffoldDomain[];
  files: AdapterScaffoldFile[];
}

interface ProjectInitFile {
  path: string;
  content: string;
}

interface ProjectInitPlan {
  adapter: string;
  outDir: string;
  files: ProjectInitFile[];
  installHint: string;
  notes: string[];
}

type ExampleCredentialMode = "mock" | "no-provider" | "local-docker";

interface RunnableExample {
  id: string;
  packageName: string;
  directory: string;
  command: string[];
  credentialMode: ExampleCredentialMode;
  runnableWithoutCredentials: boolean;
  notes: string[];
}

interface ExamplesReport {
  examples: RunnableExample[];
}

interface ExampleRunnerOptions {
  cwd: string;
  env: NodeJS.ProcessEnv;
}

interface ExampleRunnerResult {
  status: number | null;
  stdout?: string;
  stderr?: string;
  error?: unknown;
}

interface RunExampleReport {
  status: "planned" | "passed" | "failed";
  example: RunnableExample;
  command: string[];
  exitCode?: number;
  stdout?: string;
  stderr?: string;
  error?: string;
}

type AdapterScaffoldDomain = Extract<CapsuleDomain, "sandbox" | "job" | "service" | "edge" | "database" | "preview" | "machine">;

const adapterScaffoldDomains = ["sandbox", "job", "service", "edge", "database", "preview", "machine"] as const satisfies readonly AdapterScaffoldDomain[];
const liveTestMaxResourcesEnv = "CAPSULE_LIVE_TEST_MAX_RESOURCES";
const liveTestFlakyRevalidationEnv = "CAPSULE_LIVE_TEST_REVALIDATE_FLAKY";
const liveTestCiOptInEnv = "CAPSULE_LIVE_TEST_CI_OPT_IN";
const liveTestCiUntrustedForkEnv = "CAPSULE_LIVE_TEST_UNTRUSTED_FORK";
const liveTestCiLabel = "capsule:live-tests";
const previewCleanupPlanFileSchema = "capsule.cli.preview-cleanup-file.v1" as const;
const legacyPreviewCleanupPlanFileSchema = "capsule.preview.cleanup.v1" as const;
const mockAdapterFactories: Record<string, () => CapsuleAdapter> = {
  "mock-e2b": mockE2B,
  "mock-daytona": mockDaytona,
  "mock-modal": mockModal,
  "mock-cloud-run": mockCloudRun,
  "mock-vercel": mockVercel,
  "mock-cloudflare": mockCloudflare,
  "mock-neon": mockNeon,
  "mock-lambda": mockLambda,
  "mock-ecs": mockECS,
  "mock-kubernetes": mockKubernetes,
  "mock-ec2": mockEC2
};

const credentialRequirements: CredentialRequirement[] = [
  { provider: "e2b", requiredAll: ["E2B_API_KEY"] },
  { provider: "daytona", requiredAll: ["DAYTONA_API_KEY"] },
  { provider: "modal", requiredAll: ["MODAL_TOKEN_ID", "MODAL_TOKEN_SECRET"], notes: ["MODAL_ENVIRONMENT is optional."] },
  {
    provider: "neon",
    requiredAll: ["NEON_API_KEY"],
    aliases: { NEON_PROJECT_ID: ["CAPSULE_POSTGRES_PROJECT_ID"] },
    notes: ["NEON_PROJECT_ID, or project-scoped alias CAPSULE_POSTGRES_PROJECT_ID, is required for Neon live branch tests."]
  },
  {
    provider: "cloudflare",
    requiredAll: ["CLOUDFLARE_API_TOKEN", "CLOUDFLARE_ACCOUNT_ID"],
    aliases: {
      CLOUDFLARE_API_TOKEN: ["CAPSULE_WORKER_API_TOKEN", "CLOUDFLARE_WORKERS_FREE_API_TOKEN"],
      CLOUDFLARE_ACCOUNT_ID: ["CAPSULE_WORKER_ACCOUNT_ID", "CLOUDFLARE_WORKERS_FREE_ACCOUNT_ID"]
    },
    notes: ["CLOUDFLARE_ZONE_ID is required only for route creation."]
  },
  { provider: "vercel", requiredAll: ["VERCEL_TOKEN"], notes: ["VERCEL_TEAM_ID or slug-style scoping is optional."] },
  {
    provider: "cloud-run",
    requiredAny: ["GOOGLE_APPLICATION_CREDENTIALS", "GOOGLE_APPLICATION_CREDENTIALS_JSON", "GOOGLE_OAUTH_ACCESS_TOKEN"],
    notes: ["Cloud Run uses Google ADC; an already-authenticated gcloud environment can also satisfy credentials at runtime."]
  },
  {
    provider: "kubernetes",
    requiredAny: ["KUBECONFIG"],
    notes: ["Kubernetes can also use the default kubeconfig path or in-cluster configuration."]
  },
  {
    provider: "aws",
    requiredAny: ["AWS_PROFILE", "AWS_ACCESS_KEY_ID", "AWS_WEB_IDENTITY_TOKEN_FILE"],
    notes: ["Lambda, ECS/Fargate, and EC2 use the AWS SDK default credential chain."]
  },
  { provider: "fly", requiredAll: ["FLY_API_TOKEN"], notes: ["FLY_APP_NAME is required for Fly Machines calls unless passed through CLI options."] },
  {
    provider: "azure-container-apps",
    requiredAll: ["AZURE_ACCESS_TOKEN", "AZURE_SUBSCRIPTION_ID", "AZURE_RESOURCE_GROUP", "AZURE_LOCATION", "AZURE_CONTAINERAPPS_ENVIRONMENT_ID"]
  }
];

const comparableProviders = [
  "azure-container-apps",
  "cloud-run",
  "cloudflare",
  "daytona",
  "docker",
  "e2b",
  "ec2",
  "ecs",
  "fly",
  "kubernetes",
  "lambda",
  "modal",
  "neon",
  "vercel"
] as const;

const completionCommands = [
  "doctor",
  "verify",
  "live-test",
  "classify",
  "policy",
  "receipt",
  "preview",
  "preset",
  "init",
  "examples",
  "adapter",
  "select",
  "compare",
  "capabilities",
  "run",
  "sandbox",
  "job",
  "service",
  "machine",
  "edge",
  "neon",
  "completion"
] as const;

const completionOptions = [
  "--adapter",
  "--provider",
  "--recipe",
  "--left",
  "--right",
  "--json",
  "--explain",
  "--policy-file",
  "--spec-file",
  "--receipt-file",
  "--config-file",
  "--cleanup-file",
  "--out-dir",
  "--domain",
  "--name",
  "--id",
  "--image",
  "--project",
  "--branch-id",
  "--database",
  "--role",
  "--force",
  "--dry-run",
  "--require-signature",
  "--reason",
  "--project-id",
  "--location",
  "--namespace",
  "--region",
  "--app-name"
] as const;

const completionProviders = [...comparableProviders, ...Object.keys(mockAdapterFactories)].sort();
const completionRecipes = ["sandbox", "agent-code-execution", "preview-web-db", "edge-web", "service-api", "machine"] as const;
const completionShells = ["bash", "zsh", "fish"] as const;

type ShellCompletionTarget = (typeof completionShells)[number];

const liveTestPlans: LiveTestPlan[] = [
  {
    provider: "e2b",
    testPath: "packages/e2b/src/e2b.live.test.ts",
    requiredEnv: ["CAPSULE_LIVE_TESTS", "E2B_API_KEY"],
    optionalEnv: [],
    costRisk: "billable",
    costAcknowledgementEnv: "CAPSULE_LIVE_TEST_COST_ACK",
    safeCommands: ["CAPSULE_LIVE_TESTS=1 pnpm vitest run packages/e2b/src/e2b.live.test.ts"],
    notes: ["Creates a sandbox, exercises exec and file operations, then destroys the sandbox."]
  },
  {
    provider: "daytona",
    testPath: "packages/daytona/src/daytona.live.test.ts",
    requiredEnv: ["CAPSULE_LIVE_TESTS", "DAYTONA_API_KEY"],
    optionalEnv: [],
    costRisk: "billable",
    costAcknowledgementEnv: "CAPSULE_LIVE_TEST_COST_ACK",
    safeCommands: ["CAPSULE_LIVE_TESTS=1 pnpm vitest run packages/daytona/src/daytona.live.test.ts"],
    notes: ["Creates an ephemeral sandbox with auto-stop configured and destroys it in finally."]
  },
  {
    provider: "modal",
    testPath: "packages/modal/src/modal.live.test.ts",
    requiredEnv: ["CAPSULE_LIVE_TESTS", "MODAL_TOKEN_ID", "MODAL_TOKEN_SECRET"],
    optionalEnv: ["MODAL_APP_NAME", "MODAL_IMAGE", "MODAL_ENVIRONMENT"],
    costRisk: "billable",
    costAcknowledgementEnv: "CAPSULE_LIVE_TEST_COST_ACK",
    safeCommands: ["CAPSULE_LIVE_TESTS=1 pnpm vitest run packages/modal/src/modal.live.test.ts"],
    notes: ["Creates a Modal sandbox, exercises exec and file operations, then destroys the sandbox."]
  },
  {
    provider: "cloud-run",
    testPath: "packages/cloud-run/src/cloud-run.live.test.ts",
    requiredEnv: ["CAPSULE_LIVE_TESTS", "GOOGLE_CLOUD_PROJECT", "GOOGLE_CLOUD_RUN_LOCATION", "GOOGLE_OAUTH_ACCESS_TOKEN", "CAPSULE_CLOUD_RUN_SERVICE_ID"],
    optionalEnv: [],
    costRisk: "read-only",
    safeCommands: ["CAPSULE_LIVE_TESTS=1 pnpm vitest run packages/cloud-run/src/cloud-run.live.test.ts"],
    notes: ["Reads an existing Cloud Run service status; no resource is created."]
  },
  {
    provider: "cloudflare",
    testPath: "packages/cloudflare/src/cloudflare.live.test.ts",
    requiredEnv: [
      "CAPSULE_LIVE_TESTS",
      "CLOUDFLARE_API_TOKEN",
      "CLOUDFLARE_ACCOUNT_ID",
      "CAPSULE_CLOUDFLARE_WORKER_NAME",
      "CAPSULE_CLOUDFLARE_LIVE_CREATE_VERSION"
    ],
    optionalEnv: ["CLOUDFLARE_COMPATIBILITY_DATE"],
    costRisk: "billable",
    costAcknowledgementEnv: "CAPSULE_LIVE_TEST_COST_ACK",
    aliases: {
      CLOUDFLARE_API_TOKEN: ["CAPSULE_WORKER_API_TOKEN", "CLOUDFLARE_WORKERS_FREE_API_TOKEN"],
      CLOUDFLARE_ACCOUNT_ID: ["CAPSULE_WORKER_ACCOUNT_ID", "CLOUDFLARE_WORKERS_FREE_ACCOUNT_ID"]
    },
    safeCommands: [
      'CLOUDFLARE_API_TOKEN="${CLOUDFLARE_API_TOKEN:-$CAPSULE_WORKER_API_TOKEN}" CLOUDFLARE_ACCOUNT_ID="${CLOUDFLARE_ACCOUNT_ID:-$CAPSULE_WORKER_ACCOUNT_ID}" CAPSULE_LIVE_TESTS=1 pnpm vitest run packages/cloudflare/src/cloudflare.live.test.ts'
    ],
    notes: ["Creates an unreleased Worker version. Project-scoped Worker aliases can satisfy the Cloudflare token and account env vars."]
  },
  {
    provider: "vercel",
    testPath: "packages/vercel/src/vercel.live.test.ts",
    requiredEnv: ["CAPSULE_LIVE_TESTS", "VERCEL_TOKEN", "CAPSULE_VERCEL_DEPLOYMENT_ID"],
    optionalEnv: ["VERCEL_TEAM_ID", "VERCEL_TEAM_SLUG", "VERCEL_PROJECT_ID"],
    costRisk: "read-only",
    safeCommands: ["CAPSULE_LIVE_TESTS=1 pnpm vitest run packages/vercel/src/vercel.live.test.ts"],
    notes: ["Reads an existing Vercel deployment status; no resource is created."]
  },
  {
    provider: "neon",
    testPath: "packages/neon/src/neon.live.test.ts",
    requiredEnv: ["CAPSULE_LIVE_TESTS", "NEON_API_KEY", "NEON_PROJECT_ID"],
    optionalEnv: ["NEON_PARENT_BRANCH_ID", "NEON_DATABASE", "NEON_ROLE", "NEON_POOLED"],
    costRisk: "billable",
    costAcknowledgementEnv: "CAPSULE_LIVE_TEST_COST_ACK",
    aliases: {
      NEON_PROJECT_ID: ["CAPSULE_POSTGRES_PROJECT_ID"]
    },
    safeCommands: [
      'NEON_PROJECT_ID="${NEON_PROJECT_ID:-$CAPSULE_POSTGRES_PROJECT_ID}" CAPSULE_LIVE_TESTS=1 pnpm vitest run packages/neon/src/neon.live.test.ts'
    ],
    notes: ["Creates a Neon branch and hard-deletes it in finally. Project-scoped Postgres aliases can satisfy NEON_PROJECT_ID."]
  },
  {
    provider: "kubernetes",
    testPath: "packages/kubernetes/src/kubernetes.live.test.ts",
    requiredEnv: ["CAPSULE_LIVE_TESTS", "CAPSULE_KUBERNETES_NAMESPACE"],
    optionalEnv: ["KUBECONFIG", "KUBECONFIG_CONTEXT", "CAPSULE_KUBERNETES_IMAGE"],
    costRisk: "billable",
    costAcknowledgementEnv: "CAPSULE_LIVE_TEST_COST_ACK",
    safeCommands: ["CAPSULE_LIVE_TESTS=1 pnpm vitest run packages/kubernetes/src/kubernetes.live.test.ts"],
    notes: ["Creates a Kubernetes Job and best-effort cancels it in finally."]
  },
  {
    provider: "lambda",
    testPath: "packages/lambda/src/lambda.live.test.ts",
    requiredEnv: ["CAPSULE_LIVE_TESTS", "AWS_REGION", "CAPSULE_LAMBDA_FUNCTION_NAME"],
    optionalEnv: ["AWS_PROFILE", "AWS_ACCESS_KEY_ID", "AWS_WEB_IDENTITY_TOKEN_FILE"],
    costRisk: "billable",
    costAcknowledgementEnv: "CAPSULE_LIVE_TEST_COST_ACK",
    safeCommands: ["CAPSULE_LIVE_TESTS=1 pnpm vitest run packages/lambda/src/lambda.live.test.ts"],
    notes: ["Uses the AWS SDK default credential chain and invokes an existing Lambda function."]
  },
  {
    provider: "fly",
    testPath: "packages/fly/src/fly.live.test.ts",
    requiredEnv: ["CAPSULE_LIVE_TESTS", "FLY_API_TOKEN", "FLY_APP_NAME", "CAPSULE_FLY_IMAGE"],
    optionalEnv: ["FLY_REGION", "CAPSULE_FLY_MEMORY_MB", "CAPSULE_FLY_CPUS"],
    costRisk: "billable",
    costAcknowledgementEnv: "CAPSULE_LIVE_TEST_COST_ACK",
    safeCommands: ["CAPSULE_LIVE_TESTS=1 pnpm vitest run packages/fly/src/fly.live.test.ts"],
    notes: ["Creates a Fly Machine and destroys it in finally."]
  },
  {
    provider: "azure-container-apps",
    testPath: "packages/azure/src/azure-container-apps.live.test.ts",
    requiredEnv: [
      "CAPSULE_LIVE_TESTS",
      "AZURE_ACCESS_TOKEN",
      "AZURE_SUBSCRIPTION_ID",
      "AZURE_RESOURCE_GROUP",
      "AZURE_LOCATION",
      "AZURE_CONTAINERAPPS_ENVIRONMENT_ID",
      "CAPSULE_AZURE_CONTAINER_IMAGE"
    ],
    optionalEnv: ["CAPSULE_AZURE_CONTAINER_PORT"],
    costRisk: "billable",
    costAcknowledgementEnv: "CAPSULE_LIVE_TEST_COST_ACK",
    safeCommands: ["CAPSULE_LIVE_TESTS=1 pnpm vitest run packages/azure/src/azure-container-apps.live.test.ts"],
    notes: ["Deploys an Azure Container App service and deletes it in finally."]
  }
];

// Single-value flags: kebab-case CLI flag -> camelCase ParsedArgs field.
const stringFlagFields: Record<string, keyof ParsedArgs> = {
  image: "image",
  adapter: "adapter",
  left: "leftAdapter",
  right: "rightAdapter",
  provider: "provider",
  recipe: "recipe",
  capability: "capability",
  "policy-file": "policyFile",
  "spec-file": "specFile",
  "config-file": "configFile",
  "cleanup-file": "cleanupFile",
  "out-dir": "outDir",
  "receipt-file": "receiptFile",
  id: "id",
  project: "project",
  name: "name",
  parent: "parent",
  "branch-id": "branchId",
  database: "database",
  role: "role",
  entrypoint: "entrypoint",
  "compatibility-date": "compatibilityDate",
  "workers-dev-subdomain": "workersDevSubdomain",
  "zone-id": "zoneId",
  "project-id": "projectId",
  location: "location",
  "project-name": "projectName",
  target: "target",
  namespace: "namespace",
  context: "context",
  kubeconfig: "kubeconfig",
  region: "region",
  "function-name": "functionName",
  "subscription-id": "subscriptionId",
  "resource-group": "resourceGroup",
  "environment-id": "environmentId",
  cluster: "cluster",
  "task-definition": "taskDefinition",
  "container-name": "containerName",
  "subnet-id": "subnetId",
  "image-id": "imageId",
  "instance-type": "instanceType",
  "api-url": "apiUrl",
  "app-name": "appName",
  "public-key": "publicKey",
  reason: "reason"
};

// Repeatable flags that accumulate into an array field.
const arrayFlagFields: Record<string, "domains" | "routes" | "subnets" | "securityGroups"> = {
  domain: "domains",
  route: "routes",
  subnet: "subnets",
  "security-group": "securityGroups"
};

// Boolean presence flags.
const booleanFlagFields: Record<string, keyof ParsedArgs> = {
  "hard-delete": "hardDelete",
  explain: "explain",
  json: "json",
  "require-signature": "requireSignature",
  "allow-unverified-signatures": "allowUnverifiedSignatures",
  "dry-run": "dryRun",
  force: "force"
};

type ParseArgsOptions = NonNullable<NonNullable<Parameters<typeof parseArgs>[0]>["options"]>;

const parseArgsOptions: ParseArgsOptions = { port: { type: "string" } };
for (const flag of Object.keys(stringFlagFields)) parseArgsOptions[flag] = { type: "string" };
for (const flag of Object.keys(arrayFlagFields)) parseArgsOptions[flag] = { type: "string", multiple: true };
for (const flag of Object.keys(booleanFlagFields)) parseArgsOptions[flag] = { type: "boolean" };

// node:util parseArgs in non-strict token mode. Known flags map to their ParsedArgs field;
// --domain/--route/--subnet/--security-group accumulate; --port coerces to a number; and every
// unrecognized token (unknown flags, bare positionals, everything after --) falls through into
// rest in its original order, matching the previous hand-rolled parser.
export function parse(argv: string[]): ParsedArgs {
  const [command, ...args] = argv;
  const parsed: ParsedArgs = { command, rest: [] };
  const target = parsed as unknown as Record<string, unknown>;
  const { tokens } = parseArgs({ args, options: parseArgsOptions, strict: false, allowPositionals: true, tokens: true });
  for (const token of tokens) {
    if (token.kind === "positional") {
      parsed.rest.push(token.value);
      continue;
    }
    if (token.kind !== "option") {
      continue;
    }
    if (token.name === "port") {
      parsed.port = Number(token.value);
      continue;
    }
    const arrayField = arrayFlagFields[token.name];
    if (arrayField) {
      const values = (target[arrayField] as string[] | undefined) ?? [];
      values.push(token.value as string);
      target[arrayField] = values;
      continue;
    }
    const stringField = stringFlagFields[token.name];
    if (stringField) {
      target[stringField] = token.value;
      continue;
    }
    const booleanField = booleanFlagFields[token.name];
    if (booleanField) {
      target[booleanField] = true;
      continue;
    }
    parsed.rest.push(args[token.index]);
  }
  return parsed;
}

function credentialDiagnostic(requirement: CredentialRequirement, env: NodeJS.ProcessEnv): ProviderCredentialDiagnostic {
  const all = requirement.requiredAll ?? [];
  const any = requirement.requiredAny ?? [];
  const configuredAll = all.flatMap((name) => configuredCredentialNames(name, requirement.aliases, env));
  const missingAll = all.filter((name) => configuredCredentialNames(name, requirement.aliases, env).length === 0);
  const configuredAny = any.flatMap((name) => configuredCredentialNames(name, requirement.aliases, env));
  const hasRequiredAny = any.length === 0 || configuredAny.length > 0;
  return {
    provider: requirement.provider,
    status: missingAll.length === 0 && hasRequiredAny ? "configured" : "missing",
    configuredEnv: [...configuredAll, ...configuredAny],
    missingEnv: [...missingAll, ...(hasRequiredAny ? [] : any)],
    requiredEnv: [...all, ...any].flatMap((name) => [name, ...(requirement.aliases?.[name] ?? [])]),
    notes: requirement.notes ?? []
  };
}

function configuredCredentialNames(name: string, aliases: Record<string, string[]> | undefined, env: NodeJS.ProcessEnv): string[] {
  return [name, ...(aliases?.[name] ?? [])].filter((candidate) => Boolean(env[candidate]));
}

export function providerCredentialDiagnostics(env: NodeJS.ProcessEnv = process.env, adapter?: string): ProviderCredentialDiagnostic[] {
  return credentialRequirements
    .filter(
      (requirement) =>
        !adapter ||
        requirement.provider === adapter ||
        (adapter === "lambda" || adapter === "ecs" || adapter === "ec2" ? requirement.provider === "aws" : false)
    )
    .map((requirement) => credentialDiagnostic(requirement, env));
}

const minimumNodeRequirement = ">=22";
const releaseAuditScripts = ["release:audit", "release:metadata-audit", "release:dependency-audit", "release:markers", "release:pack-smoke"];
const workspaceRequiredFiles = ["package.json", "pnpm-lock.yaml", "pnpm-workspace.yaml", "tsconfig.typecheck.json"];

interface PackageJsonShape {
  name?: string;
  version?: string;
  private?: boolean;
  packageManager?: string;
  scripts?: Record<string, string>;
}

async function readJsonFile(path: string): Promise<PackageJsonShape | undefined> {
  try {
    return JSON.parse(await readFile(path, "utf8")) as PackageJsonShape;
  } catch {
    return undefined;
  }
}

function assertJsonObject(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`${label} must contain a JSON object.`);
  }
  return value as Record<string, unknown>;
}

async function readJsonObjectFile<T>(path: string | undefined, fallback: T): Promise<T> {
  if (!path) {
    return fallback;
  }
  return assertJsonObject(JSON.parse(await readFile(path, "utf8")), path) as T;
}

async function missingWorkspaceFiles(root: string): Promise<string[]> {
  const missing: string[] = [];
  for (const file of workspaceRequiredFiles) {
    try {
      await access(join(root, file));
    } catch {
      missing.push(file);
    }
  }
  return missing;
}

function nodeVersionSupported(version: string): boolean {
  const [major = 0] = version
    .replace(/^v/, "")
    .split(".")
    .map((part) => Number(part));
  return major >= 22;
}

async function workspacePackageVersions(root: string): Promise<DoctorReport["packages"]> {
  const packagesDir = join(root, "packages");
  let entries;
  try {
    entries = await readdir(packagesDir, { withFileTypes: true });
  } catch {
    return [];
  }

  const packages = await Promise.all(
    entries
      .filter((entry) => entry.isDirectory())
      .map(async (entry) => {
        const packagePath = join("packages", entry.name, "package.json");
        const pkg = await readJsonFile(join(root, packagePath));
        if (!pkg?.name || !pkg.version) return undefined;
        return {
          name: pkg.name,
          version: pkg.version,
          private: pkg.private === true,
          path: packagePath
        };
      })
  );

  return packages.filter((pkg): pkg is NonNullable<(typeof packages)[number]> => Boolean(pkg)).sort((left, right) => left.name.localeCompare(right.name));
}

function releaseAuditStatus(rootPackage: PackageJsonShape | undefined): DoctorReport["releaseAudit"] {
  const scripts = rootPackage?.scripts ?? {};
  const missingScripts = releaseAuditScripts.filter((script) => !scripts[script]);
  return {
    status: missingScripts.length === 0 ? "available" : "missing-scripts",
    command: "pnpm release:audit",
    scripts: releaseAuditScripts.filter((script) => Boolean(scripts[script])),
    missingScripts
  };
}

export async function createDoctorReport(
  options: { env?: NodeJS.ProcessEnv; adapter?: string; dockerCheck?: () => Promise<boolean>; workspaceRoot?: string } = {}
): Promise<DoctorReport> {
  const workspaceRoot = options.workspaceRoot ?? process.cwd();
  const rootPackage = await readJsonFile(join(workspaceRoot, "package.json"));
  const missingFiles = await missingWorkspaceFiles(workspaceRoot);
  const dockerOk = await (options.dockerCheck ?? dockerAvailable)();
  return {
    docker: dockerOk ? "available" : "unavailable",
    node: {
      version: process.version,
      requirement: minimumNodeRequirement,
      supported: nodeVersionSupported(process.version)
    },
    workspace: {
      root: workspaceRoot,
      status: missingFiles.length === 0 ? "ok" : "missing-files",
      packageManager: rootPackage?.packageManager,
      rootVersion: rootPackage?.version,
      missingFiles
    },
    packages: await workspacePackageVersions(workspaceRoot),
    releaseAudit: releaseAuditStatus(rootPackage),
    providers: providerCredentialDiagnostics(options.env ?? process.env, options.adapter)
  };
}

export function capabilityExplanations(capabilities: CapabilityMap): SupportLevelExplanation[] {
  return uniqueCapabilityPaths(capabilities).map((path) => explainSupportLevel(capabilities, path));
}

function createCapabilityReport(adapter: string, capabilities: CapabilityMap): CapabilityReport {
  return {
    adapter,
    capabilities,
    entries: capabilityExplanations(capabilities)
  };
}

function formatTable(columns: string[], rows: string[][]): string {
  const widths = columns.map((column, index) => Math.max(column.length, ...rows.map((row) => row[index]?.length ?? 0)));
  const formatRow = (values: string[]): string =>
    values
      .map((value, index) => value.padEnd(widths[index] ?? value.length))
      .join("  ")
      .trimEnd();
  return [formatRow(columns), formatRow(widths.map((width) => "-".repeat(width))), ...rows.map(formatRow)].join("\n");
}

function printReport(parsed: ParsedArgs, report: unknown, table: string): void {
  console.log(parsed.json ? JSON.stringify(report, null, 2) : table);
}

function formatCapabilityTable(report: CapabilityReport, options: { explain?: boolean } = {}): string {
  const columns = options.explain ? ["Capability", "Level", "Supported", "Guidance"] : ["Capability", "Level", "Supported", "Summary"];
  const rows = report.entries.map((entry) => [entry.path, entry.level, entry.supported ? "yes" : "no", options.explain ? entry.guidance : entry.summary]);

  return [`Adapter: ${report.adapter}`, "", formatTable(columns, rows)].join("\n");
}

function formatDoctorReport(report: DoctorReport): string {
  const publicPackages = report.packages.filter((pkg) => !pkg.private).length;
  const privatePackages = report.packages.length - publicPackages;
  const providerRows = report.providers.map((provider) => [
    provider.provider,
    provider.status,
    provider.configuredEnv.join(", ") || "-",
    provider.missingEnv.join(", ") || "-"
  ]);
  return [
    "Capsule doctor",
    "",
    "Runtime",
    formatTable(
      ["Check", "Status", "Details"],
      [
        ["Node", report.node.supported ? "ok" : "unsupported", `${report.node.version} (${report.node.requirement})`],
        ["Docker", report.docker, "-"],
        ["Release audit", report.releaseAudit.status, report.releaseAudit.command],
        ["Packages", "detected", `${publicPackages} public, ${privatePackages} private`]
      ]
    ),
    "",
    "Workspace",
    formatTable(["Root", "Status", "Missing"], [[report.workspace.root, report.workspace.status, report.workspace.missingFiles.join(", ") || "-"]]),
    "",
    "Providers",
    formatTable(["Provider", "Status", "Configured", "Missing"], providerRows.length > 0 ? providerRows : [["-", "-", "-", "-"]])
  ].join("\n");
}

function formatProviderSelectionReport(report: ProviderSelectionReport): string {
  const rows = report.results.map((result) => [
    result.provider,
    String(result.score),
    `${result.requiredSatisfied}/${result.requiredTotal}`,
    `${result.optionalSatisfied}/${result.optionalTotal}`,
    result.missingRequired
      .map((entry) => entry.path)
      .slice(0, 3)
      .join(", ") || "-"
  ]);
  return [
    `Provider selection: ${report.recipe.id}`,
    report.recipe.title,
    "",
    formatTable(["Provider", "Score", "Required", "Optional", "Missing required"], rows)
  ].join("\n");
}

function formatProviderComparisonReport(report: ProviderCapabilityComparison): string {
  const providers = [report.left, report.right].map((entry) => [
    entry.provider,
    String(entry.compatibility.score),
    `${entry.compatibility.requiredSatisfied}/${entry.compatibility.requiredTotal}`,
    `${entry.compatibility.optionalSatisfied}/${entry.compatibility.optionalTotal}`
  ]);
  const diffRows = report.diff.map((entry) => [entry.path, entry.left, entry.right]);
  return [
    `Provider comparison: ${report.left.provider} vs ${report.right.provider}`,
    "",
    formatTable(["Provider", "Score", "Required", "Optional"], providers),
    "",
    "Capability differences",
    formatTable(["Capability", report.left.provider, report.right.provider], diffRows.length > 0 ? diffRows : [["-", "-", "-"]])
  ].join("\n");
}

function assertPolicyExplainCapability(path: string | undefined): CapabilityPath {
  if (!path) {
    throw new Error("Missing --capability for policy explain.");
  }
  if (!path.includes(".")) {
    throw new Error(`Invalid capability path "${path}". Use dot notation such as job.run.`);
  }
  return path as CapabilityPath;
}

// The spec file is parsed JSON, so PolicyInput.now arrives as a string. Coerce it to a Date and
// reject invalid values with a clear message instead of letting a string reach input.now.toISOString().
export function coercePolicySpecNow(value: unknown): Date | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }
  if (value instanceof Date) {
    return value;
  }
  if (typeof value === "string" || typeof value === "number") {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) {
      throw new Error(`Invalid "now" in policy spec: ${JSON.stringify(value)}. Use an ISO 8601 date string such as 2026-01-01T00:00:00.000Z.`);
    }
    return date;
  }
  throw new Error(`Invalid "now" in policy spec: expected an ISO 8601 date string, received ${typeof value}.`);
}

function redactResourceScope(resource: CapsuleApprovalResourceScope, policy: CapsulePolicy): CapsuleApprovalResourceScope {
  return {
    ...resource,
    ...(resource.id === undefined ? {} : { id: redactSensitiveText(resource.id, undefined, policy) }),
    ...(resource.name === undefined ? {} : { name: redactSensitiveText(resource.name, undefined, policy) }),
    ...(resource.path === undefined ? {} : { path: redactSensitiveText(resource.path, undefined, policy) })
  };
}

// Env keys are safe by construction, but approval.reason and resource name/id/path echo user
// values verbatim. Run them through the same redaction the rest of Capsule applies before printing.
export function redactPolicyExplanation(explanation: ReturnType<typeof explainPolicy>): ReturnType<typeof explainPolicy> {
  const { input } = explanation;
  const policy = explanation.applied;
  return {
    ...explanation,
    input: {
      ...input,
      ...(input.approval === undefined
        ? {}
        : {
            approval: {
              ...input.approval,
              ...(input.approval.reason === undefined ? {} : { reason: redactSensitiveText(input.approval.reason, undefined, policy) }),
              ...(input.approval.resources === undefined
                ? {}
                : { resources: input.approval.resources.map((resource) => redactResourceScope(resource, policy)) })
            }
          }),
      ...(input.resource === undefined ? {} : { resource: redactResourceScope(input.resource, policy) })
    }
  };
}

async function createPolicyExplainReport(parsed: ParsedArgs): Promise<PolicyExplainReport> {
  const capsule = createCapsule(parsed);
  const capabilityPath = assertPolicyExplainCapability(parsed.capability);
  const support = capsule.supportLevel(capabilityPath);
  const policy = await readJsonObjectFile<CapsulePolicy>(parsed.policyFile, {});
  const spec = await readJsonObjectFile<Omit<PolicyInput, "capabilityPath" | "supportLevel">>(parsed.specFile, {});
  const now = coercePolicySpecNow((spec as { now?: unknown }).now);

  return {
    adapter: capsule.adapterName(),
    capabilityPath,
    supportLevel: support,
    policy: redactPolicyExplanation(
      explainPolicy(policy, {
        ...spec,
        now,
        capabilityPath,
        supportLevel: support
      })
    )
  };
}

// ed25519-only: the "public key" verification path Capsule ships. RSA/EC would need a hash
// algorithm passed to crypto.verify; add a branch here if a signer ever emits them.
// ponytail: ed25519 only, extend when a non-ed25519 signer appears.
function createPublicKeyVerifier(publicKeyPem: string): ReceiptVerifier {
  const key = createPublicKey(publicKeyPem);
  if (key.asymmetricKeyType !== "ed25519") {
    throw new Error(`Unsupported --public-key type "${key.asymmetricKeyType ?? "unknown"}". receipt verify --public-key supports ed25519 keys.`);
  }
  return {
    algorithm: "ed25519",
    verify: (payload, signature) => {
      try {
        return verifySignature(null, Buffer.from(payload, "utf8"), key, Buffer.from(signature, "base64"));
      } catch {
        return false;
      }
    }
  };
}

async function resolvePublicKeyPem(input: string): Promise<string> {
  return input.includes("-----BEGIN") ? input : readFile(input, "utf8");
}

async function createReceiptVerifyReport(parsed: ParsedArgs): Promise<ReceiptVerifyReport> {
  if (!parsed.receiptFile) {
    throw new Error("Missing --receipt-file for receipt verify.");
  }
  const verifier = parsed.publicKey ? createPublicKeyVerifier(await resolvePublicKeyPem(parsed.publicKey)) : undefined;
  try {
    const receipts = await jsonlReceiptStore(parsed.receiptFile).readAll();
    const verified = receipts.map((receipt) => {
      const report = verifyReceipt(receipt, { verifier, requireSignature: parsed.requireSignature });
      // Without a verifier, a signature can only be confirmed present, not authentic. Under
      // --require-signature that must fail unless the caller downgrades to a presence check.
      const rejectUnverified =
        parsed.requireSignature === true && parsed.allowUnverifiedSignatures !== true && report.signature.status === "present-unverified";
      return {
        id: receipt.id,
        type: receipt.type,
        capabilityPath: receipt.capabilityPath,
        ...report,
        valid: report.valid && !rejectUnverified,
        ...(rejectUnverified
          ? { notes: ["Signature is present but unverified; supply --public-key or pass --allow-unverified-signatures to accept presence only."] }
          : {})
      };
    });
    const failed = verified.filter((entry) => !entry.valid).length;
    const notes: string[] = [];
    const emptyStore = receipts.length === 0;
    if (emptyStore) {
      notes.push("receipts: 0 (store is readable but contains no receipts; nothing to verify).");
    }
    // An empty store cannot satisfy --require-signature: there is no signed receipt to confirm.
    const emptyStoreUnderRequireSignature = emptyStore && parsed.requireSignature === true;
    return {
      store: {
        path: parsed.receiptFile,
        readable: true,
        receiptCount: receipts.length
      },
      summary: {
        valid: failed === 0 && !emptyStoreUnderRequireSignature,
        checked: verified.length,
        failed
      },
      notes,
      receipts: verified
    };
  } catch (error) {
    return {
      store: {
        path: parsed.receiptFile,
        readable: false,
        receiptCount: 0,
        error: error instanceof Error ? error.message : String(error)
      },
      summary: {
        valid: false,
        checked: 0,
        failed: 0
      },
      notes: [],
      receipts: []
    };
  }
}

interface ReceiptInspectReport {
  store: { path: string; receiptCount: number };
  receipts: CapsuleReceipt[];
}

// Pretty-prints stored receipts as-is. No signature or schema validation: use receipt verify for that.
async function createReceiptInspectReport(parsed: ParsedArgs): Promise<ReceiptInspectReport> {
  if (!parsed.receiptFile) {
    throw new Error("Missing --receipt-file for receipt inspect.");
  }
  const receipts = await jsonlReceiptStore(parsed.receiptFile).readAll();
  const selected = parsed.id ? receipts.filter((receipt) => receipt.id === parsed.id) : receipts;
  if (parsed.id && selected.length === 0) {
    throw new Error(`No receipt with id "${parsed.id}" in ${parsed.receiptFile}.`);
  }
  return {
    store: { path: parsed.receiptFile, receiptCount: receipts.length },
    receipts: selected
  };
}

function formatPresetCatalogTable(entries: PresetCatalogEntry[]): string {
  return formatTable(
    ["ID", "Package", "Description"],
    entries.map((entry) => [entry.id, entry.package, entry.description])
  );
}

async function createPreviewPlanReport(parsed: ParsedArgs): Promise<PreviewDryRunReceiptBundle> {
  const config = await readPreviewConfigFile(parsed.configFile);
  return createPreviewDryRunReceiptBundle(createPreviewPlanFromConfig(config));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function assertRecordValue(value: unknown, label: string): Record<string, unknown> {
  if (!isRecord(value)) {
    throw new Error(`${label} must be a JSON object.`);
  }
  return value;
}

function assertStringValue(value: unknown, label: string): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`${label} must be a non-empty string.`);
  }
  return value;
}

function optionalBooleanValue(value: unknown, label: string): boolean | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "boolean") {
    throw new Error(`${label} must be a boolean.`);
  }
  return value;
}

function optionalNumberValue(value: unknown, label: string): number | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`${label} must be a finite number.`);
  }
  return value;
}

function optionalObjectValue(value: unknown, label: string): Record<string, unknown> | undefined {
  if (value === undefined) return undefined;
  return assertRecordValue(value, label);
}

function optionalStringRecord(value: unknown, label: string): Record<string, string> | undefined {
  if (value === undefined) return undefined;
  const record = assertRecordValue(value, label);
  for (const [key, entry] of Object.entries(record)) {
    if (typeof entry !== "string") {
      throw new Error(`${label}.${key} must be a string.`);
    }
  }
  return record as Record<string, string>;
}

function previewConfigResources<TSpec>(value: unknown, label: string): Array<PreviewConfigResource<TSpec>> | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) {
    throw new Error(`${label} must be an array.`);
  }
  return value.map((entry, index) => {
    const record = assertRecordValue(entry, `${label}[${index}]`);
    return {
      adapter: assertStringValue(record.adapter, `${label}[${index}].adapter`),
      options: optionalObjectValue(record.options, `${label}[${index}].options`),
      spec: assertRecordValue(record.spec, `${label}[${index}].spec`) as TSpec
    };
  });
}

function validatePreviewConfig(record: Record<string, unknown>, label: string): PreviewConfigFile {
  return {
    name: assertStringValue(record.name, `${label}.name`),
    source: optionalObjectValue(record.source, `${label}.source`) as CreatePreviewSpec["source"] | undefined,
    ttlMs: optionalNumberValue(record.ttlMs, `${label}.ttlMs`),
    requireRealProviders: optionalBooleanValue(record.requireRealProviders, `${label}.requireRealProviders`),
    allowMockProviders: optionalBooleanValue(record.allowMockProviders, `${label}.allowMockProviders`),
    labels: optionalStringRecord(record.labels, `${label}.labels`),
    databases: previewConfigResources<CreateDatabaseBranchSpec>(record.databases, `${label}.databases`),
    services: previewConfigResources<DeployServiceSpec>(record.services, `${label}.services`),
    edges: previewConfigResources<DeployEdgeSpec>(record.edges, `${label}.edges`),
    jobs: previewConfigResources<RunJobSpec>(record.jobs, `${label}.jobs`)
  };
}

async function readPreviewConfigFile(path: string | undefined): Promise<PreviewConfigFile> {
  if (!path) {
    throw new Error("Missing --config-file for preview create.");
  }
  return validatePreviewConfig(assertJsonObject(JSON.parse(await readFile(path, "utf8")), path), path);
}

function previewResourceConfigs(
  config: PreviewConfigFile
): Array<{ kind: PreviewResourceKind; config: PreviewConfigResource<CreateDatabaseBranchSpec | DeployServiceSpec | DeployEdgeSpec | RunJobSpec> }> {
  return [
    ...(config.databases ?? []).map((entry) => ({ kind: "database" as const, config: entry })),
    ...(config.services ?? []).map((entry) => ({ kind: "service" as const, config: entry })),
    ...(config.edges ?? []).map((entry) => ({ kind: "edge" as const, config: entry })),
    ...(config.jobs ?? []).map((entry) => ({ kind: "job" as const, config: entry }))
  ];
}

const previewAdapterOptionKeys = new Set<keyof ParsedArgs>([
  "image",
  "database",
  "role",
  "apiUrl",
  "target",
  "appName",
  "compatibilityDate",
  "workersDevSubdomain",
  "zoneId",
  "routes",
  "projectId",
  "location",
  "projectName",
  "namespace",
  "context",
  "kubeconfig",
  "region",
  "functionName",
  "subscriptionId",
  "resourceGroup",
  "environmentId",
  "cluster",
  "taskDefinition",
  "containerName",
  "subnets",
  "securityGroups",
  "subnetId",
  "imageId",
  "instanceType"
]);

function parsedArgsFromPreviewAdapterConfig(adapter: string, options: Record<string, unknown> | undefined): ParsedArgs {
  const parsed: ParsedArgs = { adapter, rest: [] };
  for (const [key, value] of Object.entries(options ?? {})) {
    if (!previewAdapterOptionKeys.has(key as keyof ParsedArgs)) {
      throw new Error(`Unsupported preview adapter option "${key}" for ${adapter}.`);
    }
    (parsed as unknown as Record<string, unknown>)[key] = value;
  }
  return parsed;
}

function createPreviewCapsule(config: { adapter: string; options?: Record<string, unknown> }): Capsule {
  const mockFactory = mockAdapterFactories[config.adapter];
  if (mockFactory) {
    return new Capsule({ adapter: mockFactory(), receipts: true });
  }
  return createCapsule(parsedArgsFromPreviewAdapterConfig(config.adapter, config.options));
}

function createPreviewPlanFromConfig(config: PreviewConfigFile): PreviewPlan {
  return {
    name: config.name,
    source: config.source,
    ttlMs: config.ttlMs,
    requireRealProviders: config.requireRealProviders,
    allowMockProviders: config.allowMockProviders,
    labels: config.labels,
    databases: config.databases?.map((entry) => ({ capsule: createPreviewCapsule(entry), spec: entry.spec })),
    services: config.services?.map((entry) => ({ capsule: createPreviewCapsule(entry), spec: entry.spec })),
    edges: config.edges?.map((entry) => ({ capsule: createPreviewCapsule(entry), spec: entry.spec })),
    jobs: config.jobs?.map((entry) => ({ capsule: createPreviewCapsule(entry), spec: entry.spec }))
  };
}

function serializePreviewResourceRecord(resource: PreviewResourceRecord, cleanup?: SerializedPreviewCleanupAction): SerializedPreviewResourceRecord {
  return {
    type: resource.type,
    kind: resource.kind,
    id: resource.id,
    provider: resource.provider,
    name: resource.name,
    url: resource.url,
    status: resource.status,
    receipt: resource.receipt,
    cleanupActionId: cleanup?.actionId,
    cleanupOrder: cleanup?.cleanupOrder,
    cleanup,
    cleanupDisposition: resource.cleanupDisposition
  };
}

function serializeCleanupAction(
  resource: PreviewResourceRecord,
  config: PreviewConfigResource<unknown> | undefined,
  action: PreviewCleanupPlan["actions"][number] | undefined
): SerializedPreviewCleanupAction | undefined {
  if (!resource.cleanup || !config) {
    return undefined;
  }
  return {
    actionId: action?.actionId,
    cleanupOrder: action?.cleanupOrder,
    kind: resource.cleanup.kind,
    adapter: config.adapter,
    options: config.options,
    capabilityPath: resource.cleanup.capabilityPath,
    spec: action?.spec ?? resource.cleanup.spec,
    idempotencyKey: action?.idempotencyKey,
    reversible: action?.reversible
  };
}

function createPreviewCleanupPlanFile(
  preview: PreviewEnvironment,
  resources: PreviewResourceRecord[],
  config: PreviewConfigFile,
  cleanupPlan: PreviewCleanupPlan
): PreviewCleanupPlanFile {
  const configs = previewResourceConfigs(config);
  const actionByResourceId = new Map(cleanupPlan.actions.map((action) => [action.resourceId, action]));
  return {
    schema: previewCleanupPlanFileSchema,
    id: cleanupPlan.id,
    previewId: cleanupPlan.previewId,
    createdAt: cleanupPlan.createdAt,
    cleanupOrder: cleanupPlan.cleanupOrder,
    cleanupActionCount: cleanupPlan.cleanupActionCount,
    unsupportedCleanupCount: cleanupPlan.unsupportedCleanupCount,
    actions: cleanupPlan.actions,
    preview,
    resources: resources.map((resource, index) =>
      serializePreviewResourceRecord(resource, serializeCleanupAction(resource, configs[index]?.config, actionByResourceId.get(resource.id)))
    )
  };
}

async function createPreviewCreateReport(parsed: ParsedArgs): Promise<PreviewCreateReport> {
  const config = await readPreviewConfigFile(parsed.configFile);
  const result = await createPreviewGraph(createPreviewPlanFromConfig(config));
  const cleanupPlan = createPreviewCleanupPlanFile(result.preview, result.resources, config, result.cleanupPlan);
  if (parsed.cleanupFile) {
    await mkdir(dirname(parsed.cleanupFile), { recursive: true });
    await writeFile(parsed.cleanupFile, `${JSON.stringify(cleanupPlan, null, 2)}\n`, "utf8");
  }
  const cleanupActionCount = cleanupPlan.resources.filter((resource) => resource.cleanup).length;
  return {
    preview: result.preview,
    resources: cleanupPlan.resources,
    receipts: result.receipts,
    cleanupPlan: {
      schema: cleanupPlan.schema,
      id: cleanupPlan.id,
      previewId: cleanupPlan.previewId,
      cleanupOrder: cleanupPlan.cleanupOrder,
      path: parsed.cleanupFile,
      resourceCount: cleanupPlan.resources.length,
      cleanupActionCount,
      unsupportedCleanupCount: cleanupPlan.resources.length - cleanupActionCount
    }
  };
}

function validatePreviewCleanupPlan(record: Record<string, unknown>, label: string): PreviewCleanupPlanFile {
  if (record.schema !== previewCleanupPlanFileSchema && record.schema !== legacyPreviewCleanupPlanFileSchema) {
    throw new Error(`${label}.schema must be ${previewCleanupPlanFileSchema}.`);
  }
  const preview = assertRecordValue(record.preview, `${label}.preview`) as unknown as PreviewEnvironment;
  const resources = record.resources;
  if (!Array.isArray(resources)) {
    throw new Error(`${label}.resources must be an array.`);
  }
  const previewId = typeof record.previewId === "string" ? record.previewId : preview.id;
  return {
    schema: previewCleanupPlanFileSchema,
    id: typeof record.id === "string" ? record.id : `cleanup_${previewId}`,
    previewId,
    createdAt: assertStringValue(record.createdAt, `${label}.createdAt`),
    cleanupOrder: typeof record.cleanupOrder === "string" ? (record.cleanupOrder as "reverse-create-order") : "reverse-create-order",
    cleanupActionCount: typeof record.cleanupActionCount === "number" ? record.cleanupActionCount : 0,
    unsupportedCleanupCount: typeof record.unsupportedCleanupCount === "number" ? record.unsupportedCleanupCount : 0,
    actions: Array.isArray(record.actions) ? (record.actions as PreviewCleanupPlan["actions"]) : [],
    preview,
    resources: resources.map((resource, index) => {
      const entry = assertRecordValue(resource, `${label}.resources[${index}]`);
      const cleanup =
        entry.cleanup === undefined
          ? undefined
          : (assertRecordValue(entry.cleanup, `${label}.resources[${index}].cleanup`) as unknown as SerializedPreviewCleanupAction);
      return {
        type: assertStringValue(entry.type, `${label}.resources[${index}].type`),
        kind: assertStringValue(entry.kind, `${label}.resources[${index}].kind`) as PreviewResourceKind,
        id: assertStringValue(entry.id, `${label}.resources[${index}].id`),
        provider: assertStringValue(entry.provider, `${label}.resources[${index}].provider`),
        name: typeof entry.name === "string" ? entry.name : undefined,
        url: typeof entry.url === "string" ? entry.url : undefined,
        status: typeof entry.status === "string" ? entry.status : undefined,
        receipt: entry.receipt as CapsuleReceipt | undefined,
        cleanupActionId: typeof entry.cleanupActionId === "string" ? entry.cleanupActionId : undefined,
        cleanupOrder: typeof entry.cleanupOrder === "number" ? entry.cleanupOrder : undefined,
        cleanup,
        cleanupDisposition: entry.cleanupDisposition as PreviewCleanupDisposition | undefined
      };
    })
  };
}

async function readPreviewCleanupPlanFile(path: string | undefined): Promise<PreviewCleanupPlanFile> {
  if (!path) {
    throw new Error("Missing --cleanup-file for preview destroy.");
  }
  return validatePreviewCleanupPlan(assertJsonObject(JSON.parse(await readFile(path, "utf8")), path), path);
}

function previewResourceKey(resource: { kind: PreviewResourceKind; id: string }): string {
  return `${resource.kind}:${resource.id}`;
}

function hydratedCleanupSpec(cleanup: SerializedPreviewCleanupAction, parsed: ParsedArgs): Record<string, unknown> {
  const spec = { ...cleanup.spec };
  if (cleanup.kind === "database" && parsed.hardDelete) {
    spec.hardDelete = true;
  }
  if (cleanup.kind === "service") {
    if (parsed.force) spec.force = true;
    if (parsed.reason) spec.reason = parsed.reason;
  }
  return spec;
}

function hydratePreviewCleanupResource(resource: SerializedPreviewResourceRecord, parsed: ParsedArgs): PreviewResourceRecord {
  return {
    type: resource.type as CapsuleDomain,
    kind: resource.kind,
    id: resource.id,
    provider: resource.provider,
    name: resource.name,
    url: resource.url,
    status: resource.status,
    receipt: resource.receipt,
    cleanup: resource.cleanup
      ? {
          kind: resource.cleanup.kind,
          capsule: createPreviewCapsule(resource.cleanup),
          capabilityPath: resource.cleanup.capabilityPath,
          spec: hydratedCleanupSpec(resource.cleanup, parsed)
        }
      : undefined,
    cleanupDisposition: resource.cleanupDisposition
  };
}

async function createPreviewDestroyReport(parsed: ParsedArgs): Promise<PreviewDestroyReport> {
  const plan = await readPreviewCleanupPlanFile(parsed.cleanupFile);
  const sourceByKey = new Map(plan.resources.map((resource) => [previewResourceKey(resource), resource]));
  const cleanup = await cleanupPreviewEnvironment(
    plan.preview,
    plan.resources.map((resource) => hydratePreviewCleanupResource(resource, parsed))
  );
  const dispositions = cleanup.dispositions.map((entry) => {
    const source = sourceByKey.get(previewResourceKey(entry.resource));
    return {
      resource: serializePreviewResourceRecord(entry.resource, source?.cleanup),
      disposition: entry.disposition,
      receipt: entry.receipt,
      error: entry.error,
      notes: entry.notes
    };
  });
  return {
    previewId: cleanup.previewId,
    status: cleanup.status,
    summary: {
      cleaned: dispositions.filter((entry) => entry.disposition === "cleaned").length,
      partial: dispositions.filter((entry) => entry.disposition === "partial").length,
      failed: cleanup.failed.length,
      unsupported: dispositions.filter((entry) => entry.disposition === "unsupported").length,
      leaked: dispositions.filter((entry) => entry.disposition === "leaked").length
    },
    dispositions,
    receipts: cleanup.receipts,
    receipt: cleanup.receipt
  };
}

export function compareProviderCapabilities(leftProvider: string, rightProvider: string): ProviderCapabilityComparison {
  assertComparableProvider(leftProvider);
  assertComparableProvider(rightProvider);
  const leftCapabilities = createCapsuleForCapabilityInspection(leftProvider).capabilities();
  const rightCapabilities = createCapsuleForCapabilityInspection(rightProvider).capabilities();
  const paths = uniqueCapabilityPaths(leftCapabilities, rightCapabilities);

  return {
    left: {
      provider: leftProvider,
      compatibility: providerCompatibilityScore(leftCapabilities, paths)
    },
    right: {
      provider: rightProvider,
      compatibility: providerCompatibilityScore(rightCapabilities, paths)
    },
    diff: capabilityDiff(leftCapabilities, rightCapabilities, paths)
  };
}

export function selectProvidersForRecipe(recipeId: ProviderSelectionRecipeId): ProviderSelectionReport {
  const recipe = getProviderSelectionRecipe(recipeId);
  const candidates = comparableProviders.map((provider) => ({
    provider,
    capabilities: createCapsuleForCapabilityInspection(provider).capabilities()
  }));

  return {
    recipe,
    results: rankProvidersByRecipe(candidates, recipe)
  };
}

function completionWordList(values: readonly string[]): string {
  return values.join(" ");
}

function fishLongOption(flag: string): string {
  return flag.replace(/^--/, "");
}

function isShellCompletionTarget(value: string | undefined): value is ShellCompletionTarget {
  return typeof value === "string" && (completionShells as readonly string[]).includes(value);
}

export function createShellCompletionScript(shell: ShellCompletionTarget): string {
  const commands = completionWordList(completionCommands);
  const providers = completionWordList(completionProviders);
  const recipes = completionWordList(completionRecipes);
  const shells = completionWordList(completionShells);
  const flags = completionWordList(completionOptions);

  if (shell === "bash") {
    return `# capsule bash completion
_capsule_completions() {
  local cur prev commands providers recipes shells flags
  COMPREPLY=()
  cur="\${COMP_WORDS[COMP_CWORD]}"
  prev="\${COMP_WORDS[COMP_CWORD-1]}"
  commands="${commands}"
  providers="${providers}"
  recipes="${recipes}"
  shells="${shells}"
  flags="${flags}"

  case "$prev" in
    --adapter|--provider|--left|--right)
      COMPREPLY=( $(compgen -W "$providers" -- "$cur") )
      return
      ;;
    --recipe)
      COMPREPLY=( $(compgen -W "$recipes" -- "$cur") )
      return
      ;;
    completion)
      COMPREPLY=( $(compgen -W "$shells" -- "$cur") )
      return
      ;;
  esac

  if [[ "$COMP_CWORD" -eq 1 ]]; then
    COMPREPLY=( $(compgen -W "$commands" -- "$cur") )
    return
  fi
  COMPREPLY=( $(compgen -W "$commands $flags" -- "$cur") )
}
complete -F _capsule_completions capsule`;
  }

  if (shell === "zsh") {
    return `#compdef capsule

_capsule() {
  local -a commands providers recipes shells flags
  commands=(${commands})
  providers=(${providers})
  recipes=(${recipes})
  shells=(${shells})
  flags=(${completionOptions.map((option) => `'${option}'`).join(" ")})

  _arguments -C \\
    '1:command:->command' \\
    '*::arg:->arg'

  case $state in
    command)
      _describe 'capsule command' commands
      ;;
    arg)
      case \${words[CURRENT-1]} in
        --adapter|--provider|--left|--right) _describe 'provider' providers ;;
        --recipe) _describe 'recipe' recipes ;;
        completion) _describe 'shell' shells ;;
        *) _describe 'option' flags ;;
      esac
      ;;
  esac
}
_capsule "$@"`;
  }

  return [
    "# capsule fish completion",
    "complete -c capsule -f",
    ...completionCommands.map((command) => `complete -c capsule -n "__fish_use_subcommand" -a "${command}"`),
    `complete -c capsule -l adapter -xa "${providers}"`,
    `complete -c capsule -l provider -xa "${providers}"`,
    `complete -c capsule -l left -xa "${providers}"`,
    `complete -c capsule -l right -xa "${providers}"`,
    `complete -c capsule -l recipe -xa "${recipes}"`,
    `complete -c capsule -n "__fish_seen_subcommand_from completion" -a "${shells}"`,
    ...completionOptions
      .filter((option) => !["--adapter", "--provider", "--left", "--right", "--recipe"].includes(option))
      .map((option) => `complete -c capsule -l ${fishLongOption(option)}`)
  ].join("\n");
}

export function liveTestCommandPlan(provider?: string, plans: LiveTestPlan[] = liveTestPlans): LiveTestPlan[] {
  const withGuardedCommands = (plan: LiveTestPlan): LiveTestPlan =>
    plan.costRisk === "billable"
      ? {
          ...plan,
          safeCommands: plan.safeCommands.map(
            (command) =>
              `${plan.costAcknowledgementEnv ?? "CAPSULE_LIVE_TEST_COST_ACK"}=1 ${plan.maxResourceCountEnv ?? liveTestMaxResourcesEnv}=${plan.maxResourceCount ?? 1} ${command}`
          )
        }
      : plan;

  if (!provider) {
    return plans.map(withGuardedCommands);
  }
  const plan = plans.find((entry) => entry.provider === provider);
  if (!plan) {
    throw new Error(`Unknown live-test provider "${provider}". Providers: ${plans.map((entry) => entry.provider).join(", ")}`);
  }
  return [withGuardedCommands(plan)];
}

function livePlanQuarantineActive(plan: LiveTestPlan, env: NodeJS.ProcessEnv): boolean {
  return Boolean(plan.quarantine && env[liveTestFlakyRevalidationEnv] !== "1");
}

function livePlanQuarantineNote(quarantine: LiveTestQuarantine): string {
  return `Quarantined flaky live test: ${quarantine.reason}. Owner: ${quarantine.owner}. Last observed failure: ${quarantine.lastObservedFailure}. Revalidate with: ${quarantine.revalidationCommand}`;
}

function readGitHubEvent(env: NodeJS.ProcessEnv): Record<string, any> | undefined {
  const eventPath = env.GITHUB_EVENT_PATH;
  if (!eventPath) return undefined;
  try {
    return JSON.parse(readFileSync(eventPath, "utf8")) as Record<string, any>;
  } catch {
    return undefined;
  }
}

function githubEventLabels(env: NodeJS.ProcessEnv, event: Record<string, any> | undefined): string[] {
  const eventLabels = [...(event?.pull_request?.labels ?? []), event?.label].flatMap((label) => (typeof label?.name === "string" ? [label.name] : []));
  const envLabels = (env.CAPSULE_LIVE_TEST_GITHUB_LABELS ?? "")
    .split(",")
    .map((label) => label.trim())
    .filter(Boolean);
  return [...eventLabels, ...envLabels];
}

function githubEventIsUntrustedFork(env: NodeJS.ProcessEnv, event: Record<string, any> | undefined): boolean {
  if (env[liveTestCiUntrustedForkEnv] === "1") return true;
  const pullRequest = event?.pull_request;
  if (!pullRequest && env.GITHUB_EVENT_NAME !== "pull_request") return false;
  if (pullRequest?.head?.repo?.fork === true) return true;

  const baseRepo = pullRequest?.base?.repo?.full_name ?? event?.repository?.full_name ?? env.GITHUB_REPOSITORY;
  const headRepo = pullRequest?.head?.repo?.full_name ?? env.GITHUB_HEAD_REPO_FULL_NAME;
  return Boolean(baseRepo && headRepo && baseRepo !== headRepo);
}

function liveTestCiSafety(env: NodeJS.ProcessEnv): { ci: boolean; optedIn: boolean; untrustedFork: boolean } {
  const ci = env.CI === "true" || env.GITHUB_ACTIONS === "true";
  if (!ci) return { ci: false, optedIn: true, untrustedFork: false };
  const event = readGitHubEvent(env);
  const labels = githubEventLabels(env, event);
  return {
    ci: true,
    optedIn: env[liveTestCiOptInEnv] === "1" || labels.includes(liveTestCiLabel),
    untrustedFork: githubEventIsUntrustedFork(env, event)
  };
}

function liveTestCiNotes(ciSafety: { ci: boolean; optedIn: boolean; untrustedFork: boolean }): string[] {
  if (!ciSafety.ci) return [];
  if (ciSafety.untrustedFork) return ["Live tests are disabled for untrusted fork pull requests."];
  if (!ciSafety.optedIn) return [`Set ${liveTestCiOptInEnv}=1 or apply the ${liveTestCiLabel} label before running live tests in CI.`];
  return [];
}

function liveTestCiFields(ciSafety: {
  ci: boolean;
  optedIn: boolean;
  untrustedFork: boolean;
}): Pick<ProviderVerificationEntry, "missingCiOptInEnv" | "ciOptInEnv" | "ciOptInLabel" | "ciUntrustedFork"> {
  if (!ciSafety.ci) return {};
  return {
    missingCiOptInEnv: ciSafety.optedIn || ciSafety.untrustedFork ? [] : [liveTestCiOptInEnv],
    ciOptInEnv: liveTestCiOptInEnv,
    ciOptInLabel: liveTestCiLabel,
    ciUntrustedFork: ciSafety.untrustedFork
  };
}

function livePlanRequirementDiagnostic(
  plan: LiveTestPlan,
  env: NodeJS.ProcessEnv
): Omit<ProviderVerificationEntry, "provider" | "status" | "testPath" | "safeCommands" | "notes" | "liveTestEnabled"> {
  const required = plan.requiredEnv.filter((name) => name !== "CAPSULE_LIVE_TESTS");
  const configuredEnv = required.flatMap((name) => configuredCredentialNames(name, plan.aliases, env));
  const missingEnv = required.filter((name) => configuredCredentialNames(name, plan.aliases, env).length === 0);
  return {
    configuredEnv,
    missingEnv,
    requiredEnv: required.flatMap((name) => [name, ...(plan.aliases?.[name] ?? [])])
  };
}

function livePlanResourceLimit(plan: LiveTestPlan, env: NodeJS.ProcessEnv): LiveEnvironmentValidationEntry["resourceLimit"] {
  if (plan.costRisk !== "billable") return undefined;
  const resourceEnv = plan.maxResourceCountEnv ?? liveTestMaxResourcesEnv;
  const required = plan.maxResourceCount ?? 1;
  const raw = env[resourceEnv];
  const configured = raw === undefined ? undefined : Number(raw);
  const satisfied = configured !== undefined && Number.isSafeInteger(configured) && configured >= required;
  return { env: resourceEnv, required, configured, satisfied };
}

export async function createProviderVerificationReport(
  options: { env?: NodeJS.ProcessEnv; provider?: string; dockerCheck?: () => Promise<boolean> } = {}
): Promise<ProviderVerificationReport> {
  const env = options.env ?? process.env;
  const plans = options.provider === "docker" ? [] : liveTestCommandPlan(options.provider).filter((plan) => plan.provider !== "docker");
  const providers: ProviderVerificationEntry[] = [];

  if (!options.provider || options.provider === "docker") {
    const dockerOk = await (options.dockerCheck ?? dockerAvailable)();
    providers.push({
      provider: "docker",
      status: dockerOk ? "passed" : "unavailable",
      liveTestEnabled: true,
      configuredEnv: [],
      missingEnv: [],
      requiredEnv: [],
      safeCommands: ["pnpm vitest run packages/docker/src/docker.test.ts"],
      notes: [
        dockerOk
          ? "Docker daemon is available for local Docker adapter tests."
          : "Docker daemon is unavailable; Docker adapter live paths cannot run on this machine."
      ]
    });
  }

  for (const plan of plans) {
    const diagnostic = livePlanRequirementDiagnostic(plan, env);
    const liveTestEnabled = env.CAPSULE_LIVE_TESTS === "1";
    const quarantineActive = livePlanQuarantineActive(plan, env);
    const ciSafety = liveTestCiSafety(env);
    const ciBlocked = ciSafety.ci && (!ciSafety.optedIn || ciSafety.untrustedFork);
    providers.push({
      provider: plan.provider,
      status: ciBlocked ? "blocked" : quarantineActive ? "quarantined" : diagnostic.missingEnv.length === 0 ? "ready" : "missing",
      liveTestEnabled,
      ...diagnostic,
      testPath: plan.testPath,
      safeCommands: plan.safeCommands,
      notes: [
        ...plan.notes,
        ...liveTestCiNotes(ciSafety),
        ...(plan.quarantine ? [livePlanQuarantineNote(plan.quarantine)] : []),
        ...(liveTestEnabled ? [] : ["Set CAPSULE_LIVE_TESTS=1 before running the safe command."])
      ],
      ...(ciSafety.ci && env[liveTestCiOptInEnv] === "1" ? { configuredEnv: [...diagnostic.configuredEnv, liveTestCiOptInEnv] } : {}),
      ...liveTestCiFields(ciSafety),
      ...(plan.quarantine
        ? {
            quarantine: plan.quarantine,
            quarantineRevalidationEnv: liveTestFlakyRevalidationEnv
          }
        : {})
    });
  }

  return { providers };
}

export function createLiveEnvironmentValidationReport(
  options: { env?: NodeJS.ProcessEnv; provider?: string; plans?: LiveTestPlan[] } = {}
): LiveEnvironmentValidationReport {
  const env = options.env ?? process.env;
  const plans = liveTestCommandPlan(options.provider, options.plans);
  const providers = plans.map((plan): LiveEnvironmentValidationEntry => {
    const diagnostic = livePlanRequirementDiagnostic(plan, env);
    const liveTestEnabled = env.CAPSULE_LIVE_TESTS === "1";
    const quarantineActive = livePlanQuarantineActive(plan, env);
    const ciSafety = liveTestCiSafety(env);
    const ciBlocked = ciSafety.ci && (!ciSafety.optedIn || ciSafety.untrustedFork);
    const costEnv = plan.costAcknowledgementEnv;
    const costAcknowledged = costEnv ? env[costEnv] === "1" : true;
    const missingCostEnv = costEnv && !costAcknowledged ? [costEnv] : [];
    const resourceLimit = livePlanResourceLimit(plan, env);
    const missingResourceLimitEnv = resourceLimit && !resourceLimit.satisfied ? [resourceLimit.env] : [];
    const ready = !ciBlocked && liveTestEnabled && diagnostic.missingEnv.length === 0 && missingCostEnv.length === 0 && missingResourceLimitEnv.length === 0;
    return {
      provider: plan.provider,
      status: ciBlocked ? "blocked" : quarantineActive ? "quarantined" : ready ? "ready" : "blocked",
      liveTestEnabled,
      costRisk: plan.costRisk,
      costAcknowledged,
      resourceLimit,
      configuredEnv: [
        ...(liveTestEnabled ? ["CAPSULE_LIVE_TESTS"] : []),
        ...diagnostic.configuredEnv,
        ...(costEnv && costAcknowledged ? [costEnv] : []),
        ...(resourceLimit?.satisfied ? [resourceLimit.env] : []),
        ...(ciSafety.ci && env[liveTestCiOptInEnv] === "1" ? [liveTestCiOptInEnv] : []),
        ...(plan.quarantine && env[liveTestFlakyRevalidationEnv] === "1" ? [liveTestFlakyRevalidationEnv] : [])
      ],
      missingEnv: liveTestEnabled ? diagnostic.missingEnv : ["CAPSULE_LIVE_TESTS", ...diagnostic.missingEnv],
      missingCostEnv,
      missingResourceLimitEnv,
      requiredEnv: plan.requiredEnv.flatMap((name) => [name, ...(plan.aliases?.[name] ?? [])]),
      testPath: plan.testPath,
      safeCommands: plan.safeCommands,
      notes: [
        ...plan.notes,
        ...liveTestCiNotes(ciSafety),
        ...(plan.quarantine ? [livePlanQuarantineNote(plan.quarantine)] : []),
        ...(liveTestEnabled ? [] : ["Set CAPSULE_LIVE_TESTS=1 before running the safe command."]),
        ...(missingCostEnv.length > 0 ? [`Set ${missingCostEnv[0]}=1 to acknowledge billable or side-effecting live provider work.`] : []),
        ...(missingResourceLimitEnv.length > 0
          ? [`Set ${missingResourceLimitEnv[0]} to a positive integer >= ${resourceLimit?.required ?? 1} before running billable live provider work.`]
          : [])
      ],
      ...liveTestCiFields(ciSafety),
      ...(plan.quarantine
        ? {
            quarantine: plan.quarantine,
            quarantineRevalidationEnv: liveTestFlakyRevalidationEnv
          }
        : {})
    };
  });
  return { providers };
}

export function classifyProvider(provider: string, service: string): ClassifyProviderServiceResult {
  return classifyProviderService({ provider, service });
}

function toPackageSegment(provider: string): string {
  const segment = provider
    .trim()
    .toLowerCase()
    .replace(/^@/, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
  if (!segment) {
    throw new Error("Provider name must contain at least one alphanumeric character.");
  }
  return segment;
}

function toFactoryName(provider: string): string {
  const segment = toPackageSegment(provider);
  const name = segment.replace(/-([a-z0-9])/g, (_, char: string) => char.toUpperCase());
  return /^[a-z]/.test(name) ? name : `adapter${name[0]!.toUpperCase()}${name.slice(1)}`;
}

function toTypeName(factoryName: string): string {
  return `${factoryName[0]!.toUpperCase()}${factoryName.slice(1)}`;
}

function assertScaffoldDomains(domains: string[]): AdapterScaffoldDomain[] {
  if (domains.length === 0) {
    throw new Error(`Missing --domain. Supported domains: ${adapterScaffoldDomains.join(", ")}`);
  }
  return domains.map((domain) => {
    if (!(adapterScaffoldDomains as readonly string[]).includes(domain)) {
      throw new Error(`Unknown adapter domain "${domain}". Supported domains: ${adapterScaffoldDomains.join(", ")}`);
    }
    return domain as AdapterScaffoldDomain;
  });
}

function capabilityMapForDomains(domains: AdapterScaffoldDomain[]): string {
  const entries: Record<AdapterScaffoldDomain, string> = {
    sandbox: `  sandbox: {
    create: "unsupported",
    exec: "unsupported",
    fileRead: "unsupported",
    fileWrite: "unsupported",
    fileList: "unsupported",
    destroy: "unsupported"
  }`,
    job: `  job: {
    run: "unsupported",
    status: "unsupported",
    cancel: "unsupported",
    logs: "unsupported",
    artifacts: "unsupported",
    timeout: "unsupported",
    env: "unsupported"
  }`,
    service: `  service: {
    deploy: "unsupported",
    update: "unsupported",
    delete: "unsupported",
    status: "unsupported",
    logs: "unsupported",
    url: "unsupported"
  }`,
    edge: `  edge: {
    deploy: "unsupported",
    rollback: "unsupported",
    routes: "unsupported"
  }`,
    database: `  database: {
    branchCreate: "unsupported",
    branchDelete: "unsupported",
    connectionString: "unsupported"
  }`,
    preview: `  preview: {
    create: "unsupported",
    destroy: "unsupported",
    status: "unsupported",
    logs: "unsupported",
    urls: "unsupported"
  }`,
    machine: `  machine: {
    create: "unsupported",
    exec: "unsupported",
    start: "unsupported",
    stop: "unsupported",
    destroy: "unsupported"
  }`
  };
  return `{\n${domains.map((domain) => entries[domain]).join(",\n")}\n}`;
}

export function createAdapterScaffoldPlan(options: { provider: string; domains: string[]; outDir?: string }): AdapterScaffoldPlan {
  const segment = toPackageSegment(options.provider);
  const factoryName = toFactoryName(segment);
  const typeName = toTypeName(factoryName);
  const packageName = `@capsule-sdk/${segment}`;
  const domains = assertScaffoldDomains(options.domains);
  const packageDir = join(options.outDir ?? "packages", `adapter-${segment}`);
  const capabilities = capabilityMapForDomains(domains);
  const files: AdapterScaffoldFile[] = [
    {
      path: join(packageDir, "package.json"),
      content: `${JSON.stringify(
        {
          name: packageName,
          version: "0.1.0",
          type: "module",
          main: "./dist/index.js",
          types: "./dist/index.d.ts",
          exports: { ".": { types: "./dist/index.d.ts", import: "./dist/index.js" } },
          scripts: {
            build: "tsup src/index.ts --format esm && tsc -p tsconfig.json --emitDeclarationOnly",
            typecheck: "tsc -p tsconfig.json --noEmit"
          },
          dependencies: { "@capsule-sdk/core": "workspace:*" },
          devDependencies: { tsup: "^8.5.0", typescript: "^5.9.3", vitest: "^4.1.6" },
          publishConfig: { access: "public" },
          files: ["dist"],
          description: `Capsule adapter scaffold for ${segment}.`,
          license: "MIT",
          engines: { node: ">=22" }
        },
        null,
        2
      )}\n`
    },
    {
      path: join(packageDir, "tsconfig.json"),
      content: `{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "composite": true,
    "rootDir": "src",
    "outDir": "dist"
  },
  "references": [{ "path": "../core" }],
  "include": ["src"]
}
`
    },
    {
      path: join(packageDir, "src/index.ts"),
      content: `export * from "./${segment}-adapter.js";
`
    },
    {
      path: join(packageDir, `src/${segment}-adapter.ts`),
      content: `import type { CapsuleAdapter, CapabilityMap } from "@capsule-sdk/core";

export interface ${typeName}AdapterOptions {
  raw?: unknown;
}

export const ${factoryName}Capabilities: CapabilityMap = ${capabilities};

export function ${factoryName}(options: ${typeName}AdapterOptions = {}): CapsuleAdapter {
  return {
    name: "${segment}",
    provider: "${segment}",
    capabilities: ${factoryName}Capabilities,
    raw: options.raw
  };
}
`
    },
    {
      path: join(packageDir, `src/${segment}.test.ts`),
      content: `import { describe, expect, test } from "vitest";
import { Capsule, runCapsuleAdapterContract } from "@capsule-sdk/core";
import { ${factoryName}, ${factoryName}Capabilities } from "./index.js";

describe("${segment} adapter", () => {
  test("satisfies the public adapter contract for declared unsupported capabilities", async () => {
    await runCapsuleAdapterContract(${factoryName}(), { domains: ${JSON.stringify(domains)} });
  });

  test("starts with explicit unsupported support levels", () => {
    const capsule = new Capsule({ adapter: ${factoryName}() });
    expect(capsule.capabilities()).toEqual(${factoryName}Capabilities);
  });
});
`
    }
  ];
  return { provider: segment, packageName, factoryName, packageDir, domains, files };
}

function adapterPackageName(adapter: string): string {
  if (adapter.startsWith("mock-")) {
    return "@capsule-sdk/mock";
  }
  return `@capsule-sdk/${toPackageSegment(adapter)}`;
}

export function createProjectInitPlan(options: { adapter?: string; outDir?: string } = {}): ProjectInitPlan {
  const adapter = options.adapter ?? "docker";
  const outDir = options.outDir ?? ".";
  const config = {
    $schema: "https://capsule.dev/schemas/capsule.config.schema.json",
    adapter,
    policyFile: "capsule.policy.json",
    receipts: {
      enabled: true,
      path: ".capsule/receipts.jsonl"
    }
  };
  const policy: CapsulePolicy = {
    network: { mode: "none" },
    secrets: {
      allowed: [],
      redactFromLogs: true,
      redactionProfile: "strict"
    },
    limits: {
      timeoutMs: 60_000,
      maxStdoutBytes: 1_048_576,
      maxStderrBytes: 1_048_576
    },
    ttl: {
      maxMs: 86_400_000
    }
  };
  return {
    adapter,
    outDir,
    files: [
      {
        path: join(outDir, "capsule.config.json"),
        content: `${JSON.stringify(config, null, 2)}\n`
      },
      {
        path: join(outDir, "capsule.policy.json"),
        content: `${JSON.stringify(policy, null, 2)}\n`
      }
    ],
    installHint: `pnpm add @capsule-sdk/core ${adapterPackageName(adapter)}`,
    notes: [
      "No secrets were written; configure provider credentials through environment variables or provider-native auth.",
      "The scaffolded policy sets secrets.allowed to [], which denies every environment key by default; add keys to secrets.allowed in capsule.policy.json to permit them.",
      "capsule.config.json is auto-applied from the working directory; explicit flags such as --adapter, --receipt-file, and --policy-file override its values."
    ]
  };
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

export async function writeAdapterScaffold(plan: AdapterScaffoldPlan, options: { force?: boolean } = {}): Promise<AdapterScaffoldPlan> {
  for (const file of plan.files) {
    if (!options.force && (await exists(file.path))) {
      throw new Error(`Refusing to overwrite ${file.path}. Re-run with --force to replace scaffold files.`);
    }
  }
  for (const file of plan.files) {
    await mkdir(dirname(file.path), { recursive: true });
    await writeFile(file.path, file.content, "utf8");
  }
  return plan;
}

export async function writeProjectInitFiles(plan: ProjectInitPlan, options: { force?: boolean } = {}): Promise<ProjectInitPlan> {
  for (const file of plan.files) {
    if (!options.force && (await exists(file.path))) {
      throw new Error(`Refusing to overwrite ${file.path}. Re-run with --force to replace project init files.`);
    }
  }
  for (const file of plan.files) {
    await mkdir(dirname(file.path), { recursive: true });
    await writeFile(file.path, file.content, "utf8");
  }
  return plan;
}

const localDockerExampleIds = new Set(["sandbox-docker"]);
const noProviderExampleIds = new Set(["provider-presets"]);
const liveProviderCredentialEnv = [
  "CAPSULE_LIVE_TESTS",
  "E2B_API_KEY",
  "NEON_API_KEY",
  "NEON_PROJECT_ID",
  "VERCEL_TOKEN",
  "GOOGLE_CLOUD_PROJECT",
  "GOOGLE_CLOUD_RUN_LOCATION",
  "GOOGLE_OAUTH_ACCESS_TOKEN"
];

function exampleId(packageName: string): string {
  return packageName.replace(/^@capsule-sdk\/example-/, "");
}

function exampleCredentialMode(id: string): ExampleCredentialMode {
  if (localDockerExampleIds.has(id)) return "local-docker";
  if (noProviderExampleIds.has(id)) return "no-provider";
  return "mock";
}

function exampleNotes(mode: ExampleCredentialMode): string[] {
  if (mode === "local-docker") {
    return ["Requires a local Docker daemon and may pull container images."];
  }
  if (mode === "no-provider") {
    return ["Does not call provider APIs."];
  }
  return ["Runs in mock mode without provider credentials; live-provider opt-in is disabled by the CLI runner."];
}

export async function createExamplesReport(options: { workspaceRoot?: string } = {}): Promise<ExamplesReport> {
  const workspaceRoot = options.workspaceRoot ?? process.cwd();
  const examplesDir = join(workspaceRoot, "examples");
  let entries;
  try {
    entries = await readdir(examplesDir, { withFileTypes: true });
  } catch {
    return { examples: [] };
  }

  const examples = await Promise.all(
    entries
      .filter((entry) => entry.isDirectory())
      .map(async (entry) => {
        const packageDir = join(examplesDir, entry.name);
        const pkg = await readJsonFile(join(packageDir, "package.json"));
        if (!pkg?.name || !pkg.scripts?.start) return undefined;
        const id = exampleId(pkg.name);
        const credentialMode = exampleCredentialMode(id);
        return {
          id,
          packageName: pkg.name,
          directory: join("examples", entry.name),
          command: ["pnpm", "--filter", pkg.name, "start"],
          credentialMode,
          runnableWithoutCredentials: credentialMode !== "local-docker",
          notes: exampleNotes(credentialMode)
        };
      })
  );

  return {
    examples: examples.filter((example): example is RunnableExample => Boolean(example)).sort((left, right) => left.id.localeCompare(right.id))
  };
}

function credentialFreeExampleEnv(env: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const next = { ...env };
  for (const name of liveProviderCredentialEnv) {
    delete next[name];
  }
  return next;
}

function defaultExampleRunner(command: string, args: string[], options: ExampleRunnerOptions): ExampleRunnerResult {
  return spawnSync(command, args, {
    cwd: options.cwd,
    env: options.env,
    encoding: "utf8"
  });
}

function errorText(error: unknown): string | undefined {
  if (error === undefined) return undefined;
  return error instanceof Error ? error.message : String(error);
}

export async function runExampleCommand(
  id: string,
  options: {
    workspaceRoot?: string;
    dryRun?: boolean;
    env?: NodeJS.ProcessEnv;
    runner?: (command: string, args: string[], options: ExampleRunnerOptions) => ExampleRunnerResult;
  } = {}
): Promise<RunExampleReport> {
  const workspaceRoot = options.workspaceRoot ?? process.cwd();
  const report = await createExamplesReport({ workspaceRoot });
  const example = report.examples.find((entry) => entry.id === id || entry.packageName === id);
  if (!example) {
    throw new Error(`Unknown example "${id}". Run "capsule examples list" to inspect available examples.`);
  }
  if (!example.runnableWithoutCredentials) {
    throw new Error(`Example "${example.id}" requires local Docker and is not runnable by the credential-free examples command.`);
  }
  if (options.dryRun) {
    return {
      status: "planned",
      example,
      command: example.command
    };
  }

  const [command, ...args] = example.command;
  const result = (options.runner ?? defaultExampleRunner)(command!, args, {
    cwd: workspaceRoot,
    env: credentialFreeExampleEnv(options.env)
  });
  const exitCode = result.status ?? 1;
  return {
    status: exitCode === 0 ? "passed" : "failed",
    example,
    command: example.command,
    exitCode,
    stdout: result.stdout,
    stderr: result.stderr,
    error: errorText(result.error)
  };
}

function createCapsuleForCapabilityInspection(provider: string): Capsule {
  if (provider === "ecs") {
    return createCapsule({ adapter: provider, cluster: "capability-inspection", taskDefinition: "capability-inspection:1", containerName: "main", rest: [] });
  }
  return createCapsule({ adapter: provider, rest: [] });
}

function assertComparableProvider(provider: string): void {
  if (!(comparableProviders as readonly string[]).includes(provider)) {
    throw new Error(`Unknown provider "${provider}". Comparable providers: ${comparableProviders.join(", ")}`);
  }
}

function printHelp(): void {
  console.log(`Capsule CLI

Commands:
  capsule doctor
  capsule verify providers
  capsule verify providers --provider neon
  capsule live-test plan
  capsule live-test plan --provider neon
  capsule live-test validate --provider neon
  capsule classify provider cloudflare workers
  capsule policy explain --adapter docker --capability job.run --policy-file policy.json --spec-file spec.json
  capsule receipt verify --receipt-file .capsule/receipts.jsonl
  capsule receipt verify --receipt-file .capsule/receipts.jsonl --public-key ./capsule-receipts.pub --require-signature
  capsule receipt verify --receipt-file .capsule/receipts.jsonl --require-signature --allow-unverified-signatures
  capsule receipt inspect --receipt-file .capsule/receipts.jsonl
  capsule receipt inspect --receipt-file .capsule/receipts.jsonl --id <receiptId>
  capsule preset list
  capsule preset list --json
  capsule preset explain node-sandbox
  capsule preview plan --config-file preview.json
  capsule preview create --config-file preview.json --cleanup-file .capsule/preview-cleanup.json
  capsule preview destroy --cleanup-file .capsule/preview-cleanup.json
  capsule init --adapter docker --out-dir .
  capsule examples list
  capsule examples run capability-check
  capsule examples run capability-check --dry-run
  capsule adapter scaffold acme --domain sandbox
  capsule select provider --recipe sandbox
  capsule select provider --recipe service-api
  capsule compare providers --left docker --right e2b
  capsule completion bash
  capsule completion zsh
  capsule completion fish
  capsule capabilities
  capsule capabilities --explain
  capsule capabilities --json
  capsule capabilities --adapter neon
  capsule capabilities --adapter e2b
  capsule capabilities --adapter daytona
  capsule capabilities --adapter modal --app-name capsule
  capsule capabilities --adapter cloudflare
  capsule capabilities --adapter vercel
  capsule capabilities --adapter kubernetes --namespace default
  capsule capabilities --adapter lambda --region us-east-1 --function-name my-function
  capsule capabilities --adapter ecs --region us-east-1 --cluster default --task-definition task:1 --container-name main
  capsule capabilities --adapter ec2 --region us-east-1 --image-id ami-123 --instance-type t3.micro
  capsule capabilities --adapter fly --app-name my-fly-app
  capsule capabilities --adapter azure-container-apps --subscription-id <sub> --resource-group <rg> --location eastus --environment-id <env_id>
  capsule capabilities --adapter cloud-run --project-id <gcp-project> --location us-central1
  capsule run --image node:22 -- node -e "console.log('hello')"
  capsule sandbox --image node:22
  capsule sandbox --adapter e2b -- node -e "console.log('hello from E2B')"
  capsule sandbox --adapter daytona --image node:22 -- node -e "console.log('hello from Daytona')"
  capsule sandbox --adapter modal --app-name capsule --image debian:bookworm-slim -- bash -lc "echo hello"
  capsule job --adapter cloud-run --project-id <gcp-project> --location us-central1 --name my-job --image us-docker.pkg.dev/project/repo/job:tag
  capsule job run --adapter cloud-run --project-id <gcp-project> --location us-central1 --name my-job --image us-docker.pkg.dev/project/repo/job:tag
  capsule job status --adapter cloud-run --project-id <gcp-project> --location us-central1 --id projects/<project>/locations/<region>/jobs/<job>/executions/<execution>
  capsule job cancel --adapter cloud-run --project-id <gcp-project> --location us-central1 --id projects/<project>/locations/<region>/jobs/<job>/executions/<execution> --reason cleanup
  capsule job --adapter kubernetes --namespace default --name my-job --image node:22 -- node -e "console.log('hi')"
  capsule job status --adapter kubernetes --namespace default --id my-job
  capsule job cancel --adapter kubernetes --namespace default --id my-job --reason cleanup
  capsule job --adapter lambda --region us-east-1 --function-name my-function --image ignored
  capsule job --adapter ecs --region us-east-1 --cluster default --task-definition task:1 --container-name main --subnet subnet-123 --security-group sg-123 --image intent -- node job.js
  capsule job status --adapter ecs --region us-east-1 --cluster default --task-definition task:1 --container-name main --id <task-arn>
  capsule job cancel --adapter ecs --region us-east-1 --cluster default --task-definition task:1 --container-name main --id <task-arn> --reason cleanup
  capsule job --adapter fly --app-name my-fly-app --name smoke --image node:22 -- node smoke.js
  capsule job --adapter azure-container-apps --subscription-id <sub> --resource-group <rg> --location eastus --environment-id <env_id> --name smoke --image node:22 -- node smoke.js
  capsule service --adapter cloud-run --project-id <gcp-project> --location us-central1 --name api --image us-docker.pkg.dev/project/repo/api:tag --port 8080
  capsule service deploy --adapter cloud-run --project-id <gcp-project> --location us-central1 --name api --image us-docker.pkg.dev/project/repo/api:tag --port 8080
  capsule service status --adapter cloud-run --project-id <gcp-project> --location us-central1 --id api
  capsule service delete --adapter cloud-run --project-id <gcp-project> --location us-central1 --id api --reason cleanup
  capsule service --adapter ecs --region us-east-1 --cluster default --task-definition api:1 --container-name main --name api --image intent
  capsule service status --adapter ecs --region us-east-1 --cluster default --task-definition api:1 --container-name main --id api
  capsule service delete --adapter ecs --region us-east-1 --cluster default --task-definition api:1 --container-name main --id api --force
  capsule service --adapter kubernetes --namespace default --name api --image ghcr.io/acme/api:latest --port 8080
  capsule service status --adapter kubernetes --namespace default --id api
  capsule service delete --adapter kubernetes --namespace default --id api
  capsule service --adapter azure-container-apps --subscription-id <sub> --resource-group <rg> --location eastus --environment-id <env_id> --name api --image ghcr.io/acme/api:latest --port 8080
  capsule machine --adapter ec2 --region us-east-1 --name dev --image-id ami-123 --instance-type t3.micro --subnet-id subnet-123 --security-group sg-123
  capsule machine --adapter fly --app-name my-fly-app --name dev --image ghcr.io/acme/dev:latest
  capsule edge --adapter cloudflare --name my-worker --entrypoint worker.js --zone-id <zone> --route example.com/* ./dist/worker.js
  capsule edge --adapter vercel --name my-deployment --project-name my-project --entrypoint index.js ./index.js
  capsule neon branch-create --project <project_id> --name pr-42 --database neondb --role neondb_owner --receipt-file .capsule/receipts.jsonl
  capsule neon branch-delete --project <project_id> --branch-id br_xxx --hard-delete

Receipt signatures:
  --public-key <path-or-value>     Verify ed25519 receipt signatures against this public key (PEM path or inline PEM).
  --require-signature              Fail receipts without a verified signature; a present-but-unverified signature fails too.
  --allow-unverified-signatures    Downgrade --require-signature to a presence-only check when no --public-key is supplied.

Configuration:
  capsule.config.json in the working directory supplies default adapter, receipts.path, and policyFile.
  Explicit flags (--adapter, --receipt-file, --policy-file) always override the config file.

Output:
  Report commands default to human-readable tables. Add --json for stable automation output.
`);
}

interface CapsuleConfigFile {
  adapter?: string;
  policyFile?: string;
  receipts?: {
    enabled?: boolean;
    path?: string;
  };
}

// Pure and testable: fills adapter, receipt-file, and policy-file from capsule.config.json only
// when the matching flag was not passed, so explicit flags always win over the config file.
export function applyCapsuleConfig(parsed: ParsedArgs, config: CapsuleConfigFile | undefined): ParsedArgs {
  if (!config) {
    return parsed;
  }
  const resolved: ParsedArgs = { ...parsed };
  if (resolved.adapter === undefined && typeof config.adapter === "string") {
    resolved.adapter = config.adapter;
  }
  if (resolved.policyFile === undefined && typeof config.policyFile === "string") {
    resolved.policyFile = config.policyFile;
  }
  if (resolved.receiptFile === undefined && config.receipts?.enabled !== false && typeof config.receipts?.path === "string") {
    resolved.receiptFile = config.receipts.path;
  }
  return resolved;
}

async function readCapsuleConfigFile(cwd: string = process.cwd()): Promise<CapsuleConfigFile | undefined> {
  const path = join(cwd, "capsule.config.json");
  let text: string;
  try {
    text = await readFile(path, "utf8");
  } catch {
    return undefined;
  }
  return assertJsonObject(JSON.parse(text), path) as CapsuleConfigFile;
}

function createCapsule(parsed: ParsedArgs): Capsule {
  const receiptStore = parsed.receiptFile ? jsonlReceiptStore(parsed.receiptFile) : undefined;
  if (parsed.adapter === "neon") {
    return new Capsule({
      adapter: neon({ databaseName: parsed.database, roleName: parsed.role }),
      receipts: true,
      receiptStore
    });
  }
  if (parsed.adapter === "e2b") {
    return new Capsule({ adapter: e2b(), receipts: true, receiptStore });
  }
  if (parsed.adapter === "daytona") {
    return new Capsule({ adapter: daytona({ apiUrl: parsed.apiUrl, target: parsed.target }), receipts: true, receiptStore });
  }
  if (parsed.adapter === "modal") {
    return new Capsule({ adapter: modal({ appName: parsed.appName, defaultImage: parsed.image }), receipts: true, receiptStore });
  }
  if (parsed.adapter === "cloudflare") {
    return new Capsule({
      adapter: cloudflare({ compatibilityDate: parsed.compatibilityDate, workersDevSubdomain: parsed.workersDevSubdomain, zoneId: parsed.zoneId }),
      receipts: true,
      receiptStore
    });
  }
  if (parsed.adapter === "cloud-run") {
    return new Capsule({
      adapter: cloudRun({ projectId: parsed.projectId, location: parsed.location }),
      receipts: true,
      receiptStore
    });
  }
  if (parsed.adapter === "vercel") {
    return new Capsule({
      adapter: vercel({ project: parsed.projectName, target: parsed.target }),
      receipts: true,
      receiptStore
    });
  }
  if (parsed.adapter === "kubernetes") {
    return new Capsule({
      adapter: kubernetes({ namespace: parsed.namespace, context: parsed.context, kubeconfigPath: parsed.kubeconfig }),
      receipts: true,
      receiptStore
    });
  }
  if (parsed.adapter === "lambda") {
    return new Capsule({
      adapter: lambda({ region: parsed.region, functionName: parsed.functionName }),
      receipts: true,
      receiptStore
    });
  }
  if (parsed.adapter === "ecs") {
    if (!parsed.cluster || !parsed.taskDefinition || !parsed.containerName) {
      throw new Error("ECS adapter requires --cluster, --task-definition, and --container-name");
    }
    return new Capsule({
      adapter: ecs({
        region: parsed.region,
        cluster: parsed.cluster,
        taskDefinition: parsed.taskDefinition,
        containerName: parsed.containerName,
        subnets: parsed.subnets,
        securityGroups: parsed.securityGroups
      }),
      receipts: true,
      receiptStore
    });
  }
  if (parsed.adapter === "ec2") {
    return new Capsule({
      adapter: ec2({
        region: parsed.region,
        imageId: parsed.imageId,
        instanceType: parsed.instanceType,
        subnetId: parsed.subnetId,
        securityGroupIds: parsed.securityGroups
      }),
      receipts: true,
      receiptStore
    });
  }
  if (parsed.adapter === "fly") {
    return new Capsule({
      adapter: fly({ appName: parsed.appName, region: parsed.region, defaultImage: parsed.image }),
      receipts: true,
      receiptStore
    });
  }
  if (parsed.adapter === "azure-container-apps") {
    return new Capsule({
      adapter: azureContainerApps({
        subscriptionId: parsed.subscriptionId,
        resourceGroupName: parsed.resourceGroup,
        location: parsed.location,
        environmentId: parsed.environmentId
      }),
      receipts: true,
      receiptStore
    });
  }
  return new Capsule({ adapter: docker(), receipts: true, receiptStore });
}

function requireCapability(capsule: Capsule, adapter: string | undefined, path: CapabilityPath): void {
  if (!capsule.supports(path)) {
    const adapterName = adapter ?? capsule.adapterName();
    const explanation = explainSupportLevel(capsule.capabilities(), path);
    throw new Error(
      `${adapterName} does not support ${path}. ${explanation.guidance} Docs: ${capabilityModelDocsUrl}. ${unsupportedCapabilitySafeRetryGuidance} Run "capsule capabilities --adapter ${adapterName} --explain" to inspect supported operations.`
    );
  }
}

export async function main(argv: string[]): Promise<void> {
  const parsed = applyCapsuleConfig(parse(argv), await readCapsuleConfigFile());

  switch (parsed.command) {
    case "completion": {
      const shell = parsed.rest[0];
      if (!isShellCompletionTarget(shell)) {
        throw new Error(`Unsupported shell "${shell ?? ""}". Supported shells: ${completionShells.join(", ")}.`);
      }
      console.log(createShellCompletionScript(shell));
      return;
    }
    case "neon": {
      const capsule = createCapsule(parsed);
      const action = parsed.rest[0];
      const project = parsed.project;
      if (!project) {
        throw new Error("Missing --project");
      }
      if (action === "branch-create") {
        if (!parsed.name) {
          throw new Error("Missing --name");
        }
        const branch = await capsule.database.branch.create({ project, name: parsed.name, parent: parsed.parent });
        console.log(JSON.stringify({ ...branch, connectionString: branch.connectionString ? "[REDACTED]" : undefined }, null, 2));
        return;
      }
      if (action === "branch-delete") {
        if (!parsed.branchId) {
          throw new Error("Missing --branch-id");
        }
        const deleted = await capsule.database.branch.delete({ project, branchId: parsed.branchId, hardDelete: parsed.hardDelete });
        console.log(JSON.stringify(deleted, null, 2));
        return;
      }
      throw new Error("Unknown neon command. Use branch-create or branch-delete.");
    }
    case "doctor": {
      const report = await createDoctorReport({ adapter: parsed.provider ?? parsed.adapter });
      printReport(parsed, report, formatDoctorReport(report));
      process.exitCode =
        report.docker === "available" && report.node.supported && report.workspace.status === "ok" && report.releaseAudit.status === "available" ? 0 : 1;
      return;
    }
    case "verify": {
      const action = parsed.rest[0];
      if (action !== "providers") {
        throw new Error("Unknown verify command. Use providers.");
      }
      const report = await createProviderVerificationReport({ provider: parsed.provider ?? parsed.adapter });
      console.log(JSON.stringify(report, null, 2));
      process.exitCode = report.providers.every((entry) => entry.status === "passed" || entry.status === "ready") ? 0 : 1;
      return;
    }
    case "live-test": {
      const action = parsed.rest[0];
      if (action === "plan") {
        console.log(JSON.stringify(liveTestCommandPlan(parsed.provider ?? parsed.adapter), null, 2));
        return;
      }
      if (action === "validate") {
        const report = createLiveEnvironmentValidationReport({ provider: parsed.provider ?? parsed.adapter });
        console.log(JSON.stringify(report, null, 2));
        process.exitCode = report.providers.every((entry) => entry.status === "ready") ? 0 : 1;
        return;
      }
      throw new Error("Unknown live-test command. Use plan or validate.");
    }
    case "capabilities": {
      const capsule = createCapsule(parsed);
      const capabilities = capsule.capabilities();
      const report = createCapabilityReport(capsule.adapterName(), capabilities);
      console.log(parsed.json ? JSON.stringify(report, null, 2) : formatCapabilityTable(report, { explain: parsed.explain }));
      return;
    }
    case "policy": {
      const action = parsed.rest[0];
      if (action !== "explain") {
        throw new Error("Unknown policy command. Use explain.");
      }
      console.log(JSON.stringify(await createPolicyExplainReport(parsed), null, 2));
      return;
    }
    case "receipt": {
      const action = parsed.rest[0];
      if (action === "verify") {
        const report = await createReceiptVerifyReport(parsed);
        console.log(JSON.stringify(report, null, 2));
        process.exitCode = report.summary.valid ? 0 : 1;
        return;
      }
      if (action === "inspect") {
        console.log(JSON.stringify(await createReceiptInspectReport(parsed), null, 2));
        return;
      }
      throw new Error("Unknown receipt command. Use verify or inspect.");
    }
    case "preset": {
      const action = parsed.rest[0];
      if (action === "list") {
        console.log(parsed.json ? JSON.stringify(presetCatalog, null, 2) : formatPresetCatalogTable(presetCatalog));
        return;
      }
      if (action === "explain") {
        const id = parsed.rest[1];
        if (!id) {
          throw new Error("Missing preset id. Use capsule preset explain <id>.");
        }
        const entry = presetCatalog.find((preset) => preset.id === id);
        if (!entry) {
          throw new Error(`Unknown preset "${id}". Run capsule preset list to see available presets.`);
        }
        console.log(JSON.stringify(entry, null, 2));
        return;
      }
      throw new Error("Unknown preset command. Use list or explain.");
    }
    case "preview": {
      const action = parsed.rest[0];
      if (action === "plan") {
        const report = await createPreviewPlanReport(parsed);
        console.log(JSON.stringify(report, null, 2));
        process.exitCode = report.validation.ok ? 0 : 1;
        return;
      }
      if (action === "create") {
        console.log(JSON.stringify(await createPreviewCreateReport(parsed), null, 2));
        process.exitCode = 0;
        return;
      }
      if (action === "destroy") {
        const report = await createPreviewDestroyReport(parsed);
        console.log(JSON.stringify(report, null, 2));
        // "unsupported" means only by-design-uncleanable resources (edge, job) were left behind;
        // that is not a failure. Only real failures ("partial") exit non-zero.
        process.exitCode = report.status === "partial" ? 1 : 0;
        return;
      }
      throw new Error("Unknown preview command. Use plan, create, or destroy.");
    }
    case "classify": {
      const action = parsed.rest[0];
      if (action !== "provider") {
        throw new Error("Unknown classify command. Use provider.");
      }
      const provider = parsed.rest[1] ?? parsed.provider;
      const service = parsed.rest[2] ?? parsed.name;
      if (!provider || !service) {
        throw new Error("Missing provider or service. Use capsule classify provider <provider> <service>.");
      }
      console.log(JSON.stringify(classifyProvider(provider, service), null, 2));
      return;
    }
    case "adapter": {
      const action = parsed.rest[0];
      if (action !== "scaffold") {
        throw new Error("Unknown adapter command. Use scaffold.");
      }
      const provider = parsed.rest[1] ?? parsed.provider ?? parsed.name;
      if (!provider) {
        throw new Error("Missing provider. Use capsule adapter scaffold <provider> --domain <domain>.");
      }
      const plan = createAdapterScaffoldPlan({ provider, domains: parsed.domains ?? [], outDir: parsed.outDir });
      await writeAdapterScaffold(plan, { force: parsed.force });
      console.log(
        JSON.stringify(
          { provider: plan.provider, packageName: plan.packageName, packageDir: plan.packageDir, files: plan.files.map((file) => file.path) },
          null,
          2
        )
      );
      return;
    }
    case "init": {
      const plan = createProjectInitPlan({ adapter: parsed.adapter, outDir: parsed.outDir });
      await writeProjectInitFiles(plan, { force: parsed.force });
      console.log(
        JSON.stringify(
          { adapter: plan.adapter, outDir: plan.outDir, files: plan.files.map((file) => file.path), installHint: plan.installHint, notes: plan.notes },
          null,
          2
        )
      );
      return;
    }
    case "examples": {
      const action = parsed.rest[0];
      if (action === "list") {
        console.log(JSON.stringify(await createExamplesReport(), null, 2));
        return;
      }
      if (action === "run") {
        const id = parsed.rest[1] ?? parsed.name;
        if (!id) {
          throw new Error("Missing example id. Use capsule examples run <id>.");
        }
        const report = await runExampleCommand(id, { dryRun: parsed.dryRun });
        console.log(JSON.stringify(report, null, 2));
        process.exitCode = report.status === "failed" ? (report.exitCode ?? 1) : 0;
        return;
      }
      throw new Error("Unknown examples command. Use list or run.");
    }
    case "select": {
      const action = parsed.rest[0];
      if (action !== "provider") {
        throw new Error("Unknown select command. Use provider.");
      }
      if (!parsed.recipe) {
        throw new Error("Missing --recipe");
      }
      if (!isProviderSelectionRecipeId(parsed.recipe)) {
        throw new Error(
          `Unknown provider selection recipe "${parsed.recipe}". Recipes: sandbox, agent-code-execution, preview-web-db, edge-web, service-api, machine`
        );
      }
      const report = selectProvidersForRecipe(parsed.recipe);
      printReport(parsed, report, formatProviderSelectionReport(report));
      return;
    }
    case "compare": {
      const action = parsed.rest[0];
      if (action !== "providers") {
        throw new Error("Unknown compare command. Use providers.");
      }
      const left = parsed.leftAdapter ?? parsed.rest[1];
      const right = parsed.rightAdapter ?? parsed.rest[2];
      if (!left || !right) {
        throw new Error("Missing providers. Use capsule compare providers --left docker --right e2b.");
      }
      const report = compareProviderCapabilities(left, right);
      printReport(parsed, report, formatProviderComparisonReport(report));
      return;
    }
    case "edge": {
      const capsule = createCapsule(parsed);
      if (parsed.adapter !== "cloudflare" && parsed.adapter !== "vercel") {
        throw new Error("edge currently requires --adapter cloudflare or --adapter vercel");
      }
      if (!parsed.name) {
        throw new Error("Missing --name");
      }
      const sourcePath = parsed.rest[0];
      if (!sourcePath) {
        throw new Error("Missing Worker module path");
      }
      const deployment = await capsule.edge.deploy({
        name: parsed.name,
        runtime: "workers",
        source: { path: sourcePath, entrypoint: parsed.entrypoint },
        routes: parsed.routes
      });
      console.log(JSON.stringify(deployment, null, 2));
      return;
    }
    case "job": {
      const capsule = createCapsule(parsed);
      const action = parsed.rest[0] === "run" || parsed.rest[0] === "status" || parsed.rest[0] === "cancel" ? parsed.rest[0] : "run";
      if (action === "status") {
        const id = parsed.id ?? parsed.name ?? parsed.rest[1];
        if (!id) {
          throw new Error("Missing --id");
        }
        requireCapability(capsule, parsed.adapter, "job.status");
        console.log(JSON.stringify(await capsule.job.status({ id }), null, 2));
        return;
      }
      if (action === "cancel") {
        const id = parsed.id ?? parsed.name ?? parsed.rest[1];
        if (!id) {
          throw new Error("Missing --id");
        }
        requireCapability(capsule, parsed.adapter, "job.cancel");
        console.log(JSON.stringify(await capsule.job.cancel({ id, reason: parsed.reason }), null, 2));
        return;
      }
      if (!parsed.image) {
        throw new Error("Missing --image");
      }
      const command = action === "run" && parsed.rest[0] === "run" ? parsed.rest.slice(1) : parsed.rest;
      requireCapability(capsule, parsed.adapter, "job.run");
      const run = await capsule.job.run({
        name: parsed.name,
        image: parsed.image,
        command: command.length > 0 ? command : undefined
      });
      console.log(JSON.stringify(run, null, 2));
      return;
    }
    case "service": {
      const capsule = createCapsule(parsed);
      const action = parsed.rest[0] === "deploy" || parsed.rest[0] === "status" || parsed.rest[0] === "delete" ? parsed.rest[0] : "deploy";
      if (parsed.adapter !== "cloud-run" && parsed.adapter !== "kubernetes" && parsed.adapter !== "ecs" && parsed.adapter !== "azure-container-apps") {
        throw new Error("service currently requires --adapter cloud-run, --adapter kubernetes, --adapter ecs, or --adapter azure-container-apps");
      }
      if (action === "status") {
        const id = parsed.id ?? parsed.name ?? parsed.rest[1];
        if (!id) {
          throw new Error("Missing --id");
        }
        requireCapability(capsule, parsed.adapter, "service.status");
        console.log(JSON.stringify(await capsule.service.status({ id }), null, 2));
        return;
      }
      if (action === "delete") {
        const id = parsed.id ?? parsed.name ?? parsed.rest[1];
        if (!id) {
          throw new Error("Missing --id");
        }
        requireCapability(capsule, parsed.adapter, "service.delete");
        console.log(JSON.stringify(await capsule.service.delete({ id, force: parsed.force, reason: parsed.reason }), null, 2));
        return;
      }
      if (!parsed.name) {
        throw new Error("Missing --name");
      }
      if (!parsed.image) {
        throw new Error("Missing --image");
      }
      requireCapability(capsule, parsed.adapter, "service.deploy");
      const deployment = await capsule.service.deploy({
        name: parsed.name,
        image: parsed.image,
        ports: parsed.port ? [{ port: parsed.port, protocol: "http" }] : undefined
      });
      console.log(JSON.stringify(deployment, null, 2));
      return;
    }
    case "machine": {
      const capsule = createCapsule(parsed);
      if (parsed.adapter !== "ec2" && parsed.adapter !== "fly") {
        throw new Error("machine currently requires --adapter ec2 or --adapter fly");
      }
      if (!parsed.name) {
        throw new Error("Missing --name");
      }
      const machine = await capsule.machine.create({
        name: parsed.name,
        image: parsed.imageId ?? parsed.image,
        size: parsed.instanceType,
        region: parsed.region
      });
      console.log(JSON.stringify(machine, null, 2));
      return;
    }
    case "run": {
      const capsule = createCapsule(parsed);
      const image = parsed.image ?? "node:22";
      const command = parsed.rest.length > 0 ? parsed.rest : ["node", "-e", "console.log('hello from capsule')"];
      const result = await capsule.job.run({ image, command });
      console.log(result.result?.stdout ?? "");
      if (result.receipt) {
        console.log(JSON.stringify(result.receipt, null, 2));
      }
      process.exitCode = result.result?.exitCode ?? 1;
      return;
    }
    case "sandbox": {
      const capsule = createCapsule(parsed);
      const image = parsed.image ?? "node:22";
      const sandbox = await capsule.sandbox.create({ image });
      try {
        const result = await sandbox.exec({ command: parsed.rest.length > 0 ? parsed.rest : ["node", "-e", "console.log('hello from sandbox')"] });
        console.log(result.stdout);
        if (result.receipt) {
          console.log(JSON.stringify(result.receipt, null, 2));
        }
        process.exitCode = result.exitCode;
      } finally {
        await sandbox.destroy();
      }
      return;
    }
    default:
      printHelp();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(2)).catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
