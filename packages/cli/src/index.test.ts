import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test, vi } from "vitest";
import {
  classifyProvider,
  compareProviderCapabilities,
  capabilityExplanations,
  createAdapterScaffoldPlan,
  createDoctorReport,
  createLiveEnvironmentValidationReport,
  createProviderVerificationReport,
  liveTestCommandPlan,
  main,
  parse,
  selectProvidersForRecipe,
  writeAdapterScaffold,
  providerCredentialDiagnostics
} from "./index.js";

describe("CLI doctor credential diagnostics", () => {
  test("reports configured and missing providers without secret values", () => {
    const diagnostics = providerCredentialDiagnostics({
      E2B_API_KEY: "secret-e2b",
      AZURE_ACCESS_TOKEN: "secret-azure",
      AZURE_SUBSCRIPTION_ID: "sub-1",
      AZURE_RESOURCE_GROUP: "rg-1"
    });

    expect(diagnostics.find((item) => item.provider === "e2b")).toMatchObject({
      provider: "e2b",
      status: "configured",
      configuredEnv: ["E2B_API_KEY"],
      missingEnv: []
    });
    expect(diagnostics.find((item) => item.provider === "azure-container-apps")).toMatchObject({
      provider: "azure-container-apps",
      status: "missing",
      configuredEnv: ["AZURE_ACCESS_TOKEN", "AZURE_SUBSCRIPTION_ID", "AZURE_RESOURCE_GROUP"],
      missingEnv: ["AZURE_LOCATION", "AZURE_CONTAINERAPPS_ENVIRONMENT_ID"]
    });
    expect(JSON.stringify(diagnostics)).not.toContain("secret-e2b");
    expect(JSON.stringify(diagnostics)).not.toContain("secret-azure");
  });

  test("filters AWS-backed adapters to the shared AWS credential diagnostic", () => {
    expect(providerCredentialDiagnostics({ AWS_PROFILE: "dev" }, "ecs")).toEqual([
      expect.objectContaining({
        provider: "aws",
        status: "configured",
        configuredEnv: ["AWS_PROFILE"]
      })
    ]);
  });

  test("recognizes project-scoped env aliases without exposing values", () => {
    const diagnostics = providerCredentialDiagnostics(
      {
        CAPSULE_WORKER_API_TOKEN: "secret-cloudflare-token",
        CAPSULE_WORKER_ACCOUNT_ID: "secret-cloudflare-account",
        CAPSULE_POSTGRES_PROJECT_ID: "secret-neon-project"
      },
      "cloudflare"
    );

    expect(diagnostics).toEqual([
      expect.objectContaining({
        provider: "cloudflare",
        status: "configured",
        configuredEnv: ["CAPSULE_WORKER_API_TOKEN", "CAPSULE_WORKER_ACCOUNT_ID"],
        missingEnv: [],
        requiredEnv: [
          "CLOUDFLARE_API_TOKEN",
          "CAPSULE_WORKER_API_TOKEN",
          "CLOUDFLARE_WORKERS_FREE_API_TOKEN",
          "CLOUDFLARE_ACCOUNT_ID",
          "CAPSULE_WORKER_ACCOUNT_ID",
          "CLOUDFLARE_WORKERS_FREE_ACCOUNT_ID"
        ]
      })
    ]);
    expect(JSON.stringify(diagnostics)).not.toContain("secret-cloudflare-token");
    expect(JSON.stringify(diagnostics)).not.toContain("secret-cloudflare-account");
  });

  test("creates the doctor output shape", async () => {
    await expect(createDoctorReport({ env: { NEON_API_KEY: "secret-neon" }, adapter: "neon", dockerCheck: async () => false })).resolves.toMatchObject({
      docker: "unavailable",
      providers: [
        expect.objectContaining({
          provider: "neon",
          status: "configured",
          configuredEnv: ["NEON_API_KEY"]
        })
      ]
    });
  });

  test("reports runtime, workspace, package versions, and release audit availability", async () => {
    const report = await createDoctorReport({ env: {}, dockerCheck: async () => true });

    expect(report.node).toMatchObject({
      version: process.version,
      requirement: ">=20.11",
      supported: true
    });
    expect(report.workspace).toMatchObject({
      status: "ok",
      packageManager: "pnpm@10.32.1",
      missingFiles: []
    });
    expect(report.packages.find((pkg) => pkg.name === "@capsule/core")).toMatchObject({
      name: "@capsule/core",
      version: "0.1.1",
      private: false
    });
    expect(report.packages.find((pkg) => pkg.name === "@capsule/test-utils")).toMatchObject({
      name: "@capsule/test-utils",
      version: "0.1.0",
      private: true
    });
    expect(report.releaseAudit).toMatchObject({
      status: "available",
      command: "pnpm release:audit",
      missingScripts: []
    });
    expect(report.releaseAudit.scripts).toEqual(
      expect.arrayContaining(["release:audit", "release:metadata-audit", "release:dependency-audit", "release:markers", "release:pack-smoke"])
    );
  });
});

describe("CLI capability explanations", () => {
  test("classifies provider services by Capsule domain", async () => {
    expect(parse(["classify", "provider", "cloudflare", "workers"])).toMatchObject({
      command: "classify",
      rest: ["provider", "cloudflare", "workers"]
    });
    expect(classifyProvider("fly", "mpg")).toMatchObject({
      classification: {
        domains: ["database", "resource"],
        notCapabilities: expect.arrayContaining(["machine.create"])
      }
    });

    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
    try {
      await main(["classify", "provider", "neon", "postgres"]);
      const output = JSON.parse(String(log.mock.calls[0]?.[0])) as ReturnType<typeof classifyProvider>;
      expect(output.classification?.domains).toEqual(["database", "resource"]);
    } finally {
      log.mockRestore();
    }
  });

  test("creates an adapter scaffold plan without claiming provider support", async () => {
    const plan = createAdapterScaffoldPlan({ provider: "acme-cloud", domains: ["sandbox", "job"], outDir: "tmp-packages" });

    expect(plan).toMatchObject({
      provider: "acme-cloud",
      packageName: "@capsule/adapter-acme-cloud",
      factoryName: "acmeCloud",
      packageDir: join("tmp-packages", "adapter-acme-cloud"),
      domains: ["sandbox", "job"]
    });
    expect(plan.files.map((file) => file.path)).toEqual([
      join("tmp-packages", "adapter-acme-cloud", "package.json"),
      join("tmp-packages", "adapter-acme-cloud", "tsconfig.json"),
      join("tmp-packages", "adapter-acme-cloud", "src/index.ts"),
      join("tmp-packages", "adapter-acme-cloud", "src/acme-cloud-adapter.ts"),
      join("tmp-packages", "adapter-acme-cloud", "src/acme-cloud.test.ts")
    ]);
    expect(plan.files.find((file) => file.path.endsWith("acme-cloud-adapter.ts"))?.content).toContain('create: "unsupported"');
    expect(plan.files.find((file) => file.path.endsWith("acme-cloud-adapter.ts"))?.content).toContain('run: "unsupported"');
  });

  test("writes adapter scaffold files and refuses overwrites without force", async () => {
    const root = await mkdtemp(join(tmpdir(), "capsule-scaffold-"));
    try {
      const plan = createAdapterScaffoldPlan({ provider: "sample", domains: ["edge"], outDir: root });
      await writeAdapterScaffold(plan);

      await expect(readFile(join(root, "adapter-sample", "src/sample-adapter.ts"), "utf8")).resolves.toContain('deploy: "unsupported"');
      await expect(writeAdapterScaffold(plan)).rejects.toThrow("Refusing to overwrite");
      await expect(writeAdapterScaffold(plan, { force: true })).resolves.toBe(plan);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("parses provider selection recipes", () => {
    expect(parse(["select", "provider", "--recipe", "sandbox"])).toMatchObject({
      command: "select",
      recipe: "sandbox",
      rest: ["provider"]
    });
  });

  test("ranks comparable providers for a built-in recipe", () => {
    const report = selectProvidersForRecipe("service-api");

    expect(report.recipe.id).toBe("service-api");
    expect(report.results[0]).toMatchObject({
      provider: expect.stringMatching(/cloud-run|kubernetes|azure-container-apps/),
      requiredSatisfied: expect.any(Number),
      requiredTotal: expect.any(Number)
    });
    expect(report.results.find((entry) => entry.provider === "e2b")?.missingRequired.map((entry) => entry.path)).toContain("service.deploy");
  });

  test("prints provider selection from the select provider command", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
    try {
      await main(["select", "provider", "--recipe", "sandbox"]);
      const output = JSON.parse(String(log.mock.calls[0]?.[0])) as ReturnType<typeof selectProvidersForRecipe>;

      expect(output.recipe.id).toBe("sandbox");
      expect(output.results[0]?.provider).toBe("docker");
      expect(output.results[0]?.missingRequired).toEqual([]);
    } finally {
      log.mockRestore();
    }
  });

  test("parses provider comparison adapters", () => {
    expect(parse(["compare", "providers", "--left", "docker", "--right", "e2b"])).toMatchObject({
      command: "compare",
      leftAdapter: "docker",
      rightAdapter: "e2b",
      rest: ["providers"]
    });
  });

  test("compares provider capabilities with diff and compatibility scores", () => {
    const report = compareProviderCapabilities("docker", "e2b");

    expect(report.left.provider).toBe("docker");
    expect(report.right.provider).toBe("e2b");
    expect(report.diff).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          path: "sandbox.exposePort",
          left: "native",
          right: "experimental"
        })
      ])
    );
    expect(report.left.compatibility.score).toBeGreaterThanOrEqual(0);
    expect(report.left.compatibility.score).toBeGreaterThan(report.right.compatibility.score);
  });

  test("prints provider comparison from the compare providers command", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
    let output: { left: { provider: string }; right: { provider: string }; diff: Array<{ path: string }> };
    try {
      await main(["compare", "providers", "--left", "docker", "--right", "e2b"]);
      output = JSON.parse(String(log.mock.calls[0]?.[0])) as typeof output;
    } finally {
      log.mockRestore();
    }

    expect(output).toMatchObject({
      left: { provider: "docker" },
      right: { provider: "e2b" }
    });
    expect(output.diff).toEqual(expect.arrayContaining([expect.objectContaining({ path: "sandbox.exposePort" })]));
  });

  test("rejects unknown provider comparison names", () => {
    expect(() => compareProviderCapabilities("dockre", "e2b")).toThrow('Unknown provider "dockre"');
  });

  test("compares ECS capabilities without requiring deployment options", () => {
    expect(() => compareProviderCapabilities("ecs", "e2b")).not.toThrow();
  });

  test("prints remediation hints for unsupported CLI capabilities", async () => {
    await expect(main(["job", "run", "--adapter", "neon", "--image", "node:22"])).rejects.toThrow(
      'neon does not support job.run. Choose another adapter, change the workflow requirements, or use a provider-specific escape hatch for job.run. Run "capsule capabilities --adapter neon --explain" to inspect supported operations.'
    );
  });

  test("parses the explain flag", () => {
    expect(parse(["capabilities", "--adapter", "neon", "--explain"])).toMatchObject({
      command: "capabilities",
      adapter: "neon",
      explain: true
    });
  });

  test("parses the capabilities json flag", () => {
    expect(parse(["capabilities", "--adapter", "docker", "--json"])).toMatchObject({
      command: "capabilities",
      adapter: "docker",
      json: true
    });
  });

  test("prints capabilities as a table by default", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
    let output = "";
    try {
      await main(["capabilities", "--adapter", "docker"]);
      output = String(log.mock.calls[0]?.[0]);
    } finally {
      log.mockRestore();
    }

    expect(output).toContain("Adapter: docker");
    expect(output).toContain("Capability");
    expect(output).toContain("Level");
    expect(output).toContain("Supported");
    expect(output).toContain("sandbox.networkPolicy");
    expect(output).toContain("experimental");
    expect(output).toContain("service.deploy");
    expect(output).toContain("unsupported");
    expect(() => JSON.parse(output)).toThrow();
  });

  test("prints capabilities as stable json for automation", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
    let output: {
      adapter: string;
      entries: Array<{ path: string; level: string; supported: boolean; guidance: string }>;
    };
    try {
      await main(["capabilities", "--adapter", "docker", "--json"]);
      output = JSON.parse(String(log.mock.calls[0]?.[0])) as typeof output;
    } finally {
      log.mockRestore();
    }

    expect(output.adapter).toBe("docker");
    expect(output.entries).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ path: "sandbox.networkPolicy", level: "experimental", supported: true }),
        expect.objectContaining({ path: "service.deploy", level: "unsupported", supported: false })
      ])
    );
  });

  test("prints capability guidance in explain table mode", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
    let output = "";
    try {
      await main(["capabilities", "--adapter", "docker", "--explain"]);
      output = String(log.mock.calls[0]?.[0]);
    } finally {
      log.mockRestore();
    }

    expect(output).toContain("Guidance");
    expect(output).toContain("sandbox.networkPolicy should be gated behind explicit opt-in");
  });

  test("formats capabilities as support-level explanations", () => {
    expect(
      capabilityExplanations({
        sandbox: {
          create: "native",
          exec: "native",
          fileRead: "native",
          fileWrite: "native",
          fileList: "native",
          destroy: "native",
          snapshot: "experimental"
        }
      })
    ).toContainEqual({
      path: "sandbox.snapshot",
      level: "experimental",
      supported: true,
      summary: "The adapter/provider exposes this capability, but behavior may still change or be incomplete.",
      guidance: "sandbox.snapshot should be gated behind explicit opt-in, tests, or provider-specific checks."
    });
  });
});

describe("CLI policy explain", () => {
  test("parses policy explain file inputs", () => {
    expect(parse(["policy", "explain", "--capability", "job.run", "--policy-file", "policy.json", "--spec-file", "spec.json"])).toMatchObject({
      command: "policy",
      rest: ["explain"],
      capability: "job.run",
      policyFile: "policy.json",
      specFile: "spec.json"
    });
  });

  test("prints denied policy explanation without executing a provider action", async () => {
    const root = await mkdtemp(join(tmpdir(), "capsule-policy-explain-"));
    const policyFile = join(root, "policy.json");
    const specFile = join(root, "spec.json");
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
    try {
      await writeFile(policyFile, JSON.stringify({ approvals: { required: true, reason: "production cleanup" } }), "utf8");
      await writeFile(specFile, JSON.stringify({ env: { TOKEN: "secret-token" }, resource: { type: "job", name: "nightly" } }), "utf8");

      await main(["policy", "explain", "--adapter", "docker", "--capability", "job.run", "--policy-file", policyFile, "--spec-file", specFile]);
      const output = JSON.parse(String(log.mock.calls[0]?.[0])) as {
        adapter: string;
        capabilityPath: string;
        supportLevel: string;
        policy: { decision: string; reason?: string; violations: string[]; input: { envKeys?: string[] } };
      };

      expect(output).toMatchObject({
        adapter: "docker",
        capabilityPath: "job.run",
        supportLevel: "native",
        policy: {
          decision: "denied",
          reason: "Approval required by policy: production cleanup",
          input: { envKeys: ["TOKEN"] },
          violations: ["production cleanup"]
        }
      });
      expect(JSON.stringify(output)).not.toContain("secret-token");
    } finally {
      log.mockRestore();
      await rm(root, { recursive: true, force: true });
    }
  });

  test("explains policy for unsupported adapter capabilities without executing them", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
    try {
      await main(["policy", "explain", "--adapter", "neon", "--capability", "job.run"]);
      const output = JSON.parse(String(log.mock.calls[0]?.[0])) as {
        supportLevel: string;
        policy: { decision: string; notes: string[] };
      };

      expect(output.supportLevel).toBe("unsupported");
      expect(output.policy).toMatchObject({
        decision: "allowed",
        notes: ["Adapter support level for job.run: unsupported."]
      });
    } finally {
      log.mockRestore();
    }
  });
});

describe("CLI live-test planner", () => {
  test("parses the live-test provider flag", () => {
    expect(parse(["live-test", "plan", "--provider", "neon"])).toMatchObject({
      command: "live-test",
      provider: "neon",
      rest: ["plan"]
    });
    expect(parse(["live-test", "validate", "--provider", "fly"])).toMatchObject({
      command: "live-test",
      provider: "fly",
      rest: ["validate"]
    });
  });

  test("returns a safe Neon plan with project-scoped aliases and no secret values", () => {
    const plan = liveTestCommandPlan("neon");

    expect(plan).toEqual([
      expect.objectContaining({
        provider: "neon",
        testPath: "packages/adapter-neon/src/neon.live.test.ts",
        requiredEnv: ["CAPSULE_LIVE_TESTS", "NEON_API_KEY", "NEON_PROJECT_ID"],
        aliases: { NEON_PROJECT_ID: ["CAPSULE_POSTGRES_PROJECT_ID"] },
        safeCommands: [
          'CAPSULE_LIVE_TEST_COST_ACK=1 CAPSULE_LIVE_TEST_MAX_RESOURCES=1 NEON_PROJECT_ID="${NEON_PROJECT_ID:-$CAPSULE_POSTGRES_PROJECT_ID}" CAPSULE_LIVE_TESTS=1 pnpm vitest run packages/adapter-neon/src/neon.live.test.ts'
        ]
      })
    ]);
    expect(JSON.stringify(plan)).not.toContain("secret");
    expect(JSON.stringify(plan)).not.toContain("sk_");
  });

  test("returns a safe Cloudflare plan with project-scoped aliases", () => {
    const plan = liveTestCommandPlan("cloudflare")[0];

    expect(plan).toMatchObject({
      provider: "cloudflare",
      requiredEnv: ["CAPSULE_LIVE_TESTS", "CLOUDFLARE_API_TOKEN", "CLOUDFLARE_ACCOUNT_ID", "CAPSULE_CLOUDFLARE_WORKER_NAME", "CAPSULE_CLOUDFLARE_LIVE_CREATE_VERSION"],
      aliases: {
        CLOUDFLARE_API_TOKEN: ["CAPSULE_WORKER_API_TOKEN", "CLOUDFLARE_WORKERS_FREE_API_TOKEN"],
        CLOUDFLARE_ACCOUNT_ID: ["CAPSULE_WORKER_ACCOUNT_ID", "CLOUDFLARE_WORKERS_FREE_ACCOUNT_ID"]
      }
    });
    expect(plan.safeCommands[0]).toContain('CLOUDFLARE_API_TOKEN="${CLOUDFLARE_API_TOKEN:-$CAPSULE_WORKER_API_TOKEN}"');
    expect(plan.safeCommands[0]).toContain("pnpm vitest run packages/adapter-cloudflare/src/cloudflare.live.test.ts");
  });

  test("prints the selected live-test plan", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
    try {
      await main(["live-test", "plan", "--provider", "vercel"]);
      const output = JSON.parse(String(log.mock.calls[0]?.[0])) as Array<{ provider: string; requiredEnv: string[]; safeCommands: string[] }>;
      expect(output).toEqual([
        expect.objectContaining({
          provider: "vercel",
          requiredEnv: ["CAPSULE_LIVE_TESTS", "VERCEL_TOKEN", "CAPSULE_VERCEL_DEPLOYMENT_ID"],
          safeCommands: ["CAPSULE_LIVE_TESTS=1 pnpm vitest run packages/adapter-vercel/src/vercel.live.test.ts"]
        })
      ]);
    } finally {
      log.mockRestore();
    }
  });

  test("rejects unknown live-test providers", () => {
    expect(() => liveTestCommandPlan("unknown")).toThrow('Unknown live-test provider "unknown"');
  });

  test("validates live-test env and blocks billable providers without cost acknowledgement", () => {
    const report = createLiveEnvironmentValidationReport({
      provider: "fly",
      env: {
        CAPSULE_LIVE_TESTS: "1",
        FLY_API_TOKEN: "secret-token",
        FLY_APP_NAME: "capsule-app",
        CAPSULE_FLY_IMAGE: "registry.example/app:latest"
      }
    });

    expect(report.providers).toEqual([
      expect.objectContaining({
        provider: "fly",
        status: "blocked",
        liveTestEnabled: true,
        costRisk: "billable",
        configuredEnv: ["CAPSULE_LIVE_TESTS", "FLY_API_TOKEN", "FLY_APP_NAME", "CAPSULE_FLY_IMAGE"],
        missingEnv: [],
        missingCostEnv: ["CAPSULE_LIVE_TEST_COST_ACK"],
        missingResourceLimitEnv: ["CAPSULE_LIVE_TEST_MAX_RESOURCES"]
      })
    ]);
    expect(JSON.stringify(report)).not.toContain("secret-token");
  });

  test("validates billable live-test max resource count", () => {
    const report = createLiveEnvironmentValidationReport({
      provider: "fly",
      env: {
        CAPSULE_LIVE_TESTS: "1",
        FLY_API_TOKEN: "secret-token",
        FLY_APP_NAME: "capsule-app",
        CAPSULE_FLY_IMAGE: "registry.example/app:latest",
        CAPSULE_LIVE_TEST_COST_ACK: "1",
        CAPSULE_LIVE_TEST_MAX_RESOURCES: "0"
      }
    });

    expect(report.providers).toEqual([
      expect.objectContaining({
        provider: "fly",
        status: "blocked",
        costAcknowledged: true,
        resourceLimit: {
          env: "CAPSULE_LIVE_TEST_MAX_RESOURCES",
          required: 1,
          configured: 0,
          satisfied: false
        },
        missingCostEnv: [],
        missingResourceLimitEnv: ["CAPSULE_LIVE_TEST_MAX_RESOURCES"]
      })
    ]);
  });

  test("validates read-only live tests without cost acknowledgement", () => {
    const report = createLiveEnvironmentValidationReport({
      provider: "vercel",
      env: {
        CAPSULE_LIVE_TESTS: "1",
        VERCEL_TOKEN: "secret-vercel",
        CAPSULE_VERCEL_DEPLOYMENT_ID: "dpl_123"
      }
    });

    expect(report.providers).toEqual([
      expect.objectContaining({
        provider: "vercel",
        status: "ready",
        costRisk: "read-only",
        costAcknowledged: true,
        missingEnv: [],
        missingCostEnv: []
      })
    ]);
    expect(JSON.stringify(report)).not.toContain("secret-vercel");
  });

  test("blocks CI live-test validation without explicit opt-in", () => {
    const blocked = createLiveEnvironmentValidationReport({
      provider: "vercel",
      env: {
        CI: "true",
        CAPSULE_LIVE_TESTS: "1",
        VERCEL_TOKEN: "secret-vercel",
        CAPSULE_VERCEL_DEPLOYMENT_ID: "dpl_123"
      }
    });

    expect(blocked.providers[0]).toMatchObject({
      provider: "vercel",
      status: "blocked",
      missingCiOptInEnv: ["CAPSULE_LIVE_TEST_CI_OPT_IN"],
      ciOptInLabel: "capsule:live-tests"
    });
    expect(blocked.providers[0]?.notes).toContain("Set CAPSULE_LIVE_TEST_CI_OPT_IN=1 or apply the capsule:live-tests label before running live tests in CI.");

    const ready = createLiveEnvironmentValidationReport({
      provider: "vercel",
      env: {
        CI: "true",
        CAPSULE_LIVE_TEST_CI_OPT_IN: "1",
        CAPSULE_LIVE_TESTS: "1",
        VERCEL_TOKEN: "secret-vercel",
        CAPSULE_VERCEL_DEPLOYMENT_ID: "dpl_123"
      }
    });

    expect(ready.providers[0]).toMatchObject({
      provider: "vercel",
      status: "ready",
      configuredEnv: ["CAPSULE_LIVE_TESTS", "VERCEL_TOKEN", "CAPSULE_VERCEL_DEPLOYMENT_ID", "CAPSULE_LIVE_TEST_CI_OPT_IN"],
      missingCiOptInEnv: []
    });
    expect(JSON.stringify(ready)).not.toContain("secret-vercel");
  });

  test("blocks CI live-test validation for untrusted forks even with opt-in", () => {
    const report = createLiveEnvironmentValidationReport({
      provider: "vercel",
      env: {
        CI: "true",
        CAPSULE_LIVE_TEST_UNTRUSTED_FORK: "1",
        CAPSULE_LIVE_TEST_CI_OPT_IN: "1",
        CAPSULE_LIVE_TESTS: "1",
        VERCEL_TOKEN: "secret-vercel",
        CAPSULE_VERCEL_DEPLOYMENT_ID: "dpl_123"
      }
    });

    expect(report.providers[0]).toMatchObject({
      provider: "vercel",
      status: "blocked",
      ciUntrustedFork: true,
      missingCiOptInEnv: []
    });
    expect(report.providers[0]?.notes).toContain("Live tests are disabled for untrusted fork pull requests.");
    expect(JSON.stringify(report)).not.toContain("secret-vercel");
  });

  test("validates quarantined flaky live tests with revalidation metadata", () => {
    const quarantine = {
      reason: "provider control plane intermittently returns 503",
      lastObservedFailure: "2026-05-30T10:00:00Z",
      owner: "runtime-team",
      revalidationCommand: "CAPSULE_LIVE_TEST_REVALIDATE_FLAKY=1 CAPSULE_LIVE_TESTS=1 pnpm vitest run packages/adapter-fly/src/fly.live.test.ts"
    };
    const report = createLiveEnvironmentValidationReport({
      provider: "fly",
      plans: [
        {
          provider: "fly",
          testPath: "packages/adapter-fly/src/fly.live.test.ts",
          requiredEnv: ["CAPSULE_LIVE_TESTS", "FLY_API_TOKEN", "FLY_APP_NAME"],
          optionalEnv: [],
          costRisk: "billable",
          costAcknowledgementEnv: "CAPSULE_LIVE_TEST_COST_ACK",
          safeCommands: ["CAPSULE_LIVE_TESTS=1 pnpm vitest run packages/adapter-fly/src/fly.live.test.ts"],
          quarantine,
          notes: []
        }
      ],
      env: {
        CAPSULE_LIVE_TESTS: "1",
        FLY_API_TOKEN: "secret-token",
        FLY_APP_NAME: "capsule-app",
        CAPSULE_LIVE_TEST_COST_ACK: "1",
        CAPSULE_LIVE_TEST_MAX_RESOURCES: "1"
      }
    });

    expect(report.providers[0]).toMatchObject({
      provider: "fly",
      status: "quarantined",
      quarantine,
      quarantineRevalidationEnv: "CAPSULE_LIVE_TEST_REVALIDATE_FLAKY"
    });
    expect(report.providers[0]?.notes).toContain(
      "Quarantined flaky live test: provider control plane intermittently returns 503. Owner: runtime-team. Last observed failure: 2026-05-30T10:00:00Z. Revalidate with: CAPSULE_LIVE_TEST_REVALIDATE_FLAKY=1 CAPSULE_LIVE_TESTS=1 pnpm vitest run packages/adapter-fly/src/fly.live.test.ts"
    );
    expect(JSON.stringify(report)).not.toContain("secret-token");
  });

  test("prints the selected live-test environment validation report", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
    const envKeys = ["CAPSULE_LIVE_TESTS", "NEON_API_KEY", "NEON_PROJECT_ID", "CAPSULE_POSTGRES_PROJECT_ID", "CAPSULE_LIVE_TEST_COST_ACK"];
    const previousEnv = Object.fromEntries(envKeys.map((key) => [key, process.env[key]]));
    try {
      for (const key of envKeys) {
        delete process.env[key];
      }
      await main(["live-test", "validate", "--provider", "neon"]);
      const output = JSON.parse(String(log.mock.calls[0]?.[0])) as ReturnType<typeof createLiveEnvironmentValidationReport>;
      expect(output.providers[0]).toMatchObject({
        provider: "neon",
        status: "blocked"
      });
      expect(process.exitCode).toBe(1);
    } finally {
      for (const key of envKeys) {
        if (previousEnv[key] === undefined) {
          delete process.env[key];
        } else {
          process.env[key] = previousEnv[key];
        }
      }
      log.mockRestore();
      process.exitCode = undefined;
    }
  });
});

describe("CLI provider verification matrix", () => {
  test("parses verify providers", () => {
    expect(parse(["verify", "providers", "--provider", "neon"])).toMatchObject({
      command: "verify",
      provider: "neon",
      rest: ["providers"]
    });
  });

  test("reports Docker availability and provider credential readiness without secrets", async () => {
    const report = await createProviderVerificationReport({
      env: {
        CAPSULE_LIVE_TESTS: "1",
        NEON_API_KEY: "secret-neon",
        CAPSULE_POSTGRES_PROJECT_ID: "secret-project"
      },
      dockerCheck: async () => true
    });

    expect(report.providers.find((entry) => entry.provider === "docker")).toMatchObject({
      provider: "docker",
      status: "passed",
      missingEnv: []
    });
    expect(report.providers.find((entry) => entry.provider === "neon")).toMatchObject({
      provider: "neon",
      status: "ready",
      liveTestEnabled: true,
      configuredEnv: ["NEON_API_KEY", "CAPSULE_POSTGRES_PROJECT_ID"],
      missingEnv: []
    });
    expect(JSON.stringify(report)).not.toContain("secret-neon");
    expect(JSON.stringify(report)).not.toContain("secret-project");
  });

  test("reports missing credentials for a selected provider", async () => {
    const report = await createProviderVerificationReport({
      provider: "vercel",
      env: {},
      dockerCheck: async () => true
    });

    expect(report.providers).toEqual([
      expect.objectContaining({
        provider: "vercel",
        status: "missing",
        liveTestEnabled: false,
        missingEnv: ["VERCEL_TOKEN", "CAPSULE_VERCEL_DEPLOYMENT_ID"],
        notes: expect.arrayContaining(["Set CAPSULE_LIVE_TESTS=1 before running the safe command."])
      })
    ]);
  });

  test("prints the provider verification report", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
    try {
      await main(["verify", "providers", "--provider", "neon"]);
      const output = JSON.parse(String(log.mock.calls[0]?.[0])) as Awaited<ReturnType<typeof createProviderVerificationReport>>;
      expect(output.providers[0]?.provider).toBe("neon");
    } finally {
      log.mockRestore();
      process.exitCode = undefined;
    }
  });
});

describe("CLI service lifecycle parsing", () => {
  test("parses service status and delete flags", () => {
    expect(parse(["service", "status", "--adapter", "cloud-run", "--id", "api"])).toMatchObject({
      command: "service",
      adapter: "cloud-run",
      id: "api",
      rest: ["status"]
    });
    expect(parse(["service", "delete", "--adapter", "ecs", "--id", "api", "--force", "--reason", "cleanup"])).toMatchObject({
      command: "service",
      adapter: "ecs",
      id: "api",
      force: true,
      reason: "cleanup",
      rest: ["delete"]
    });
  });

  test("parses Azure Container Apps service lifecycle commands", () => {
    expect(parse(["service", "status", "--adapter", "azure-container-apps", "--id", "api"])).toMatchObject({
      command: "service",
      adapter: "azure-container-apps",
      id: "api",
      rest: ["status"]
    });
    expect(parse(["service", "delete", "--adapter", "azure-container-apps", "--id", "api", "--reason", "cleanup"])).toMatchObject({
      command: "service",
      adapter: "azure-container-apps",
      id: "api",
      reason: "cleanup",
      rest: ["delete"]
    });
  });
});

describe("CLI job lifecycle parsing", () => {
  test("parses job status and cancel flags", () => {
    expect(parse(["job", "status", "--adapter", "cloud-run", "--id", "exec-1"])).toMatchObject({
      command: "job",
      adapter: "cloud-run",
      id: "exec-1",
      rest: ["status"]
    });
    expect(parse(["job", "cancel", "--adapter", "ecs", "--id", "task-1", "--reason", "cleanup"])).toMatchObject({
      command: "job",
      adapter: "ecs",
      id: "task-1",
      reason: "cleanup",
      rest: ["cancel"]
    });
  });

  test("parses Azure Container Apps job lifecycle commands", () => {
    expect(parse(["job", "status", "--adapter", "azure-container-apps", "--id", "job-execution"])).toMatchObject({
      command: "job",
      adapter: "azure-container-apps",
      id: "job-execution",
      rest: ["status"]
    });
    expect(parse(["job", "cancel", "--adapter", "azure-container-apps", "--id", "job-execution", "--reason", "cleanup"])).toMatchObject({
      command: "job",
      adapter: "azure-container-apps",
      id: "job-execution",
      reason: "cleanup",
      rest: ["cancel"]
    });
  });
});
