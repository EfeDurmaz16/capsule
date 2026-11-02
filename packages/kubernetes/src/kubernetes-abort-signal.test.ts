// Deadlines reach the Kubernetes requests they bound. Injected clients only: fakes that record the
// per-request options, and the installed @kubernetes/client-node API classes over a fake HTTP library.
// No cluster or network is contacted.
import * as k8s from "@kubernetes/client-node";
import { describe, expect, it } from "vitest";
import { Capsule, CaptureLimitError, PendingOperationError } from "@capsule-sdk/core";
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

  // The first page has no continue token. A deadline there must still come back with a cursor: an
  // absent nextCursor means "no more pages", and a pager would stop after reading zero pods.
  it.each(["selector read", "pod list"] as const)("hands back a cursor that rereads the first page when the %s misses its deadline", async (hanging) => {
    const listed: Array<string | undefined> = [];
    let serviceReads = 0;
    const hang = async (options?: RequestOptions) => await untilAborted(await attachedSignal(options));
    const capsule = logsCapsule({
      readNamespacedService: async (_input: unknown, options?: RequestOptions) => {
        serviceReads += 1;
        if (hanging === "selector read" && serviceReads === 1) return await hang(options);
        return { metadata: { name: "svc" }, spec: { selector: { app: "svc" } } };
      },
      listNamespacedPod: async (input: { _continue?: string }, options?: RequestOptions) => {
        listed.push(input._continue);
        if (hanging === "pod list" && listed.length === 1) return await hang(options);
        return { items: [pod], metadata: { continue: "pods-page-2" } };
      },
      readNamespacedPodLog: async () => "2026-10-29T10:00:00Z pod-0 up\n"
    });
    const first = await capsule.service.logs({ id: "svc", bounds: { deadlineMs: 40 } });
    expect(first.logs).toEqual([]);
    expect(first.truncation).toMatchObject({ truncated: true, reason: "deadline", limit: 40 });
    expect(typeof first.nextCursor).toBe("string");
    expect(first.nextCursor).not.toBe("");

    const second = await capsule.service.logs({ id: "svc", cursor: first.nextCursor, bounds: { deadlineMs: 60_000 } });
    // The returned cursor asks the API server for the first page again, with no continue token.
    expect(listed.at(-1)).toBeUndefined();
    expect(second.logs).toEqual([{ timestamp: "2026-10-29T10:00:00Z", stream: "stdout", message: "pod-0 up", source: "pod-0" }]);
    expect(second.truncation).toMatchObject({ truncated: false });
    // Paging continues from the first page's continue token as before.
    expect(second.nextCursor).toBe("pods-page-2");
    const third = await capsule.service.logs({ id: "svc", cursor: second.nextCursor, bounds: { deadlineMs: 60_000 } });
    expect(listed.at(-1)).toBe("pods-page-2");
    expect(third.nextCursor).toBe("pods-page-2");
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

  // The pod list of a page can be read in time while one of its pod log reads is not. That page is
  // incomplete, so the deadline must hand back the cursor of the same page, never the next page's token
  // (the unread pod would be skipped for good) and never no cursor (the pager would stop).
  it.each([
    { page: "first and last page", cursor: undefined, continueToken: undefined },
    { page: "first page with a next page", cursor: undefined, continueToken: "page-2" },
    { page: "middle page", cursor: "page-2", continueToken: "page-3" },
    { page: "last page", cursor: "page-3", continueToken: undefined }
  ])("hands back the cursor of the same page when a pod log read misses the deadline on the $page", async ({ cursor, continueToken }) => {
    const listed: Array<string | undefined> = [];
    const capsule = logsCapsule({
      listNamespacedPod: async (input: { _continue?: string }) => {
        listed.push(input._continue);
        return { items: [pod, { ...pod, metadata: { name: "pod-1" } }], metadata: continueToken === undefined ? {} : { continue: continueToken } };
      },
      readNamespacedPodLog: async (input: { name: string }, options?: RequestOptions) => {
        if (input.name === "pod-1") return await untilAborted(await attachedSignal(options));
        return "2026-10-29T10:00:00Z pod-0 up\n";
      }
    });
    const result = await capsule.service.logs({ id: "svc", cursor, bounds: { deadlineMs: 40 } });
    expect(result.truncation).toMatchObject({ truncated: true, reason: "deadline", limit: 40 });
    expect(typeof result.nextCursor).toBe("string");
    expect(result.nextCursor).not.toBe(continueToken);
    if (cursor !== undefined) expect(result.nextCursor).toBe(cursor);

    // Feeding the cursor back asks the API server for the same page: the first page with no continue
    // token, any other page with the token this call was given.
    await capsule.service.logs({ id: "svc", cursor: result.nextCursor, bounds: { deadlineMs: 40 } });
    expect(listed).toEqual([cursor, cursor]);
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

  // The Service or Job read that names the pod selector is a provider request of the capture too. A
  // read that never answers ends at the deadline with no logs, and the next call asks for the same page.
  it.each(["service", "job"] as const)("bounds the %s selector read with the capture deadline and aborts it", async (kind) => {
    const signals: Array<AbortSignal | undefined> = [];
    let listed = false;
    const hangingRead = async (_input: unknown, options?: RequestOptions) => {
      const signal = await attachedSignal(options);
      signals.push(signal);
      return await untilAborted(signal);
    };
    const core = {
      readNamespacedService: hangingRead,
      listNamespacedPod: async () => {
        listed = true;
        return { items: [pod] };
      },
      readNamespacedPodLog: async () => "2026-10-29T10:00:00Z never read\n"
    };
    const capsule = new Capsule({
      adapter: kubernetes({ clients: { batch: { readNamespacedJob: hangingRead } as never, apps: {} as never, core: core as never } })
    });
    const spec = { id: "owner", cursor: "page-2", bounds: { deadlineMs: 40 } };
    const result = await Promise.race([
      kind === "service" ? capsule.service.logs(spec) : capsule.job.logs(spec),
      new Promise<"still pending">((resolve) => setTimeout(() => resolve("still pending"), 1_000))
    ]);
    expect(result).not.toBe("still pending");
    if (result === "still pending") return;
    expect(result.logs).toEqual([]);
    expect(result.truncation).toMatchObject({ truncated: true, reason: "deadline", limit: 40 });
    expect(result.nextCursor).toBe("page-2");
    expect(listed).toBe(false);
    expect(signals).toHaveLength(1);
    expect(signals[0]?.aborted).toBe(true);
  });

  it("throws CaptureLimitError when the selector read misses the deadline and overflow is error", async () => {
    const capsule = logsCapsule({
      readNamespacedService: async (_input: unknown, options?: RequestOptions) => await untilAborted(await attachedSignal(options)),
      listNamespacedPod: async () => ({ items: [pod] }),
      readNamespacedPodLog: async () => "2026-10-29T10:00:00Z never read\n"
    });
    const outcome = await Promise.race([
      capsule.service.logs({ id: "svc", bounds: { deadlineMs: 40, overflow: "error" } }).catch((caught: unknown) => caught),
      new Promise<"still pending">((resolve) => setTimeout(() => resolve("still pending"), 1_000))
    ]);
    expect(outcome).toBeInstanceOf(CaptureLimitError);
  });
});

// The same paths through the installed client's generated API classes: the per-request middleware must
// be one the client accepts, reach the HTTP library's request context and keep the middleware the
// client was built with.
describe("kubernetes request signal through @kubernetes/client-node", () => {
  type Sent = { method: string; url: string; signal?: AbortSignal; staticHeader?: string };

  function sdkClients(answer: (request: k8s.RequestContext) => Promise<k8s.ResponseContext> | undefined, auth?: k8s.SecurityAuthentication) {
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
      authMethods: auth ? { default: auth } : {},
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
    return { sent, apps: new k8s.AppsV1Api(configuration), batch: new k8s.BatchV1Api(configuration), core: new k8s.CoreV1Api(configuration) };
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

  it("aborts the Service and Job selector reads at the capture deadline", async () => {
    for (const kind of ["service", "job"] as const) {
      const { sent, batch, core } = sdkClients(() => undefined);
      const capsule = new Capsule({ adapter: kubernetes({ clients: { batch, apps: {} as never, core } as never }) });
      const spec = { id: "owner", bounds: { deadlineMs: 40 } };
      const result = await Promise.race([
        kind === "service" ? capsule.service.logs(spec) : capsule.job.logs(spec),
        new Promise<"still pending">((resolve) => setTimeout(() => resolve("still pending"), 1_000))
      ]);
      expect(result).not.toBe("still pending");
      if (result === "still pending") return;
      expect(result.truncation).toMatchObject({ truncated: true, reason: "deadline" });
      expect(sent).toHaveLength(1);
      expect(sent[0]?.url).toBe(
        kind === "service"
          ? "https://kubernetes.test/api/v1/namespaces/default/services/owner"
          : "https://kubernetes.test/apis/batch/v1/namespaces/default/jobs/owner"
      );
      expect(sent[0]?.staticHeader).toBe("kept");
      expect(sent[0]?.signal?.aborted).toBe(true);
    }
  });
  // The client applies authentication (an exec credential plugin such as aws eks get-token or the GKE
  // auth plugin) while it builds the request, before the per-request middleware attaches the signal, so
  // a hung plugin cannot be cancelled. It must still send nothing once the deadline has passed.
  function slowAuth(when: (request: k8s.RequestContext) => boolean) {
    let release: () => void = () => undefined;
    const released = new Promise<void>((resolve) => (release = resolve));
    const auth: k8s.SecurityAuthentication = {
      getName: () => "slow-plugin",
      applySecurityAuthentication: async (request) => {
        if (when(request)) await released;
        request.setHeaderParam("authorization", "Bearer late");
      }
    };
    return { auth, release: () => release() };
  }
  const settled = () => new Promise((resolve) => setTimeout(resolve, 20));

  it("sends no log capture request after the deadline when the auth step answers late", async () => {
    const { auth, release } = slowAuth(() => true);
    const { sent, core } = sdkClients(() => undefined, auth);
    const capsule = new Capsule({ adapter: kubernetes({ clients: { batch: {} as never, apps: {} as never, core } as never }) });
    const result = await Promise.race([
      capsule.service.logs({ id: "svc", bounds: { deadlineMs: 40 } }),
      new Promise<"still pending">((resolve) => setTimeout(() => resolve("still pending"), 1_000))
    ]);
    expect(result).not.toBe("still pending");
    if (result === "still pending") return;
    expect(result.logs).toEqual([]);
    expect(result.truncation).toMatchObject({ truncated: true, reason: "deadline", limit: 40 });
    expect(sent).toHaveLength(0);
    release();
    await settled();
    expect(sent).toHaveLength(0);
  });

  it("sends no service.delete observation GET after the deadline when the auth step answers late", async () => {
    const { auth, release } = slowAuth((request) => request.getHttpMethod() === k8s.HttpMethod.GET);
    const { sent, apps, core } = sdkClients((request) => {
      if (request.getHttpMethod() === k8s.HttpMethod.DELETE) {
        return json({ apiVersion: "apps/v1", kind: "Deployment", metadata: { name: "app", deletionTimestamp: "2026-10-29T00:00:00Z" } });
      }
      return undefined;
    }, auth);
    const capsule = new Capsule({
      adapter: kubernetes({ operationDeadlineMs: 40, operationPollIntervalMs: 5, clients: { batch: {} as never, apps, core } as never })
    });
    const error = await Promise.race([
      capsule.service.delete({ id: "app" }).catch((caught: unknown) => caught),
      new Promise<"still pending">((resolve) => setTimeout(() => resolve("still pending"), 1_000))
    ]);
    expect(error).toBeInstanceOf(PendingOperationError);
    const reads = () => sent.filter((request) => request.method === k8s.HttpMethod.GET);
    expect(reads()).toHaveLength(0);
    release();
    await settled();
    expect(reads()).toHaveLength(0);
  });
});
