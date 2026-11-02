// AWS-05: one lazily created, owned SDK client per adapter. The installed EC2Client is subclassed only to
// count constructions and send is intercepted, so no AWS request or credential resolution happens.
import { afterEach, describe, expect, it, vi } from "vitest";

const counters = vi.hoisted(() => ({ constructed: 0, clients: new Set<unknown>() }));

vi.mock("@aws-sdk/client-ec2", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@aws-sdk/client-ec2")>();
  class CountingEC2Client extends actual.EC2Client {
    constructor(...args: ConstructorParameters<typeof actual.EC2Client>) {
      super(...args);
      counters.constructed += 1;
    }
    override send = (async () => {
      counters.clients.add(this);
      return { Reservations: [{ Instances: [{ InstanceId: "i-reuse", State: { Name: "running" } }] }] };
    }) as never;
  }
  return { ...actual, EC2Client: CountingEC2Client };
});

const { Capsule } = await import("@capsule-sdk/core");
const { ec2 } = await import("./index.js");

afterEach(() => {
  counters.constructed = 0;
  counters.clients.clear();
});

describe("ec2 client reuse", () => {
  it("constructs no SDK client until the first operation", () => {
    ec2({ region: "us-east-1" });
    expect(counters.constructed).toBe(0);
  });

  it("reuses one owned SDK client across operations of one adapter", async () => {
    const capsule = new Capsule({ adapter: ec2({ region: "us-east-1" }) });
    for (let i = 0; i < 5; i += 1) await capsule.machine.status({ id: "i-reuse" });
    expect(counters.constructed).toBe(1);
    expect(counters.clients.size).toBe(1);
  });

  it("never constructs an SDK client when a client is injected", async () => {
    const send = vi.fn(async () => ({ Reservations: [{ Instances: [{ InstanceId: "i-reuse", State: { Name: "running" } }] }] }));
    const capsule = new Capsule({ adapter: ec2({ client: { send } }) });
    await capsule.machine.status({ id: "i-reuse" });
    await capsule.machine.status({ id: "i-reuse" });
    expect(counters.constructed).toBe(0);
    expect(send).toHaveBeenCalledTimes(2);
  });
});
