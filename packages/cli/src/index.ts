#!/usr/bin/env node
import { Capsule } from "@capsule/core";
import { docker, dockerAvailable } from "@capsule/adapter-docker";
import { neon } from "@capsule/adapter-neon";
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
  capsule run --image node:22 -- node -e "console.log('hello')"
  capsule sandbox --image node:22
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
