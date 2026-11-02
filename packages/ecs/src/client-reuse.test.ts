// AWS-05: one lazily created, owned SDK client per adapter. The installed ECSClient is subclassed only to
// count constructions and send is intercepted, so no AWS request or credential resolution happens.
import { afterEach, describe, expect, it, vi } from "vitest";

const counters = vi.hoisted(() => ({ constructed: 0, clients: new Set<unknown>() }));

vi.mock("@aws-sdk/client-ecs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@aws-sdk/client-ecs")>();
  class CountingECSClient extends actual.ECSClient {
    constructor(...args: ConstructorParameters<typeof actual.ECSClient>) {
      super(...args);
      counters.constructed += 1;
    }
    override send = (async () => {
      counters.clients.add(this);
      return { tasks: [{ taskArn: "arn:task/reuse", lastStatus: "RUNNING" }] };
    }) as never;
  }
  return { ...actual, ECSClient: CountingECSClient };
});

const { Capsule } = await import("@capsule-sdk/core");
const { ecs } = await import("./index.js");

const base = { region: "us-east-1", cluster: "reuse", taskDefinition: "reuse:1", containerName: "main" };

afterEach(() => {
  counters.constructed = 0;
  counters.clients.clear();
});

describe("ecs client reuse", () => {
  it("constructs no SDK client until the first operation", () => {
    ecs(base);
    expect(counters.constructed).toBe(0);
  });

  it("reuses one owned SDK client across operations of one adapter", async () => {
    const capsule = new Capsule({ adapter: ecs(base) });
    await capsule.job.run({ image: "intent", command: ["true"] });
    for (let i = 0; i < 4; i += 1) await capsule.job.status({ id: "arn:task/reuse" });
    expect(counters.constructed).toBe(1);
    expect(counters.clients.size).toBe(1);
  });

  it("never constructs an SDK client when a client is injected", async () => {
    const send = vi.fn(async () => ({ tasks: [{ taskArn: "arn:task/reuse", lastStatus: "RUNNING" }] }));
    const capsule = new Capsule({ adapter: ecs({ ...base, client: { send } }) });
    await capsule.job.status({ id: "arn:task/reuse" });
    await capsule.job.status({ id: "arn:task/reuse" });
    expect(counters.constructed).toBe(0);
    expect(send).toHaveBeenCalledTimes(2);
  });
});
