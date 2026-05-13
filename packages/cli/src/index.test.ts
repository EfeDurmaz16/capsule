import { describe, expect, test } from "vitest";
import { createDoctorReport, main, parse, providerCredentialDiagnostics } from "./index.js";

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

  test("fails clearly when a provider does not support service status", async () => {
    await expect(main(["service", "status", "--adapter", "azure-container-apps", "--id", "api"])).rejects.toThrow(
      'azure-container-apps does not support service.status. Run "capsule capabilities --adapter azure-container-apps" to inspect supported operations.'
    );
  });
});
