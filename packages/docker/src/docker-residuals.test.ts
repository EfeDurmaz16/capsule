import { describe, expect, test } from "vitest";
import { Capsule, MemoryReceiptStore, liveSet } from "@capsule-sdk/core";
import type { DockerCommandResult, RunDockerOptions } from "./docker-cli.js";
import { parseLabeledContainers } from "./docker-adapter.js";
import { docker } from "./index.js";

const sandboxId = "a".repeat(64);
const runId = "b".repeat(64);

describe("docker residuals", () => {
  test("parses labelled containers, telling sandboxes from job containers and skipping malformed lines", () => {
    const stdout = [
      `${sandboxId}\top_1\tjob_1\t\texited\t2026-11-08 10:00:00 +0000 UTC`,
      `${runId}\top_2\t\trun-uuid\trunning\t2026-11-08 10:00:01 +0000 UTC`,
      `--rm\top_3\tjob_3\t\trunning\tx`,
      `${sandboxId}\t\tjob_4\t\trunning\tx`,
      `${sandboxId}\top_5\tjob\twith\ttab\trunning\tx`,
      ""
    ].join("\n");
    expect(parseLabeledContainers(stdout)).toEqual([
      { provider: "docker", kind: "sandbox", id: sandboxId, operation: "op_1", job: "job_1", status: "exited", createdAt: "2026-11-08 10:00:00 +0000 UTC" },
      { provider: "docker", kind: "job-container", id: runId, operation: "op_2", status: "running", createdAt: "2026-11-08 10:00:01 +0000 UTC" }
    ]);
  });

  test("a create with an owner carries the labels, and gc lists by label, removes with rm -f, then lists again", async () => {
    const calls: string[][] = [];
    let present = true;
    const runner = async (args: string[], _options?: RunDockerOptions): Promise<DockerCommandResult> => {
      calls.push(args);
      if (args[0] === "ps") return { exitCode: 0, stdout: present ? `${sandboxId}\top_1\tjob_1\t\tcreated\tx\n` : "", stderr: "" };
      if (args[0] === "inspect") return { exitCode: 0, stdout: "2026-11-08T10:00:00Z\n", stderr: "" };
      if (args[0] === "rm") present = false;
      if (args[0] === "create") return { exitCode: 0, stdout: `${sandboxId}\n`, stderr: "" };
      return { exitCode: 0, stdout: "", stderr: "" };
    };
    const adapter = docker({ checkAvailable: async () => true, runner });
    await new Capsule({ adapter, owner: { job: "job_1" } }).sandbox.create({ image: "busybox" });
    const create = calls.find((args) => args[0] === "create")!;
    expect(create.join(" ")).toMatch(/--label capsule_operation=op_[0-9a-f]{32} --label capsule_job=job_1/);
    calls.length = 0;
    const store = new MemoryReceiptStore();
    const report = await new Capsule({ adapter, receipts: true, receiptStore: store }).gc.remove({
      liveness: liveSet({}),
      approve: (request) => ({
        approved: true,
        id: "fresh",
        expiresAt: new Date(Date.now() + 60_000).toISOString(),
        capabilities: ["sandbox.destroy"],
        resources: [request.resource]
      })
    });
    expect(report.results.map((result) => [result.outcome, result.approval])).toEqual([["removed", "fresh"]]);
    expect(calls.map((args) => args[0])).toEqual(["ps", "inspect", "rm", "ps"]);
    expect(calls[0]).toEqual([
      "ps",
      "-a",
      "--no-trunc",
      "--filter",
      "label=capsule_operation",
      "--format",
      '{{.ID}}\t{{.Label "capsule_operation"}}\t{{.Label "capsule_job"}}\t{{.Label "capsule_docker_run"}}\t{{.State}}\t{{.CreatedAt}}'
    ]);
    expect(store.receipts.map((receipt) => receipt.type)).toEqual(["sandbox.destroy"]);
  });
});
