// Audit regressions for the M1 campaign (Docker sandbox). Each test asserts the INTENDED behavior from the
// M1 manifest and is marked it.fails while the defect is present on the baseline (7d3a28a). The owner
// who fixes an ID flips its it.fails to it in the same commit. The runner is an injected fake; no
// Docker daemon is used. SB-02 runs the generated shell locally with a harmless fake `find`.
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import { Capsule, CleanupFailureError, MemoryReceiptStore, PartialEffectsError, partialEffectsOf, sha256 } from "@capsule-sdk/core";
import type { DockerCommandResult, RunDockerOptions } from "./docker-cli.js";
import { docker } from "./index.js";

const ok: DockerCommandResult = { exitCode: 0, stdout: "", stderr: "" };

function fakeDocker(handler: (args: string[], options?: RunDockerOptions) => DockerCommandResult | undefined = () => undefined) {
  const calls: string[][] = [];
  const adapter = docker({
    checkAvailable: async () => true,
    runner: async (args, options) => {
      calls.push(args);
      return handler(args, options) ?? (args[0] === "create" ? { ...ok, stdout: "audit-container\n" } : ok);
    }
  });
  return { calls, adapter };
}

describe("M1 audit regressions: docker", () => {
  it("SB-03: a nonzero docker rm rejects destroy and writes no deleted receipt", async () => {
    const fake = fakeDocker((args) => (args[0] === "rm" ? { exitCode: 1, stdout: "", stderr: "permission denied" } : undefined));
    const store = new MemoryReceiptStore();
    const box = await new Capsule({ adapter: fake.adapter, receipts: true, receiptStore: store }).sandbox.create({});
    const outcome = await box.destroy().then(
      () => "resolved",
      () => "rejected"
    );
    expect(outcome).toBe("rejected");
    expect(store.receipts.some((receipt) => receipt.type === "sandbox.destroy" && receipt.resource?.status === "deleted")).toBe(false);
  });

  it("SB-03: an already absent container is an explicit idempotent destroy", async () => {
    const fake = fakeDocker((args) => (args[0] === "rm" ? { exitCode: 1, stdout: "", stderr: "Error response from daemon: No such container: audit-container" } : undefined));
    const store = new MemoryReceiptStore();
    const box = await new Capsule({ adapter: fake.adapter, receipts: true, receiptStore: store }).sandbox.create({});
    await box.destroy();
    const deleted = store.receipts.find((receipt) => receipt.type === "sandbox.destroy");
    expect(deleted?.resource?.status).toBe("deleted");
    expect(deleted?.metadata).toMatchObject({ alreadyAbsent: true });
  });

  it("SB-02: listFiles treats dollar and backtick paths as literals", async () => {
    const dir = mkdtempSync(join(tmpdir(), "capsule-sb02-"));
    const marker = join(dir, "marker");
    const fake = fakeDocker((args) => {
      if (args[0] !== "exec") return undefined;
      const flag = args.findIndex((arg) => arg === "-c" || arg === "-lc");
      if (flag > 0 && args[flag - 1] === "sh") {
        // Execute exactly the generated script, with a harmless fake find, never a container.
        execFileSync("/bin/sh", ["-c", `find() { :; }; ${args[flag + 1]}`, ...args.slice(flag + 2)]);
      }
      return undefined;
    });
    try {
      const box = await new Capsule({ adapter: fake.adapter }).sandbox.create({});
      await box.listFiles(`/workspace/$(touch ${marker})`).catch(() => undefined);
      await box.listFiles(`/workspace/\`touch ${marker}\``).catch(() => undefined);
      expect(existsSync(marker)).toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("SB-02: listFiles passes the literal path as one argv element and parses NUL-separated entries", async () => {
    const tricky = "/workspace/it's \"$HOME\" `id`\nnext";
    const fake = fakeDocker((args) => {
      if (args[0] !== "exec") return undefined;
      return { ...ok, stdout: ["a\tb\nc", `${tricky}/a\tb\nc`, "f", "3", "sub", `${tricky}/sub`, "d", "4096", ""].join("\0") };
    });
    const box = await new Capsule({ adapter: fake.adapter }).sandbox.create({});
    const entries = await box.listFiles(tricky);
    expect(fake.calls.at(-1)).toEqual(["exec", "audit-container", "find", tricky, "-maxdepth", "1", "-mindepth", "1", "-printf", "%f\\0%p\\0%y\\0%s\\0"]);
    expect(entries).toEqual([
      { name: "a\tb\nc", path: `${tricky}/a\tb\nc`, type: "file", sizeBytes: 3 },
      { name: "sub", path: `${tricky}/sub`, type: "directory", sizeBytes: 4096 }
    ]);
    await box.listFiles("-delete");
    expect(fake.calls.at(-1)?.[3]).toBe("./-delete");
  });

  it("SB-04: a receipt signer failure after allocation attempts container removal and keeps the original error", async () => {
    const fake = fakeDocker();
    const capsule = new Capsule({
      adapter: fake.adapter,
      receipts: true,
      receiptSigner: {
        algorithm: "test",
        sign: () => {
          throw new Error("sign failed");
        }
      }
    });
    const error = await capsule.sandbox.create({}).then(
      () => undefined,
      (caught: Error) => caught
    );
    expect(error).toBeInstanceOf(Error);
    expect(`${error?.message} ${String((error as { cause?: unknown } | undefined)?.cause)}`).toContain("sign failed");
    expect(fake.calls.some((args) => args[0] === "rm")).toBe(true);
  });

  it("SB-04: a start failure removes the created container and keeps the start error as the cause", async () => {
    const fake = fakeDocker((args) => (args[0] === "start" ? { exitCode: 1, stdout: "", stderr: "port is already allocated" } : undefined));
    const error = await new Capsule({ adapter: fake.adapter }).sandbox.create({}).then(
      () => undefined,
      (caught: unknown) => caught
    );
    expect(error).toBeInstanceOf(PartialEffectsError);
    const effects = partialEffectsOf(error)!;
    expect(effects).toMatchObject({ operation: "sandbox.create", outcome: "failed", cleanup: { status: "succeeded" } });
    expect(effects.resources[0]).toMatchObject({ provider: "docker", kind: "sandbox", nativeId: "audit-container" });
    expect((effects.primaryError as Error).message).toContain("port is already allocated");
    expect(fake.calls.filter((args) => args[0] === "rm")).toEqual([["rm", "-f", "audit-container"]]);
  });

  it("SB-04: a failed rollback reports the residual container and both errors separately", async () => {
    const fake = fakeDocker((args) =>
      args[0] === "start" ? { exitCode: 1, stdout: "", stderr: "start boom" } : args[0] === "rm" ? { exitCode: 1, stdout: "", stderr: "rm boom" } : undefined
    );
    const error = await new Capsule({ adapter: fake.adapter }).sandbox.create({}).then(
      () => undefined,
      (caught: unknown) => caught
    );
    expect(error).toBeInstanceOf(CleanupFailureError);
    const effects = partialEffectsOf(error)!;
    expect((effects.primaryError as Error).message).toContain("start boom");
    expect(effects.cleanup.status).toBe("failed");
    expect((effects.cleanup.error as Error).message).toContain("rm boom");
    expect(effects.cleanup.residual?.[0]?.nativeId).toBe("audit-container");
  });

  it("SB-07: artifacts with equal basenames from different directories are both preserved or rejected before copying", async () => {
    let copies = 0;
    const fake = fakeDocker((args) => {
      if (args[0] !== "cp") return undefined;
      copies += 1;
      const source = args[1]!.slice(args[1]!.indexOf(":") + 1);
      const destination = args[2]!;
      const target = existsSync(destination) && statSync(destination).isDirectory() ? join(destination, basename(source)) : destination;
      mkdirSync(dirname(target), { recursive: true });
      writeFileSync(target, `content of ${source}`);
      return undefined;
    });
    const box = await new Capsule({ adapter: fake.adapter }).sandbox.create({});
    const outcome = await box.exec({ command: "true", artifactPaths: ["/a/out.txt", "/b/out.txt"] }).then(
      (result) => ({ result }),
      (error: Error) => ({ error })
    );
    if ("error" in outcome) {
      expect(copies).toBe(0);
      return;
    }
    const artifacts = outcome.result.artifacts;
    expect(artifacts).toHaveLength(2);
    expect(new Set(artifacts.map((artifact) => artifact.path)).size).toBe(2);
    expect(new Set(artifacts.map((artifact) => artifact.sha256)).size).toBe(2);
  });

  it("SB-07: distinct container paths keep their relative layout and content", async () => {
    const fake = fakeDocker((args) => {
      if (args[0] !== "cp") return undefined;
      const source = args[1]!.slice(args[1]!.indexOf(":") + 1);
      writeFileSync(join(args[2]!, basename(source)), `content of ${source}`);
      return undefined;
    });
    const box = await new Capsule({ adapter: fake.adapter }).sandbox.create({});
    const result = await box.exec({ command: "true", artifactPaths: ["/workspace/a/out.txt", "/workspace/b/c/out.txt"] });
    expect(result.artifacts.map((artifact) => [artifact.path, artifact.sha256]).sort()).toEqual(
      [
        ["a/out.txt", sha256("content of /workspace/a/out.txt")],
        ["b/c/out.txt", sha256("content of /workspace/b/c/out.txt")]
      ].sort()
    );
  });

  it("SB-07: a duplicate artifact path is rejected before the command or any copy runs", async () => {
    const fake = fakeDocker();
    const box = await new Capsule({ adapter: fake.adapter }).sandbox.create({});
    await expect(box.exec({ command: "true", artifactPaths: ["/a/out.txt", "/a/../a/out.txt"] })).rejects.toThrow("requested more than once");
    expect(fake.calls.some((args) => args[0] === "cp" || args[0] === "exec")).toBe(false);
  });

  it("SB-08: exec input implies an interactive docker exec so stdin reaches the process", async () => {
    const fake = fakeDocker();
    const box = await new Capsule({ adapter: fake.adapter }).sandbox.create({});
    await box.exec({ command: "cat", input: "hello" });
    const execArgs = fake.calls.find((args) => args[0] === "exec")!;
    expect(execArgs.includes("-i") || execArgs.includes("--interactive")).toBe(true);
  });

  it("SB-08: empty input still attaches stdin for an explicit EOF and absent input does not", async () => {
    const seen: Array<RunDockerOptions | undefined> = [];
    const fake = fakeDocker((args, options) => {
      if (args[0] === "exec") seen.push(options);
      return undefined;
    });
    const box = await new Capsule({ adapter: fake.adapter }).sandbox.create({});
    await box.exec({ command: ["cat"], input: "" });
    await box.exec({ command: ["true"] });
    const execs = fake.calls.filter((args) => args[0] === "exec");
    expect(execs[0]).toEqual(["exec", "-i", "audit-container", "cat"]);
    expect(seen[0]?.input).toBe("");
    expect(execs[1]).toEqual(["exec", "audit-container", "true"]);
    expect(seen[1]?.input).toBeUndefined();
  });

  it("SB-10d: job.artifacts is not declared while job.run never collects artifacts", () => {
    const capsule = new Capsule({ adapter: fakeDocker().adapter });
    expect(capsule.supports("job.artifacts")).toBe(false);
    // Sandbox artifact collection is real and stays declared.
    expect(capsule.supportLevel("sandbox.artifacts")).toBe("emulated");
  });
});
