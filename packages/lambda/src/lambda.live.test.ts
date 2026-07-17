import { describe, expect, test } from "vitest";
import { Capsule } from "@capsule-sdk/core";
import { liveTest, providerLiveTestGate } from "@capsule-sdk/test-utils";
import { lambda } from "./index.js";

describe("lambda live smoke", () => {
  liveTest(
    test,
    "invokes an existing live Lambda function",
    providerLiveTestGate("aws"),
    async () => {
      const capsule = new Capsule({
        adapter: lambda({
          region: process.env.AWS_REGION,
          functionName: process.env.CAPSULE_LAMBDA_FUNCTION_NAME
        }),
        receipts: true
      });

      const run = await capsule.job.run({
        name: "capsule-live-smoke",
        image: "lambda-existing-function",
        command: ["capsule", "live-smoke"]
      });
      expect(run.provider).toBe("lambda");
      expect(run.receipt?.type).toBe("job.run");
      expect(run.receipt?.metadata).toMatchObject({
        providerApiVersion: "2015-03-31",
        providerRegion: process.env.AWS_REGION,
        runtimeVersion: process.version,
        adapterVersion: "0.1.1"
      });
    },
    60_000
  );
});
