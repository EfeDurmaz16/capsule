import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { providerHttpScenarioOperations, type EmulationProvider } from "./emulate-catalog.js";

async function executeScenario(provider: EmulationProvider) {
  switch (provider) {
    case "ec2":
    case "ecs":
    case "lambda":
      return (await import("./emulate-http-aws.js")).runAwsProviderHttp(provider);
    case "daytona":
    case "docker":
    case "e2b":
    case "modal":
      return (await import("./emulate-http-cloudbox.js")).runCloudboxProviderHttp(provider);
    case "azure-container-apps":
    case "cloud-run":
    case "gce":
    case "kubernetes":
      return (await import("./emulate-http-platform.js")).runPlatformProviderHttp(provider);
    case "cloudflare":
    case "fly":
    case "neon":
    case "vercel":
      return (await import("./emulate-http-hosted.js")).runHostedProviderHttp(provider);
  }
}

export async function runProviderHttpScenario(provider: EmulationProvider) {
  const result = await executeScenario(provider);
  assert.deepEqual(result.operations, providerHttpScenarioOperations[provider], `Unexpected HTTP receipt sequence for ${provider}.`);
  return result;
}

const childScript = `
try {
  const { runProviderHttpScenario } = await import(process.argv[1]);
  const result = await runProviderHttpScenario(process.argv[2]);
  process.stdout.write(JSON.stringify(result), () => process.exit(0));
} catch (error) {
  process.stderr.write(error instanceof Error ? error.message : String(error), () => process.exit(1));
}
`;

/** Keep SDK defaults away from the caller's credentials, dotenv files and proxy configuration. */
export async function runIsolatedProviderHttp(provider: EmulationProvider): Promise<Awaited<ReturnType<typeof runProviderHttpScenario>>> {
  const workspace = await mkdtemp(join(tmpdir(), "capsule-emulate-http-"));
  try {
    const source = import.meta.url.endsWith(".ts");
    const loader = source ? ["--import", createRequire(import.meta.url).resolve("tsx")] : [];
    const { stdout } = await promisify(execFile)(
      process.execPath,
      [...loader, "--disable-warning=DEP0205", "--input-type=module", "--eval", childScript, import.meta.url, provider],
      {
        cwd: workspace,
        timeout: 60_000,
        maxBuffer: 4 * 1024 * 1024,
        encoding: "utf8",
        env: {
          PATH: process.env.PATH,
          SystemRoot: process.env.SystemRoot,
          HOME: workspace,
          USERPROFILE: workspace,
          TMPDIR: workspace,
          TMP: workspace,
          TEMP: workspace,
          XDG_CONFIG_HOME: workspace,
          AWS_EC2_METADATA_DISABLED: "true",
          CAPSULE_EMULATE_PROVIDER: provider,
          DO_NOT_TRACK: "1",
          OTEL_SDK_DISABLED: "true",
          TSX_TSCONFIG_PATH: source ? fileURLToPath(new URL("../../../tsconfig.typecheck.json", import.meta.url)) : undefined
        }
      }
    ).catch((error: unknown) => {
      if (error instanceof Error && "stderr" in error && typeof error.stderr === "string" && error.stderr.trim()) throw new Error(error.stderr.trim());
      throw error;
    });
    return JSON.parse(stdout) as Awaited<ReturnType<typeof runProviderHttpScenario>>;
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
}
