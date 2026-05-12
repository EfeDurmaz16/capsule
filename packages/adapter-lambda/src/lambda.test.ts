import { describe, expect, it } from "vitest";
import { assertAdapterContract, assertUnsupportedCapabilitiesReject, Capsule } from "@capsule/core";
import { lambda, lambdaCapabilities } from "./index.js";

describe("lambda adapter", () => {
  it("declares job run as native", () => {
    expect(lambdaCapabilities.job?.run).toBe("native");
    expect(lambdaCapabilities.job?.env).toBe("emulated");
  });

  it("satisfies the public adapter contract", async () => {
    const adapter = lambda({ functionName: "capsule-worker", client: { send: async () => ({}) } });
    assertAdapterContract(adapter);
    await assertUnsupportedCapabilitiesReject(adapter);
  });

  it("invokes an existing Lambda function", async () => {
    const sent: any[] = [];
    const client = {
      send: async (command: any) => {
        sent.push(command.input);
        return {
          StatusCode: 200,
          Payload: new TextEncoder().encode(JSON.stringify({ ok: true })),
          LogResult: Buffer.from("done\n").toString("base64"),
          ExecutedVersion: "$LATEST"
        };
      }
    };
    const capsule = new Capsule({ adapter: lambda({ functionName: "capsule-worker", client }), receipts: true });
    const run = await capsule.job.run({
      image: "ignored-by-lambda",
      command: ["node", "index.js"],
      env: { SECRET: "value" },
      labels: { purpose: "test" }
    });

    expect(run.status).toBe("succeeded");
    expect(run.result?.stdout).toBe(JSON.stringify({ ok: true }));
    expect(run.receipt?.type).toBe("job.run");
    expect(sent[0]).toMatchObject({
      FunctionName: "capsule-worker",
      InvocationType: "RequestResponse",
      LogType: "Tail"
    });
    expect(JSON.parse(new TextDecoder().decode(sent[0].Payload))).toMatchObject({
      capsule: true,
      image: "ignored-by-lambda",
      command: ["node", "index.js"],
      env: { SECRET: "value" }
    });
  });

  it("maps FunctionError to failed even when HTTP status is 200", async () => {
    const client = {
      send: async () => ({
        StatusCode: 200,
        FunctionError: "Unhandled",
        Payload: new TextEncoder().encode(JSON.stringify({ errorMessage: "boom" }))
      })
    };
    const capsule = new Capsule({ adapter: lambda({ functionName: "bad-worker", client }), receipts: true });
    const run = await capsule.job.run({ image: "ignored" });
    expect(run.status).toBe("failed");
    expect(run.result?.exitCode).toBe(1);
    expect(run.receipt?.metadata?.functionError).toBe("Unhandled");
  });
});
