// AWS-05: one lazily created, owned SDK client per adapter. The installed LambdaClient is subclassed only
// to count constructions and send is intercepted, so no AWS request or credential resolution happens.
import { afterEach, describe, expect, it, vi } from "vitest";

const counters = vi.hoisted(() => ({ constructed: 0, clients: new Set<unknown>() }));

vi.mock("@aws-sdk/client-lambda", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@aws-sdk/client-lambda")>();
  class CountingLambdaClient extends actual.LambdaClient {
    constructor(...args: ConstructorParameters<typeof actual.LambdaClient>) {
      super(...args);
      counters.constructed += 1;
    }
    override send = (async () => {
      counters.clients.add(this);
      return { StatusCode: 200, Payload: new TextEncoder().encode("{}") };
    }) as never;
  }
  return { ...actual, LambdaClient: CountingLambdaClient };
});

const { Capsule } = await import("@capsule-sdk/core");
const { lambda } = await import("./index.js");

afterEach(() => {
  counters.constructed = 0;
  counters.clients.clear();
});

describe("lambda client reuse", () => {
  it("constructs no SDK client until the first operation", () => {
    lambda({ region: "us-east-1", functionName: "reuse" });
    expect(counters.constructed).toBe(0);
  });

  it("reuses one owned SDK client across invocations of one adapter", async () => {
    const capsule = new Capsule({ adapter: lambda({ region: "us-east-1", functionName: "reuse" }) });
    for (let i = 0; i < 5; i += 1) await capsule.job.run({ image: "intent" });
    expect(counters.constructed).toBe(1);
    expect(counters.clients.size).toBe(1);
  });

  it("never constructs an SDK client when a client is injected", async () => {
    const send = vi.fn(async () => ({ StatusCode: 200, Payload: new TextEncoder().encode("{}") }));
    const capsule = new Capsule({ adapter: lambda({ functionName: "reuse", client: { send } }) });
    await capsule.job.run({ image: "intent" });
    await capsule.job.run({ image: "intent" });
    expect(counters.constructed).toBe(0);
    expect(send).toHaveBeenCalledTimes(2);
  });
});
