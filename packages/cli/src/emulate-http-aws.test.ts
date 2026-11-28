import { afterEach, expect, test, vi } from "vitest";
import { handleLambdaInvoke, runAwsProviderHttp } from "./emulate-http-aws.js";

afterEach(() => vi.unstubAllEnvs());

test.each([
  ["ec2", ["machine.create", "machine.status", "machine.destroy"], "deleted"],
  ["ecs", ["job.run", "job.status"], "succeeded"],
  ["lambda", ["job.run"], "succeeded"]
] as const)("the real %s client uses the fixture identity and endpoint", async (provider, operations, status) => {
  vi.stubEnv("AWS_ACCESS_KEY_ID", "ignored");
  vi.stubEnv("AWS_SECRET_ACCESS_KEY", "ignored");
  vi.stubEnv("AWS_ENDPOINT_URL", "http://127.0.0.1:1");
  const run = await runAwsProviderHttp(provider);
  expect(run.operations).toEqual(operations);
  expect(run.result.status).toBe(status);
  expect(run.requests).toHaveLength(operations.length);
  expect(run.evidence).toBe("provider-http");
});

test("Lambda fixture rejects unsigned requests and mismatched invocation types", () => {
  const request = {
    method: "POST",
    url: new URL("http://127.0.0.1/2015-03-31/functions/capsule-example/invocations"),
    headers: {},
    body: Buffer.from("{}")
  };
  expect(handleLambdaInvoke(request)).toBeUndefined();
  expect(() =>
    handleLambdaInvoke({
      ...request,
      headers: { authorization: "AWS4-HMAC-SHA256 Credential=CAPSULEFIXTURE/20000101/us-west-2/lambda/aws4_request,", "x-amz-invocation-type": "Event" }
    })
  ).toThrow(/RequestResponse/);
});
