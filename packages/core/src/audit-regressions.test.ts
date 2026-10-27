// Audit regressions for the M1 campaign (core domain). Each test asserts the INTENDED behavior from the
// M1 manifest and is marked it.fails while the defect is present on the baseline (7d3a28a). The owner
// who fixes an ID flips its it.fails to it in the same commit. All clients are in-memory fakes.
import fs from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setFlagsFromString } from "node:v8";
import { runInNewContext } from "node:vm";
import { describe, expect, it } from "vitest";
import type { CapsuleAdapter } from "./adapters.js";
import { collectFileArtifacts } from "./artifact-collector.js";
import { Capsule } from "./capsule.js";
import { evaluatePolicy, mergePolicy, redactError } from "./policy.js";
import { createReceipt, verifyReceipt } from "./receipts.js";
import type { CapsulePolicy, ExecResult, ExecSpec } from "./types.js";

setFlagsFromString("--expose-gc");
const gc = runInNewContext("gc") as () => void;
const tick = () => new Promise<void>((resolve) => setImmediate(resolve));
const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

function okResult(): ExecResult {
  return { exitCode: 0, stdout: "", stderr: "", logs: [], artifacts: [] };
}

function sandboxAdapter(exec: (spec: ExecSpec) => Promise<ExecResult>): CapsuleAdapter {
  return {
    name: "audit-fake",
    provider: "audit-fake",
    capabilities: { sandbox: { create: "native", exec: "native", fileRead: "native", fileWrite: "native", fileList: "native", destroy: "native" } },
    sandbox: {
      create: async () => ({
        handle: { id: "audit-box", provider: "audit-fake", createdAt: new Date(0).toISOString() },
        exec,
        writeFile: async () => {},
        readFile: async () => new Uint8Array(),
        listFiles: async () => [],
        destroy: async () => {}
      })
    }
  };
}

function firstCommand(spec: ExecSpec): string {
  return Array.isArray(spec.command) ? String(spec.command[0]) : String(spec.command);
}

describe("M1 audit regressions: core", () => {
  it.fails("CORE-02: a sibling's failed required receipt write rejects only that sibling", async () => {
    const release = new Map<string, () => void>();
    const capsule = new Capsule({
      adapter: sandboxAdapter((spec) => new Promise((resolve) => release.set(firstCommand(spec), () => resolve(okResult())))),
      receipts: true,
      receiptPersistence: "required",
      receiptStore: {
        write(receipt) {
          if (receipt.command?.[0] === "A") throw new Error("write-A-failed");
        }
      }
    });
    const box = await capsule.sandbox.create({});
    const a = box.exec({ command: ["A"] }).then(
      () => "resolved",
      (error: Error) => error.message
    );
    const b = box.exec({ command: ["B"] }).then(
      () => "resolved",
      (error: Error) => error.message
    );
    await tick();
    release.get("A")!();
    expect(await a).toBe("write-A-failed");
    release.get("B")!();
    expect(await b).toBe("resolved");
  });

  it.fails("CORE-02: B resolves on its own write while A's required write is still stalled", async () => {
    let releaseA!: () => void;
    const aWrite = new Promise<void>((resolve) => (releaseA = resolve));
    const capsule = new Capsule({
      adapter: sandboxAdapter(async (spec) => {
        await sleep(firstCommand(spec) === "A" ? 1 : 5);
        return okResult();
      }),
      receipts: true,
      receiptPersistence: "required",
      receiptStore: {
        async write(receipt) {
          if (receipt.command?.[0] === "A") await aWrite;
        }
      }
    });
    const box = await capsule.sandbox.create({});
    const a = box.exec({ command: ["A"] });
    const b = box.exec({ command: ["B"] }).then(() => "resolved");
    const outcome = await Promise.race([b, sleep(500).then(() => "still-waiting-for-A")]);
    releaseA();
    await a;
    expect(outcome).toBe("resolved");
  });

  it.fails("CORE-01: a non-retaining store lets completed receipts be collected while the sandbox stays live", async () => {
    const capsule = new Capsule({ adapter: sandboxAdapter(async () => okResult()), receipts: true, receiptStore: { write() {} } });
    const box = await capsule.sandbox.create({});
    const refs: WeakRef<object>[] = [];
    for (let i = 0; i < 200; i += 1) {
      const result = await box.exec({ command: ["noop", String(i)] });
      refs.push(new WeakRef(result.receipt!));
    }
    for (let i = 0; i < 3; i += 1) {
      await tick();
      gc();
    }
    expect(box.handle.id).toBe("audit-box");
    expect(refs.filter((ref) => ref.deref() !== undefined).length).toBeLessThan(10);
  });

  it.fails("POL-01: merging an allowlist into a present secrets block without allowed never widens the deny-all", () => {
    const base: CapsulePolicy = { secrets: { redactFromLogs: true } };
    const decide = (policy: CapsulePolicy) => {
      try {
        evaluatePolicy(policy, { env: { TOKEN: "synthetic-value" } });
        return "allowed";
      } catch {
        return "denied";
      }
    };
    expect(decide(base)).toBe("denied");
    expect(decide(mergePolicy(base, { secrets: { allowed: ["TOKEN"] } }))).toBe("denied");
    expect(decide(mergePolicy({ secrets: { allowed: ["TOKEN"] } }, base))).toBe("denied");
  });

  it.fails("POL-02: redactError also redacts an already materialized stack", () => {
    const error = new Error("Bearer FAKE-not-a-real-token-value");
    void error.stack;
    redactError(error, undefined);
    expect(error.message).not.toContain("FAKE-not-a-real-token-value");
    expect(error.stack).not.toContain("FAKE-not-a-real-token-value");
  });

  it.fails("POL-02: a public operation error never leaks a credential through error.stack", async () => {
    const capsule = new Capsule({
      adapter: {
        name: "audit-fake",
        provider: "audit-fake",
        capabilities: { job: { run: "native" } } as never,
        job: {
          run: async () => {
            const error = new Error("Bearer FAKE-not-a-real-token-value");
            void error.stack;
            throw error;
          }
        }
      }
    });
    const caught = await capsule.job.run({ image: "fake", command: ["noop"] }).then(
      () => undefined,
      (error: Error) => error
    );
    expect(caught).toBeInstanceOf(Error);
    expect(caught!.stack).not.toContain("FAKE-not-a-real-token-value");
  });

  describe("EV-01: runtime receipt verdict agrees with the exported schema", () => {
    const receipt = createReceipt({
      type: "job.run",
      provider: "synthetic",
      adapter: "synthetic",
      capabilityPath: "job.run",
      supportLevel: "native",
      startedAt: new Date("2026-01-01T00:00:00Z"),
      finishedAt: new Date("2026-01-01T00:00:00Z")
    });
    const mutations: Array<[string, Record<string, unknown>]> = [
      ["unknown schema version", { schemaVersion: "capsule.receipt.v999" }],
      ["resource as string", { resource: "wrongtype" }],
      ["non-string command element", { command: [42] }],
      ["unknown top-level property", { unexpected: true }],
      ["invalid enforcement", { policy: { ...receipt.policy, enforcement: "banana" } }]
    ];
    for (const [name, mutation] of mutations) {
      it.fails(`rejects ${name}`, () => {
        expect(verifyReceipt({ ...receipt, ...mutation } as never).schema.valid).toBe(false);
      });
    }
    it("keeps accepting a documented legacy receipt that omits schemaVersion", () => {
      const { schemaVersion: _omitted, ...legacy } = receipt;
      expect(verifyReceipt(legacy as never).schema.valid).toBe(true);
    });
  });

  it.fails("IO-01: a 16 MiB file is not read in full under maxBytes 1", () => {
    const dir = fs.mkdtempSync(join(tmpdir(), "capsule-io01-"));
    const path = join(dir, "large.bin");
    fs.writeFileSync(path, "");
    fs.truncateSync(path, 16 * 1024 * 1024);
    const original = { readFileSync: fs.readFileSync, readSync: fs.readSync };
    let bytesRead = 0;
    let insideReadFile = false;
    fs.readFileSync = ((...args: Parameters<typeof fs.readFileSync>) => {
      insideReadFile = true;
      try {
        const value = original.readFileSync(...args);
        bytesRead += typeof value === "string" ? Buffer.byteLength(value) : value.byteLength;
        return value;
      } finally {
        insideReadFile = false;
      }
    }) as typeof fs.readFileSync;
    fs.readSync = ((...args: Parameters<typeof fs.readSync>) => {
      const read = (original.readSync as (...inner: unknown[]) => number)(...args);
      if (!insideReadFile) bytesRead += read;
      return read;
    }) as typeof fs.readSync;
    syncBuiltinESMExports();
    try {
      const result = collectFileArtifacts(dir, { maxBytes: 1 });
      expect(result.truncated).toBe(true);
      expect(bytesRead).toBeLessThan(1024 * 1024);
    } finally {
      fs.readFileSync = original.readFileSync;
      fs.readSync = original.readSync;
      syncBuiltinESMExports();
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
