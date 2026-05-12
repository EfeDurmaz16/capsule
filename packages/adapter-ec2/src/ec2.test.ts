import { describe, expect, it } from "vitest";
import { AdapterExecutionError, assertAdapterContract, assertUnsupportedCapabilitiesReject, Capsule } from "@capsule/core";
import { ec2, ec2Capabilities } from "./index.js";

describe("ec2 adapter", () => {
  it("declares machine create as native", () => {
    expect(ec2Capabilities.machine?.create).toBe("native");
    expect(ec2Capabilities.machine?.exec).toBe("unsupported");
  });

  it("satisfies the public adapter contract", async () => {
    const adapter = ec2({ client: { send: async () => ({}) } });
    assertAdapterContract(adapter);
    await assertUnsupportedCapabilitiesReject(adapter);
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
});
