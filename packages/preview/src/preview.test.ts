import { describe, expect, test } from "vitest";
import { Capsule, type CapsuleAdapter, type CapabilityMap } from "@capsule/core";
import {
  cleanupPreviewEnvironment,
  compilePreviewPlan,
  compilePreviewSpec,
  createPreviewDryRunReceiptBundle,
  createPreviewEnvironmentWithCleanup,
  createPreviewGraph,
  MockProviderNotAllowedError,
  PreviewCreationError,
  validatePreviewPlanCapabilities,
  type PreviewPlan
} from "./index.js";

const capabilities: CapabilityMap = {
  database: {
    branchCreate: "native",
    branchDelete: "native",
    branchReset: "unsupported",
    connectionString: "unsupported",
    migrate: "unsupported"
  },
  service: {
    deploy: "native",
    update: "unsupported",
    delete: "native",
    status: "unsupported",
    logs: "unsupported",
    url: "native"
  },
  edge: {
    deploy: "native",
    rollback: "unsupported",
    routes: "unsupported",
    url: "native"
  },
  job: {
    run: "native",
    status: "unsupported",
    cancel: "unsupported",
    logs: "unsupported",
    artifacts: "unsupported",
    timeout: "native",
    env: "native"
  }
};

function fakeCapsule(
  events: string[] = [],
  options: { failServiceDeploy?: boolean; failDatabaseDelete?: boolean; mock?: boolean; capabilities?: CapabilityMap } = {}
): Capsule {
  const adapter: CapsuleAdapter = {
    name: "fake-preview",
    provider: "fake",
    capabilities: options.capabilities ?? capabilities,
    raw: options.mock ? { mock: true, provider: "fake" } : undefined,
    database: {
      branch: {
        create: async (spec, context) => {
          events.push(`database.create:${spec.name}`);
          return {
            id: `db-${spec.name}`,
            provider: "fake",
            project: spec.project,
            name: spec.name,
            status: "ready",
            receipt: context.createReceipt({
              type: "database.branch.create",
              capabilityPath: "database.branchCreate",
              startedAt: new Date("2026-05-13T00:00:00.000Z"),
              resource: { id: `db-${spec.name}`, name: spec.name, status: "ready" }
            })
          };
        },
        delete: async (spec, context) => {
          events.push(`database.delete:${spec.branchId}`);
          if (options.failDatabaseDelete) {
            throw new Error("database cleanup failed");
          }
          return {
            id: spec.branchId,
            provider: "fake",
            project: spec.project,
            status: "deleted",
            receipt: context.createReceipt({
              type: "database.branch.delete",
              capabilityPath: "database.branchDelete",
              startedAt: new Date("2026-05-13T00:00:01.000Z"),
              resource: { id: spec.branchId, status: "deleted" }
            })
          };
        }
      }
    },
    service: {
      deploy: async (spec, context) => {
        events.push(`service.deploy:${spec.name}`);
        if (options.failServiceDeploy) {
          throw new Error("service deploy failed");
        }
        return {
          id: `svc-${spec.name}`,
          provider: "fake",
          name: spec.name,
          status: "ready",
          url: `https://${spec.name}.example.test`,
          receipt: context.createReceipt({
            type: "service.deploy",
            capabilityPath: "service.deploy",
            startedAt: new Date("2026-05-13T00:00:02.000Z"),
            resource: { id: `svc-${spec.name}`, name: spec.name, url: `https://${spec.name}.example.test`, status: "ready" }
          })
        };
      },
      delete: async (spec, context) => {
        events.push(`service.delete:${spec.id}`);
        return {
          id: spec.id,
          provider: "fake",
          status: "deleted",
          receipt: context.createReceipt({
            type: "service.delete",
            capabilityPath: "service.delete",
            startedAt: new Date("2026-05-13T00:00:03.000Z"),
            resource: { id: spec.id, status: "deleted" }
          })
        };
      }
    },
    edge: {
      deploy: async (spec, context) => {
        events.push(`edge.deploy:${spec.name}`);
        return {
          id: `edge-${spec.name}`,
          provider: "fake",
          name: spec.name,
          status: "ready",
          url: `https://${spec.name}.edge.test`,
          receipt: context.createReceipt({
            type: "edge.deploy",
            capabilityPath: "edge.deploy",
            startedAt: new Date("2026-05-13T00:00:04.000Z"),
            resource: { id: `edge-${spec.name}`, name: spec.name, url: `https://${spec.name}.edge.test`, status: "ready" }
          })
        };
      }
    },
    job: {
      run: async (spec, context) => {
        events.push(`job.run:${spec.name ?? spec.image}`);
        return {
          id: `job-${spec.name ?? "check"}`,
          provider: "fake",
          status: "succeeded",
          receipt: context.createReceipt({
            type: "job.run",
            capabilityPath: "job.run",
            startedAt: new Date("2026-05-13T00:00:05.000Z"),
            resource: { id: `job-${spec.name ?? "check"}`, status: "succeeded" }
          })
        };
      }
    }
  };
  return new Capsule({ adapter, receipts: true });
}

function plan(capsule: Capsule): PreviewPlan {
  return {
    name: "pr-42",
    databases: [{ capsule, spec: { project: "app", name: "pr-42-db" } }],
    services: [{ capsule, spec: { name: "api", image: "ghcr.io/acme/api:latest" } }],
    edges: [{ capsule, spec: { name: "web", source: { path: "./dist" } } }],
    jobs: [{ capsule, spec: { name: "smoke", image: "node:22", command: "node smoke.js" } }]
  };
}

describe("preview orchestration", () => {
  test("compiles a create preview spec into explicit resources and checks", () => {
    const compiled = compilePreviewSpec({
      name: "pr-42",
      source: { repo: "https://github.com/acme/app", ref: "refs/pull/42/head", path: "." },
      ttlMs: 3_600_000,
      labels: { pullRequest: "42" },
      databases: [{ project: "app", name: "pr-42-db" }],
      services: [{ name: "api", image: "ghcr.io/acme/api:latest" }],
      edges: [{ name: "web", source: { path: "./dist" } }],
      jobs: [{ name: "smoke", image: "node:22", command: "node smoke.js" }]
    });

    expect(compiled).toMatchObject({
      name: "pr-42",
      ttlMs: 3_600_000,
      labels: { pullRequest: "42" }
    });
    expect(compiled.resources.map((resource) => [resource.kind, resource.name, resource.capabilityPath, resource.cleanupCapabilityPath])).toEqual([
      ["database", "pr-42-db", "database.branchCreate", "database.branchDelete"],
      ["service", "api", "service.deploy", "service.delete"],
      ["edge", "web", "edge.deploy", undefined],
      ["job", "smoke", "job.run", undefined]
    ]);
    expect(compiled.checks.map((check) => [check.kind, check.capabilityPath, check.required])).toEqual([
      ["database", "database.branchCreate", true],
      ["service", "service.deploy", true],
      ["edge", "edge.deploy", true],
      ["job", "job.run", true]
    ]);
  });

  test("validates preview plan capability requirements without provider calls", () => {
    const events: string[] = [];
    const validation = validatePreviewPlanCapabilities(plan(fakeCapsule(events)));

    expect(validation.ok).toBe(true);
    expect(validation.missingRequired).toEqual([]);
    expect(validation.checked.map((record) => [record.resource.kind, record.result.path, record.result.actualLevel])).toEqual([
      ["database", "database.branchCreate", "native"],
      ["service", "service.deploy", "native"],
      ["edge", "edge.deploy", "native"],
      ["job", "job.run", "native"]
    ]);
    expect(events).toEqual([]);
  });

  test("compiles a provider-bound preview plan without provider calls", () => {
    const events: string[] = [];
    const compiled = compilePreviewPlan(plan(fakeCapsule(events)));

    expect(compiled.resources.map((resource) => [resource.kind, resource.name, resource.capabilityPath])).toEqual([
      ["database", "pr-42-db", "database.branchCreate"],
      ["service", "api", "service.deploy"],
      ["edge", "web", "edge.deploy"],
      ["job", "smoke", "job.run"]
    ]);
    expect(events).toEqual([]);
  });

  test("emits a dry-run preview receipt bundle without creating provider resources", () => {
    const events: string[] = [];
    const bundle = createPreviewDryRunReceiptBundle(plan(fakeCapsule(events)), {
      startedAt: new Date("2026-05-13T00:00:00.000Z")
    });

    expect(bundle.validation.ok).toBe(true);
    expect(bundle.receipts).toEqual([bundle.receipt]);
    expect(bundle.receipt).toMatchObject({
      type: "preview.create",
      provider: "capsule-preview",
      adapter: "@capsule/preview",
      capabilityPath: "preview.create",
      supportLevel: "emulated",
      resource: { name: "pr-42", status: "ready" },
      policy: { decision: "allowed" }
    });
    expect(bundle.receipt.metadata).toMatchObject({
      dryRun: true,
      resources: [
        { kind: "database", name: "pr-42-db", capabilityPath: "database.branchCreate", cleanupCapabilityPath: "database.branchDelete" },
        { kind: "service", name: "api", capabilityPath: "service.deploy", cleanupCapabilityPath: "service.delete" },
        { kind: "edge", name: "web", capabilityPath: "edge.deploy" },
        { kind: "job", name: "smoke", capabilityPath: "job.run" }
      ],
      missingRequired: []
    });
    expect(events).toEqual([]);
  });

  test("reports missing required capability paths before orchestration", () => {
    const validation = validatePreviewPlanCapabilities(
      plan(
        fakeCapsule([], {
          capabilities: {
            ...capabilities,
            edge: { ...capabilities.edge!, deploy: "unsupported" }
          }
        })
      )
    );

    expect(validation.ok).toBe(false);
    expect(validation.missingRequired).toHaveLength(1);
    expect(validation.missingRequired[0]).toMatchObject({
      resource: { kind: "edge", name: "web", capabilityPath: "edge.deploy" },
      result: { path: "edge.deploy", actualLevel: "unsupported", supported: false }
    });
  });

  test("marks dry-run preview receipt as denied when required capabilities are missing", () => {
    const bundle = createPreviewDryRunReceiptBundle(
      plan(
        fakeCapsule([], {
          capabilities: {
            ...capabilities,
            service: { ...capabilities.service!, deploy: "unsupported" }
          }
        })
      ),
      { startedAt: new Date("2026-05-13T00:00:00.000Z") }
    );

    expect(bundle.validation.ok).toBe(false);
    expect(bundle.receipt).toMatchObject({
      resource: { name: "pr-42", status: "failed" },
      policy: { decision: "denied" }
    });
    expect(bundle.receipt.metadata?.missingRequired).toEqual([
      {
        kind: "service",
        name: "api",
        provider: "unknown",
        adapter: "fake-preview",
        path: "service.deploy",
        actualLevel: "unsupported",
        reason: "Preview services require service.deploy support."
      }
    ]);
  });

  test("creates a preview resource graph", async () => {
    const events: string[] = [];
    const result = await createPreviewGraph(plan(fakeCapsule(events)));

    expect(result.preview.status).toBe("ready");
    expect(result.preview.urls).toEqual(["https://api.example.test", "https://web.edge.test"]);
    expect(result.resources.map((resource) => resource.kind)).toEqual(["database", "service", "edge", "job"]);
    expect(result.receipts.map((receipt) => receipt.type)).toEqual(["database.branch.create", "service.deploy", "edge.deploy", "job.run"]);
    expect(events).toEqual(["database.create:pr-42-db", "service.deploy:api", "edge.deploy:web", "job.run:smoke"]);
  });

  test("cleans up database resources after service deployment failure", async () => {
    const events: string[] = [];

    await expect(createPreviewEnvironmentWithCleanup(plan(fakeCapsule(events, { failServiceDeploy: true })))).rejects.toMatchObject({
      name: "PreviewCreationError",
      preview: { status: "failed" },
      cleanup: { status: "cleaned" }
    });
    expect(events).toEqual(["database.create:pr-42-db", "service.deploy:api", "database.delete:db-pr-42-db"]);
  });

  test("reports partial cleanup failures", async () => {
    const events: string[] = [];

    try {
      await createPreviewEnvironmentWithCleanup(plan(fakeCapsule(events, { failServiceDeploy: true, failDatabaseDelete: true })));
      throw new Error("expected preview creation to fail");
    } catch (error) {
      expect(error).toBeInstanceOf(PreviewCreationError);
      const previewError = error as PreviewCreationError;
      expect(previewError.cleanup?.status).toBe("partial");
      expect(previewError.cleanup?.failed).toHaveLength(1);
      expect(previewError.cleanup?.receipt.type).toBe("preview.cleanup");
      expect(previewError.cleanup?.receipt.metadata?.cleanupStatus).toBe("partial");
      expect(previewError.cleanup?.dispositions).toMatchObject([
        {
          disposition: "leaked",
          resource: { id: "db-pr-42-db", cleanupDisposition: "leaked" }
        }
      ]);
    }
    expect(events).toEqual(["database.create:pr-42-db", "service.deploy:api", "database.delete:db-pr-42-db"]);
  });

  test("cleans resources in reverse dependency order", async () => {
    const events: string[] = [];
    const result = await createPreviewGraph(plan(fakeCapsule(events)));
    const cleanup = await cleanupPreviewEnvironment(result.preview, result.resources);

    expect(cleanup.status).toBe("partial");
    expect(cleanup.receipt.type).toBe("preview.cleanup");
    expect(cleanup.receipts.map((receipt) => receipt.type)).toEqual(["service.delete", "database.branch.delete", "preview.cleanup"]);
    expect(cleanup.dispositions.map((entry) => [entry.resource.kind, entry.disposition])).toEqual([
      ["job", "unsupported"],
      ["edge", "unsupported"],
      ["service", "cleaned"],
      ["database", "cleaned"]
    ]);
    expect(events.slice(4)).toEqual(["service.delete:svc-api", "database.delete:db-pr-42-db"]);
  });

  test("emits preview cleanup receipt after create failure cleanup succeeds", async () => {
    const events: string[] = [];

    try {
      await createPreviewEnvironmentWithCleanup(plan(fakeCapsule(events, { failServiceDeploy: true })));
      throw new Error("expected preview creation to fail");
    } catch (error) {
      expect(error).toBeInstanceOf(PreviewCreationError);
      const previewError = error as PreviewCreationError;
      expect(previewError.cleanup?.status).toBe("cleaned");
      expect(previewError.cleanup?.receipts.map((receipt) => receipt.type)).toEqual(["database.branch.delete", "preview.cleanup"]);
      expect(previewError.cleanup?.dispositions.map((entry) => entry.disposition)).toEqual(["cleaned"]);
      expect(previewError.cleanup?.receipt).toMatchObject({
        provider: "capsule-preview",
        adapter: "@capsule/preview",
        capabilityPath: "preview.cleanup",
        supportLevel: "emulated",
        resource: { status: "cleaned" },
        policy: { decision: "allowed" }
      });
    }
  });

  test("rejects mock adapters when real providers are required", async () => {
    const previewPlan = {
      ...plan(fakeCapsule([], { mock: true })),
      requireRealProviders: true
    };

    await expect(createPreviewGraph(previewPlan)).rejects.toBeInstanceOf(MockProviderNotAllowedError);
  });

  test("allows mock adapters only when explicitly allowed", async () => {
    const previewPlan = {
      ...plan(fakeCapsule([], { mock: true })),
      requireRealProviders: true,
      allowMockProviders: true
    };

    await expect(createPreviewGraph(previewPlan)).resolves.toMatchObject({
      preview: { status: "ready" }
    });
  });
});
