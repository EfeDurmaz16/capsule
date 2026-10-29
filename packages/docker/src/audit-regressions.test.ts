// Audit regressions for the M1 campaign (Docker sandbox). Each test asserts the INTENDED behavior from the
// M1 manifest and is marked it.fails while the defect is present on the baseline (7d3a28a). The owner
// who fixes an ID flips its it.fails to it in the same commit. The runner is an injected fake; no
// Docker daemon is used. SB-02 runs the generated shell locally with a harmless fake `find`.
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
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
    const fake = fakeDocker((args) =>
      args[0] === "rm" ? { exitCode: 1, stdout: "", stderr: "Error response from daemon: No such container: audit-container" } : undefined
    );
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
    const tricky = '/workspace/it\'s "$HOME" `id`\nnext';
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

// PERF-14: a 1/10/100-path profile (benchmarks/workloads/perf-14-docker-artifacts.mjs) showed collection
// time is one docker CLI round trip per path. A single tar stream would need tar inside the container, run
// as the container user and extract a container-controlled archive on the host, so it cannot reproduce
// `docker cp` exactly; disjoint paths are instead copied with up to 4 `docker cp` at a time, still one
// call per path with the same arguments.
function timedDocker(options: { delayMs?: number; failFor?: string[] } = {}) {
  const copies: Array<{ path: string; target: string; startedAt: number; endedAt?: number }> = [];
  let inFlight = 0;
  let maxInFlight = 0;
  const adapter = docker({
    checkAvailable: async () => true,
    runner: async (args) => {
      if (args[0] === "create") return { ...ok, stdout: "audit-container\n" };
      if (args[0] !== "cp") return ok;
      const source = args[1]!.slice(args[1]!.indexOf(":") + 1);
      const copy: { path: string; target: string; startedAt: number; endedAt?: number } = { path: source, target: args[2]!, startedAt: performance.now() };
      copies.push(copy);
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise((resolve) => setTimeout(resolve, options.delayMs ?? 5));
      inFlight -= 1;
      copy.endedAt = performance.now();
      if (options.failFor?.includes(source)) return { exitCode: 1, stdout: "", stderr: `no such path ${source}` };
      // Behaves like docker cp into an existing directory: the source's basename lands inside it. A source
      // without a file extension stands for a directory.
      if (source.endsWith(".txt")) writeFileSync(join(args[2]!, basename(source)), `content of ${source}`);
      else mkdirSync(join(args[2]!, basename(source)), { recursive: true });
      return ok;
    }
  });
  return { adapter, copies, maxInFlight: () => maxInFlight };
}

describe("PERF-14: docker cp of several artifact paths", () => {
  it("copies disjoint paths up to 4 at a time with the same calls, layout and hashes as one at a time", async () => {
    const fake = timedDocker({ delayMs: 20 });
    const box = await new Capsule({ adapter: fake.adapter }).sandbox.create({});
    const paths = Array.from({ length: 10 }, (_, index) => `/work/d${index}/out.txt`);
    const result = await box.exec({ command: "true", artifactPaths: paths });
    expect(fake.maxInFlight()).toBe(4);
    expect(fake.copies.map((copy) => copy.path)).toEqual(paths);
    expect(result.artifacts.map((artifact) => [artifact.path, artifact.sha256]).sort()).toEqual(
      paths.map((path, index) => [`d${index}/out.txt`, sha256(`content of ${path}`)]).sort()
    );
  });

  it("keeps nested paths strictly sequential in request order", async () => {
    const fake = timedDocker({ delayMs: 5 });
    const box = await new Capsule({ adapter: fake.adapter }).sandbox.create({});
    await box.exec({ command: "true", artifactPaths: ["/a/x.txt", "/a", "/a-b/y.txt", "/a/sub/z.txt"] });
    expect(fake.maxInFlight()).toBe(1);
    expect(fake.copies.map((copy) => copy.path)).toEqual(["/a/x.txt", "/a", "/a-b/y.txt", "/a/sub/z.txt"]);
  });

  it.each([[["/out", "/out/logs/run.log"]], [["/out", "/out/logs/sub/run.log"]]])(
    "refuses to copy %j through a symbolic link an earlier copy planted, so nothing lands outside the temp dir",
    async (paths) => {
      // The container planted /out/logs -> a host directory. docker cp copies the link itself into the temp
      // tree; a later copy into out/logs then followed it, through mkdir -p and through docker cp, which
      // resolves a symbolic link in its destination, and wrote run.log on the host.
      const outside = mkdtempSync(join(tmpdir(), "capsule-artifact-outside-"));
      try {
        const copied: string[] = [];
        const fake = fakeDocker((args) => {
          if (args[0] !== "cp") return undefined;
          const source = args[1]!.slice(args[1]!.indexOf(":") + 1);
          copied.push(source);
          if (source === "/out") {
            mkdirSync(join(args[2]!, "out"));
            writeFileSync(join(args[2]!, "out", "top.txt"), "top");
            symlinkSync(outside, join(args[2]!, "out", "logs"));
          } else {
            writeFileSync(join(args[2]!, basename(source)), `content of ${source}`);
          }
          return undefined;
        });
        const box = await new Capsule({ adapter: fake.adapter }).sandbox.create({});
        await expect(box.exec({ command: "true", artifactPaths: paths })).rejects.toThrow(
          "out/logs, which an earlier artifact copy created as a symbolic link"
        );
        expect(readdirSync(outside)).toEqual([]);
        expect(copied).toEqual(["/out"]);
      } finally {
        rmSync(outside, { recursive: true, force: true });
      }
    }
  );

  it.each([[["/c/out", "/c/OUT/logs/run.txt"]], [["/c/caf\u00e9", "/c/cafe\u0301/x.txt"]], [["/c/a.txt", "/c/A.txt"]]])(
    "copies %j one at a time because a case- or normalization-insensitive host merges them",
    async (paths) => {
      // On macOS and Windows these land in one host tree, so a concurrent copy could race another copy's
      // symbolic link; they take the sequential branch and its symbolic link check.
      const fake = timedDocker({ delayMs: 5 });
      const box = await new Capsule({ adapter: fake.adapter }).sandbox.create({});
      await box.exec({ command: "true", artifactPaths: paths });
      expect(fake.maxInFlight()).toBe(1);
    }
  );

  it("reports the earliest failed path, starts no copy after a failure and lets running copies finish first", async () => {
    const fake = timedDocker({ delayMs: 15, failFor: ["/work/d1/out.txt", "/work/d3/out.txt"] });
    const box = await new Capsule({ adapter: fake.adapter }).sandbox.create({});
    const paths = Array.from({ length: 12 }, (_, index) => `/work/d${index}/out.txt`);
    let rejectedAt = 0;
    const error = await box.exec({ command: "true", artifactPaths: paths }).then(
      () => undefined,
      (caught: Error) => {
        rejectedAt = performance.now();
        return caught;
      }
    );
    expect(error?.message).toContain("docker cp artifact failed for /work/d1/out.txt");
    // Copies start in request order; none starts after the first failure is seen, and every started copy
    // has finished before exec rejects (and the temp dir is removed).
    const failedAt = fake.copies.find((copy) => copy.path === "/work/d1/out.txt")!.endedAt!;
    expect(fake.copies.map((copy) => copy.path)).toEqual(paths.slice(0, fake.copies.length));
    expect(fake.copies.length).toBeLessThan(paths.length);
    expect(fake.copies.every((copy) => copy.startedAt <= failedAt)).toBe(true);
    expect(fake.copies.every((copy) => copy.endedAt !== undefined && copy.endedAt <= rejectedAt)).toBe(true);
  });
});
