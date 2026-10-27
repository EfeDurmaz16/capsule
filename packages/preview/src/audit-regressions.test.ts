// Audit regressions for the M1 campaign (preview composition). Each test asserts the INTENDED behavior
// from the M1 manifest and is marked it.fails while the defect is present on the baseline (7d3a28a). The
// owner who fixes an ID flips its it.fails to it in the same commit. All adapters are in-memory fakes.
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  Capsule,
  CleanupFailureError,
  PartialEffectsError,
  PolicyViolationError,
  resourceLocator,
  UnsupportedCapabilityError,
  type CapsuleApprovalGrant,
  type CleanupApprovalRequest,
  type CleanupOutcome,
  type PartialEffects
} from "@capsule-sdk/core";
import {
  aggregatePreviewStatus,
  cleanupPreviewEnvironment,
  createPreviewEnvironmentWithCleanup,
  createPreviewGraph,
  createPreviewId,
  PreviewCreationError,
  PreviewCleanupPlanError,
  type PreviewCleanupPlan
} from "./index.js";

type DeleteCall = { owner: string; provider: string; project: string; branchId: string };

function fakeDatabase(provider: string, ownerProject: string, calls: DeleteCall[], createDelayMs = 0) {
  return new Capsule({
    adapter: {
      name: `${provider}-${ownerProject}`,
      provider,
      capabilities: { database: { branchCreate: "native", branchDelete: "native" } } as never,
      database: {
        branch: {
          create: async (spec) => {
            if (createDelayMs > 0) await new Promise((resolve) => setTimeout(resolve, createDelayMs));
            return { id: "provider-local-id", provider, project: spec.project, name: spec.name, status: "ready" };
          },
          delete: async (spec) => {
            calls.push({ owner: ownerProject, provider, project: spec.project, branchId: spec.branchId });
            return { id: spec.branchId, provider, project: spec.project, status: "deleted" };
          }
        }
      }
    }
  });
}

describe("M1 audit regressions: preview", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  for (const providers of [
    ["provider-a", "provider-b"],
    ["same-provider", "same-provider"]
  ] as const) {
    it(`COMP-01: equal native ids (${providers.join(", ")}) clean up through their own Capsule and project`, async () => {
      const calls: DeleteCall[] = [];
      const graph = await createPreviewGraph({
        name: "collision",
        databases: [
          { capsule: fakeDatabase(providers[0], "project-one", calls), spec: { project: "project-one", name: "one" } },
          { capsule: fakeDatabase(providers[1], "project-two", calls), spec: { project: "project-two", name: "two" } }
        ]
      });
      await cleanupPreviewEnvironment(graph.preview, graph.resources, { cleanupPlan: graph.cleanupPlan });
      expect(calls.map((call) => [call.owner, call.project]).sort()).toEqual([
        ["project-one", "project-one"],
        ["project-two", "project-two"]
      ]);
      expect(new Set(graph.cleanupPlan.actions.map((action) => action.actionId)).size).toBe(graph.cleanupPlan.actions.length);
    });
  }

  async function collisionGraph(calls: DeleteCall[]) {
    return createPreviewGraph({
      name: "collision",
      databases: [
        { capsule: fakeDatabase("same-provider", "project-one", calls), spec: { project: "project-one", name: "one" } },
        { capsule: fakeDatabase("same-provider", "project-two", calls), spec: { project: "project-two", name: "two" } }
      ]
    });
  }

  it("COMP-01: a cleanup plan from another preview is rejected before any delete", async () => {
    const calls: DeleteCall[] = [];
    const graph = await collisionGraph(calls);
    const foreign: PreviewCleanupPlan = { ...graph.cleanupPlan, previewId: "preview_other_run" };
    await expect(cleanupPreviewEnvironment(graph.preview, graph.resources, { cleanupPlan: foreign })).rejects.toBeInstanceOf(PreviewCleanupPlanError);
    expect(calls).toEqual([]);
  });

  it("COMP-01: a plan action that points a resource at another project is rejected before any delete", async () => {
    const calls: DeleteCall[] = [];
    const graph = await collisionGraph(calls);
    const tampered: PreviewCleanupPlan = {
      ...graph.cleanupPlan,
      actions: graph.cleanupPlan.actions.map((action) =>
        action.resourceRef === graph.resources[0]?.ref ? { ...action, spec: { ...action.spec, project: "project-two" } } : action
      )
    };
    await expect(cleanupPreviewEnvironment(graph.preview, graph.resources, { cleanupPlan: tampered })).rejects.toBeInstanceOf(PreviewCleanupPlanError);
    expect(calls).toEqual([]);
  });

  it("COMP-01: a legacy plan without resource refs is accepted only when each action matches exactly one identity", async () => {
    const calls: DeleteCall[] = [];
    const graph = await collisionGraph(calls);
    const legacy: PreviewCleanupPlan = {
      ...graph.cleanupPlan,
      actions: graph.cleanupPlan.actions.map(({ resourceRef: _ref, resourceAdapter: _adapter, resourceScope: _scope, ...action }) => action)
    };
    const legacyResources = graph.resources.map(({ ref: _ref, ...resource }) => resource);
    await cleanupPreviewEnvironment(graph.preview, legacyResources, { cleanupPlan: legacy });
    expect(calls.map((call) => [call.owner, call.project]).sort()).toEqual([
      ["project-one", "project-one"],
      ["project-two", "project-two"]
    ]);

    const ambiguous: PreviewCleanupPlan = { ...legacy, actions: [...legacy.actions, ...legacy.actions] };
    calls.length = 0;
    await expect(cleanupPreviewEnvironment(graph.preview, legacyResources, { cleanupPlan: ambiguous })).rejects.toBeInstanceOf(PreviewCleanupPlanError);
    expect(calls).toEqual([]);
  });

  it("COMP-02: a cancelled required check never aggregates to ready", () => {
    expect(aggregatePreviewStatus([{ type: "job", kind: "job", id: "check", provider: "fake", status: "cancelled" } as never])).not.toBe("ready");
    expect(
      aggregatePreviewStatus([
        { type: "service", kind: "service", id: "api", provider: "fake", status: "running" },
        { type: "job", kind: "job", id: "check", provider: "fake", status: "cancelled" }
      ])
    ).toBe("failed");
  });

  it("COMP-02: running services keep ready semantics", () => {
    expect(aggregatePreviewStatus([{ type: "service", kind: "service", id: "api", provider: "fake", status: "running" }])).toBe("ready");
  });

  it("COMP-05: the aggregate preview receipt duration covers provisioning time", async () => {
    const graph = await createPreviewGraph({
      name: "timing",
      databases: [{ capsule: fakeDatabase("fake", "p", [], 40), spec: { project: "p", name: "slow" } }]
    });
    expect(graph.receipts.at(-1)?.durationMs ?? 0).toBeGreaterThanOrEqual(30);
  });

  it("COMP-05: a fake clock advance during provisioning appears in the aggregate duration", async () => {
    vi.useFakeTimers({ now: new Date("2026-10-27T00:00:00.000Z") });
    try {
      const pending = createPreviewGraph({
        name: "timing",
        databases: [{ capsule: fakeDatabase("fake", "p", [], 5_000), spec: { project: "p", name: "slow" } }]
      });
      await vi.advanceTimersByTimeAsync(5_000);
      const graph = await pending;
      const receipt = graph.receipts.at(-1);
      expect(receipt?.type).toBe("preview.create");
      expect(receipt?.startedAt).toBe("2026-10-27T00:00:00.000Z");
      expect(receipt?.durationMs).toBe(5_000);
    } finally {
      vi.useRealTimers();
    }
  });

  it("COMP-06: the same name in the same millisecond yields distinct preview ids", () => {
    vi.spyOn(Date, "now").mockReturnValue(123);
    expect(createPreviewId("a")).not.toBe(createPreviewId("a"));
  });

  it("COMP-06: a caller-stable operation id is recorded separately from the unique run id", async () => {
    vi.spyOn(Date, "now").mockReturnValue(123);
    const run = () =>
      createPreviewGraph({
        name: "pr-7",
        operationId: "pr-7@abc123",
        databases: [{ capsule: fakeDatabase("fake", "p", []), spec: { project: "p", name: "db" } }]
      });
    const [first, second] = [await run(), await run()];
    expect(first.preview.id).not.toBe(second.preview.id);
    expect(first.cleanupPlan.operationId).toBe("pr-7@abc123");
    expect(second.cleanupPlan.operationId).toBe("pr-7@abc123");
    expect(first.receipts.at(-1)?.metadata?.operationId).toBe("pr-7@abc123");
    expect(first.cleanupPlan.actions[0]?.idempotencyKey).not.toBe(second.cleanupPlan.actions[0]?.idempotencyKey);
  });

  it("PERF-08: cleanup joins scale linearly on a large graph with colliding native ids", async () => {
    const size = 500;
    const calls: DeleteCall[] = [];
    const graph = await createPreviewGraph({
      name: "large",
      databases: Array.from({ length: size }, (_, index) => ({
        capsule: fakeDatabase("same-provider", `project-${index}`, calls),
        spec: { project: `project-${index}`, name: `db-${index}` }
      }))
    });
    expect(new Set(graph.cleanupPlan.actions.map((action) => action.actionId)).size).toBe(size);
    expect(graph.receipts.at(-1)?.metadata?.resources).toHaveLength(size);

    let elementReads = 0;
    const countedActions = new Proxy(graph.cleanupPlan.actions, {
      get(target, property, receiver) {
        if (typeof property === "string" && /^\d+$/.test(property)) elementReads += 1;
        return Reflect.get(target, property, receiver);
      }
    });
    const cleanup = await cleanupPreviewEnvironment(graph.preview, graph.resources, {
      cleanupPlan: { ...graph.cleanupPlan, actions: countedActions }
    });
    expect(cleanup.status).toBe("cleaned");
    expect(calls).toHaveLength(size);
    expect(calls.every((call) => call.owner === call.project)).toBe(true);
    // Indexed joins read each plan action a constant number of times; a per-resource search reads O(n^2).
    expect(elementReads).toBeLessThanOrEqual(4 * size);
  });

  function failingService() {
    return new Capsule({
      adapter: {
        name: "failing-service",
        provider: "fake-service",
        capabilities: { service: { deploy: "native", delete: "native" } } as never,
        service: {
          deploy: async () => {
            throw new Error("service deploy failed");
          }
        }
      }
    });
  }

  function approvalDatabase(calls: DeleteCall[]) {
    return new Capsule({
      adapter: {
        name: "approval-db",
        provider: "fake-db",
        capabilities: { database: { branchCreate: "native", branchDelete: "native" } } as never,
        database: {
          branch: {
            create: async (spec) => ({ id: "branch-1", provider: "fake-db", project: spec.project, name: spec.name, status: "ready" }),
            delete: async (spec) => {
              calls.push({ owner: "approval-db", provider: "fake-db", project: spec.project, branchId: spec.branchId });
              return { id: spec.branchId, provider: "fake-db", project: spec.project, status: "deleted" };
            }
          }
        }
      },
      policy: { approvals: { required: true, reason: "test" } }
    });
  }

  const createGrant: CapsuleApprovalGrant = { approved: true, id: "create-only", capabilities: ["database.branchCreate"] };

  it("GAP-06: a basic create failure exposes the created resources, cleanup plan and receipts for recovery", async () => {
    const calls: DeleteCall[] = [];
    const error = await createPreviewGraph({
      name: "partial",
      databases: [{ capsule: fakeDatabase("fake", "project-one", calls), spec: { project: "project-one", name: "db" } }],
      services: [{ capsule: failingService(), spec: { name: "api", image: "api:1" } }]
    }).then(
      () => undefined,
      (caught: unknown) => caught
    );
    expect(error).toBeInstanceOf(PreviewCreationError);
    const failure = error as PreviewCreationError;
    expect(failure.resources.map((resource) => [resource.ref, resource.kind, resource.id])).toEqual([["resource-0", "database", "provider-local-id"]]);
    expect(failure.resources[0]?.cleanup?.capsule).toBeDefined();
    expect(failure.cleanupPlan?.previewId).toBe(failure.preview.id);
    expect(failure.cleanupPlan?.actions.map((action) => [action.resourceRef, action.resourceScope])).toEqual([["resource-0", { project: "project-one" }]]);
    expect((failure.cause as Error).message).toBe("service deploy failed");
    expect(calls).toEqual([]);

    const cleanup = await cleanupPreviewEnvironment(failure.preview, failure.resources, { cleanupPlan: failure.cleanupPlan });
    expect(cleanup.status).toBe("cleaned");
    expect(calls).toEqual([{ owner: "project-one", provider: "fake", project: "project-one", branchId: "provider-local-id" }]);
  });

  it("CD-APPROVAL: a create-only grant never authorizes compensation cleanup", async () => {
    const calls: DeleteCall[] = [];
    const error = (await createPreviewEnvironmentWithCleanup({
      name: "approval",
      databases: [{ capsule: approvalDatabase(calls), spec: { project: "p", name: "db", approval: createGrant } }],
      services: [{ capsule: failingService(), spec: { name: "api", image: "api:1" } }]
    }).catch((caught: unknown) => caught)) as PreviewCreationError;
    expect(error.cleanup?.dispositions.map((entry) => entry.disposition)).toEqual(["leaked"]);
    expect(error.cleanup?.dispositions[0]?.error).toMatch(/Approval required/);
    expect(calls).toEqual([]);
  });

  it("CD-APPROVAL: a fresh resolver grant authorizes cleanup and a denied resolver leaves a residual without a delete", async () => {
    const requests: CleanupApprovalRequest[] = [];
    const calls: DeleteCall[] = [];
    const plan = () => ({
      name: "approval",
      databases: [{ capsule: approvalDatabase(calls), spec: { project: "p", name: "db", approval: createGrant } }],
      services: [{ capsule: failingService(), spec: { name: "api", image: "api:1" } }]
    });

    const approved = (await createPreviewEnvironmentWithCleanup(plan(), {
      cleanupApproval: (request) => {
        requests.push(request);
        return { approved: true, id: "fresh-delete", capabilities: [request.capabilityPath], resources: [request.resource] };
      }
    }).catch((caught: unknown) => caught)) as PreviewCreationError;
    expect(approved.cleanup?.status).toBe("cleaned");
    expect(requests).toEqual([
      {
        capabilityPath: "database.branchDelete",
        resource: { type: "database", project: "p", id: "branch-1", provider: "fake-db" },
        reason: expect.any(String),
        context: {
          provider: "fake-db",
          adapter: "approval-db",
          previewId: approved.preview.id,
          resourceRef: "resource-0",
          actionId: expect.stringContaining("resource-0"),
          scope: { project: "p" }
        }
      }
    ]);
    expect(calls).toHaveLength(1);

    calls.length = 0;
    const denied = (await createPreviewEnvironmentWithCleanup(plan(), { cleanupApproval: async () => undefined }).catch(
      (caught: unknown) => caught
    )) as PreviewCreationError;
    expect(denied.cleanup?.status).toBe("partial");
    expect(denied.cleanup?.dispositions.map((entry) => entry.disposition)).toEqual(["leaked"]);
    expect(denied.cleanup?.dispositions[0]?.error).toMatch(/approval was not granted/);
    expect(calls).toEqual([]);
  });

  it("GAP-18: required preview expiry is rejected before any provider call", async () => {
    let creates = 0;
    const capsule = new Capsule({
      adapter: {
        name: "counting-db",
        provider: "fake",
        capabilities: { database: { branchCreate: "native", branchDelete: "native" } } as never,
        database: {
          branch: {
            create: async (spec) => {
              creates += 1;
              return { id: "b", provider: "fake", project: spec.project, name: spec.name, status: "ready" };
            }
          }
        }
      }
    });
    const plan = {
      name: "ttl",
      ttlMs: 60_000,
      ttlEnforcement: "required" as const,
      databases: [{ capsule, spec: { project: "p", name: "db" } }]
    };
    await expect(createPreviewGraph(plan)).rejects.toBeInstanceOf(UnsupportedCapabilityError);
    await expect(createPreviewEnvironmentWithCleanup(plan)).rejects.toBeInstanceOf(UnsupportedCapabilityError);
    expect(creates).toBe(0);
  });

  it("GAP-18: a recorded preview TTL is labeled record-only in the create receipt", async () => {
    const graph = await createPreviewGraph({
      name: "ttl",
      ttlMs: 60_000,
      databases: [{ capsule: fakeDatabase("fake", "p", []), spec: { project: "p", name: "db" } }]
    });
    expect(graph.receipts.at(-1)?.metadata?.ttl).toMatchObject({ requestedMs: 60_000, enforcement: "record-only" });
  });
  // Throws exactly what @capsule-sdk/neon's cleanupCreatedBranch throws when the compensating DELETE
  // fails (neon-adapter.ts): CleanupFailureError with a branch locator scoped by project as residual.
  function residualNeonDatabase(deletes: string[], deleteFails: boolean) {
    return new Capsule({
      adapter: {
        name: "neon-residual",
        provider: "neon",
        capabilities: { database: { branchCreate: "native", branchDelete: "native" } } as never,
        database: {
          branch: {
            create: async (spec) => {
              const branch = resourceLocator({ provider: "neon", kind: "branch", nativeId: "br-leak-1", scope: { project: spec.project } });
              const primaryError = new Error("connection_uri returned 500");
              const cleanupError = new Error("Neon returned 423: project has running operations");
              const effects: PartialEffects = {
                operation: "database.branchCreate",
                outcome: "failed",
                resources: [branch],
                primaryError,
                cleanup: { status: "failed", resources: [branch], residual: [branch], error: cleanupError }
              };
              throw new CleanupFailureError("Neon branch cleanup failed", effects.cleanup, primaryError, effects);
            },
            delete: async (spec) => {
              deletes.push(`${spec.project}/${spec.branchId}`);
              if (deleteFails) throw new Error("Neon returned 423: project has running operations");
              return { id: spec.branchId, provider: "neon", project: spec.project, status: "deleted" };
            }
          }
        }
      }
    });
  }

  // Mirrors @capsule-sdk/kubernetes rollbackDeployment: the Service create outcome is unknown, the
  // Deployment rollback either failed (CleanupFailureError) or succeeded (PartialEffectsError).
  function residualKubernetesService(rollbackFails: boolean) {
    return new Capsule({
      adapter: {
        name: "kubernetes",
        provider: "kubernetes",
        capabilities: { service: { deploy: "native", delete: "native" } } as never,
        service: {
          deploy: async (spec) => {
            const scope = { namespace: "preview" };
            const deployment = resourceLocator({ provider: "kubernetes", kind: "deployment", nativeId: spec.name, scope });
            const service = resourceLocator({ provider: "kubernetes", kind: "service", nativeId: spec.name, scope });
            const primaryError = new Error("createNamespacedService: socket hang up");
            const cleanup: CleanupOutcome = rollbackFails
              ? { status: "failed", resources: [deployment], residual: [deployment], error: new Error("403 Forbidden") }
              : { status: "succeeded", resources: [deployment] };
            const effects: PartialEffects = { operation: "service.deploy", outcome: "unknown", resources: [deployment, service], primaryError, cleanup };
            throw rollbackFails ? new CleanupFailureError("rollback failed", cleanup, primaryError, effects) : new PartialEffectsError("deploy failed", effects);
          }
        }
      }
    });
  }

  it("GAP-06: a failing step's residual resources are kept and cleanup never reports cleaned while they may exist", async () => {
    const deletes: string[] = [];
    const neon = (await createPreviewEnvironmentWithCleanup({
      name: "residual",
      databases: [{ capsule: residualNeonDatabase(deletes, true), spec: { project: "p1", name: "db" } }]
    }).catch((caught: unknown) => caught)) as PreviewCreationError;
    expect(neon).toBeInstanceOf(PreviewCreationError);
    expect(neon.resources.map((resource) => [resource.kind, resource.provider, resource.id, resource.residual?.locator.scope])).toEqual([
      ["database", "neon", "br-leak-1", { project: "p1" }]
    ]);
    expect(neon.cleanupPlan?.actions.map((action) => [action.resourceId, action.spec.project])).toEqual([["br-leak-1", "p1"]]);
    expect(deletes).toEqual(["p1/br-leak-1"]);
    expect(neon.cleanup?.status).toBe("partial");
    expect(neon.cleanup?.dispositions.map((entry) => entry.disposition)).toEqual(["leaked"]);
    expect(neon.cleanup?.receipt.resource?.status).toBe("partial");

    for (const rollbackFails of [true, false]) {
      const k8s = (await createPreviewEnvironmentWithCleanup({
        name: "residual",
        services: [{ capsule: residualKubernetesService(rollbackFails), spec: { name: "web", image: "img" } }]
      }).catch((caught: unknown) => caught)) as PreviewCreationError;
      const expected = rollbackFails ? ["deployment:web", "service:web"] : ["service:web"];
      expect(k8s.resources.map((resource) => `${resource.residual?.locator.kind}:${resource.id}`).sort()).toEqual(expected);
      expect(k8s.resources.every((resource) => resource.cleanup === undefined)).toBe(true);
      expect(k8s.cleanup?.status).toBe("partial");
      expect(k8s.cleanup?.dispositions.every((entry) => entry.disposition === "leaked")).toBe(true);
    }
  });

  it("GAP-06: the basic create path also returns the failing step's residual for later cleanup", async () => {
    const deletes: string[] = [];
    const error = (await createPreviewGraph({
      name: "residual",
      databases: [{ capsule: residualNeonDatabase(deletes, false), spec: { project: "p1", name: "db" } }]
    }).catch((caught: unknown) => caught)) as PreviewCreationError;
    expect(error.resources.map((resource) => resource.residual?.locator.nativeId)).toEqual(["br-leak-1"]);
    expect(deletes).toEqual([]);
    const cleanup = await cleanupPreviewEnvironment(error.preview, error.resources, { cleanupPlan: error.cleanupPlan });
    expect(cleanup.status).toBe("cleaned");
    expect(deletes).toEqual(["p1/br-leak-1"]);
  });

  it("CD-SECRETS: a policy denial of a later child is found before any child is created", async () => {
    const calls: DeleteCall[] = [];
    let deploys = 0;
    const service = new Capsule({
      adapter: {
        name: "fake-service",
        provider: "fake-service",
        capabilities: { service: { deploy: "native", delete: "native" } } as never,
        service: {
          deploy: async (spec) => {
            deploys += 1;
            return { id: spec.name, provider: "fake-service", name: spec.name, status: "ready" };
          }
        }
      },
      policy: { secrets: { allowed: [] } }
    });
    let creates = 0;
    const database = fakeDatabase("fake", "app", calls);
    const create = database.database.branch.create.bind(database.database.branch);
    database.database.branch.create = async (spec) => {
      creates += 1;
      return create(spec);
    };
    const plan = {
      name: "preflight",
      databases: [{ capsule: database, spec: { project: "app", name: "audit-db" } }],
      services: [{ capsule: service, spec: { name: "web", image: "img", env: { API_TOKEN: "fixture" } } }]
    };
    for (const run of [() => createPreviewGraph(plan), () => createPreviewEnvironmentWithCleanup(plan)]) {
      const error = (await run().catch((caught: unknown) => caught)) as PreviewCreationError;
      expect(error).toBeInstanceOf(PreviewCreationError);
      expect(error.cause).toBeInstanceOf(PolicyViolationError);
      expect(error.resources).toEqual([]);
    }
    expect(creates).toBe(0);
    expect(deploys).toBe(0);
  });

  function namespacedService(namespace: string, deletes: string[], provider = "kubernetes") {
    return new Capsule({
      adapter: {
        name: `kubernetes-${namespace}`,
        provider,
        capabilities: { service: { deploy: "native", delete: "native" } } as never,
        service: {
          deploy: async (spec) => ({ id: spec.name, provider, name: spec.name, status: "ready" }),
          delete: async (spec) => {
            deletes.push(`${namespace}/${spec.id}`);
            return { id: spec.id, provider, name: spec.id, status: "deleted" };
          }
        }
      },
      policy: { approvals: { required: true, reason: "delete needs approval" } }
    });
  }

  it("COMP-01: cleanup without a plan deletes ref-less same-id records through their own Capsule", async () => {
    const deletes: string[] = [];
    const graph = await createPreviewGraph({
      name: "same-id",
      services: [
        { capsule: namespacedService("ns-a", deletes), spec: { name: "web", image: "img", approval: { approved: true, id: "deploy" } } },
        { capsule: namespacedService("ns-b", deletes), spec: { name: "web", image: "img", approval: { approved: true, id: "deploy" } } }
      ]
    });
    const refless = graph.resources.map(({ ref: _ref, ...resource }) => resource);
    const approval = () => ({ approved: true, id: "fresh-delete" });
    const cleanup = await cleanupPreviewEnvironment(graph.preview, refless, { approval });
    expect(cleanup.status).toBe("cleaned");
    expect(deletes.sort()).toEqual(["ns-a/web", "ns-b/web"]);

    deletes.length = 0;
    const plan = (await import("./index.js")).createPreviewCleanupPlan(graph.preview, refless);
    const withPlan = await cleanupPreviewEnvironment(graph.preview, refless, { cleanupPlan: plan, approval });
    expect(withPlan.status).toBe("cleaned");
    expect(deletes.sort()).toEqual(["ns-a/web", "ns-b/web"]);
  });

  it("CD-APPROVAL: same-id cleanup requests are distinguishable and a provider-scoped grant matches only its provider", async () => {
    const deletes: string[] = [];
    const graph = await createPreviewGraph({
      name: "same-id",
      services: [
        { capsule: namespacedService("preview-a", deletes), spec: { name: "web", image: "img", approval: { approved: true, id: "deploy" } } },
        { capsule: namespacedService("other", deletes, "other-cloud"), spec: { name: "web", image: "img", approval: { approved: true, id: "deploy" } } }
      ]
    });
    const requests: CleanupApprovalRequest[] = [];
    const cleanup = await cleanupPreviewEnvironment(graph.preview, graph.resources, {
      cleanupPlan: graph.cleanupPlan,
      approval: (request) => {
        requests.push(request);
        return request.context?.adapter === "kubernetes-preview-a"
          ? { approved: true, id: "only-preview-a", capabilities: ["service.delete"], resources: [request.resource] }
          : undefined;
      }
    });
    expect(new Set(requests.map((request) => JSON.stringify(request))).size).toBe(2);
    expect(requests.map((request) => [request.resource.provider, request.context?.resourceRef]).sort()).toEqual([
      ["kubernetes", "resource-0"],
      ["other-cloud", "resource-1"]
    ]);
    expect(deletes).toEqual(["preview-a/web"]);
    expect(cleanup.status).toBe("partial");

    // The same provider-scoped grant handed to the other provider's delete is refused by core policy.
    const grant: CapsuleApprovalGrant = { approved: true, id: "kubernetes-only", resources: [{ type: "service", id: "web", provider: "kubernetes" }] };
    await expect(namespacedService("other", deletes, "other-cloud").service.delete({ id: "web", approval: grant })).rejects.toBeInstanceOf(
      PolicyViolationError
    );
    await expect(namespacedService("preview-a", deletes).service.delete({ id: "web", approval: grant })).resolves.toMatchObject({ status: "deleted" });
  });
});
