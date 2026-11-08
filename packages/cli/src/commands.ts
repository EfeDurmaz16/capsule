// One table drives parsing, help and shell completion. Every command lists the options it reads; any
// other option, an unknown command or action, or an extra argument is a usage error before any work.
import { parseArgs } from "node:util";
import { usageError } from "./contract.js";

type Kind = "string" | "array" | "boolean" | "number";

interface OptionSpec {
  kind: Kind;
  field: string;
  hint?: string;
  summary: string;
  short?: string;
}

const kinds: Record<string, Kind> = { s: "string", a: "array", b: "boolean", n: "number" };

// One option per line: name[=field] kind hint summary. kind is s(tring), a(rray, repeatable), b(oolean) or
// n(umber); hint "-" means no value. The field defaults to the camelCase name.
function optionTable(text: string): Record<string, OptionSpec> {
  const table: Record<string, OptionSpec> = {};
  for (const line of text.trim().split("\n")) {
    const [key = "", kind = "", hint = "", ...summary] = line.split(" ");
    const [name = "", field = name.replace(/-(\w)/g, (_, letter: string) => letter.toUpperCase())] = key.split("=");
    table[name] = { kind: kinds[kind]!, field, summary: summary.join(" "), ...(hint === "-" ? {} : { hint }) };
  }
  return table;
}

export const optionSpecs = optionTable(`
adapter s <name> Adapter to use (default: docker, or capsule.config.json)
allow-unverified-signatures b - With --require-signature and no key, check presence only
api-url s <url> Daytona API URL
app-name s <name> Fly or Modal app name
branch-id s <id> Neon branch id
capability s <path> Capability path, for example job.run
cleanup-file s <file> Preview cleanup plan file
cluster s <name> ECS cluster
compatibility-date s <date> Cloudflare Workers compatibility date
config-file s <file> Preview config file
container-name s <name> ECS container name
context s <name> Kubernetes context
database s <name> Neon database name
domain=domains a <domain> Adapter domain to scaffold (repeatable)
dry-run b - Show what would run without running it
entrypoint s <file> Edge entrypoint module
environment-id s <id> Azure Container Apps environment id
explain b - Show guidance for each capability
force b - Overwrite files, or force a provider delete where supported
function-name s <name> Lambda function name
hard-delete b - Delete the Neon branch permanently
id s <id> Resource or receipt id
image s <image> Container image
image-id s <ami> EC2 image id
instance-type s <type> EC2 instance type
kubeconfig s <file> Kubernetes kubeconfig path
left=leftAdapter s <name> First provider to compare
location s <region> Cloud Run or Azure location
name s <name> Resource name
namespace s <name> Kubernetes namespace
out-dir s <dir> Directory to write files into
parent s <branch> Neon parent branch
policy-file s <file> Policy JSON enforced before any provider call
port n <port> Service port
project s <id> Neon project id
project-id s <id> Google Cloud project id
project-name s <name> Vercel project name
provider s <name> Provider to report on
public-key s <file|pem> Ed25519 public key to verify signatures
reason s <text> Reason recorded with a cancel or delete
receipt-file s <file> Append receipts to this JSONL file
recipe s <id> Provider selection recipe
region s <region> AWS or Fly region
require-signature b - Fail receipts without a verified signature
resource-group s <name> Azure resource group
right=rightAdapter s <name> Second provider to compare
role s <name> Neon role name
route=routes a <route> Edge route (repeatable)
security-group=securityGroups a <id> AWS security group (repeatable)
spec-file s <file> Policy input JSON
since s <time> Export from this ISO 8601 time (inclusive)
subnet-id s <id> EC2 subnet id
subnet=subnets a <id> AWS subnet (repeatable)
subscription-id s <id> Azure subscription id
target s <name> Daytona or Vercel target
task-definition s <arn> ECS task definition
until s <time> Export up to this ISO 8601 time (exclusive)
workers-dev-subdomain s <name> Cloudflare workers.dev subdomain
yes b - Confirm a delete without a prompt
zone-id s <id> Cloudflare zone id
`);

export const globalOptionSpecs = optionTable(`
debug b - Print stack traces for failures
help b - Show help for a command
json b - Print one JSON document on stdout; errors as one JSON line on stderr
no-color b - Turn off color (also NO_COLOR, or when stderr is not a terminal)
non-interactive b - Never prompt (also when stdin is not a terminal, or CI is set)
version b - Print the version
`);
globalOptionSpecs.help!.short = "h";
globalOptionSpecs.version!.short = "v";

const providerOptions = (
  "adapter api-url app-name cluster compatibility-date container-name context database environment-id function-name image image-id " +
  "instance-type kubeconfig location namespace project-id project-name region resource-group role security-group subnet subnet-id " +
  "subscription-id target task-definition workers-dev-subdomain zone-id"
).split(" ");
const executionOptions = [...providerOptions, "policy-file", "receipt-file"];

interface ActionSpec {
  summary: string;
  args?: string[];
}

export interface CommandSpec {
  summary: string;
  usage: string[];
  options: string[];
  actions?: Record<string, ActionSpec>;
  defaultAction?: string;
  args?: string[];
  passthrough?: boolean;
  examples: string[];
}

export const commandSpecs: Record<string, CommandSpec> = {
  run: {
    summary: "Run a command in a one-off container; its stdout and stderr are the program's own",
    usage: ["run [options] -- <command>..."],
    options: executionOptions,
    passthrough: true,
    examples: ['run --image node:22 -- node -e "console.log(1)"', "run --json --image busybox -- echo hi"]
  },
  sandbox: {
    summary: "Create a sandbox, run one command in it, then destroy it",
    usage: ["sandbox [options] -- <command>..."],
    options: executionOptions,
    passthrough: true,
    examples: ['sandbox --adapter e2b -- node -e "console.log(1)"']
  },
  gc: {
    summary: "Remove what crashed runs left behind (asks first)",
    usage: ["gc [--dry-run] [--yes] [options]"],
    options: [...executionOptions, "dry-run", "reason", "yes"],
    examples: ["gc --dry-run"]
  },
  capabilities: {
    summary: "Show what an adapter supports",
    usage: ["capabilities [--adapter <name>] [--explain]"],
    options: [...providerOptions, "explain"],
    examples: ["capabilities --adapter e2b", "capabilities --adapter kubernetes --namespace default --json"]
  },
  doctor: {
    summary: "Check this machine: Node, Docker, and provider credentials",
    usage: ["doctor [--adapter <name>]"],
    options: ["adapter", "provider"],
    examples: ["doctor", "doctor --adapter e2b --json"]
  },
  policy: {
    summary: "Explain a policy decision without calling a provider",
    usage: ["policy explain --capability <path> [--policy-file <file>] [--spec-file <file>]"],
    options: [...providerOptions, "capability", "policy-file", "spec-file"],
    actions: { explain: { summary: "Show the decision and its trace" } },
    examples: ["policy explain --capability job.run --policy-file policy.json"]
  },
  receipt: {
    summary: "Verify or inspect stored receipts",
    usage: ["receipt verify --receipt-file <file> [--public-key <key>] [--require-signature]", "receipt inspect --receipt-file <file> [--id <id>]"],
    options: ["receipt-file", "public-key", "require-signature", "allow-unverified-signatures", "id"],
    actions: { verify: { summary: "Check hashes and signatures" }, inspect: { summary: "Print receipts, or one by id" } },
    examples: ["receipt verify --receipt-file .capsule/receipts.jsonl"]
  },
  audit: {
    summary: "Export receipts and policy decisions as JSONL",
    usage: ["audit export --receipt-file <file> [--since <time>] [--until <time>]"],
    options: ["receipt-file", "since", "until"],
    actions: { export: { summary: "One JSON line per receipt and per decision" } },
    examples: ["audit export --receipt-file .capsule/receipts.jsonl --since 2026-11-01T00:00:00Z"]
  },
  job: {
    summary: "Run, inspect, or cancel a provider job",
    usage: ["job [run] --image <image> [options] [-- <command>...]", "job status --id <id> [options]", "job cancel --id <id> [--reason <text>] [options]"],
    options: [...executionOptions, "name", "id", "reason"],
    actions: {
      run: { summary: "Run a job (default)" },
      status: { summary: "Show a job's status", args: ["id"] },
      cancel: { summary: "Cancel a job", args: ["id"] }
    },
    defaultAction: "run",
    passthrough: true,
    examples: ["job --adapter kubernetes --namespace default --name smoke --image node:22 -- node -e 1", "job status --adapter kubernetes --id smoke"]
  },
  service: {
    summary: "Deploy, inspect, or delete a provider service",
    usage: [
      "service [deploy] --name <name> --image <image> [--port <port>] [options]",
      "service status --id <id> [options]",
      "service delete --id <id> --yes [options]"
    ],
    options: [...executionOptions, "name", "id", "port", "force", "reason", "yes"],
    actions: {
      deploy: { summary: "Deploy a service (default)" },
      status: { summary: "Show a service's status", args: ["id"] },
      delete: { summary: "Delete a service (asks first)", args: ["id"] }
    },
    defaultAction: "deploy",
    examples: ["service --adapter cloud-run --project-id <project> --location us-central1 --name api --image <image>"]
  },
  machine: {
    summary: "Create a provider machine",
    usage: ["machine --adapter ec2|fly --name <name> [options]"],
    options: [...executionOptions, "name"],
    examples: ["machine --adapter fly --app-name my-app --name dev --image <image>"]
  },
  edge: {
    summary: "Deploy an edge function",
    usage: ["edge --adapter cloudflare|vercel --name <name> [options] <module>"],
    options: [...executionOptions, "name", "entrypoint", "route"],
    args: ["module"],
    examples: ["edge --adapter cloudflare --name my-worker ./dist/worker.js"]
  },
  neon: {
    summary: "Create or delete a Neon branch",
    usage: ["neon branch-create --project <id> --name <name> [options]", "neon branch-delete --project <id> --branch-id <id> --yes [--hard-delete]"],
    options: [...executionOptions, "project", "name", "parent", "branch-id", "hard-delete", "yes"],
    actions: { "branch-create": { summary: "Create a branch" }, "branch-delete": { summary: "Delete a branch (asks first)" } },
    examples: ["neon branch-create --project <id> --name pr-42"]
  },
  preview: {
    summary: "Plan, create, or destroy a preview environment",
    usage: ["preview plan --config-file <file>", "preview create --config-file <file> [--cleanup-file <file>]", "preview destroy --cleanup-file <file> --yes"],
    options: ["config-file", "cleanup-file", "policy-file", "receipt-file", "force", "hard-delete", "reason", "yes"],
    actions: {
      plan: { summary: "Validate a preview config" },
      create: { summary: "Create the preview resources" },
      destroy: { summary: "Clean up recorded resources (asks first)" }
    },
    examples: ["preview create --config-file preview.json --cleanup-file .capsule/preview-cleanup.json"]
  },
  preset: {
    summary: "List or explain presets",
    usage: ["preset list", "preset explain <id>"],
    options: [],
    actions: { list: { summary: "List presets" }, explain: { summary: "Explain one preset", args: ["id"] } },
    examples: ["preset explain node-sandbox"]
  },
  select: {
    summary: "Rank providers for a recipe",
    usage: ["select provider --recipe <id>"],
    options: ["recipe"],
    actions: { provider: { summary: "Rank providers" } },
    examples: ["select provider --recipe sandbox"]
  },
  compare: {
    summary: "Compare two providers' capabilities",
    usage: ["compare providers --left <name> --right <name>"],
    options: ["left", "right"],
    actions: { providers: { summary: "Compare two providers", args: ["left", "right"] } },
    examples: ["compare providers --left docker --right e2b"]
  },
  classify: {
    summary: "Classify a provider service",
    usage: ["classify provider <provider> <service>"],
    options: ["provider", "name"],
    actions: { provider: { summary: "Classify one service", args: ["provider", "service"] } },
    examples: ["classify provider cloudflare workers"]
  },
  init: {
    summary: "Write a starter project",
    usage: ["init [--adapter <name>] [--out-dir <dir>] [--force]"],
    options: ["adapter", "out-dir", "force"],
    examples: ["init --adapter docker --out-dir ."]
  },
  examples: {
    summary: "List or run the repository examples",
    usage: ["examples list", "examples run <id> [--dry-run]"],
    options: ["name", "dry-run"],
    actions: { list: { summary: "List examples" }, run: { summary: "Run one example", args: ["id"] } },
    examples: ["examples run capability-check --dry-run"]
  },
  adapter: {
    summary: "Scaffold a new adapter package",
    usage: ["adapter scaffold <provider> --domain <domain> [--out-dir <dir>] [--force]"],
    options: ["provider", "name", "domain", "out-dir", "force"],
    actions: { scaffold: { summary: "Write the package files", args: ["provider"] } },
    examples: ["adapter scaffold acme --domain sandbox"]
  },
  "live-test": {
    summary: "Plan or validate live provider tests",
    usage: ["live-test plan [--provider <name>]", "live-test validate [--provider <name>]"],
    options: ["provider", "adapter"],
    actions: { plan: { summary: "Show the live test plan" }, validate: { summary: "Check the live test environment" } },
    examples: ["live-test validate --provider neon"]
  },
  verify: {
    summary: "Report provider verification status",
    usage: ["verify providers [--provider <name>]"],
    options: ["provider", "adapter"],
    actions: { providers: { summary: "Report every provider, or one" } },
    examples: ["verify providers --provider neon"]
  },
  completion: {
    summary: "Print a shell completion script",
    usage: ["completion bash|zsh|fish"],
    options: [],
    args: ["shell"],
    examples: ["completion zsh"]
  },
  help: {
    summary: "Show help for a command",
    usage: ["help [<command>]"],
    options: [],
    args: ["command"],
    examples: ["help run"]
  }
};

export const docsUrl = "https://github.com/EfeDurmaz16/capsule/blob/main/docs/cli.md";

export interface ParsedLine {
  command?: string;
  rest: string[];
  positionals: string[];
  passthrough: string[];
  help?: boolean;
  version?: boolean;
}

const allOptionSpecs = { ...optionSpecs, ...globalOptionSpecs };
const parseOptions = Object.fromEntries(
  Object.entries(allOptionSpecs).map(([name, spec]) => [
    name,
    { type: spec.kind === "boolean" ? ("boolean" as const) : ("string" as const), ...(spec.short ? { short: spec.short } : {}) }
  ])
);

function distance(left: string, right: string): number {
  const row = Array.from({ length: right.length + 1 }, (_, index) => index);
  for (let i = 1; i <= left.length; i++) {
    let previous = row[0]!;
    row[0] = i;
    for (let j = 1; j <= right.length; j++) {
      const current = row[j]!;
      row[j] = Math.min(row[j]! + 1, row[j - 1]! + 1, previous + (left[i - 1] === right[j - 1] ? 0 : 1));
      previous = current;
    }
  }
  return row[right.length]!;
}

/** At most one suggestion, and only a close one. */
export function suggest(input: string, candidates: readonly string[]): string | undefined {
  let best: { value: string; score: number } | undefined;
  for (const candidate of candidates) {
    const score = distance(input, candidate);
    if (score <= Math.max(1, Math.floor(candidate.length / 3)) && (!best || score < best.score)) best = { value: candidate, score };
  }
  return best?.value;
}

function helpHint(path: string[], suggestion?: string): string {
  const help = `Run capsule ${[...path, "--help"].join(" ")} for usage.`;
  return suggestion ? `Did you mean ${suggestion}? ${help}` : help;
}

const shortNames = new Set(Object.values(allOptionSpecs).flatMap((spec) => (spec.short ? [spec.short] : [])));

function isOptionName(value: string): boolean {
  const long = /^--([^=]+)/.exec(value);
  if (long) return Object.hasOwn(allOptionSpecs, long[1]!);
  const short = /^-([^-])$/.exec(value);
  return short !== null && shortNames.has(short[1]!);
}

/** Strict parse: throws a usage error (exit 2) before any work for anything the command does not read. */
export function parseCommandLine(argv: string[]): ParsedLine {
  const parsed: ParsedLine = { rest: [], positionals: [], passthrough: [] };
  const target = parsed as unknown as Record<string, unknown>;
  const { tokens } = parseArgs({ args: argv, options: parseOptions, strict: false, allowPositionals: true, tokens: true });
  const unknown: string[] = [];
  const seen: string[] = [];
  let terminated = false;
  for (const token of tokens) {
    if (token.kind === "option-terminator") {
      terminated = true;
      continue;
    }
    if (token.kind === "positional") {
      if (terminated) parsed.passthrough.push(token.value);
      else if (parsed.command === undefined) parsed.command = token.value;
      else parsed.positionals.push(token.value);
      continue;
    }
    const spec = allOptionSpecs[token.name];
    if (!spec) {
      unknown.push(token.rawName);
      continue;
    }
    seen.push(token.name);
    if (spec.kind === "boolean") {
      if (token.value !== undefined) throw usageError(`${token.rawName} does not take a value.`, "invalid_arguments");
      target[spec.field] = true;
      continue;
    }
    if (token.value === undefined) {
      throw usageError(`${token.rawName} needs a value${spec.hint ? ` ${spec.hint}` : ""}.`, "missing_value");
    }
    // `--image --json` would otherwise read --json as the image. A separate value that names a known option
    // is a missing value; a value that really starts with a dash can be attached with =.
    if (!token.inlineValue && isOptionName(token.value)) {
      throw usageError(`${token.rawName} needs a value${spec.hint ? ` ${spec.hint}` : ""}, but got the option ${token.value}.`, "missing_value", {
        hint: `If the value starts with a dash, write ${token.rawName}=${token.value}.`
      });
    }
    if (spec.kind === "array") {
      const values = (target[spec.field] as string[] | undefined) ?? [];
      values.push(token.value);
      target[spec.field] = values;
    } else if (spec.kind === "number") {
      const port = Number(token.value);
      if (!Number.isInteger(port) || port < 1 || port > 65_535) throw usageError(`${token.rawName} must be a port number from 1 to 65535.`);
      target[spec.field] = port;
    } else {
      target[spec.field] = token.value;
    }
  }
  parsed.rest = [...parsed.positionals, ...parsed.passthrough];
  // Help and version skip all other validation, so they work when the rest of the line is wrong.
  if (parsed.help || parsed.version) return parsed;
  if (parsed.command === undefined) {
    // Bare `capsule` (or only global flags) shows the root help; a typo or a command option must not.
    if (unknown.length > 0) {
      const name = unknown[0]!;
      const hint = suggest(name.replace(/^-+/, ""), Object.keys(globalOptionSpecs));
      throw usageError(`Unknown option ${name}.`, "unknown_option", { hint: helpHint([], hint ? `--${hint}` : undefined), data: { options: unknown } });
    }
    const commandOption = seen.find((name) => !globalOptionSpecs[name]);
    if (commandOption) {
      throw usageError(`--${commandOption} needs a command, for example capsule run --${commandOption} ...`, "invalid_arguments", { hint: helpHint([]) });
    }
    return parsed;
  }

  const command = commandSpecs[parsed.command];
  if (!command) {
    throw usageError(`Unknown command "${parsed.command}".`, "unknown_command", {
      hint: helpHint([], suggest(parsed.command, Object.keys(commandSpecs)))
    });
  }
  const path = [parsed.command];
  if (unknown.length > 0) {
    const name = unknown[0]!;
    const hint = suggest(name.replace(/^-+/, ""), [...command.options, ...Object.keys(globalOptionSpecs)]);
    throw usageError(`Unknown option ${name} for capsule ${parsed.command}.`, "unknown_option", {
      hint: helpHint(path, hint ? `--${hint}` : undefined),
      data: { options: unknown }
    });
  }
  const notHere = seen.find((name) => !command.options.includes(name) && !globalOptionSpecs[name]);
  if (notHere) {
    throw usageError(`capsule ${parsed.command} does not take --${notHere}.`, "unknown_option", { hint: helpHint(path) });
  }
  let args = command.args ?? [];
  let positionals = parsed.positionals;
  if (command.actions) {
    const action = positionals[0];
    if (action !== undefined && command.actions[action]) {
      args = command.actions[action].args ?? [];
      positionals = positionals.slice(1);
      path.push(action);
    } else if (action !== undefined) {
      throw usageError(`Unknown action "${action}" for capsule ${parsed.command}.`, "unknown_command", {
        hint: helpHint(path, suggest(action, Object.keys(command.actions)))
      });
    } else if (!command.defaultAction) {
      parsed.help = true;
      return parsed;
    } else {
      path.push(command.defaultAction);
    }
  }
  if (positionals.length > args.length) {
    const extra = positionals[args.length]!;
    const where = command.passthrough ? " Put the command to run after --." : "";
    throw usageError(`Unexpected argument "${extra}" for capsule ${path.join(" ")}.${where}`, "invalid_arguments", { hint: helpHint(path) });
  }
  const action = path[1];
  const takesCommand = command.passthrough && (action === undefined || action === "run");
  if (parsed.passthrough.length > 0 && !takesCommand) {
    throw usageError(`capsule ${path.join(" ")} does not take a command after --.`, "invalid_arguments", { hint: helpHint(path) });
  }
  return parsed;
}

function column(rows: Array<[string, string]>): string[] {
  const width = Math.max(...rows.map(([left]) => left.length)) + 3;
  return rows.map(([left, right]) => `  ${left.padEnd(width)}${right}`);
}

function optionLabel(name: string, spec: OptionSpec): string {
  return `${spec.short ? `-${spec.short}, ` : ""}--${name}${spec.hint ? ` ${spec.hint}` : ""}`;
}

/** Help text for the root or one command. Goes to stdout, exits 0, never does work. */
export function helpText(commandName?: string): string {
  const command = commandName ? commandSpecs[commandName] : undefined;
  const globals = column(Object.entries(globalOptionSpecs).map(([name, spec]) => [optionLabel(name, spec), spec.summary]));
  if (!command) {
    return [
      "Capsule runs work on one runtime at a time, checks policy before each provider call, and records a receipt.",
      "",
      "Usage",
      "  capsule <command> [options]",
      "",
      "Commands",
      ...column(Object.entries(commandSpecs).map(([name, spec]) => [name, spec.summary])),
      "",
      "Global options",
      ...globals,
      "",
      "Examples",
      ...["run --image node:22 -- node -e \"console.log('hello')\"", "capabilities --adapter e2b", "doctor"].map((line) => `  capsule ${line}`),
      "",
      "Learn more",
      `  ${docsUrl}`
    ].join("\n");
  }
  const lines = ["Usage", ...command.usage.map((line) => `  capsule ${line}`), "", command.summary + "."];
  if (command.actions) {
    lines.push("", "Actions", ...column(Object.entries(command.actions).map(([name, spec]) => [name, spec.summary])));
  }
  if (command.options.length > 0) {
    const options = [...command.options].sort().map((name): [string, string] => [optionLabel(name, optionSpecs[name]!), optionSpecs[name]!.summary]);
    lines.push("", "Options", ...column(options));
  }
  lines.push("", "Global options", ...globals, "", "Examples", ...command.examples.map((line) => `  capsule ${line}`), "", "Learn more", `  ${docsUrl}`);
  return lines.join("\n");
}
