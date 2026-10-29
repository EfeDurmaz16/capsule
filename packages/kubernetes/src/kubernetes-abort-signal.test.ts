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
});
