#!/usr/bin/env node
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import ts from "typescript";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const defaultRoot = join(scriptDir, "..");
const domains = ["sandbox", "job", "service", "edge", "database", "preview", "machine"];
const policyEnforcement = ["networkPolicy", "filesystemPolicy", "secretMounting"];
const supportOrder = ["unsupported", "experimental", "emulated", "native"];

const adapterDefinitions = [
  {
    displayName: "Docker",
    packageDir: "docker",
    notes:
      "Local Docker is useful but not safe for hostile code by default. Sandbox port exposure is supported through local-only `127.0.0.1` Docker publish flags unless a caller explicitly opts into another bind IP. Sandbox snapshot/restore are unsupported because Capsule exposes no public restore API or portable Docker restore semantics today. Sandbox artifacts are copied out with `docker cp`; `job.artifacts` is unsupported because jobs run with `docker run --rm`. A timed-out exec or job reports an unknown outcome unless container removal is confirmed."
  },
  {
    displayName: "E2B",
    packageDir: "e2b",
    notes:
      "Cloud sandbox create, exec, file read/write/list, and destroy are implemented through the E2B SDK. A nonzero exit is a normal result; exec input, artifacts and streaming logs are unsupported, and port exposure is experimental (per-port E2B hosts)."
  },
  {
    displayName: "Daytona",
    packageDir: "daytona",
    notes:
      "Sandbox create, exec, file read/write/list, and delete are implemented through the Daytona SDK; job and preview wrappers are unsupported until implemented. Exec input, artifacts and snapshot are unsupported; `allowedHosts` accepts CIDR entries only (domains are rejected, empty blocks all)."
  },
  {
    displayName: "Modal",
    packageDir: "modal",
    notes:
      "Sandbox create, exec (with stdin and EOF), file read/write, and terminate (observed with `wait: true` under a deadline) are implemented through the Modal JS SDK; file listing, artifacts, streaming logs, snapshot, port exposure and broader function/service workflows are unsupported. `allowedHosts` accepts CIDR entries only."
  },
  {
    displayName: "Cloud Run",
    packageDir: "cloud-run",
    notes:
      "Cloud Run Jobs and Services are implemented via Admin API v2; service update uses `services.patch` with `forceNewRevision`, rollback migrates traffic to an explicit or selected previous revision, job/service logs use Cloud Logging `entries:list`; delete reports deleted only after the operation completes, otherwise `PendingOperationError`; command healthchecks are rejected; IAM/public access and preview orchestration are not faked."
  },
  {
    displayName: "Cloudflare Workers",
    packageDir: "cloudflare",
    notes:
      "Worker module upload, route creation, version upload, and rollback via Workers Deployments are implemented; secrets, logs, provider-specific bindings, and gradual traffic-split release remain explicit future capabilities."
  },
  {
    displayName: "Vercel",
    packageDir: "vercel",
    notes:
      "Inline deployment creation, deployment status, full alias release, bounded deployment event logs, and project runtime logs are implemented; runtime logs require `projectId` and are read as a bounded live tail (`since`/`until` are rejected), traffic splits other than 100% and follow streaming are rejected, and service/preview wrappers, large file upload/SHA flow, env, routes, and rollback remain explicit future capabilities."
  },
  {
    displayName: "Neon",
    packageDir: "neon",
    notes:
      "Database branch create/delete/reset and connection URI retrieval are implemented; a branch reports `creating` or `resetting` until its state and operations settle. Migrations, TTL and preview orchestration remain unsupported."
  },
  {
    displayName: "Kubernetes",
    packageDir: "kubernetes",
    notes:
      "Jobs, Deployments, Services, and selector-based combined Pod logs are implemented through the official Kubernetes client; follow streaming is rejected and log capture is bounded; delete is observed until the objects are gone; command healthchecks and an autoscaling `scale.max` are rejected, and sandbox/machine wrappers, ingress, and rollout remain explicit future work."
  },
  {
    displayName: "Lambda",
    packageDir: "lambda",
    notes:
      "Existing Lambda function invocation is implemented as `job.run`; the `DryRun` invocation type is rejected; function deployment/env mutation is not faked."
  },
  {
    displayName: "ECS/Fargate",
    packageDir: "ecs",
    notes:
      "RunTask and CreateService are implemented for existing task definitions. A task's result follows the configured main container; service delete waits for the drain and reports deleted only once the service is INACTIVE, otherwise `PendingOperationError`. Task-definition registration, previews, and load balancers are future work."
  },
  {
    displayName: "EC2",
    packageDir: "ec2",
    notes:
      "`machine.create/status/start/stop/destroy` are implemented through EC2 APIs with transitional `stopping`/`destroying` statuses; `spec.region` must match the adapter region; env values are shell literals that do not persist past user data. Job/service wrappers, exec, and snapshot remain explicit future work."
  },
  {
    displayName: "Fly Machines",
    packageDir: "fly",
    notes:
      "Fly Machines API supports machine create/status/start/stop/destroy and one-shot job machines; services, logs, volumes, and app networking remain explicit future work."
  },
  {
    displayName: "Azure Container Apps",
    packageDir: "azure",
    notes:
      "ARM APIs support Container App service create/status/delete and manual job create/start/status/stop; a 202 delete is observed until it completes, otherwise `PendingOperationError`; healthchecks are rejected; logs, secrets, registries, and generic service rollback remain explicit future work."
  }
];

const plannedRows = [
  "| Mock provider models | mock | varies | varies | varies | varies | varies | varies | varies | varies | varies | varies | `@capsule-sdk/mock` provides fake E2B, Daytona, Modal, Cloud Run, Vercel, Cloudflare, Neon, Lambda, ECS, Kubernetes, and EC2 capability models for tests/examples only. It returns fake objects and does not call real provider APIs. |",
  "| Cloudflare Sandbox | planned | experimental | unsupported | unsupported | unsupported | unsupported | unsupported | unsupported | unsupported | unsupported | unsupported | Future sandbox-focused adapter target; not implemented as a real provider adapter in this repo yet. |",
  "| Cloudflare Containers | planned | unsupported | experimental | experimental | experimental | unsupported | experimental | unsupported | unsupported | unsupported | unsupported | Hybrid runtime model still needs a real adapter and provider-specific lifecycle design. |",
  "| Microsandbox | planned | experimental | unsupported | unsupported | unsupported | unsupported | unsupported | unsupported | unsupported | unsupported | unsupported | Sandbox-focused future adapter target. |"
];

function walk(dir, files = []) {
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (entry === "node_modules" || entry === "dist") continue;
    if (statSync(path).isDirectory()) walk(path, files);
    else files.push(path);
  }
  return files;
}

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function parseArgs(argv) {
  const options = { root: defaultRoot, check: false };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--root") {
      const value = argv[index + 1];
      if (!value) throw new Error("--root requires a path.");
      options.root = value;
      index += 1;
    } else if (arg === "--check") {
      options.check = true;
    } else if (arg === "--help") {
      options.help = true;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  return options;
}

function printUsage() {
  console.log(`Usage: node scripts/capsule-gap-report.mjs [--root <path>] [--check]

Generates docs/provider-matrix.md from adapter capability declarations and prints
a compact support-level gap report.`);
}

export function domainSupportLevel(capabilities, domain) {
  const domainCapabilities = capabilities[domain];
  if (!domainCapabilities) {
    return "unsupported";
  }
  return Object.values(domainCapabilities).reduce((best, level) => (supportOrder.indexOf(level) > supportOrder.indexOf(best) ? level : best), "unsupported");
}

export function policySupportLevel(capabilities, key) {
  return capabilities.sandbox?.[key] ?? "unsupported";
}

export function renderProviderMatrix(adapters) {
  const realRows = adapters.map((adapter) => {
    const cells = domains.map((domain) => domainSupportLevel(adapter.capabilities, domain));
    const policyCells = policyEnforcement.map((key) => policySupportLevel(adapter.capabilities, key));
    return `| ${adapter.displayName} | \`${adapter.packageName}\` | ${cells.join(" | ")} | ${policyCells.join(" | ")} | ${adapter.notes} |`;
  });

  return `# Provider Matrix

> This file is generated by \`pnpm capsule:gap\`. Edit adapter capability declarations or the generator metadata in \`scripts/capsule-gap-report.mjs\`, then rerun the command.

Status legend:

- \`real\`: implemented against a real provider/runtime API in this repo.
- \`mock\`: modeled by \`@capsule-sdk/mock\` for tests/examples only.
- \`planned\`: documented target with no real adapter yet.

Policy enforcement columns (Network policy, Filesystem policy, Secret mounting) report adapter-declared \`sandbox\` support levels for policy controls. \`unsupported\` means the adapter does not model that policy control, not that the control is unsafe.

## Real Adapters

| Provider | Package | Sandbox | Job | Service | Edge/function | Database/resource | Preview | Machine | Network policy | Filesystem policy | Secret mounting | Support notes |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
${realRows.join("\n")}

## Preset Packages

\`@capsule-sdk/core\` includes generic spec and policy factories such as Node sandboxes, one-shot jobs, HTTP services, edge workers, database branches, and preview environments.

\`@capsule-sdk/presets\` adds provider-oriented composition helpers. These helpers are intentionally not adapter shortcuts: they produce typed specs, policies, notes, and capability paths for common shapes such as Fly + Vercel + Neon previews. Callers still instantiate the provider adapters, check support levels, execute through Capsule, and keep receipts for each action.

## Mock And Planned Modeling

| Provider/model | Adapter status | Sandbox | Job | Service | Edge/function | Database/resource | Preview | Machine | Network policy | Filesystem policy | Secret mounting | Support notes |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
${plannedRows.join("\n")}
`;
}

export function renderGapReport(adapters, mockExamples) {
  const lines = ["# Capsule Gap Report", "", "| Adapter | Native | Emulated | Experimental | Unsupported |", "| --- | ---: | ---: | ---: | ---: |"];
  for (const adapter of adapters) {
    const levels = { native: 0, emulated: 0, experimental: 0, unsupported: 0 };
    for (const domain of Object.values(adapter.capabilities)) {
      for (const level of Object.values(domain)) {
        levels[level] += 1;
      }
    }
    lines.push(`| ${adapter.packageName} | ${levels.native} | ${levels.emulated} | ${levels.experimental} | ${levels.unsupported} |`);
  }

  lines.push("", "## Mock-First Example References");
  if (mockExamples.length === 0) {
    lines.push("No examples import @capsule-sdk/mock.");
  } else {
    lines.push(...mockExamples.map((file) => `- ${file}`));
  }

  lines.push(
    "",
    "## Recommended Next Work",
    "- Reduce unsupported counts by implementing explicit lifecycle operations, not by pretending support exists.",
    "- Move examples to env-gated real adapters while preserving mock mode for credential-free docs.",
    "- Add live tests behind CAPSULE_LIVE_TESTS=1 and provider-specific credentials."
  );
  return `${lines.join("\n")}\n`;
}

function loadCapabilityMap(sourceFile) {
  const source = ts.createSourceFile(sourceFile, readFileSync(sourceFile, "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  for (const statement of source.statements) {
    if (!ts.isVariableStatement(statement)) continue;
    const isExported = statement.modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword);
    if (!isExported) continue;
    for (const declaration of statement.declarationList.declarations) {
      if (!ts.isIdentifier(declaration.name) || !declaration.name.text.endsWith("Capabilities") || !declaration.initializer) continue;
      return objectLiteralToValue(declaration.initializer, sourceFile);
    }
  }
  throw new Error(`No exported *Capabilities object found in ${sourceFile}.`);
}

function objectLiteralToValue(node, sourceFile) {
  if (ts.isAsExpression(node) || ts.isSatisfiesExpression(node)) {
    return objectLiteralToValue(node.expression, sourceFile);
  }
  if (ts.isStringLiteral(node)) {
    return node.text;
  }
  if (!ts.isObjectLiteralExpression(node)) {
    throw new Error(`Unsupported capability literal in ${sourceFile}: ${node.getText()}`);
  }

  const value = {};
  for (const property of node.properties) {
    if (!ts.isPropertyAssignment(property)) {
      throw new Error(`Unsupported capability property in ${sourceFile}: ${property.getText()}`);
    }
    const name = propertyName(property.name);
    value[name] = objectLiteralToValue(property.initializer, sourceFile);
  }
  return value;
}

function propertyName(name) {
  if (ts.isIdentifier(name) || ts.isStringLiteral(name) || ts.isNumericLiteral(name)) {
    return name.text;
  }
  throw new Error(`Unsupported capability property name: ${name.getText()}`);
}

export function loadAdapters(root) {
  return adapterDefinitions.map((definition) => {
    const packageDir = join(root, "packages", definition.packageDir);
    const packageName = readJson(join(packageDir, "package.json")).name;
    const adapterSource = walk(join(packageDir, "src")).find((file) => file.endsWith("-adapter.ts"));
    if (!adapterSource) {
      throw new Error(`No adapter source found for ${definition.packageDir}.`);
    }
    return {
      ...definition,
      packageName,
      capabilities: loadCapabilityMap(adapterSource)
    };
  });
}

export function mockExampleReferences(root) {
  const examplesDir = join(root, "examples");
  if (!existsSync(examplesDir)) {
    return [];
  }
  return walk(examplesDir)
    .filter((file) => file.endsWith(".ts") || file.endsWith("package.json"))
    .filter((file) => readFileSync(file, "utf8").includes("@capsule-sdk/mock"))
    .map((file) => relative(root, file))
    .sort();
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    printUsage();
    return;
  }

  const adapters = loadAdapters(options.root);
  const mockExamples = mockExampleReferences(options.root);
  const providerMatrix = renderProviderMatrix(adapters);
  const providerMatrixPath = join(options.root, "docs", "provider-matrix.md");

  if (options.check) {
    const current = readFileSync(providerMatrixPath, "utf8");
    if (current !== providerMatrix) {
      throw new Error("docs/provider-matrix.md is stale. Run pnpm capsule:gap.");
    }
  } else {
    writeFileSync(providerMatrixPath, providerMatrix);
  }

  console.log(renderGapReport(adapters, mockExamples));
  if (!options.check) {
    console.log("Updated docs/provider-matrix.md from adapter capability declarations.");
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}
