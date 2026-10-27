// GAP-01 and PERF-10 adapter behavior. A runDocker timeout only kills the local docker CLI. These tests pin what the adapter does
// afterwards with a deterministic fake daemon (an injected runner); no Docker daemon is used.
import { describe, expect, it } from "vitest";
import { Capsule, CleanupFailureError, MemoryReceiptStore, UnknownOutcomeError, partialEffectsOf } from "@capsule-sdk/core";
import type { DockerCommandResult, RunDockerOptions } from "./docker-cli.js";
import { docker } from "./index.js";

const ok: DockerCommandResult = { exitCode: 0, stdout: "", stderr: "" };
const timedOut: DockerCommandResult = { exitCode: 124, stdout: "partial", stderr: "Command timed out after 50ms", timedOut: true };

function fakeDaemon(handler: (args: string[], options?: RunDockerOptions) => DockerCommandResult | undefined) {
  const calls: string[][] = [];
  const adapter = docker({
    checkAvailable: async () => true,
    runner: async (args, options) => {
      calls.push(args);
      return handler(args, options) ?? (args[0] === "create" ? { ...ok, stdout: "box-1\n" } : ok);
    }
  });
  return { calls, adapter };
}

function runLabelOf(calls: string[][]): string {
  const run = calls.find((args) => args[0] === "run")!;
  return run[run.indexOf("--label") + 1]!;
}

describe("GAP-01: docker timeouts", () => {
  it("removes a timed-out job container found by its run label and records the termination", async () => {
    const fake = fakeDaemon((args) => {
      if (args[0] === "run") return timedOut;
      if (args[0] === "ps") return { ...ok, stdout: "c0ffee\n" };
      return undefined;
    });
    const store = new MemoryReceiptStore();
    const run = await new Capsule({ adapter: fake.adapter, receipts: true, receiptStore: store }).job.run({ image: "node:22", command: "sleep 60", timeoutMs: 50 });

    const label = runLabelOf(fake.calls);
    expect(label).toMatch(/^capsule_docker_run=[0-9a-f-]{36}$/);
    expect(fake.calls.find((args) => args[0] === "ps")).toEqual(["ps", "-a", "-q", "--no-trunc", "--filter", `label=${label}`]);
    expect(fake.calls.at(-1)).toEqual(["rm", "-f", "c0ffee"]);
    expect(run.status).toBe("failed");
    expect(run.result?.exitCode).toBe(124);
    expect(run.result?.stderr).toContain("Removed timed-out job container c0ffee");
    expect(run.receipt?.metadata).toMatchObject({ runLabel: label, timedOut: true, termination: "removed", containers: ["c0ffee"] });
  });

  it("records that no container existed when the CLI was killed before creating one", async () => {
    const fake = fakeDaemon((args) => (args[0] === "run" ? timedOut : undefined));
    const run = await new Capsule({ adapter: fake.adapter, receipts: true }).job.run({ image: "node:22", timeoutMs: 50 });

    expect(fake.calls.some((args) => args[0] === "rm")).toBe(false);
    expect(run.receipt?.metadata).toMatchObject({ timedOut: true, termination: "not-created", containers: [] });
  });

  it("reports an unknown outcome with the residual container when removal fails", async () => {
    const fake = fakeDaemon((args) => {
      if (args[0] === "run") return timedOut;
      if (args[0] === "ps") return { ...ok, stdout: "c0ffee\n" };
      if (args[0] === "rm") return { exitCode: 1, stdout: "", stderr: "daemon busy" };
      return undefined;
    });
    const store = new MemoryReceiptStore();
    const error = await new Capsule({ adapter: fake.adapter, receipts: true, receiptStore: store })
      .job.run({ image: "node:22", timeoutMs: 50 })
      .then(
        () => undefined,
        (caught: unknown) => caught
      );

    expect(error).toBeInstanceOf(CleanupFailureError);
    const effects = partialEffectsOf(error)!;
    expect(effects).toMatchObject({ operation: "job.run", outcome: "unknown", cleanup: { status: "failed" } });
    expect(effects.cleanup.residual?.map((resource) => resource.nativeId)).toEqual(["c0ffee"]);
    expect(store.receipts.some((receipt) => receipt.type === "job.run")).toBe(false);
  });

  it("does not report a timed-out sandbox exec as an exit code", async () => {
    const fake = fakeDaemon((args) => (args[0] === "exec" ? timedOut : undefined));
    const store = new MemoryReceiptStore();
    const box = await new Capsule({ adapter: fake.adapter, receipts: true, receiptStore: store }).sandbox.create({});

    const error = await box.exec({ command: "sleep 60", timeoutMs: 50 }).then(
      () => undefined,
      (caught: unknown) => caught
    );

    expect(error).toBeInstanceOf(UnknownOutcomeError);
    expect((error as UnknownOutcomeError).resource).toMatchObject({ provider: "docker", kind: "sandbox", nativeId: "box-1" });
    expect(store.receipts.some((receipt) => receipt.type === "sandbox.exec")).toBe(false);
  });

  it("reports a timed-out docker create as unknown by name without removing anything", async () => {
    const fake = fakeDaemon((args) => (args[0] === "create" ? timedOut : undefined));
    const error = await new Capsule({ adapter: fake.adapter })
      .sandbox.create({ name: "maybe-created", timeoutMs: 50 })
      .then(
        () => undefined,
        (caught: unknown) => caught
      );

    expect(error).toBeInstanceOf(UnknownOutcomeError);
    expect((error as UnknownOutcomeError).resource).toMatchObject({ kind: "sandbox", nativeId: "maybe-created" });
    expect(fake.calls.some((args) => args[0] === "rm" || args[0] === "start")).toBe(false);
  });
});

describe("PERF-10: docker output bounds", () => {
  it("passes resolved per-stream bounds with policy ceilings to the runner and surfaces truncation", async () => {
    const seen: Array<RunDockerOptions | undefined> = [];
    const truncation = {
      stdout: { truncated: true, reason: "bytes" as const, capturedBytes: 9, limit: 9 },
      stderr: { truncated: false, capturedBytes: 0 }
    };
    const fake = fakeDaemon((args, options) => {
      if (args[0] !== "exec") return undefined;
      seen.push(options);
      return { exitCode: 0, stdout: "token=sec", stderr: "", truncation };
    });
    const store = new MemoryReceiptStore();
    const capsule = new Capsule({
      adapter: fake.adapter,
      receipts: true,
      receiptStore: store,
      policy: { limits: { maxStderrBytes: 100 }, secrets: { allowed: ["SECRET"], redactFromLogs: true } }
    });
    const box = await capsule.sandbox.create({});
    const result = await box.exec({ command: "print", env: { SECRET: "secretvalue" }, bounds: { maxBytes: 9 } });

    expect(seen[0]?.outputBounds?.stdout.maxBytes).toBe(9);
    expect(seen[0]?.outputBounds?.stderr.maxBytes).toBe(9);
    expect(seen[0]?.outputBounds?.stdout.deadlineMs).toBe(Number.MAX_SAFE_INTEGER);
    expect(result.truncation).toEqual(truncation);
    // The cap cut the secret after "sec"; the trailing prefix is redacted too.
    expect(result.stdout).toBe("token=[REDACTED]");
    expect(store.receipts.find((receipt) => receipt.type === "sandbox.exec")?.metadata).toMatchObject({ outputTruncation: truncation });
  });

  it("applies the documented 16 MiB default and policy ceilings to job.run", async () => {
    const seen: Array<RunDockerOptions | undefined> = [];
    const fake = fakeDaemon((args, options) => {
      if (args[0] === "run") seen.push(options);
      return undefined;
    });
    await new Capsule({ adapter: fake.adapter, policy: { limits: { maxStdoutBytes: 1000 } } }).job.run({ image: "node:22" });
    expect(seen[0]?.outputBounds?.stdout.maxBytes).toBe(1000);
    expect(seen[0]?.outputBounds?.stderr.maxBytes).toBe(16 * 1024 * 1024);
  });

  it("rejects invalid bounds before running the command", async () => {
    const fake = fakeDaemon(() => undefined);
    const box = await new Capsule({ adapter: fake.adapter }).sandbox.create({});
    await expect(box.exec({ command: "true", bounds: { maxBytes: 0 } })).rejects.toBeInstanceOf(RangeError);
    expect(fake.calls.some((args) => args[0] === "exec")).toBe(false);
  });
});
