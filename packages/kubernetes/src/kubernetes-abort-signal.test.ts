// Deadlines reach the Kubernetes requests they bound. Injected clients only: fakes that record the
// per-request options, and the installed @kubernetes/client-node API classes over a fake HTTP library.
// No cluster or network is contacted.
import * as k8s from "@kubernetes/client-node";
import { describe, expect, it } from "vitest";
import { Capsule, PendingOperationError } from "@capsule-sdk/core";
import { kubernetes } from "./index.js";

type RequestOptions = { middleware?: Array<{ pre(context: unknown): { toPromise(): Promise<unknown> } }>; middlewareMergeStrategy?: string };

// Runs the request middleware against a minimal request context, as the client's Observable layer
// does, and returns the signal it attached.
async function attachedSignal(options: RequestOptions | undefined): Promise<AbortSignal | undefined> {
  let signal: AbortSignal | undefined;
  const context = {
    setSignal(value: AbortSignal) {
      signal = value;
    }
  };
  for (const middleware of options?.middleware ?? []) await middleware.pre(context).toPromise();
  return signal;
}

// Like the HTTP library, settles only when the request's signal aborts; without a signal it never does.
function untilAborted(signal: AbortSignal | undefined): Promise<never> {
  return new Promise((_resolve, reject) => signal?.addEventListener("abort", () => reject(signal.reason), { once: true }));
}

const notFound = () => Object.assign(new Error("NotFound"), { statusCode: 404, code: 404 });
const pod = { metadata: { name: "pod-0" }, spec: { containers: [{ name: "web", image: "web" }] } };

describe("kubernetes service.delete observation signal", () => {
  it.each(["deployment", "service"] as const)("hands the observation signal to the %s read and aborts it at the deadline", async (hanging) => {
    const received: Array<RequestOptions | undefined> = [];
    const signals: Array<AbortSignal | undefined> = [];
    const read = async (kind: "deployment" | "service", options?: RequestOptions) => {
      if (kind !== hanging) throw notFound();
      received.push(options);
      const signal = await attachedSignal(options);
      signals.push(signal);
      return await untilAborted(signal);
    };
    const capsule = new Capsule({
      adapter: kubernetes({
        operationDeadlineMs: 40,
        operationPollIntervalMs: 5,
        clients: {
          batch: {} as never,
          apps: {
            createNamespacedDeployment: async () => ({}),
            deleteNamespacedDeployment: async () => ({ metadata: { name: "app", deletionTimestamp: "2026-10-29T00:00:00Z" } }),
            readNamespacedDeployment: async (_input: unknown, options?: RequestOptions) => await read("deployment", options)
          },
          core: {
            createNamespacedService: async () => ({}),
            deleteNamespacedService: async () => ({ metadata: { name: "app", deletionTimestamp: "2026-10-29T00:00:00Z" } }),
            readNamespacedService: async (_input: unknown, options?: RequestOptions) => await read("service", options)
          }
        }
      })
    });
    const error = await capsule.service.delete({ id: "app" }).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(PendingOperationError);
    expect(received).toHaveLength(1);
    expect(received[0]?.middlewareMergeStrategy).toBe("append");
    expect(signals[0]).toBeInstanceOf(AbortSignal);
    expect(signals[0]?.aborted).toBe(true);
  });
});

describe("kubernetes log capture signal", () => {
  function logsCapsule(core: Record<string, unknown>) {
    return new Capsule({
      adapter: kubernetes({
        clients: {
          batch: {} as never,
          apps: {} as never,
          core: { readNamespacedService: async () => ({ metadata: { name: "svc" }, spec: { selector: { app: "svc" } } }), ...core } as never
        }
      })
    });
  }

  it("bounds the pod list with the capture deadline and aborts it", async () => {
    const signals: Array<AbortSignal | undefined> = [];
    const capsule = logsCapsule({
      listNamespacedPod: async (_input: unknown, options?: RequestOptions) => {
        const signal = await attachedSignal(options);
        signals.push(signal);
        return await untilAborted(signal);
      },
      readNamespacedPodLog: async () => "2026-10-29T10:00:00Z never read\n"
    });
    const result = await capsule.service.logs({ id: "svc", cursor: "page-2", bounds: { deadlineMs: 40 } });
    expect(result.logs).toEqual([]);
    expect(result.truncation).toMatchObject({ truncated: true, reason: "deadline", limit: 40 });
    // The page was not read, so the next call asks for the same page again.
    expect(result.nextCursor).toBe("page-2");
    expect(signals).toHaveLength(1);
    expect(signals[0]?.aborted).toBe(true);
  });

  it("aborts a pod log read that is still in flight at the capture deadline", async () => {
    const signals: Array<AbortSignal | undefined> = [];
    const capsule = logsCapsule({
      listNamespacedPod: async () => ({ items: [pod] }),
      readNamespacedPodLog: async (_input: unknown, options?: RequestOptions) => {
        const signal = await attachedSignal(options);
        signals.push(signal);
        return await untilAborted(signal);
      }
    });
    const result = await capsule.service.logs({ id: "svc", bounds: { deadlineMs: 40 } });
    expect(result.truncation).toMatchObject({ truncated: true, reason: "deadline", limit: 40 });
    expect(signals).toHaveLength(1);
    expect(signals[0]?.aborted).toBe(true);
  });

  it("aborts the reads still in flight when another read fails the capture", async () => {
    const signals: Array<AbortSignal | undefined> = [];
    const capsule = logsCapsule({
      listNamespacedPod: async () => ({ items: [pod, { ...pod, metadata: { name: "pod-1" } }] }),
      readNamespacedPodLog: async (input: { name: string }, options?: RequestOptions) => {
        const signal = await attachedSignal(options);
        signals.push(signal);
        if (input.name === "pod-1") throw Object.assign(new Error("Forbidden"), { statusCode: 403, code: 403 });
        return await untilAborted(signal);
      }
    });
    await expect(capsule.service.logs({ id: "svc", bounds: { deadlineMs: 60_000, concurrency: 2 } })).rejects.toThrow("Forbidden");
    expect(signals).toHaveLength(2);
    expect(signals.every((signal) => signal?.aborted === true)).toBe(true);
  });
});

// The same paths through the installed client's generated API classes: the per-request middleware must
// be one the client accepts, reach the HTTP library's request context and keep the middleware the
// client was built with.
describe("kubernetes request signal through @kubernetes/client-node", () => {
  type Sent = { method: string; url: string; signal?: AbortSignal; staticHeader?: string };

  function sdkClients(answer: (request: k8s.RequestContext) => Promise<k8s.ResponseContext> | undefined) {
    const sent: Sent[] = [];
    const httpApi: k8s.HttpLibrary = {
      send(request) {
        const signal = request.getSignal();
        sent.push({ method: request.getHttpMethod(), url: request.getUrl(), signal, staticHeader: request.getHeaders()["x-capsule-static"] });
        return new k8s.Observable(answer(request) ?? untilAborted(signal));
      }
    };
    const configuration = k8s.createConfiguration({
      baseServer: new k8s.ServerConfiguration("https://kubernetes.test", {}),
      httpApi,
      authMethods: {},
      promiseMiddleware: [
        {
          pre: async (request) => {
            request.setHeaderParam("x-capsule-static", "kept");
            return request;
          },
          post: async (response) => response
        }
      ]
    });
    return { sent, apps: new k8s.AppsV1Api(configuration), core: new k8s.CoreV1Api(configuration) };
  }

  const json = (body: unknown) =>
    Promise.resolve(
      new k8s.ResponseContext(
        200,
        { "content-type": "application/json" },
        { text: async () => JSON.stringify(body), binary: async () => Buffer.from(JSON.stringify(body)) }
      )
    );

  it("aborts the service.delete observation GET at the deadline", async () => {
    const { sent, apps, core } = sdkClients((request) => {
      if (request.getHttpMethod() === k8s.HttpMethod.DELETE) {
        return json({ apiVersion: "apps/v1", kind: "Deployment", metadata: { name: "app", deletionTimestamp: "2026-10-29T00:00:00Z" } });
      }
      return undefined;
    });
    const capsule = new Capsule({
      adapter: kubernetes({ operationDeadlineMs: 40, operationPollIntervalMs: 5, clients: { batch: {} as never, apps, core } as never })
    });
    const error = await capsule.service.delete({ id: "app" }).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(PendingOperationError);
    const read = sent.find((request) => request.method === k8s.HttpMethod.GET);
    expect(read?.url).toBe("https://kubernetes.test/apis/apps/v1/namespaces/default/deployments/app");
    expect(read?.staticHeader).toBe("kept");
    expect(read?.signal?.aborted).toBe(true);
  });

  it("aborts the pod list and pod log reads at the capture deadline", async () => {
    for (const hanging of ["pods", "log"] as const) {
      const { sent, core } = sdkClients((request) => {
        const path = new URL(request.getUrl()).pathname;
        if (path.endsWith("/services/svc")) return json({ apiVersion: "v1", kind: "Service", metadata: { name: "svc" }, spec: { selector: { app: "svc" } } });
        if (path.endsWith("/pods") && hanging === "log") return json({ apiVersion: "v1", kind: "PodList", metadata: {}, items: [pod] });
        return undefined;
      });
      const capsule = new Capsule({ adapter: kubernetes({ clients: { batch: {} as never, apps: {} as never, core } as never }) });
      const result = await capsule.service.logs({ id: "svc", bounds: { deadlineMs: 40 } });
      expect(result.truncation).toMatchObject({ truncated: true, reason: "deadline" });
      const bounded = sent.filter((request) => !new URL(request.url).pathname.endsWith("/services/svc"));
      expect(bounded.at(-1)?.url).toContain(hanging === "pods" ? "/namespaces/default/pods?labelSelector=app%3Dsvc" : "/pods/pod-0/log?");
      expect(bounded.every((request) => request.staticHeader === "kept" && request.signal?.aborted === true)).toBe(true);
    }
  });
});
