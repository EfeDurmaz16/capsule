import { describe, expect, test } from "vitest";
import { Capsule, type CapsuleAdapter, type CapabilityMap } from "@capsule/core";
import { cleanupPreviewEnvironment, createPreviewEnvironmentWithCleanup, createPreviewGraph, PreviewCreationError, type PreviewPlan } from "./index.js";

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

function fakeCapsule(events: string[] = [], options: { failServiceDeploy?: boolean; failDatabaseDelete?: boolean } = {}): Capsule {
  const adapter: CapsuleAdapter = {
    name: "fake-preview",
    provider: "fake",
    capabilities,
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
    }
    expect(events).toEqual(["database.create:pr-42-db", "service.deploy:api", "database.delete:db-pr-42-db"]);
  });

  test("cleans resources in reverse dependency order", async () => {
    const events: string[] = [];
    const result = await createPreviewGraph(plan(fakeCapsule(events)));
    const cleanup = await cleanupPreviewEnvironment(result.preview, result.resources);

    expect(cleanup.status).toBe("cleaned");
    expect(events.slice(4)).toEqual(["service.delete:svc-api", "database.delete:db-pr-42-db"]);
  });
});
