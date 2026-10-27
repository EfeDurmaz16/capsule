import { describe, expect, it } from "vitest";
import { AdapterExecutionError, Capsule, capsuleOperationTag, ProviderAuthError, ProviderRateLimitError, runAdapterContract } from "@capsule-sdk/core";
import { ec2, ec2Capabilities } from "./index.js";

function awsError(name: string, httpStatusCode: number, message = name): Error {
  return Object.assign(new Error(message), { name, $metadata: { httpStatusCode } });
}

describe("ec2 adapter", () => {
  it("runs the shared adapter contract suite and classifies provider failures", async () => {
    const throttled = ec2({
      imageId: "ami-x",
      instanceType: "t3.micro",
      client: { send: async () => Promise.reject(awsError("ThrottlingException", 429, "Rate exceeded")) }
    });
    await runAdapterContract(throttled, {
      failureScenarios: [
        {
          name: "EC2 throttling surfaces as a retryable rate-limit provider error",
          exercise: (capsule) => capsule.machine.status({ id: "i-throttled" }),
          expectError: (error) => {
            expect(error).toBeInstanceOf(ProviderRateLimitError);
            expect((error as AdapterExecutionError).cause).toMatchObject({ providerError: { category: "rate-limit", retryable: true, status: 429 } });
          }
        }
      ]
    });
  });

  it("classifies EC2 access-denied failures as auth provider errors", async () => {
    const capsule = new Capsule({
      adapter: ec2({ region: "us-east-1", client: { send: async () => Promise.reject(awsError("UnauthorizedOperation", 403, "not authorized")) } })
    });

    let thrown: unknown;
    try {
      await capsule.machine.status({ id: "i-123" });
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(ProviderAuthError);
    expect((thrown as Error).message).toBe("not authorized");
    expect((thrown as AdapterExecutionError).cause).toMatchObject({ providerError: { category: "auth", retryable: false, status: 403 } });
  });

  it("declares machine create as native", () => {
    expect(ec2Capabilities.machine?.create).toBe("native");
    expect(ec2Capabilities.machine?.status).toBe("native");
    expect(ec2Capabilities.machine?.start).toBe("native");
    expect(ec2Capabilities.machine?.stop).toBe("native");
    expect(ec2Capabilities.machine?.destroy).toBe("native");
    expect(ec2Capabilities.machine?.exec).toBe("unsupported");
  });

  it("creates an EC2 instance", async () => {
    const sent: any[] = [];
    const client = {
      send: async (command: any) => {
        sent.push(command.input);
        return { Instances: [{ InstanceId: "i-123", State: { Name: "pending" } }] };
      }
    };
    const capsule = new Capsule({
      adapter: ec2({ region: "us-east-1", subnetId: "subnet-1", securityGroupIds: ["sg-1"], keyName: "dev-key", client }),
      receipts: true
    });
    const machine = await capsule.machine.create({
      name: "capsule-dev",
      image: "ami-123",
      size: "t3.micro",
      env: { NODE_ENV: "test" },
      labels: { purpose: "test" },
      idempotencyKey: "ec2-create-key"
    });

    expect(machine).toMatchObject({ id: "i-123", provider: "ec2", status: "creating" });
    expect(machine.receipt?.type).toBe("machine.create");
    expect(sent[0]).toMatchObject({
      ImageId: "ami-123",
      InstanceType: "t3.micro",
      MinCount: 1,
      MaxCount: 1,
      SubnetId: "subnet-1",
      SecurityGroupIds: ["sg-1"],
      KeyName: "dev-key"
    });
    expect(sent[0].TagSpecifications[0].Tags).toContainEqual({ Key: "Name", Value: "capsule-dev" });
    expect(sent[0].TagSpecifications[0].Tags).toContainEqual({ Key: "capsule_operation_scope", Value: "machine_create" });
    expect(Buffer.from(sent[0].UserData, "base64").toString("utf8")).toContain("NODE_ENV");
  });

  it("requires image and size", async () => {
    const capsule = new Capsule({ adapter: ec2({ client: { send: async () => ({}) } }) });
    await expect(capsule.machine.create({ name: "bad" })).rejects.toThrow(AdapterExecutionError);
  });

  it("gets EC2 instance status", async () => {
    const sent: any[] = [];
    const client = {
      send: async (command: any) => {
        sent.push(command.input);
        return { Reservations: [{ Instances: [{ InstanceId: "i-123", State: { Name: "running" }, Tags: [{ Key: "Name", Value: "capsule-dev" }] }] }] };
      }
    };
    const capsule = new Capsule({ adapter: ec2({ region: "us-east-1", client }), receipts: true });
    const status = await capsule.machine.status({ id: "i-123" });

    expect(status).toMatchObject({ id: "i-123", provider: "ec2", name: "capsule-dev", status: "running" });
    expect(status.receipt?.type).toBe("machine.status");
    expect(sent[0]).toEqual({ InstanceIds: ["i-123"] });
  });

  it("starts, stops, and destroys EC2 instances", async () => {
    const sent: any[] = [];
    const client = {
      send: async (command: any) => {
        sent.push({ name: command.constructor.name, input: command.input });
        if (command.constructor.name === "StartInstancesCommand") {
          return { StartingInstances: [{ InstanceId: "i-123", CurrentState: { Name: "pending" } }] };
        }
        if (command.constructor.name === "StopInstancesCommand") {
          return { StoppingInstances: [{ InstanceId: "i-123", CurrentState: { Name: "stopping" } }] };
        }
        return { TerminatingInstances: [{ InstanceId: "i-123", PreviousState: { Name: "running" }, CurrentState: { Name: "shutting-down" } }] };
      }
    };
    const capsule = new Capsule({ adapter: ec2({ region: "us-east-1", client }), receipts: true });

    const started = await capsule.machine.start({ id: "i-123", reason: "resume checks" });
    const stopped = await capsule.machine.stop({ id: "i-123", force: true });
    const destroyed = await capsule.machine.destroy({ id: "i-123", force: true, reason: "ttl expired", providerOptions: { skipOsShutdown: true } });

    expect(started).toMatchObject({ id: "i-123", status: "starting" });
    expect(stopped).toMatchObject({ id: "i-123", status: "stopping" });
    expect(destroyed).toMatchObject({ id: "i-123", status: "destroying" });
    expect(destroyed.metadata).toMatchObject({ awsState: "shutting-down", previousAwsState: "running", force: true, skipOsShutdown: true });
    expect(started.receipt?.type).toBe("machine.start");
    expect(stopped.receipt?.type).toBe("machine.stop");
    expect(destroyed.receipt?.type).toBe("machine.destroy");
    expect(destroyed.receipt?.metadata).toMatchObject({ awsState: "shutting-down", previousAwsState: "running", force: true, skipOsShutdown: true });
    expect(destroyed.receipt?.policy.notes).toContain(
      "EC2 TerminateInstances force requests still attempt graceful shutdown first; providerOptions.skipOsShutdown bypasses OS shutdown and can risk data integrity."
    );
    expect(sent).toEqual([
      { name: "StartInstancesCommand", input: { InstanceIds: ["i-123"] } },
      { name: "StopInstancesCommand", input: { InstanceIds: ["i-123"], Force: true } },
      { name: "TerminateInstancesCommand", input: { InstanceIds: ["i-123"], Force: true, SkipOsShutdown: true } }
    ]);
  });

  it("does not hide EC2 termination responses without instance state", async () => {
    const client = {
      send: async () => ({ TerminatingInstances: [] })
    };
    const capsule = new Capsule({ adapter: ec2({ region: "us-east-1", client }), receipts: true });

    await expect(capsule.machine.destroy({ id: "i-missing", reason: "cleanup" })).rejects.toThrow(
      "EC2 machine.destroy did not return termination state for i-missing."
    );
  });
  it("records that generated env exports do not persist and that adapter userData drops spec.env", async () => {
    const userDataSent: Array<string | undefined> = [];
    const client = {
      send: async (command: any) => {
        userDataSent.push(command.input.UserData);
        return { Instances: [{ InstanceId: "i-env", State: { Name: "pending" } }] };
      }
    };
    const generated = new Capsule({ adapter: ec2({ client }), receipts: true });
    const created = await generated.machine.create({ name: "env", image: "ami-x", size: "t3.micro", env: { A: "1" } });
    expect(created.receipt?.policy.notes).toContain(
      "Environment values are exported only inside the user-data script process; they do not persist into later logins, services or runner processes."
    );
    expect(Buffer.from(userDataSent[0] ?? "", "base64").toString("utf8")).toBe("#!/bin/sh\nexport A='1'\n");

    const overridden = new Capsule({ adapter: ec2({ client, userData: "#!/bin/sh\ntrue\n" }), receipts: true });
    const replaced = await overridden.machine.create({ name: "env", image: "ami-x", size: "t3.micro", env: { A: "1" } });
    expect(replaced.receipt?.policy.notes).toContain("Adapter userData replaces the generated script, so spec.env is not delivered to the instance.");

    const none = new Capsule({ adapter: ec2({ client }), receipts: true });
    await none.machine.create({ name: "env", image: "ami-x", size: "t3.micro", env: {} });
    expect(userDataSent[2]).toBeUndefined();
  });
  it("rejects a spec.region that differs from the adapter region before any request", async () => {
    let sends = 0;
    const client = {
      send: async () => {
        sends += 1;
        return { Instances: [{ InstanceId: "i-region", State: { Name: "pending" } }] };
      }
    };
    const pinned = new Capsule({ adapter: ec2({ region: "us-east-1", client }), receipts: true });
    await expect(pinned.machine.create({ name: "r", image: "ami-x", size: "t3.micro", region: "eu-west-1" })).rejects.toBeInstanceOf(AdapterExecutionError);
    const unpinned = new Capsule({ adapter: ec2({ client }), receipts: true });
    await expect(unpinned.machine.create({ name: "r", image: "ami-x", size: "t3.micro", region: "eu-west-1" })).rejects.toThrow(/does not match the adapter region/);
    expect(sends).toBe(0);

    const matching = await pinned.machine.create({ name: "r", image: "ami-x", size: "t3.micro", region: "us-east-1" });
    expect(matching.receipt?.metadata).toMatchObject({ region: "us-east-1" });
    expect(sends).toBe(1);
  });
  it("maps every EC2 instance state to a faithful machine status and keeps the native state", async () => {
    const expected: Record<string, string> = {
      pending: "creating",
      running: "running",
      stopping: "stopping",
      stopped: "stopped",
      "shutting-down": "destroying",
      terminated: "deleted"
    };
    for (const [awsState, status] of Object.entries(expected)) {
      const capsule = new Capsule({
        adapter: ec2({ client: { send: async () => ({ Reservations: [{ Instances: [{ InstanceId: "i-map", State: { Name: awsState } }] }] }) } }),
        receipts: true
      });
      const result = await capsule.machine.status({ id: "i-map" });
      expect(result.status).toBe(status);
      expect(result.metadata).toMatchObject({ awsState });
      expect(result.receipt?.resource).toMatchObject({ id: "i-map", status });
    }
  });

  it("refuses to invent a status for an unrecognized or missing EC2 instance state", async () => {
    const unknownState = new Capsule({
      adapter: ec2({ client: { send: async () => ({ Reservations: [{ Instances: [{ InstanceId: "i-odd", State: { Name: "hibernating" } }] }] }) } })
    });
    await expect(unknownState.machine.status({ id: "i-odd" })).rejects.toThrow(/unrecognized instance state "hibernating"/);
    const missing = new Capsule({ adapter: ec2({ client: { send: async () => ({ Reservations: [] }) } }) });
    await expect(missing.machine.status({ id: "i-gone" })).rejects.toThrow(/no instance state for i-gone/);
  });
  it("maps a machine idempotency key to a hashed RunInstances ClientToken scoped to the adapter region", async () => {
    const inputs: any[] = [];
    const createWith = async (region: string | undefined, idempotencyKey?: string) => {
      const capsule = new Capsule({
        adapter: ec2({
          region,
          client: {
            send: async (command: any) => {
              inputs.push(command.input);
              return { Instances: [{ InstanceId: "i-token", State: { Name: "pending" } }] };
            }
          }
        }),
        receipts: true
      });
      const machine = await capsule.machine.create({ name: "t", image: "ami-x", size: "t3.micro", idempotencyKey });
      return { token: inputs.at(-1).ClientToken as string | undefined, machine };
    };
    const first = await createWith("us-east-1", "machine-7");
    expect((await createWith("us-east-1", "machine-7")).token).toBe(first.token);
    expect(first.token).toBe(capsuleOperationTag({ idempotencyKey: "machine-7", capabilityPath: "machine.create", idempotencyScope: "ec2:machine.create:us-east-1" }));
    expect(first.token).toMatch(/^[0-9a-f]{32}$/);
    expect(first.token).not.toContain("machine-7");
    expect((await createWith("eu-west-1", "machine-7")).token).not.toBe(first.token);
    expect((await createWith("us-east-1", "machine-8")).token).not.toBe(first.token);
    expect((await createWith("us-east-1")).token).toBeUndefined();
    expect(first.machine.receipt?.policy.notes?.some((note) => note.includes("RunInstances ClientToken") && note.includes("not an exactly-once guarantee"))).toBe(true);
  });

  it("surfaces IdempotentParameterMismatch for a reused ClientToken as a provider error", async () => {
    const mismatch = Object.assign(new Error("Arguments on this idempotent request are inconsistent with arguments used in previous request(s)."), {
      name: "IdempotentParameterMismatch",
      $fault: "client",
      $metadata: { httpStatusCode: 400 }
    });
    const capsule = new Capsule({ adapter: ec2({ region: "us-east-1", client: { send: async () => Promise.reject(mismatch) } }) });
    const error = await capsule.machine.create({ name: "t", image: "ami-x", size: "t3.micro", idempotencyKey: "machine-7" }).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(AdapterExecutionError);
    expect((error as AdapterExecutionError).cause).toMatchObject({ cause: { name: "IdempotentParameterMismatch" } });
  });
});
