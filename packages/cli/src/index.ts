#!/usr/bin/env node
import { pathToFileURL } from "node:url";
import { Capsule } from "@capsule/core";
import { azureContainerApps } from "@capsule/adapter-azure-container-apps";
import { cloudflare } from "@capsule/adapter-cloudflare";
import { cloudRun } from "@capsule/adapter-cloud-run";
import { daytona } from "@capsule/adapter-daytona";
import { docker, dockerAvailable } from "@capsule/adapter-docker";
import { e2b } from "@capsule/adapter-e2b";
import { ec2 } from "@capsule/adapter-ec2";
import { ecs } from "@capsule/adapter-ecs";
import { fly } from "@capsule/adapter-fly";
import { kubernetes } from "@capsule/adapter-kubernetes";
import { lambda } from "@capsule/adapter-lambda";
import { modal } from "@capsule/adapter-modal";
import { neon } from "@capsule/adapter-neon";
import { vercel } from "@capsule/adapter-vercel";
import { jsonlReceiptStore } from "@capsule/store-jsonl";

interface ParsedArgs {
  command?: string;
  image?: string;
  adapter?: string;
  receiptFile?: string;
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
  hardDelete?: boolean;
  rest: string[];
}

interface CredentialRequirement {
  provider: string;
  requiredAll?: string[];
  requiredAny?: string[];
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
  providers: ProviderCredentialDiagnostic[];
}

const credentialRequirements: CredentialRequirement[] = [
  { provider: "e2b", requiredAll: ["E2B_API_KEY"] },
  { provider: "daytona", requiredAll: ["DAYTONA_API_KEY"] },
  { provider: "modal", requiredAll: ["MODAL_TOKEN_ID", "MODAL_TOKEN_SECRET"], notes: ["MODAL_ENVIRONMENT is optional."] },
  { provider: "neon", requiredAll: ["NEON_API_KEY"] },
  { provider: "cloudflare", requiredAll: ["CLOUDFLARE_API_TOKEN", "CLOUDFLARE_ACCOUNT_ID"], notes: ["CLOUDFLARE_ZONE_ID is required only for route creation."] },
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

export function parse(argv: string[]): ParsedArgs {
  const [command, ...args] = argv;
  const parsed: ParsedArgs = { command, rest: [] };
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--image") {
      parsed.image = args[index + 1];
      index += 1;
      continue;
    }
    if (arg === "--adapter") {
      parsed.adapter = args[index + 1];
      index += 1;
      continue;
    }
    if (arg === "--receipt-file") {
      parsed.receiptFile = args[index + 1];
      index += 1;
      continue;
    }
    if (arg === "--project") {
      parsed.project = args[index + 1];
      index += 1;
      continue;
    }
    if (arg === "--name") {
      parsed.name = args[index + 1];
      index += 1;
      continue;
    }
    if (arg === "--parent") {
      parsed.parent = args[index + 1];
      index += 1;
      continue;
    }
    if (arg === "--branch-id") {
      parsed.branchId = args[index + 1];
      index += 1;
      continue;
    }
    if (arg === "--database") {
      parsed.database = args[index + 1];
      index += 1;
      continue;
    }
    if (arg === "--role") {
      parsed.role = args[index + 1];
      index += 1;
      continue;
    }
    if (arg === "--entrypoint") {
      parsed.entrypoint = args[index + 1];
      index += 1;
      continue;
    }
    if (arg === "--compatibility-date") {
      parsed.compatibilityDate = args[index + 1];
      index += 1;
      continue;
    }
    if (arg === "--workers-dev-subdomain") {
      parsed.workersDevSubdomain = args[index + 1];
      index += 1;
      continue;
    }
    if (arg === "--zone-id") {
      parsed.zoneId = args[index + 1];
      index += 1;
      continue;
    }
    if (arg === "--route") {
      parsed.routes = [...(parsed.routes ?? []), args[index + 1]];
      index += 1;
      continue;
    }
    if (arg === "--project-id") {
      parsed.projectId = args[index + 1];
      index += 1;
      continue;
    }
    if (arg === "--location") {
      parsed.location = args[index + 1];
      index += 1;
      continue;
    }
    if (arg === "--project-name") {
      parsed.projectName = args[index + 1];
      index += 1;
      continue;
    }
    if (arg === "--target") {
      parsed.target = args[index + 1];
      index += 1;
      continue;
    }
    if (arg === "--namespace") {
      parsed.namespace = args[index + 1];
      index += 1;
      continue;
    }
    if (arg === "--context") {
      parsed.context = args[index + 1];
      index += 1;
      continue;
    }
    if (arg === "--kubeconfig") {
      parsed.kubeconfig = args[index + 1];
      index += 1;
      continue;
    }
    if (arg === "--region") {
      parsed.region = args[index + 1];
      index += 1;
      continue;
    }
    if (arg === "--function-name") {
      parsed.functionName = args[index + 1];
      index += 1;
      continue;
    }
    if (arg === "--subscription-id") {
      parsed.subscriptionId = args[index + 1];
      index += 1;
      continue;
    }
    if (arg === "--resource-group") {
      parsed.resourceGroup = args[index + 1];
      index += 1;
      continue;
    }
    if (arg === "--environment-id") {
      parsed.environmentId = args[index + 1];
      index += 1;
      continue;
    }
    if (arg === "--cluster") {
      parsed.cluster = args[index + 1];
      index += 1;
      continue;
    }
    if (arg === "--task-definition") {
      parsed.taskDefinition = args[index + 1];
      index += 1;
      continue;
    }
    if (arg === "--container-name") {
      parsed.containerName = args[index + 1];
      index += 1;
      continue;
    }
    if (arg === "--subnet") {
      parsed.subnets = [...(parsed.subnets ?? []), args[index + 1]];
      index += 1;
      continue;
    }
    if (arg === "--security-group") {
      parsed.securityGroups = [...(parsed.securityGroups ?? []), args[index + 1]];
      index += 1;
      continue;
    }
    if (arg === "--subnet-id") {
      parsed.subnetId = args[index + 1];
      index += 1;
      continue;
    }
    if (arg === "--image-id") {
      parsed.imageId = args[index + 1];
      index += 1;
      continue;
    }
    if (arg === "--instance-type") {
      parsed.instanceType = args[index + 1];
      index += 1;
      continue;
    }
    if (arg === "--api-url") {
      parsed.apiUrl = args[index + 1];
      index += 1;
      continue;
    }
    if (arg === "--app-name") {
      parsed.appName = args[index + 1];
      index += 1;
      continue;
    }
    if (arg === "--port") {
      parsed.port = Number(args[index + 1]);
      index += 1;
      continue;
    }
    if (arg === "--hard-delete") {
      parsed.hardDelete = true;
      continue;
    }
    if (arg === "--") {
      parsed.rest.push(...args.slice(index + 1));
      break;
    }
    parsed.rest.push(arg);
  }
  return parsed;
}

function credentialDiagnostic(requirement: CredentialRequirement, env: NodeJS.ProcessEnv): ProviderCredentialDiagnostic {
  const all = requirement.requiredAll ?? [];
  const any = requirement.requiredAny ?? [];
  const configuredAll = all.filter((name) => Boolean(env[name]));
  const missingAll = all.filter((name) => !env[name]);
  const configuredAny = any.filter((name) => Boolean(env[name]));
  const hasRequiredAny = any.length === 0 || configuredAny.length > 0;
  return {
    provider: requirement.provider,
    status: missingAll.length === 0 && hasRequiredAny ? "configured" : "missing",
    configuredEnv: [...configuredAll, ...configuredAny],
    missingEnv: [...missingAll, ...(hasRequiredAny ? [] : any)],
    requiredEnv: [...all, ...any],
    notes: requirement.notes ?? []
  };
}

export function providerCredentialDiagnostics(env: NodeJS.ProcessEnv = process.env, adapter?: string): ProviderCredentialDiagnostic[] {
  return credentialRequirements.filter((requirement) => !adapter || requirement.provider === adapter || (adapter === "lambda" || adapter === "ecs" || adapter === "ec2" ? requirement.provider === "aws" : false)).map((requirement) => credentialDiagnostic(requirement, env));
}

export async function createDoctorReport(options: { env?: NodeJS.ProcessEnv; adapter?: string; dockerCheck?: () => Promise<boolean> } = {}): Promise<DoctorReport> {
  const dockerOk = await (options.dockerCheck ?? dockerAvailable)();
  return {
    docker: dockerOk ? "available" : "unavailable",
    providers: providerCredentialDiagnostics(options.env ?? process.env, options.adapter)
  };
}

function printHelp(): void {
  console.log(`Capsule CLI

Commands:
  capsule doctor
  capsule capabilities
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
  capsule job --adapter kubernetes --namespace default --name my-job --image node:22 -- node -e "console.log('hi')"
  capsule job --adapter lambda --region us-east-1 --function-name my-function --image ignored
  capsule job --adapter ecs --region us-east-1 --cluster default --task-definition task:1 --container-name main --subnet subnet-123 --security-group sg-123 --image intent -- node job.js
  capsule job --adapter fly --app-name my-fly-app --name smoke --image node:22 -- node smoke.js
  capsule job --adapter azure-container-apps --subscription-id <sub> --resource-group <rg> --location eastus --environment-id <env_id> --name smoke --image node:22 -- node smoke.js
  capsule service --adapter cloud-run --project-id <gcp-project> --location us-central1 --name api --image us-docker.pkg.dev/project/repo/api:tag --port 8080
  capsule service --adapter ecs --region us-east-1 --cluster default --task-definition api:1 --container-name main --name api --image intent
  capsule service --adapter kubernetes --namespace default --name api --image ghcr.io/acme/api:latest --port 8080
  capsule service --adapter azure-container-apps --subscription-id <sub> --resource-group <rg> --location eastus --environment-id <env_id> --name api --image ghcr.io/acme/api:latest --port 8080
  capsule machine --adapter ec2 --region us-east-1 --name dev --image-id ami-123 --instance-type t3.micro --subnet-id subnet-123 --security-group sg-123
  capsule machine --adapter fly --app-name my-fly-app --name dev --image ghcr.io/acme/dev:latest
  capsule edge --adapter cloudflare --name my-worker --entrypoint worker.js --zone-id <zone> --route example.com/* ./dist/worker.js
  capsule edge --adapter vercel --name my-deployment --project-name my-project --entrypoint index.js ./index.js
  capsule neon branch-create --project <project_id> --name pr-42 --database neondb --role neondb_owner --receipt-file .capsule/receipts.jsonl
  capsule neon branch-delete --project <project_id> --branch-id br_xxx --hard-delete
`);
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

export async function main(argv: string[]): Promise<void> {
  const parsed = parse(argv);

  switch (parsed.command) {
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
      const report = await createDoctorReport({ adapter: parsed.adapter });
      console.log(JSON.stringify(report, null, 2));
      process.exitCode = report.docker === "available" ? 0 : 1;
      return;
    }
    case "capabilities": {
      const capsule = createCapsule(parsed);
      console.log(JSON.stringify(capsule.capabilities(), null, 2));
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
      if (parsed.adapter !== "cloud-run" && parsed.adapter !== "kubernetes" && parsed.adapter !== "lambda" && parsed.adapter !== "ecs" && parsed.adapter !== "fly" && parsed.adapter !== "azure-container-apps") {
        throw new Error("job currently requires --adapter cloud-run, --adapter kubernetes, --adapter lambda, --adapter ecs, --adapter fly, or --adapter azure-container-apps");
      }
      if (!parsed.image) {
        throw new Error("Missing --image");
      }
      const run = await capsule.job.run({
        name: parsed.name,
        image: parsed.image,
        command: parsed.rest.length > 0 ? parsed.rest : undefined
      });
      console.log(JSON.stringify(run, null, 2));
      return;
    }
    case "service": {
      const capsule = createCapsule(parsed);
      if (parsed.adapter !== "cloud-run" && parsed.adapter !== "kubernetes" && parsed.adapter !== "ecs" && parsed.adapter !== "azure-container-apps") {
        throw new Error("service currently requires --adapter cloud-run, --adapter kubernetes, --adapter ecs, or --adapter azure-container-apps");
      }
      if (!parsed.name) {
        throw new Error("Missing --name");
      }
      if (!parsed.image) {
        throw new Error("Missing --image");
      }
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
