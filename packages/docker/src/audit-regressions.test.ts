// Audit regressions for the M1 campaign (Docker sandbox). Each test asserts the INTENDED behavior from the
// M1 manifest and is marked it.fails while the defect is present on the baseline (7d3a28a). The owner
// who fixes an ID flips its it.fails to it in the same commit. The runner is an injected fake; no
// Docker daemon is used. SB-02 runs the generated shell locally with a harmless fake `find`.
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import { Capsule, MemoryReceiptStore } from "@capsule-sdk/core";
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

  it.fails("SB-04: a receipt signer failure after allocation attempts container removal and keeps the original error", async () => {
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

  it.fails("SB-07: artifacts with equal basenames from different directories are both preserved or rejected before copying", async () => {
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

  it.fails("SB-08: exec input implies an interactive docker exec so stdin reaches the process", async () => {
    const fake = fakeDocker();
    const box = await new Capsule({ adapter: fake.adapter }).sandbox.create({});
    await box.exec({ command: "cat", input: "hello" });
    const execArgs = fake.calls.find((args) => args[0] === "exec")!;
    expect(execArgs.includes("-i") || execArgs.includes("--interactive")).toBe(true);
  });

  it.fails("SB-10d: job.artifacts is not declared while job.run never collects artifacts", () => {
    expect(new Capsule({ adapter: fakeDocker().adapter }).supports("job.artifacts")).toBe(false);
  });
});
