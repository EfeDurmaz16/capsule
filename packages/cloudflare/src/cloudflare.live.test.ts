import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { Capsule } from "@capsule-sdk/core";
import { liveResourceMetadata, liveTest, liveTestGate } from "@capsule-sdk/test-utils";
import { cloudflare } from "./index.js";

async function workerFile(message = "capsule live smoke"): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "capsule-cloudflare-live-"));
  const file = join(dir, "worker.js");
  await writeFile(file, `export default { fetch() { return new Response(${JSON.stringify(message)}) } }`);
  return file;
}

describe("cloudflare live smoke", () => {
  liveTest(
    test,
    "creates an unreleased live Cloudflare Worker version",
    liveTestGate({
      provider: "cloudflare",
      credentials: ["CLOUDFLARE_API_TOKEN", "CLOUDFLARE_ACCOUNT_ID", "CAPSULE_CLOUDFLARE_WORKER_NAME", "CAPSULE_CLOUDFLARE_LIVE_CREATE_VERSION"]
    }),
    async () => {
      const capsule = new Capsule({
        adapter: cloudflare({
          apiToken: process.env.CLOUDFLARE_API_TOKEN,
          accountId: process.env.CLOUDFLARE_ACCOUNT_ID,
          compatibilityDate: process.env.CLOUDFLARE_COMPATIBILITY_DATE
        }),
        receipts: true
      });
      const liveResource = liveResourceMetadata({ provider: "cloudflare", resource: "worker-version" });

      const version = await capsule.edge.version({
        name: process.env.CAPSULE_CLOUDFLARE_WORKER_NAME ?? "",
        runtime: "workers",
        source: { path: await workerFile(), entrypoint: "worker.js" },
        labels: liveResource.labels
      });
      expect(version.provider).toBe("cloudflare");
      expect(version.receipt?.type).toBe("edge.version");
      expect(version.receipt?.metadata).toMatchObject({
        providerApiVersion: "client/v4",
        runtimeVersion: process.version,
        adapterVersion: "0.1.1"
      });
    },
    120_000
  );

  liveTest(
    test,
    "deploys a live Cloudflare Worker script when explicitly enabled",
    liveTestGate({
      provider: "cloudflare",
      credentials: ["CLOUDFLARE_API_TOKEN", "CLOUDFLARE_ACCOUNT_ID", "CAPSULE_CLOUDFLARE_WORKER_NAME", "CAPSULE_CLOUDFLARE_LIVE_DEPLOY"]
    }),
    async () => {
      const capsule = new Capsule({
        adapter: cloudflare({
          apiToken: process.env.CLOUDFLARE_API_TOKEN,
          accountId: process.env.CLOUDFLARE_ACCOUNT_ID,
          compatibilityDate: process.env.CLOUDFLARE_COMPATIBILITY_DATE,
          workersDevSubdomain: process.env.CAPSULE_CLOUDFLARE_WORKERS_DEV_SUBDOMAIN ?? process.env.CAPSULE_WORKER_WORKERS_DEV_SUBDOMAIN
        }),
        receipts: true
      });
      const liveResource = liveResourceMetadata({ provider: "cloudflare", resource: "worker-deploy" });

      const deployment = await capsule.edge.deploy({
        name: process.env.CAPSULE_CLOUDFLARE_WORKER_NAME ?? "",
        runtime: "workers",
        source: { path: await workerFile(), entrypoint: "worker.js" },
        env: { CAPSULE_LIVE_DEPLOY: "true" },
        labels: liveResource.labels
      });

      expect(deployment.provider).toBe("cloudflare");
      expect(deployment.status).toBe("ready");
      expect(deployment.receipt).toMatchObject({
        type: "edge.deploy",
        supportLevel: "native",
        policy: { decision: "allowed" },
        resource: { name: process.env.CAPSULE_CLOUDFLARE_WORKER_NAME, status: "ready" }
      });
      expect(deployment.receipt?.metadata?.runtime).toBe("workers");
      expect(deployment.receipt?.metadata).toMatchObject({
        providerApiVersion: "client/v4",
        runtimeVersion: process.version,
        adapterVersion: "0.1.1"
      });
      if (process.env.CAPSULE_CLOUDFLARE_WORKERS_DEV_SUBDOMAIN ?? process.env.CAPSULE_WORKER_WORKERS_DEV_SUBDOMAIN) {
        expect(deployment.url).toContain(".workers.dev");
      }
    },
    120_000
  );

  liveTest(
    test,
    "rolls back a live Cloudflare Worker deployment to an explicit version when enabled",
    liveTestGate({
      provider: "cloudflare",
      credentials: [
        "CLOUDFLARE_API_TOKEN",
        "CLOUDFLARE_ACCOUNT_ID",
        "CAPSULE_CLOUDFLARE_WORKER_NAME",
        "CAPSULE_CLOUDFLARE_LIVE_CREATE_VERSION",
        "CAPSULE_CLOUDFLARE_LIVE_ROLLBACK"
      ]
    }),
    async () => {
      const capsule = new Capsule({
        adapter: cloudflare({
          apiToken: process.env.CLOUDFLARE_API_TOKEN,
          accountId: process.env.CLOUDFLARE_ACCOUNT_ID,
          compatibilityDate: process.env.CLOUDFLARE_COMPATIBILITY_DATE
        }),
        receipts: true
      });
      const scriptName = process.env.CAPSULE_CLOUDFLARE_WORKER_NAME ?? "";
      const liveResource = liveResourceMetadata({ provider: "cloudflare", resource: "worker-rollback" });
      const version = await capsule.edge.version({
        name: scriptName,
        runtime: "workers",
        source: { path: await workerFile("capsule rollback smoke"), entrypoint: "worker.js" },
        labels: liveResource.labels
      });

      const rollback = await capsule.edge.rollback({
        deploymentId: liveResource.name,
        targetVersionId: version.id,
        reason: "Capsule live rollback smoke",
        providerOptions: { scriptName }
      });

      expect(rollback.provider).toBe("cloudflare");
      expect(rollback.targetVersionId).toBe(version.id);
      expect(rollback.status).toBe("ready");
      expect(rollback.receipt).toMatchObject({
        type: "edge.rollback",
        supportLevel: "native",
        policy: { decision: "allowed" },
        resource: { name: scriptName, status: "ready" }
      });
      expect(rollback.receipt?.metadata?.targetVersionId).toBe(version.id);
      expect(rollback.receipt?.metadata).toMatchObject({
        providerApiVersion: "client/v4",
        runtimeVersion: process.version,
        adapterVersion: "0.1.1"
      });
    },
    120_000
  );
});
