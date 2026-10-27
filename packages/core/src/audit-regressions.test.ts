// Audit regressions for the M1 campaign (core domain). Each test asserts the INTENDED behavior from the
// M1 manifest and is marked it.fails while the defect is present on the baseline (7d3a28a). The owner
// who fixes an ID flips its it.fails to it in the same commit. All clients are in-memory fakes.
import fs from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { inspect } from "node:util";
import { setFlagsFromString } from "node:v8";
import { runInNewContext } from "node:vm";
import { describe, expect, it } from "vitest";
import type { CapsuleAdapter } from "./adapters.js";
import { collectFileArtifacts } from "./artifact-collector.js";
import { sha256 } from "./artifacts.js";
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
  it("CORE-02: a sibling's failed required receipt write rejects only that sibling", async () => {
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

  it("CORE-02: B resolves on its own write while A's required write is still stalled", async () => {
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

  it("CORE-02: completed required writes are not retained by a live sandbox", async () => {
    const writes: WeakRef<Promise<void>>[] = [];
    const capsule = new Capsule({
      adapter: sandboxAdapter(async () => okResult()),
      receipts: true,
      receiptPersistence: "required",
      receiptStore: {
        write() {
          const write = Promise.resolve();
          writes.push(new WeakRef(write));
          return write;
        }
      }
    });
    const box = await capsule.sandbox.create({});
    for (let i = 0; i < 200; i += 1) {
      await box.exec({ command: ["noop", String(i)] });
    }
    for (let i = 0; i < 3; i += 1) {
      await tick();
      gc();
    }
    expect(box.handle.id).toBe("audit-box");
    expect(writes.length).toBe(200);
    expect(writes.filter((ref) => ref.deref() !== undefined).length).toBeLessThan(10);
  });

  it("CORE-02: each sequential operation still awaits its own required write", async () => {
    const capsule = new Capsule({
      adapter: sandboxAdapter(async () => okResult()),
      receipts: true,
      receiptPersistence: "required",
      receiptStore: {
        async write(receipt) {
          await sleep(1);
          if (receipt.command?.[0] === "fail") throw new Error("own-write-failed");
        }
      }
    });
    const box = await capsule.sandbox.create({});
    await expect(box.exec({ command: ["ok"] })).resolves.toMatchObject({ exitCode: 0 });
    await expect(box.exec({ command: ["fail"] })).rejects.toThrow("own-write-failed");
    await expect(box.exec({ command: ["ok"] })).resolves.toMatchObject({ exitCode: 0 });
  });

  it("CORE-01: a non-retaining store lets completed receipts be collected while the sandbox stays live", async () => {
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

  it("POL-01: merging an allowlist into a present secrets block without allowed never widens the deny-all", () => {
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

  it("POL-01: merged secrets policy accepts exactly the env keys both sides accept, in both orders", () => {
    const sides: Array<[string, CapsulePolicy]> = [
      ["absent block", {}],
      ["block without allowed", { secrets: { redactFromLogs: true } }],
      ["explicit empty allowed", { secrets: { allowed: [] } }],
      ["allowed TOKEN", { secrets: { allowed: ["TOKEN"] } }],
      ["allowed TOKEN and OTHER", { secrets: { allowed: ["TOKEN", "OTHER"] } }]
    ];
    const accepts = (policy: CapsulePolicy, key: string) => {
      try {
        evaluatePolicy(policy, { env: { [key]: "synthetic-value" } });
        return true;
      } catch {
        return false;
      }
    };
    for (const [, left] of sides) {
      for (const [, right] of sides) {
        for (const key of ["TOKEN", "OTHER", "UNLISTED"]) {
          const expected = accepts(left, key) && accepts(right, key);
          expect(accepts(mergePolicy(left, right), key)).toBe(expected);
        }
      }
    }
  });

  it("POL-02: redactError also redacts an already materialized stack", () => {
    const error = new Error("Bearer FAKE-not-a-real-token-value");
    void error.stack;
    redactError(error, undefined);
    expect(error.message).not.toContain("FAKE-not-a-real-token-value");
    expect(error.stack).not.toContain("FAKE-not-a-real-token-value");
  });

  it("POL-02: stack redaction covers nested causes and env secrets while keeping class, identity and frames", () => {
    class SyntheticProviderError extends Error {}
    const inner = new Error("inner Bearer FAKE-inner-not-a-real-token");
    void inner.stack;
    const outer = new SyntheticProviderError("outer leaked synthetic-env-secret-value", { cause: inner });
    void outer.stack;
    (inner as { cause?: unknown }).cause = outer;
    const env = { API_KEY: "synthetic-env-secret-value" };
    const result = redactError(outer, env, { secrets: { allowed: ["API_KEY"], redactFromLogs: true } });
    expect(result).toBe(outer);
    expect(outer).toBeInstanceOf(SyntheticProviderError);
    const inspected = inspect(outer, { depth: 5 });
    expect(inspected).not.toContain("synthetic-env-secret-value");
    expect(inspected).not.toContain("FAKE-inner-not-a-real-token");
    expect(outer.stack).not.toContain("synthetic-env-secret-value");
    expect(inner.stack).not.toContain("FAKE-inner-not-a-real-token");
    expect(outer.stack).toMatch(/^Error: outer leaked/);
    expect(outer.stack).toContain("audit-regressions.test.ts");
  });

  it("POL-02: a public operation error never leaks a credential through error.stack", async () => {
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
      it(`rejects ${name}`, () => {
        expect(verifyReceipt({ ...receipt, ...mutation } as never).schema.valid).toBe(false);
      });
    }
    const nested: Array<[string, Record<string, unknown>]> = [
      ["unknown trace verdict", { policy: { ...receipt.policy, trace: [{ check: "secrets", verdict: "maybe" }] } }],
      ["trace item with an extra property", { policy: { ...receipt.policy, trace: [{ check: "secrets", verdict: "passed", extra: 1 }] } }],
      ["network host missing allowed", { policy: { ...receipt.policy, network: { mode: "allowlist", support: "native", hosts: [{ host: "a.example" }] } } }],
      ["cost without limitUsd", { policy: { ...receipt.policy, cost: { withinLimit: true } } }],
      ["unknown policy property", { policy: { ...receipt.policy, surprise: true } }],
      ["string exitCode", { exitCode: "0" }],
      ["non-finite durationMs", { durationMs: Number.NaN }],
      ["numeric artifact hash", { artifactHashes: [1] }],
      ["numeric providerRequestId", { metadata: { providerRequestId: 7 } }],
      ["resource with an unknown property", { resource: { id: "r", region: "x" } }],
      ["signature with an unknown property", { signature: { algorithm: "hmac-sha256", value: "v", extra: "x" } }],
      ["missing required policy", { policy: undefined }]
    ];
    for (const [name, mutation] of nested) {
      it(`rejects ${name}`, () => {
        const report = verifyReceipt({ ...receipt, ...mutation } as never);
        expect(report.schema.valid).toBe(false);
        expect(report.valid).toBe(false);
      });
    }
    it("accepts a receipt that uses every optional schema member correctly", () => {
      const full = {
        ...receipt,
        parentId: "parent",
        command: ["echo", "ok"],
        image: "node:22",
        source: { kind: "git" },
        cwd: "/work",
        providerOptions: { region: "x" },
        exitCode: 0,
        stdoutHash: "a",
        stderrHash: "b",
        artifactHashes: ["c"],
        policy: {
          ...receipt.policy,
          notes: ["n"],
          enforcement: "advisory",
          trace: [{ check: "secrets", verdict: "passed" }],
          cost: { requestedUsd: 1, limitUsd: 2, withinLimit: true },
          ttl: { limitMs: 10, withinLimit: true },
          network: { mode: "allowlist", support: "unknown", hosts: [{ host: "a.example", allowed: true }] }
        },
        resource: { id: "r", name: "n", url: "https://example.invalid", status: "running" },
        metadata: { providerRequestId: "req", custom: { nested: true } },
        signature: { algorithm: "hmac-sha256", value: "v", keyId: "k" }
      };
      expect(verifyReceipt(full as never).schema).toEqual({ valid: true, errors: [] });
    });
    it("keeps accepting a documented legacy receipt that omits schemaVersion", () => {
      const { schemaVersion: _omitted, ...legacy } = receipt;
      expect(verifyReceipt(legacy as never).schema.valid).toBe(true);
    });
  });

  it("IO-01: a 16 MiB file is not read in full under maxBytes 1", () => {
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

  it("IO-01: multi-chunk files hash identically to a whole-buffer sha256", () => {
    const dir = fs.mkdtempSync(join(tmpdir(), "capsule-io01-hash-"));
    try {
      const content = Buffer.alloc(300 * 1024 + 7);
      for (let i = 0; i < content.length; i += 1) content[i] = (i * 31) % 251;
      fs.writeFileSync(join(dir, "a.bin"), content);
      fs.writeFileSync(join(dir, "b.txt"), "");
      const result = collectFileArtifacts(dir, { maxBytes: content.length });
      expect(result).toEqual({
        artifacts: [
          { name: "a.bin", path: "a.bin", sizeBytes: content.length, sha256: sha256(content) },
          { name: "b.txt", path: "b.txt", sizeBytes: 0, sha256: sha256("") }
        ],
        truncated: false
      });
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("IO-01: a file that grows past the budget after the size check is not read past the budget or collected", () => {
    const dir = fs.mkdtempSync(join(tmpdir(), "capsule-io01-grow-"));
    const path = join(dir, "growing.bin");
    fs.writeFileSync(path, Buffer.alloc(4 * 1024 * 1024, 1));
    const original = { fstatSync: fs.fstatSync, readSync: fs.readSync };
    let bytesRead = 0;
    fs.fstatSync = ((...args: Parameters<typeof fs.fstatSync>) => ({ ...original.fstatSync(...args), size: 10 })) as typeof fs.fstatSync;
    fs.readSync = ((...args: Parameters<typeof fs.readSync>) => {
      const read = (original.readSync as (...inner: unknown[]) => number)(...args);
      bytesRead += read;
      return read;
    }) as typeof fs.readSync;
    syncBuiltinESMExports();
    try {
      const result = collectFileArtifacts(dir, { maxBytes: 100 });
      expect(result).toEqual({ artifacts: [], truncated: true, truncation: { reason: "maxBytes", collectedFiles: 0, collectedBytes: 0 } });
      expect(bytesRead).toBeLessThanOrEqual(101);
    } finally {
      fs.fstatSync = original.fstatSync;
      fs.readSync = original.readSync;
      syncBuiltinESMExports();
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
