// Audit regressions for the M1 campaign (Kubernetes). Each test asserts the INTENDED behavior from the M1
// manifest and is marked it.fails while the defect is present on the baseline (7d3a28a). The owner who
// fixes an ID flips its it.fails to it in the same commit. Clients are injected fakes; no cluster.
import { describe, expect, it } from "vitest";
import { Capsule } from "@capsule-sdk/core";
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

  it.fails("SVC-06: Deployment and Service cleanup are independent and a retry converges on the Service", async () => {
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
});
