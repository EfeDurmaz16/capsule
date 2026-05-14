import { describe, expect, test, vi } from "vitest";
import { compareProviderCapabilities, capabilityExplanations, createDoctorReport, main, parse, providerCredentialDiagnostics } from "./index.js";

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

  test("recognizes Stripe Projects env aliases without exposing values", () => {
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
    await expect(createDoctorReport({ env: { NEON_API_KEY: "secret-neon" }, adapter: "neon", dockerCheck: async () => false })).resolves.toEqual({
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
});

describe("CLI capability explanations", () => {
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

  test("parses the explain flag", () => {
    expect(parse(["capabilities", "--adapter", "neon", "--explain"])).toMatchObject({
      command: "capabilities",
      adapter: "neon",
      explain: true
    });
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
