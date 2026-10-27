// Audit regressions for the M1 campaign (EC2). Each test asserts the INTENDED behavior from the M1
// manifest and is marked it.fails while the defect is present on the baseline (7d3a28a). The owner who
// fixes an ID flips its it.fails to it in the same commit. Clients are injected fakes or the installed
// SDK class with an intercepted send; no AWS request is made. AWS-01 runs the generated user-data with
// a local /bin/sh in a temporary directory only to prove literal preservation.
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { EC2Client } from "@aws-sdk/client-ec2";
import { describe, expect, it } from "vitest";
import { Capsule } from "@capsule-sdk/core";
import { ec2 } from "./index.js";

describe("M1 audit regressions: ec2", () => {
  it("AWS-01: generated env user-data preserves dollars, backticks, quotes and newlines literally", async () => {
    let userData = "";
    const client = {
      send: async (command: { input: { UserData?: string } }) => {
        userData = command.input.UserData ?? "";
        return { Instances: [{ InstanceId: "i-audit", State: { Name: "pending" } }] };
      }
    };
    const capsule = new Capsule({ adapter: ec2({ client: client as never }) });
    const literal = "$(printf capsule-expanded) `printf tick` \"quoted\" 'single'\nsecond line $HOME";
    await capsule.machine.create({ name: "audit", image: "ami-audit", size: "t3.micro", env: { CAPSULE_AUDIT_LITERAL: literal } });
    const script = Buffer.from(userData, "base64").toString("utf8");
    const cwd = mkdtempSync(join(tmpdir(), "capsule-aws01-"));
    try {
      const output = spawnSync("/bin/sh", ["-c", `${script}\nprintf '%s' "$CAPSULE_AUDIT_LITERAL"`], {
        cwd,
        encoding: "utf8",
        env: { PATH: "/usr/bin:/bin", HOME: cwd }
      });
      expect(output.stdout).toBe(literal);
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  it("AWS-01: an invalid environment variable identifier is rejected before any AWS request", async () => {
    let sends = 0;
    const capsule = new Capsule({
      adapter: ec2({
        client: {
          send: async () => {
            sends += 1;
            return { Instances: [{ InstanceId: "i-audit", State: { Name: "pending" } }] };
          }
        } as never
      })
    });
    const outcome = await capsule.machine.create({ name: "audit", image: "ami-audit", size: "t3.micro", env: { "BAD-NAME; touch /tmp/x": "v" } }).then(
      () => "resolved",
      () => "rejected"
    );
    expect(outcome).toBe("rejected");
    expect(sends).toBe(0);
  });

  it.fails("AWS-02: stopping and shutting-down map to transitional statuses, not stopped or deleted", async () => {
    const statusFor = async (awsState: string) => {
      const capsule = new Capsule({
        adapter: ec2({ client: { send: async () => ({ Reservations: [{ Instances: [{ InstanceId: "i-audit", State: { Name: awsState } }] }] }) } as never })
      });
      return (await capsule.machine.status({ id: "i-audit" })).status as string;
    };
    expect(await statusFor("stopping")).toBe("stopping");
    expect(await statusFor("shutting-down")).toBe("destroying");
  });

  it("AWS-05: N operations on one adapter construct one owned SDK client", async () => {
    const originalSend = EC2Client.prototype.send;
    const clients = new Set<unknown>();
    EC2Client.prototype.send = async function (this: unknown) {
      clients.add(this);
      return { Reservations: [{ Instances: [{ InstanceId: "i-audit", State: { Name: "running" } }] }] };
    } as never;
    try {
      const capsule = new Capsule({ adapter: ec2({ region: "us-east-1" }) });
      for (let i = 0; i < 5; i += 1) await capsule.machine.status({ id: "i-audit" });
      expect(clients.size).toBe(1);
    } finally {
      EC2Client.prototype.send = originalSend;
    }
  });
});
