// PERF-06: kubeconfig parsing and API client construction happen once per adapter unless reload is
// requested. KubeConfig methods are stubbed; no cluster or kubeconfig file is touched.
import * as k8s from "@kubernetes/client-node";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Capsule } from "@capsule-sdk/core";
import { kubernetes } from "./index.js";

const fakeApi = {
  readNamespacedJob: async ({ name }: { name: string }) => ({ metadata: { name }, status: { active: 1 } })
};

function stubKubeConfig(options: { failFirstLoad?: boolean } = {}) {
  let loads = 0;
  const load = vi.spyOn(k8s.KubeConfig.prototype, "loadFromDefault").mockImplementation(() => {
    loads += 1;
    if (options.failFirstLoad && loads === 1) throw new Error("kubeconfig not readable yet");
  });
  const make = vi.spyOn(k8s.KubeConfig.prototype, "makeApiClient").mockImplementation(() => fakeApi as never);
  return { load, make };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("kubernetes client reuse (PERF-06)", () => {
  it("parses the kubeconfig and builds the API clients once across operations", async () => {
    const { load, make } = stubKubeConfig();
    const capsule = new Capsule({ adapter: kubernetes() });
    for (const id of ["a", "b", "c"]) await capsule.job.status({ id });
    expect(load).toHaveBeenCalledTimes(1);
    expect(make).toHaveBeenCalledTimes(3);
  });

  it("does not build clients when the adapter is only constructed", () => {
    const { load } = stubKubeConfig();
    kubernetes();
    expect(load).not.toHaveBeenCalled();
  });

  it("retries a failed kubeconfig load on the next operation instead of caching the failure", async () => {
    const { load } = stubKubeConfig({ failFirstLoad: true });
    const capsule = new Capsule({ adapter: kubernetes() });
    await expect(capsule.job.status({ id: "a" })).rejects.toThrow("kubeconfig not readable yet");
    await expect(capsule.job.status({ id: "a" })).resolves.toMatchObject({ status: "running" });
    await capsule.job.status({ id: "b" });
    expect(load).toHaveBeenCalledTimes(2);
  });

  it("rereads the kubeconfig per operation when reload is requested", async () => {
    const { load } = stubKubeConfig();
    const capsule = new Capsule({ adapter: kubernetes({ reloadKubeconfigPerOperation: true }) });
    for (const id of ["a", "b", "c"]) await capsule.job.status({ id });
    expect(load).toHaveBeenCalledTimes(3);
  });
});
