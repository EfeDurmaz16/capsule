import { describe, expect, it } from "vitest";
import { AdapterExecutionError, Capsule, ProviderAuthError, ProviderRetryableError, runAdapterContract } from "@capsule/core";
import { lambda, lambdaCapabilities } from "./index.js";

function awsError(name: string, httpStatusCode: number, message = name): Error {
  return Object.assign(new Error(message), { name, $metadata: { httpStatusCode } });
}

describe("lambda adapter", () => {
  it("runs the shared adapter contract suite and classifies provider failures", async () => {
    const denied = lambda({ functionName: "capsule-worker", client: { send: async () => Promise.reject(awsError("AccessDeniedException", 403, "not authorized to invoke")) } });
    await runAdapterContract(denied, {
      failureScenarios: [
        {
          name: "Lambda access-denied surfaces as an auth provider error",
          exercise: (capsule) => capsule.job.run({ image: "node:22" }),
          expectError: (error) => {
            expect(error).toBeInstanceOf(ProviderAuthError);
            expect((error as AdapterExecutionError).cause).toMatchObject({ providerError: { category: "auth", retryable: false, status: 403 } });
          }
        }
      ]
    });
  });

  it("classifies Lambda service faults as retryable provider errors", async () => {
    const capsule = new Capsule({ adapter: lambda({ functionName: "capsule-worker", client: { send: async () => Promise.reject(awsError("ServiceException", 500, "internal service error")) } }) });

    let thrown: unknown;
    try {
      await capsule.job.run({ image: "node:22" });
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(ProviderRetryableError);
    expect((thrown as Error).message).toBe("internal service error");
    expect((thrown as AdapterExecutionError).cause).toMatchObject({ providerError: { category: "retryable", retryable: true, status: 500 } });
  });

  it("declares job run as native", () => {
    expect(lambdaCapabilities.job?.run).toBe("native");
    expect(lambdaCapabilities.job?.env).toBe("emulated");
  });

  it("invokes an existing Lambda function", async () => {
    const sent: any[] = [];
    const client = {
      send: async (command: any) => {
        sent.push(command.input);
        return {
          $metadata: { requestId: "req-123" },
          StatusCode: 200,
          Payload: new TextEncoder().encode(JSON.stringify({ ok: true })),
          LogResult: Buffer.from("START RequestId: lambda-req-123 Version: 42\ndone\n").toString("base64"),
          ExecutedVersion: "42"
        };
      }
    };
    const capsule = new Capsule({ adapter: lambda({ region: "us-east-1", functionName: "capsule-worker", qualifier: "live", client }), receipts: true });
    const run = await capsule.job.run({
      image: "ignored-by-lambda",
      command: ["node", "index.js"],
      env: { SECRET: "value" },
      labels: { purpose: "test" }
    });

    expect(run.status).toBe("succeeded");
    expect(run.result?.stdout).toBe(JSON.stringify({ ok: true }));
    expect(run.receipt?.type).toBe("job.run");
    expect(run.receipt?.metadata).toMatchObject({
      invocationType: "RequestResponse",
      providerApiVersion: "2015-03-31",
      providerRegion: "us-east-1",
      runtimeVersion: process.version,
      adapterVersion: "0.1.1",
      statusCode: 200,
      functionName: "capsule-worker",
      qualifier: "live",
      providerRequestId: "req-123",
      requestId: "req-123",
      executedVersion: "42",
      functionVersion: "42",
      logType: "Tail",
      logRequestId: "lambda-req-123",
      functionError: null,
      logTail: "START RequestId: lambda-req-123 Version: 42\ndone\n"
    });
    expect(run.receipt?.capabilityPath).toBe("job.run");
    expect(sent[0]).toMatchObject({
      FunctionName: "capsule-worker",
      InvocationType: "RequestResponse",
      Qualifier: "live",
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
        $metadata: { requestId: "req-failed" },
        StatusCode: 200,
        FunctionError: "Unhandled",
        ExecutedVersion: "42",
        Payload: new TextEncoder().encode(JSON.stringify({ errorMessage: "boom" }))
      })
    };
    const capsule = new Capsule({ adapter: lambda({ functionName: "bad-worker", client }), receipts: true });
    const run = await capsule.job.run({ image: "ignored" });
    expect(run.status).toBe("failed");
    expect(run.result?.exitCode).toBe(1);
    expect(run.receipt?.metadata).toMatchObject({
      providerRequestId: "req-failed",
      requestId: "req-failed",
      executedVersion: "42",
      functionError: "Unhandled"
    });
  });

  it("redacts secrets from Lambda payloads, log entries, and receipt log metadata", async () => {
    const client = {
      send: async () => ({
        $metadata: { requestId: "req-secret" },
        StatusCode: 200,
        Payload: new TextEncoder().encode("payload token-123 token-123"),
        LogResult: Buffer.from("log token-123\n").toString("base64")
      })
    };
    const capsule = new Capsule({
      adapter: lambda({ functionName: "secret-worker", client }),
      receipts: true,
      policy: { secrets: { allowed: ["SECRET"], redactFromLogs: true } }
    });
    const run = await capsule.job.run({ image: "ignored", env: { SECRET: "token-123" } });

    expect(run.result?.stdout).toBe("payload [REDACTED] [REDACTED]");
    expect(run.result?.logs.map((entry) => entry.message)).toEqual(["payload [REDACTED] [REDACTED]", "log [REDACTED]"]);
    expect(run.receipt?.metadata?.logTail).toBe("log [REDACTED]\n");
    expect(JSON.stringify(run)).not.toContain("token-123");
  });

  it("keeps unsupported async status semantics explicit for Event invocations", async () => {
    const client = {
      send: async () => ({
        $metadata: { requestId: "req-event" },
        StatusCode: 202,
        ExecutedVersion: "7"
      })
    };
    const capsule = new Capsule({ adapter: lambda({ functionName: "async-worker", invocationType: "Event", client }), receipts: true });
    const run = await capsule.job.run({ image: "ignored" });

    expect(run.status).toBe("queued");
    expect(run.result).toBeUndefined();
    expect(run.receipt?.exitCode).toBeUndefined();
    expect(run.receipt?.metadata).toMatchObject({
      invocationType: "Event",
      statusCode: 202,
      providerRequestId: "req-event",
      requestId: "req-event",
      executedVersion: "7",
      functionError: null,
      asyncStatusSupport: "unsupported"
    });
    expect(run.receipt?.policy.notes?.join(" ")).toContain("does not support provider-side async job.status");
  });

  it("records receipt metadata when Lambda returns a malformed payload", async () => {
    const client = {
      send: async () => ({
        $metadata: { requestId: "req-malformed" },
        StatusCode: 200,
        ExecutedVersion: "$LATEST",
        Payload: new TextEncoder().encode("{not-json")
      })
    };
    const capsule = new Capsule({ adapter: lambda({ functionName: "malformed-worker", client }), receipts: true });
    const run = await capsule.job.run({ image: "ignored" });

    expect(run.status).toBe("succeeded");
    expect(run.result?.stdout).toBe("{not-json");
    expect(run.receipt?.metadata).toMatchObject({
      providerRequestId: "req-malformed",
      requestId: "req-malformed",
      executedVersion: "$LATEST",
      functionError: null
    });
  });
});
