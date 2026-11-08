import { describe, expect, test } from "vitest";
import { dockerDriver } from "./docker.js";
import { FixtureProvider, fixtureDriver } from "./fixture.js";
import { listResiduals } from "./residuals.js";

const id = "c".repeat(64);

describe("bridge residual scan", () => {
  test("the fixture lists sandboxes of operations Fabric does not hold live, and makes no effect", async () => {
    const provider = new FixtureProvider(
      { account: "acct", project: "proj" },
      {
        sandboxes: [
          { native_id: "fx-a", project: "proj", owner_job: "job-1", operation: "op-a" },
          { native_id: "fx-b", project: "proj", owner_job: "job-2", operation: "op-b" },
          { native_id: "fx-c", project: "proj", owner_job: "job-3", operation: "op-c", status: "stopping" },
          { native_id: "fx-other", project: "elsewhere", owner_job: "job-4", operation: "op-d" },
          { native_id: "fx-unowned", project: "proj" }
        ]
      }
    );
    const scan = await listResiduals(fixtureDriver(provider), { operations: ["op-a"], jobs: ["job-3"] });
    expect(scan.residuals.map((entry) => [entry.resource.id, entry.verdict])).toEqual([["fx-b", "ended"]]);
    expect(scan.kept.map((entry) => entry.resource.id)).toEqual(["fx-a", "fx-c"]);
    expect(provider.effects).toEqual([]);
  });

  test("the docker profile lists by fabric.operation on the bound engine", async () => {
    const calls: string[][] = [];
    const driver = dockerDriver({
      binding: { engine: "orbstack" },
      runner: async (args) => {
        calls.push(args);
        return { exitCode: 0, stdout: `${id}\top-1\tjob-1\trunning\tx\nnot-an-id\top-2\tjob-2\trunning\tx\n`, stderr: "" };
      }
    });
    const scan = await listResiduals(driver, { operations: [] });
    expect(scan.residuals.map((entry) => entry.resource)).toEqual([
      { provider: "docker", kind: "container", id, operation: "op-1", job: "job-1", status: "running", createdAt: "x" }
    ]);
    expect(calls).toEqual([
      [
        "--context=orbstack",
        "ps",
        "-a",
        "--no-trunc",
        "--filter",
        "label=fabric.operation",
        "--format",
        '{{.ID}}\t{{.Label "fabric.operation"}}\t{{.Label "fabric.job"}}\t{{.State}}\t{{.CreatedAt}}'
      ]
    ]);
  });
});
