// Audit regressions for the M1 campaign (Kubernetes). Each test asserts the INTENDED behavior from the M1
// manifest and is marked it.fails while the defect is present on the baseline (7d3a28a). The owner who
// fixes an ID flips its it.fails to it in the same commit. Clients are injected fakes; no cluster.
import { describe, expect, it } from "vitest";
import { Capsule, CleanupFailureError, PartialEffectsError, PendingOperationError, ProviderRetryableError, partialEffectsOf } from "@capsule-sdk/core";
import { kubernetes } from "./index.js";

type Pod = { metadata: { name: string }; spec: { containers: Array<{ name: string; env: Array<{ name: string; value: string }> }> } };
const pod = (name: string, token: string): Pod => ({ metadata: { name }, spec: { containers: [{ name: "app", env: [{ name: "TOKEN", value: token }] }] } });

function logsCapsule(pods: Pod[], logFor: (name: string) => string) {
  return new Capsule({
    adapter: kubernetes({
      clients: {
        batch: {} as never,
        apps: {} as never,
        core: {
          readNamespacedService: async () => ({ metadata: { name: "svc" }, spec: { selector: { app: "svc" } } }),
          listNamespacedPod: async () => ({ items: pods }),
          readNamespacedPodLog: async ({ name }: { name: string }) => logFor(name)
        } as never
      }
    }),
    policy: { secrets: { redactFromLogs: true } }
  });
}

describe("M1 audit regressions: kubernetes", () => {
  it("SVC-01: literal secrets from every selected pod are redacted, not only the last value per key", async () => {
    const capsule = logsCapsule([pod("old", "synthetic-old-credential"), pod("new", "synthetic-new-credential")], (name) =>
      name === "old" ? "2026-10-25T00:00:00Z token=synthetic-old-credential" : "2026-10-25T00:00:01Z token=synthetic-new-credential"
    );
    const messages = (await capsule.service.logs({ id: "svc", limit: 10 })).logs.map((entry) => entry.message);
    expect(messages).toHaveLength(2);
    for (const message of messages) {
      expect(message).not.toContain("synthetic-old-credential");
      expect(message).not.toContain("synthetic-new-credential");
    }
  });

  it("SVC-09: limit selects the globally newest entries regardless of provider pod order", async () => {
    const capsule = logsCapsule([pod("new", "a-value"), pod("old", "b-value")], (name) =>
      name === "new" ? "2026-10-25T10:00:00.000000002Z newest" : "2026-10-24T10:00:00.000000001Z oldest"
    );
    const logs = (await capsule.service.logs({ id: "svc", limit: 1 })).logs;
    expect(logs.map((entry) => entry.message)).toEqual(["newest"]);
  });

  it("SVC-09: nanosecond timestamps inside one millisecond and equal timestamps order deterministically", async () => {
    const capsule = logsCapsule([pod("a", "a-value"), pod("b", "b-value"), pod("c", "c-value")], (name) =>
      name === "a"
        ? "2026-10-25T10:00:00.000000002Z later-in-same-ms"
        : name === "b"
          ? "2026-10-25T10:00:00.000000001Z earlier-in-same-ms"
          : "2026-10-25T10:00:00.000000001Z tie-from-c"
    );
    const logs = (await capsule.service.logs({ id: "svc", limit: 3 })).logs;
    expect(logs.map((entry) => `${entry.source}:${entry.message}`)).toEqual(["b:earlier-in-same-ms", "c:tie-from-c", "a:later-in-same-ms"]);
    expect((await capsule.service.logs({ id: "svc", limit: 1 })).logs.map((entry) => entry.message)).toEqual(["later-in-same-ms"]);
  });

  it("SVC-06: Deployment and Service cleanup are independent and a retry converges on the Service", async () => {
    let deploymentGone = false;
    let serviceCalls = 0;
    const notFound = () => Object.assign(new Error("NotFound"), { statusCode: 404, code: 404 });
    const capsule = new Capsule({
      adapter: kubernetes({
        clients: {
          batch: {} as never,
          apps: {
            createNamespacedDeployment: async () => ({}),
            deleteNamespacedDeployment: async () => {
              if (deploymentGone) throw notFound();
              deploymentGone = true;
              return {};
            }
          } as never,
          core: {
            createNamespacedService: async () => ({}),
            deleteNamespacedService: async () => {
              serviceCalls += 1;
              if (serviceCalls === 1) throw Object.assign(new Error("ServiceUnavailable"), { statusCode: 503, code: 503 });
              return {};
            }
          } as never
        }
      })
    });
    await expect(capsule.service.delete({ id: "app" })).rejects.toThrow();
    await capsule.service.delete({ id: "app" }).catch(() => undefined);
    expect(serviceCalls).toBe(2);
  });

  it("SVC-06/GAP-08: a partial failure keeps both resource ids and a retry converges to observed deletion", async () => {
    const deleted = { deployment: false, service: false };
    let serviceCalls = 0;
    const notFound = () => Object.assign(new Error("NotFound"), { statusCode: 404, code: 404 });
    const capsule = new Capsule({
      adapter: kubernetes({
        namespace: "preview",
        operationPollIntervalMs: 1,
        clients: {
          batch: {} as never,
          apps: {
            createNamespacedDeployment: async () => ({}),
            deleteNamespacedDeployment: async () => {
              if (deleted.deployment) throw notFound();
              deleted.deployment = true;
              return { metadata: { name: "app", deletionTimestamp: "2026-10-27T00:00:00Z" } };
            },
            readNamespacedDeployment: async () => {
              if (deleted.deployment) throw notFound();
              return { metadata: { name: "app" } };
            }
          } as never,
          core: {
            createNamespacedService: async () => ({}),
            deleteNamespacedService: async () => {
              serviceCalls += 1;
              if (serviceCalls === 1) throw Object.assign(new Error("ServiceUnavailable"), { statusCode: 503, code: 503 });
              deleted.service = true;
              return { metadata: { name: "app", deletionTimestamp: "2026-10-27T00:00:00Z" } };
            },
            readNamespacedService: async () => {
              if (deleted.service) throw notFound();
              return { metadata: { name: "app" } };
            }
          } as never
        }
      })
    });
    const first = await capsule.service.delete({ id: "app" }).catch((error: unknown) => error);
    expect(first).toBeInstanceOf(PartialEffectsError);
    const effects = partialEffectsOf(first)!;
    expect(effects).toMatchObject({ operation: "service.delete", outcome: "failed", cleanup: { status: "not-attempted" } });
    expect(effects.resources.map((resource) => `${resource.kind}:${resource.nativeId}:${resource.scope?.namespace}`).sort()).toEqual([
      "deployment:app:preview",
      "service:app:preview"
    ]);
    expect(effects.primaryError).toBeInstanceOf(ProviderRetryableError);

    const second = await capsule.service.delete({ id: "app" });
    expect(second.status).toBe("deleted");
    expect(second.metadata).toMatchObject({ observed: { deployment: "already-absent", service: "deleted" } });
  });

  it("GAP-08: an accepted foreground delete whose object is still terminating is pending, never deleted", async () => {
    const capsule = new Capsule({
      adapter: kubernetes({
        operationDeadlineMs: 50,
        operationPollIntervalMs: 5,
        clients: {
          batch: {} as never,
          apps: {
            createNamespacedDeployment: async () => ({}),
            deleteNamespacedDeployment: async () => ({ metadata: { name: "app", deletionTimestamp: "2026-10-27T00:00:00Z" } }),
            readNamespacedDeployment: async () => ({ metadata: { name: "app", deletionTimestamp: "2026-10-27T00:00:00Z" } })
          } as never,
          core: {
            createNamespacedService: async () => ({}),
            deleteNamespacedService: async () => ({ kind: "Status", status: "Success" }),
            readNamespacedService: async () => {
              throw Object.assign(new Error("NotFound"), { statusCode: 404, code: 404 });
            }
          } as never
        }
      })
    });
    const error = await capsule.service.delete({ id: "app" }).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(PendingOperationError);
    expect(error).toMatchObject({ operation: "service.delete", state: "deployment=terminating", resource: { kind: "service", nativeId: "app" } });
  });

  it("GAP-08: a failed deploy reports the Deployment rollback outcome instead of swallowing it", async () => {
    const capsule = new Capsule({
      adapter: kubernetes({
        clients: {
          batch: {} as never,
          apps: {
            createNamespacedDeployment: async () => ({ metadata: { name: "app" } }),
            deleteNamespacedDeployment: async () => {
              throw Object.assign(new Error("Forbidden"), { statusCode: 403, code: 403 });
            }
          } as never,
          core: {
            createNamespacedService: async () => {
              throw Object.assign(new Error("Invalid"), { statusCode: 422, code: 422 });
            }
          } as never
        }
      })
    });
    const error = await capsule.service.deploy({ name: "app", image: "i" }).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(CleanupFailureError);
    expect(partialEffectsOf(error)).toMatchObject({
      operation: "service.deploy",
      outcome: "failed",
      resources: [{ kind: "deployment", nativeId: "app" }],
      cleanup: { status: "failed", residual: [{ kind: "deployment", nativeId: "app" }] }
    });
  });

  it("SVC-08: every multi-port Service entry has a unique valid name", async () => {
    let body: { spec: { ports: Array<{ name?: string }> } } | undefined;
    const capsule = new Capsule({
      adapter: kubernetes({
        clients: {
          batch: {} as never,
          apps: { createNamespacedDeployment: async () => ({}) } as never,
          core: {
            createNamespacedService: async (input: { body: typeof body }) => {
              body = input.body;
              return {};
            }
          } as never
        }
      })
    });
    await capsule.service.deploy({ name: "app", image: "i", ports: [{ port: 8080 }, { port: 9090 }] });
    const names = body!.spec.ports.map((port) => port.name);
    expect(names.every((name) => typeof name === "string" && /^[a-z0-9]([-a-z0-9]*[a-z0-9])?$/.test(name) && name.length <= 15)).toBe(true);
    expect(new Set(names).size).toBe(names.length);
  });

  it("SVC-08: duplicate or invalid ports fail before the Deployment is created", async () => {
    let deployments = 0;
    const capsule = new Capsule({
      adapter: kubernetes({
        clients: {
          batch: {} as never,
          apps: {
            createNamespacedDeployment: async () => {
              deployments += 1;
              return {};
            }
          } as never,
          core: { createNamespacedService: async () => ({}) } as never
        }
      })
    });
    await expect(capsule.service.deploy({ name: "app", image: "i", ports: [{ port: 8080 }, { port: 8080, protocol: "tcp" }] })).rejects.toThrow(/more than once/);
    await expect(capsule.service.deploy({ name: "app", image: "i", ports: [{ port: 70000 }] })).rejects.toThrow(/between 1 and 65535/);
    expect(deployments).toBe(0);
  });

  describe("GAP-16: names are valid after truncation and generated names do not collide", () => {
    function namingCapsule() {
      const jobs: string[] = [];
      const deployments: string[] = [];
      const capsule = new Capsule({
        adapter: kubernetes({
          clients: {
            batch: {
              createNamespacedJob: async ({ body }: { body: { metadata: { name: string } } }) => {
                jobs.push(body.metadata.name);
                return {};
              }
            } as never,
            apps: {
              createNamespacedDeployment: async ({ body }: { body: { metadata: { name: string } } }) => {
                deployments.push(body.metadata.name);
                return {};
              }
            } as never,
            core: { createNamespacedService: async () => ({}) } as never
          }
        })
      });
      return { capsule, jobs, deployments };
    }

    it("never ends a truncated name with a dash", async () => {
      const { capsule, jobs } = namingCapsule();
      await capsule.job.run({ name: `${"a".repeat(62)}-b`, image: "i" });
      expect(jobs[0]).toBe("a".repeat(62));
    });

    it("rejects a name with no valid characters, and a Service name that starts with a digit, before any request", async () => {
      const { capsule, jobs, deployments } = namingCapsule();
      await expect(capsule.job.run({ name: "!!!", image: "i" })).rejects.toThrow(/valid Kubernetes name/);
      await expect(capsule.service.deploy({ name: "___", image: "i" })).rejects.toThrow(/valid Kubernetes name/);
      await expect(capsule.service.deploy({ name: "1api", image: "i" })).rejects.toThrow(/must start with a letter/);
      expect(jobs).toEqual([]);
      expect(deployments).toEqual([]);
    });

    it("generates distinct job names within the same millisecond", async () => {
      const { capsule, jobs } = namingCapsule();
      const now = Date.now;
      Date.now = () => 1_800_000_000_000;
      try {
        await capsule.job.run({ image: "i" });
        await capsule.job.run({ image: "i" });
      } finally {
        Date.now = now;
      }
      expect(jobs[0]).toMatch(/^capsule-job-[a-z0-9]+-[0-9a-f]{8}$/);
      expect(jobs[0]).not.toBe(jobs[1]);
    });
  });

  it("GAP-07: command healthchecks and autoscaling ranges are rejected instead of silently dropped", async () => {
    let deployments = 0;
    const capsule = new Capsule({
      adapter: kubernetes({
        clients: {
          batch: {} as never,
          apps: {
            createNamespacedDeployment: async () => {
              deployments += 1;
              return {};
            }
          } as never,
          core: { createNamespacedService: async () => ({}) } as never
        }
      })
    });
    await expect(capsule.service.deploy({ name: "app", image: "i", healthcheck: { command: ["true"] } })).rejects.toThrow(/healthcheck.command/);
    await expect(capsule.service.deploy({ name: "app", image: "i", scale: { min: 1, max: 3 } })).rejects.toThrow(/scale.max/);
    expect(deployments).toBe(0);
    await capsule.service.deploy({ name: "app", image: "i", scale: { min: 2, max: 2 }, healthcheck: { path: "/healthz" } });
    expect(deployments).toBe(1);
  });

  it("GAP-15: job.run on a just-created Job reports no exit code or result", async () => {
    const capsule = new Capsule({
      adapter: kubernetes({
        clients: {
          batch: { createNamespacedJob: async () => ({ metadata: { name: "build" } }) } as never,
          apps: {} as never,
          core: {} as never
        }
      })
    });
    const run = await capsule.job.run({ name: "build", image: "i" });
    expect(run.status).toBe("running");
    expect(run.result).toBeUndefined();
  });
});
