#!/usr/bin/env node
import { Capsule } from "@capsule/core";
import { cloudflare } from "@capsule/adapter-cloudflare";
import { cloudRun } from "@capsule/adapter-cloud-run";
import { docker, dockerAvailable } from "@capsule/adapter-docker";
import { e2b } from "@capsule/adapter-e2b";
import { ec2 } from "@capsule/adapter-ec2";
import { ecs } from "@capsule/adapter-ecs";
import { kubernetes } from "@capsule/adapter-kubernetes";
import { lambda } from "@capsule/adapter-lambda";
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
  projectId?: string;
  location?: string;
  projectName?: string;
  target?: string;
  namespace?: string;
  context?: string;
  kubeconfig?: string;
  region?: string;
  functionName?: string;
  cluster?: string;
  taskDefinition?: string;
  containerName?: string;
  subnets?: string[];
  securityGroups?: string[];
  subnetId?: string;
  imageId?: string;
  instanceType?: string;
  port?: number;
  hardDelete?: boolean;
  rest: string[];
}

function parse(argv: string[]): ParsedArgs {
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

function printHelp(): void {
  console.log(`Capsule CLI

Commands:
  capsule doctor
  capsule capabilities
  capsule capabilities --adapter neon
  capsule capabilities --adapter e2b
  capsule capabilities --adapter cloudflare
  capsule capabilities --adapter vercel
  capsule capabilities --adapter kubernetes --namespace default
  capsule capabilities --adapter lambda --region us-east-1 --function-name my-function
  capsule capabilities --adapter ecs --region us-east-1 --cluster default --task-definition task:1 --container-name main
  capsule capabilities --adapter ec2 --region us-east-1 --image-id ami-123 --instance-type t3.micro
  capsule capabilities --adapter cloud-run --project-id <gcp-project> --location us-central1
  capsule run --image node:22 -- node -e "console.log('hello')"
  capsule sandbox --image node:22
  capsule sandbox --adapter e2b -- node -e "console.log('hello from E2B')"
  capsule job --adapter cloud-run --project-id <gcp-project> --location us-central1 --name my-job --image us-docker.pkg.dev/project/repo/job:tag
  capsule job --adapter kubernetes --namespace default --name my-job --image node:22 -- node -e "console.log('hi')"
  capsule job --adapter lambda --region us-east-1 --function-name my-function --image ignored
  capsule job --adapter ecs --region us-east-1 --cluster default --task-definition task:1 --container-name main --subnet subnet-123 --security-group sg-123 --image intent -- node job.js
  capsule service --adapter cloud-run --project-id <gcp-project> --location us-central1 --name api --image us-docker.pkg.dev/project/repo/api:tag --port 8080
  capsule service --adapter ecs --region us-east-1 --cluster default --task-definition api:1 --container-name main --name api --image intent
  capsule service --adapter kubernetes --namespace default --name api --image ghcr.io/acme/api:latest --port 8080
  capsule machine --adapter ec2 --region us-east-1 --name dev --image-id ami-123 --instance-type t3.micro --subnet-id subnet-123 --security-group sg-123
  capsule edge --adapter cloudflare --name my-worker --entrypoint worker.js ./dist/worker.js
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
  if (parsed.adapter === "cloudflare") {
    return new Capsule({
      adapter: cloudflare({ compatibilityDate: parsed.compatibilityDate, workersDevSubdomain: parsed.workersDevSubdomain }),
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
  return new Capsule({ adapter: docker(), receipts: true, receiptStore });
}

async function main(argv: string[]): Promise<void> {
  const parsed = parse(argv);
  const capsule = createCapsule(parsed);

  switch (parsed.command) {
    case "neon": {
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
      const ok = await dockerAvailable();
      console.log(JSON.stringify({ docker: ok ? "available" : "unavailable" }, null, 2));
      process.exitCode = ok ? 0 : 1;
      return;
    }
    case "capabilities": {
      console.log(JSON.stringify(capsule.capabilities(), null, 2));
      return;
    }
    case "edge": {
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
        source: { path: sourcePath, entrypoint: parsed.entrypoint }
      });
      console.log(JSON.stringify(deployment, null, 2));
      return;
    }
    case "job": {
      if (parsed.adapter !== "cloud-run" && parsed.adapter !== "kubernetes" && parsed.adapter !== "lambda" && parsed.adapter !== "ecs") {
        throw new Error("job currently requires --adapter cloud-run, --adapter kubernetes, --adapter lambda, or --adapter ecs");
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
      if (parsed.adapter !== "cloud-run" && parsed.adapter !== "kubernetes" && parsed.adapter !== "ecs") {
        throw new Error("service currently requires --adapter cloud-run, --adapter kubernetes, or --adapter ecs");
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
      if (parsed.adapter !== "ec2") {
        throw new Error("machine currently requires --adapter ec2");
      }
      if (!parsed.name) {
        throw new Error("Missing --name");
      }
      const machine = await capsule.machine.create({
        name: parsed.name,
        image: parsed.imageId ?? parsed.image,
        size: parsed.instanceType
      });
      console.log(JSON.stringify(machine, null, 2));
      return;
    }
    case "run": {
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

main(process.argv.slice(2)).catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
