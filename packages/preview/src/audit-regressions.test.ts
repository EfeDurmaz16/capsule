// Audit regressions for the M1 campaign (preview composition). Each test asserts the INTENDED behavior
// from the M1 manifest and is marked it.fails while the defect is present on the baseline (7d3a28a). The
// owner who fixes an ID flips its it.fails to it in the same commit. All adapters are in-memory fakes.
import { afterEach, describe, expect, it, vi } from "vitest";
import { Capsule } from "@capsule-sdk/core";
import { aggregatePreviewStatus, cleanupPreviewEnvironment, createPreviewGraph, createPreviewId } from "./index.js";

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
    it.fails(`COMP-01: equal native ids (${providers.join(", ")}) clean up through their own Capsule and project`, async () => {
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

  it.fails("COMP-02: a cancelled required check never aggregates to ready", () => {
    expect(aggregatePreviewStatus([{ type: "job", kind: "job", id: "check", provider: "fake", status: "cancelled" } as never])).not.toBe("ready");
  });

  it.fails("COMP-05: the aggregate preview receipt duration covers provisioning time", async () => {
    const graph = await createPreviewGraph({
      name: "timing",
      databases: [{ capsule: fakeDatabase("fake", "p", [], 40), spec: { project: "p", name: "slow" } }]
    });
    expect(graph.receipts.at(-1)?.durationMs ?? 0).toBeGreaterThanOrEqual(30);
  });

  it.fails("COMP-06: the same name in the same millisecond yields distinct preview ids", () => {
    vi.spyOn(Date, "now").mockReturnValue(123);
    expect(createPreviewId("a")).not.toBe(createPreviewId("a"));
  });
});
