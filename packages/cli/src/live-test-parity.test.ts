// CI-04: the live-test plan is declared in three places (the CLI `live-test plan`/`validate`
// commands, scripts/live-test-matrix.mjs used by the workflow, and @capsule-sdk/test-utils gates
// used by the live suites) plus the workflow's secret mapping. These checks fail on drift between
// them without touching a provider: they read source files and plan objects only.
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { describe, expect, test } from "vitest";
import { liveTestCommandPlan } from "./index.js";

const root = join(import.meta.dirname, "..", "..", "..");

interface ScriptPlan {
  provider: string;
  testPath: string;
  requiredEnv: string[];
  optionalEnv: string[];
  aliases?: Record<string, string[]>;
  costRisk: string;
  costAcknowledgementEnv?: string;
  command: string;
  notes: string[];
}

interface ScriptMatrixModule {
  liveTestMatrixPlans: ScriptPlan[];
  createLiveTestMatrix(options: { env: Record<string, string>; provider?: string }): { providers: Array<{ provider: string; command: string }> };
}

interface TestUtilsModule {
  liveProviderCostRisk: Record<string, string>;
  liveProviderCredentials: Record<string, readonly string[]>;
}

// @capsule-sdk/test-utils is not a CLI dependency; load it through the workspace alias at test time only.
const testUtilsSpecifier = "@capsule-sdk/test-utils";
const { liveProviderCostRisk, liveProviderCredentials } = (await import(testUtilsSpecifier)) as TestUtilsModule;

async function scriptMatrix(): Promise<ScriptMatrixModule> {
  return (await import(pathToFileURL(join(root, "scripts", "live-test-matrix.mjs")).href)) as ScriptMatrixModule;
}

/** Every env var a live suite's gates require, read from the suite source. */
function gateCredentialSets(testPath: string): string[][] {
  const source = readFileSync(join(root, testPath), "utf8");
  const sets: string[][] = [];
  for (const match of source.matchAll(/credentials:\s*\[([^\]]*)\]/g)) {
    sets.push([...match[1]!.matchAll(/"([A-Z0-9_]+)"/g)].map((name) => name[1]!));
  }
  for (const match of source.matchAll(/providerLiveTestGate\("([a-z0-9-]+)"/g)) {
    sets.push([...(liveProviderCredentials[match[1]!] ?? [])]);
  }
  return sets;
}

describe("CI-04 live-test metadata parity", () => {
  test("CLI plans and the workflow matrix script declare the same providers, suites, env, cost and commands", async () => {
    const { liveTestMatrixPlans, createLiveTestMatrix } = await scriptMatrix();
    const cliPlans = liveTestCommandPlan();
    expect(cliPlans.map((plan) => plan.provider)).toEqual(liveTestMatrixPlans.map((plan) => plan.provider));

    const matrix = createLiveTestMatrix({ env: {} });
    for (const cliPlan of cliPlans) {
      const scriptPlan = liveTestMatrixPlans.find((plan) => plan.provider === cliPlan.provider)!;
      expect({ provider: cliPlan.provider, testPath: cliPlan.testPath }).toEqual({ provider: scriptPlan.provider, testPath: scriptPlan.testPath });
      expect(cliPlan.requiredEnv).toEqual(scriptPlan.requiredEnv);
      expect(cliPlan.optionalEnv).toEqual(scriptPlan.optionalEnv);
      expect(cliPlan.aliases ?? {}).toEqual(scriptPlan.aliases ?? {});
      expect(cliPlan.costRisk).toBe(scriptPlan.costRisk);
      expect(cliPlan.costAcknowledgementEnv).toBe(scriptPlan.costAcknowledgementEnv);
      expect(cliPlan.notes).toEqual(scriptPlan.notes);
      expect(cliPlan.safeCommands).toEqual([matrix.providers.find((entry) => entry.provider === cliPlan.provider)!.command]);
    }
  });

  test("each planned suite exists, its cost risk matches the shared gate, and every gated env var is declared", async () => {
    const { liveTestMatrixPlans } = await scriptMatrix();
    for (const plan of liveTestMatrixPlans) {
      expect(existsSync(join(root, plan.testPath)), plan.testPath).toBe(true);
      expect(liveProviderCostRisk[plan.provider], plan.provider).toBe(plan.costRisk);

      const declared = new Set([...plan.requiredEnv, ...plan.optionalEnv]);
      const sets = gateCredentialSets(plan.testPath);
      expect(sets.length, `${plan.testPath} has no recognizable live gate`).toBeGreaterThan(0);
      for (const name of sets.flat()) {
        expect(declared.has(name), `${plan.provider}: ${plan.testPath} gates on ${name}, which the plan does not declare`).toBe(true);
      }
      // The plan's required env must be enough to enable at least one test in the suite.
      const required = new Set(plan.requiredEnv);
      expect(
        sets.some((set) => set.every((name) => required.has(name))),
        `${plan.provider}: no gate is satisfiable from requiredEnv alone`
      ).toBe(true);
    }
  });

  test("the live workflow offers every planned provider, maps every required env var and runs the planned suite", async () => {
    const { liveTestMatrixPlans } = await scriptMatrix();
    const workflow = readFileSync(join(root, ".github", "workflows", "live-tests.yml"), "utf8");
    const described = /Provider id \(([^)]*)\)/
      .exec(workflow)?.[1]
      ?.split(",")
      .map((name) => name.trim());
    expect(described).toEqual(liveTestMatrixPlans.map((plan) => plan.provider));

    const mapped = new Set([...workflow.matchAll(/^ {6}([A-Z0-9_]+):/gm)].map((match) => match[1]!));
    // Required env must be mapped. Gated variables the workflow leaves unmapped are optional opt-in
    // switches (declared in optionalEnv, checked above), so the dispatched run never enables them.
    for (const plan of liveTestMatrixPlans) {
      for (const name of plan.requiredEnv) {
        expect(mapped.has(name), `${plan.provider}: workflow does not map required ${name}`).toBe(true);
      }
    }
    expect(workflow).toContain('node scripts/live-test-evidence.mjs --print-test-path --provider "$PROVIDER"');
    expect(workflow).toContain('node scripts/live-test-evidence.mjs --provider "$PROVIDER" --report');
  });
});
