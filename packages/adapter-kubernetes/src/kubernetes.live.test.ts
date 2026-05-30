import { describe, expect, test } from "vitest";
import { Capsule } from "@capsule/core";
import { liveResourceMetadata, liveTest, liveTestGate } from "@capsule/test-utils";
import { kubernetes } from "./index.js";

describe("kubernetes live smoke", () => {
  liveTest(
    test,
    "creates and deletes a live Kubernetes Job",
    liveTestGate({ provider: "kubernetes", credentials: ["CAPSULE_KUBERNETES_NAMESPACE"] }),
    async () => {
      const capsule = new Capsule({
        adapter: kubernetes({
          namespace: process.env.CAPSULE_KUBERNETES_NAMESPACE,
          context: process.env.KUBECONFIG_CONTEXT,
          kubeconfigPath: process.env.KUBECONFIG
        }),
        receipts: true
      });
      const liveResource = liveResourceMetadata({ provider: "kubernetes", resource: "job" });
      const name = liveResource.name;
      let jobId: string | undefined;

      try {
        const run = await capsule.job.run({
          name,
          image: process.env.CAPSULE_KUBERNETES_IMAGE ?? "busybox:1.36",
          command: ["sh", "-c", "echo capsule live smoke"],
          labels: liveResource.labels
        });
        jobId = run.id;
        expect(run.provider).toBe("kubernetes");
        expect(run.receipt?.type).toBe("job.run");
      } finally {
        if (jobId) {
          await capsule.job.cancel({ id: jobId, reason: "capsule live smoke cleanup" }).catch(() => undefined);
        }
      }
    },
    120_000
  );
});
