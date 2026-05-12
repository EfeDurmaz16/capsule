#!/usr/bin/env node
import { Capsule } from "@capsule/core";
import { docker, dockerAvailable } from "@capsule/adapter-docker";

interface ParsedArgs {
  command?: string;
  image?: string;
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
  capsule run --image node:22 -- node -e "console.log('hello')"
  capsule sandbox --image node:22
`);
}

async function main(argv: string[]): Promise<void> {
  const parsed = parse(argv);
  const capsule = new Capsule({ adapter: docker(), receipts: true });

  switch (parsed.command) {
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
