import { describe, expect, it } from "vitest";
import { AdapterExecutionError, Capsule, runAdapterContract } from "@capsule/core";
import { ec2, ec2Capabilities } from "./index.js";

describe("ec2 adapter", () => {
  it("runs the shared adapter contract suite", async () => {
    await runAdapterContract(ec2());
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
      labels: { purpose: "test" }
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
        return { TerminatingInstances: [{ InstanceId: "i-123", CurrentState: { Name: "shutting-down" } }] };
      }
    };
    const capsule = new Capsule({ adapter: ec2({ region: "us-east-1", client }), receipts: true });

    const started = await capsule.machine.start({ id: "i-123", reason: "resume checks" });
    const stopped = await capsule.machine.stop({ id: "i-123", force: true });
    const destroyed = await capsule.machine.destroy({ id: "i-123", reason: "ttl expired" });

    expect(started).toMatchObject({ id: "i-123", status: "starting" });
    expect(stopped).toMatchObject({ id: "i-123", status: "stopping" });
    expect(destroyed).toMatchObject({ id: "i-123", status: "destroying" });
    expect(started.receipt?.type).toBe("machine.start");
    expect(stopped.receipt?.type).toBe("machine.stop");
    expect(destroyed.receipt?.type).toBe("machine.destroy");
    expect(sent).toEqual([
      { name: "StartInstancesCommand", input: { InstanceIds: ["i-123"] } },
      { name: "StopInstancesCommand", input: { InstanceIds: ["i-123"], Force: true } },
      { name: "TerminateInstancesCommand", input: { InstanceIds: ["i-123"] } }
    ]);
  });
});
