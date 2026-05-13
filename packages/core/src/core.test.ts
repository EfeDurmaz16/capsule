import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";
import { Capsule } from "./capsule.js";
import {
  capabilityDiff,
  evaluateCapabilityRequirements,
  explainSupportLevel,
  missingCapabilityRequirements,
  nativeOnlySupportLevels,
  supportLevel,
  supports,
  uniqueCapabilityPaths
} from "./capabilities.js";
import { UnsupportedCapabilityError, PolicyViolationError } from "./errors.js";
import { evaluatePolicy, mergeTimeout, redactLogEntries, redactSecrets } from "./policy.js";
import { edgeWorkerPreset, httpServicePreset, nodeJobPreset, nodeSandboxPreset, previewDatabaseBranchPreset, previewEnvironmentPreset } from "./presets.js";
import { capsuleReceiptJsonSchema } from "./receipt-schema.js";
import { createReceipt } from "./receipts.js";
import { MemoryReceiptStore } from "./stores.js";
import { assertAdapterContract } from "./contract.js";
import type { CapsuleAdapter, CapabilityMap } from "./index.js";

const capabilities: CapabilityMap = {
  sandbox: {
    create: "native",
    exec: "native",
    fileRead: "native",
    fileWrite: "native",
    fileList: "native",
    destroy: "native"
  },
  job: {
    run: "unsupported",
    status: "unsupported",
    cancel: "unsupported",
    logs: "unsupported",
    artifacts: "unsupported",
    timeout: "unsupported",
    env: "unsupported"
  }
};

const adapter: CapsuleAdapter = {
  name: "test",
  provider: "test",
  capabilities,
  sandbox: {
    create: async () => ({
      handle: { id: "box", provider: "test", createdAt: new Date().toISOString() },
      exec: async () => ({ exitCode: 0, stdout: "", stderr: "", logs: [], artifacts: [] }),
      writeFile: async () => undefined,
      readFile: async () => new Uint8Array(),
      listFiles: async () => [],
      destroy: async () => undefined
    })
  }
};

function validateAgainstSimpleSchema(schema: any, value: any, path = "$"): string[] {
  const errors: string[] = [];
  if (schema.type === "object") {
    if (typeof value !== "object" || value === null || Array.isArray(value)) return [`${path} must be object`];
    for (const key of schema.required ?? []) {
      if (!(key in value)) errors.push(`${path}.${key} is required`);
    }
    if (schema.additionalProperties === false) {
      for (const key of Object.keys(value)) {
        if (!schema.properties?.[key]) errors.push(`${path}.${key} is not allowed`);
      }
    }
    for (const [key, childSchema] of Object.entries(schema.properties ?? {})) {
      if (key in value) errors.push(...validateAgainstSimpleSchema(childSchema, value[key], `${path}.${key}`));
    }
  }
  if (schema.type === "array") {
    if (!Array.isArray(value)) return [`${path} must be array`];
    value.forEach((item, index) => errors.push(...validateAgainstSimpleSchema(schema.items, item, `${path}[${index}]`)));
  }
  if (schema.type === "string" && typeof value !== "string") errors.push(`${path} must be string`);
  if (schema.type === "number" && typeof value !== "number") errors.push(`${path} must be number`);
  if (schema.enum && !schema.enum.includes(value)) errors.push(`${path} must be one of ${schema.enum.join(", ")}`);
  return errors;
}

describe("capabilities", () => {
  test("looks up capability paths", () => {
    expect(supportLevel(capabilities, "sandbox.exec")).toBe("native");
    expect(supportLevel(capabilities, "service.deploy")).toBe("unsupported");
    expect(supports(capabilities, "sandbox.exec")).toBe(true);
    expect(supports(capabilities, "job.run")).toBe(false);
  });

  test("evaluates required and optional capability sets", () => {
    expect(
      evaluateCapabilityRequirements(capabilities, [
        "sandbox.exec",
        { path: "sandbox.snapshot", optional: true, reason: "Used only when checkpointing is enabled" },
        { path: "sandbox.fileWrite", levels: nativeOnlySupportLevels }
      ])
    ).toEqual([
      {
        path: "sandbox.exec",
        actualLevel: "native",
        acceptedLevels: ["native", "emulated", "experimental"],
        supported: true,
        optional: false,
        reason: undefined
      },
      {
        path: "sandbox.snapshot",
        actualLevel: "unsupported",
        acceptedLevels: ["native", "emulated", "experimental"],
        supported: false,
        optional: true,
        reason: "Used only when checkpointing is enabled"
      },
      {
        path: "sandbox.fileWrite",
        actualLevel: "native",
        acceptedLevels: ["native"],
        supported: true,
        optional: false,
        reason: undefined
      }
    ]);
  });

  test("returns only missing non-optional requirements", () => {
    expect(missingCapabilityRequirements(capabilities, ["sandbox.exec", "service.deploy", { path: "sandbox.snapshot", optional: true }])).toEqual([
      {
        path: "service.deploy",
        actualLevel: "unsupported",
        acceptedLevels: ["native", "emulated", "experimental"],
        supported: false,
        optional: false,
        reason: undefined
      }
    ]);
  });

  test("explains support levels with remediation guidance", () => {
    expect(explainSupportLevel(capabilities, "sandbox.exec")).toEqual({
      path: "sandbox.exec",
      level: "native",
      supported: true,
      summary: "The adapter/provider declares first-class support for this capability.",
      guidance: "sandbox.exec can be used without Capsule-side emulation warnings."
    });
    expect(explainSupportLevel(capabilities, "service.deploy")).toEqual({
      path: "service.deploy",
      level: "unsupported",
      supported: false,
      summary: "The adapter/provider does not support this capability.",
      guidance: "Choose another adapter, change the workflow requirements, or use a provider-specific escape hatch for service.deploy."
    });
  });

  test("diffs provider capability maps", () => {
    const other: CapabilityMap = {
      ...capabilities,
      sandbox: {
        ...capabilities.sandbox!,
        snapshot: "experimental"
      },
      job: {
        ...capabilities.job!,
        run: "native"
      }
    };

    expect(uniqueCapabilityPaths(capabilities, other)).toContain("sandbox.snapshot");
    expect(capabilityDiff(capabilities, other, ["sandbox.exec", "sandbox.snapshot", "job.run"])).toEqual([
      { path: "sandbox.snapshot", left: "unsupported", right: "experimental" },
      { path: "job.run", left: "unsupported", right: "native" }
    ]);
  });

  test("unsupported capability throws", async () => {
    const capsule = new Capsule({ adapter });
    await expect(capsule.job.run({ image: "node:22" })).rejects.toBeInstanceOf(UnsupportedCapabilityError);
    await expect(capsule.job.status({ id: "job_123" })).rejects.toBeInstanceOf(UnsupportedCapabilityError);
    await expect(capsule.job.cancel({ id: "job_123" })).rejects.toBeInstanceOf(UnsupportedCapabilityError);
    await expect(capsule.job.logs({ id: "job_123" })).rejects.toBeInstanceOf(UnsupportedCapabilityError);
    await expect(capsule.service.status({ id: "svc_123" })).rejects.toBeInstanceOf(UnsupportedCapabilityError);
    await expect(capsule.service.update({ id: "svc_123", image: "node:22" })).rejects.toBeInstanceOf(UnsupportedCapabilityError);
    await expect(capsule.service.rollback({ id: "svc_123", revision: "svc_123-00001-abc" })).rejects.toBeInstanceOf(UnsupportedCapabilityError);
    await expect(capsule.service.delete({ id: "svc_123" })).rejects.toBeInstanceOf(UnsupportedCapabilityError);
    await expect(capsule.service.logs({ id: "svc_123" })).rejects.toBeInstanceOf(UnsupportedCapabilityError);
    await expect(capsule.edge.version({ deploymentId: "edge_123", name: "worker" })).rejects.toBeInstanceOf(UnsupportedCapabilityError);
    await expect(capsule.edge.release({ versionId: "edge_version_123" })).rejects.toBeInstanceOf(UnsupportedCapabilityError);
    await expect(capsule.edge.rollback({ deploymentId: "edge_123" })).rejects.toBeInstanceOf(UnsupportedCapabilityError);
    await expect(capsule.edge.logs({ id: "edge_123" })).rejects.toBeInstanceOf(UnsupportedCapabilityError);
    await expect(capsule.database.branch.delete({ project: "app", branchId: "br_mock" })).rejects.toBeInstanceOf(UnsupportedCapabilityError);
    await expect(capsule.database.branch.reset({ project: "app", branchId: "br_mock" })).rejects.toBeInstanceOf(UnsupportedCapabilityError);
    await expect(capsule.database.migrate({ project: "app", branchId: "br_mock", dryRun: true })).rejects.toBeInstanceOf(UnsupportedCapabilityError);
    await expect(capsule.preview.destroy({ id: "preview_123" })).rejects.toBeInstanceOf(UnsupportedCapabilityError);
    await expect(capsule.preview.status({ id: "preview_123" })).rejects.toBeInstanceOf(UnsupportedCapabilityError);
    await expect(capsule.preview.logs({ id: "preview_123" })).rejects.toBeInstanceOf(UnsupportedCapabilityError);
    await expect(capsule.preview.urls({ id: "preview_123" })).rejects.toBeInstanceOf(UnsupportedCapabilityError);
    await expect(capsule.preview.cleanup({ id: "preview_123" })).rejects.toBeInstanceOf(UnsupportedCapabilityError);
    await expect(capsule.machine.status({ id: "machine_123" })).rejects.toBeInstanceOf(UnsupportedCapabilityError);
    await expect(capsule.machine.start({ id: "machine_123" })).rejects.toBeInstanceOf(UnsupportedCapabilityError);
    await expect(capsule.machine.stop({ id: "machine_123" })).rejects.toBeInstanceOf(UnsupportedCapabilityError);
    await expect(capsule.machine.destroy({ id: "machine_123" })).rejects.toBeInstanceOf(UnsupportedCapabilityError);
  });

  test("contract rejects declared log support without implementation", () => {
    const dishonestAdapter: CapsuleAdapter = {
      ...adapter,
      capabilities: {
        ...capabilities,
        job: {
          ...capabilities.job!,
          run: "native",
          logs: "native"
        }
      },
      job: {
        run: async () => ({ id: "job_123", provider: "test", status: "succeeded" })
      }
    };

    expect(() => assertAdapterContract(dishonestAdapter)).toThrow("declares job.logs as native but does not implement the public contract");
  });

  test("contract rejects declared preview lifecycle support without implementation", () => {
    const dishonestAdapter: CapsuleAdapter = {
      ...adapter,
      capabilities: {
        ...capabilities,
        preview: {
          create: "native",
          destroy: "native",
          status: "native",
          logs: "native",
          urls: "native",
          cleanup: "native"
        }
      },
      preview: {
        create: async () => ({
          id: "preview_123",
          provider: "test",
          name: "preview",
          status: "ready",
          urls: [],
          resources: []
        })
      }
    };

    expect(() => assertAdapterContract(dishonestAdapter)).toThrow("declares preview.destroy as native but does not implement the public contract");
  });
});

describe("policy", () => {
  test("denies env keys not allowed by secret policy", () => {
    expect(() => evaluatePolicy({ secrets: { allowed: ["SAFE"] } }, { env: { TOKEN: "x" } })).toThrow(PolicyViolationError);
  });

  test("merges timeout against policy maximum", () => {
    expect(mergeTimeout({ limits: { timeoutMs: 1000 } }, 2000)).toBe(1000);
    expect(mergeTimeout({ limits: { timeoutMs: 1000 } }, 500)).toBe(500);
  });

  test("records policy enforcement notes without claiming universal OS enforcement", () => {
    expect(
      evaluatePolicy(
        {
          network: { mode: "none" },
          filesystem: { read: ["/workspace"], write: ["/workspace"] },
          secrets: { allowed: ["SECRET"], redactFromLogs: true },
          limits: { timeoutMs: 1000, memoryMb: 512, cpu: 1 },
          cost: { maxUsd: 1 },
          ttl: { maxMs: 60_000 }
        },
        { env: { SECRET: "value" }, timeoutMs: 2000 }
      ).notes
    ).toEqual([
      "Network policy requested mode=none; enforcement is native only when the adapter/provider explicitly supports network isolation.",
      "Filesystem policy requested; enforcement may be native, emulated at the adapter boundary, or unsupported depending on the runtime.",
      "Secret redaction is applied to Capsule-observed stdout, stderr, and log entries; provider-side logs may need separate controls.",
      "Requested timeout 2000ms reduced to policy maximum 1000ms",
      "CPU and memory limits are delegated to adapter/provider support; Capsule does not claim OS-level enforcement by itself.",
      "Cost policy is a control-plane constraint; provider billing enforcement is not guaranteed by Capsule.",
      "TTL policy is a control-plane cleanup constraint; cleanup depends on adapter/provider lifecycle support."
    ]);
  });

  test("redacts exact secret values from output repeatedly", () => {
    expect(redactSecrets("token=abc token=abc suffix", { SECRET: "abc" }, { secrets: { allowed: ["SECRET"], redactFromLogs: true } })).toBe("token=[REDACTED] token=[REDACTED] suffix");
  });

  test("does not redact when log redaction policy is absent", () => {
    expect(redactSecrets("token=abc", { SECRET: "abc" }, { secrets: { allowed: ["SECRET"] } })).toBe("token=abc");
  });

  test("redacts secret values from log entries", () => {
    expect(
      redactLogEntries(
        [
          { timestamp: "2026-01-01T00:00:00.000Z", stream: "stdout", message: "first abc" },
          { timestamp: "2026-01-01T00:00:00.001Z", stream: "stderr", message: "second abc abc" }
        ],
        { SECRET: "abc" },
        { secrets: { allowed: ["SECRET"], redactFromLogs: true } }
      )
    ).toEqual([
      { timestamp: "2026-01-01T00:00:00.000Z", stream: "stdout", message: "first [REDACTED]" },
      { timestamp: "2026-01-01T00:00:00.001Z", stream: "stderr", message: "second [REDACTED] [REDACTED]" }
    ]);
  });
});

describe("presets", () => {
  test("creates an agent-safe Node sandbox preset without hiding capabilities", () => {
    const preset = nodeSandboxPreset({ timeoutMs: 5_000, secretEnv: ["TOKEN"] });

    expect(preset.domain).toBe("sandbox");
    expect(preset.capabilityPaths).toEqual(["sandbox.create", "sandbox.exec", "sandbox.fileWrite", "sandbox.destroy"]);
    expect(preset.spec).toMatchObject({ image: "node:22", cwd: "/workspace", timeoutMs: 5_000 });
    expect(preset.policy).toEqual({
      network: { mode: "none" },
      filesystem: { read: ["/workspace"], write: ["/workspace"] },
      secrets: { allowed: ["TOKEN"], redactFromLogs: true },
      limits: { timeoutMs: 5_000, memoryMb: undefined, cpu: undefined }
    });
  });

  test("creates domain-specific provider specs while keeping notes explicit", () => {
    expect(nodeJobPreset({ command: ["node", "-e", "console.log(1)"] }).capabilityPaths).toEqual(["job.run"]);
    expect(httpServicePreset({ name: "api", image: "example/api", healthPath: "/health" }).spec).toMatchObject({
      name: "api",
      image: "example/api",
      ports: [{ port: 8080, public: true, protocol: "http" }],
      healthcheck: { path: "/health" }
    });
    expect(edgeWorkerPreset({ name: "worker" }).spec.runtime).toBe("workers");
    expect(previewDatabaseBranchPreset({ project: "app", name: "pr-42", ttlMs: 60_000 }).policy).toEqual({ ttl: { maxMs: 60_000 } });
    expect(previewEnvironmentPreset({ name: "pr-42" }).capabilityPaths).toEqual(["preview.create", "preview.destroy", "preview.urls"]);
  });
});

describe("receipts", () => {
  test("hashes output and includes policy decision", () => {
    const receipt = createReceipt({
      type: "sandbox.exec",
      provider: "test",
      adapter: "test",
      capabilityPath: "sandbox.exec",
      supportLevel: "native",
      startedAt: new Date("2026-01-01T00:00:00.000Z"),
      finishedAt: new Date("2026-01-01T00:00:01.000Z"),
      stdout: "hello",
      stderr: "",
      policy: { decision: "allowed", applied: { network: { mode: "none" } } }
    });
    expect(receipt.stdoutHash).toBe("2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824");
    expect(receipt.policy.decision).toBe("allowed");
    expect(receipt.durationMs).toBe(1000);
    expect(receipt.signature).toBeUndefined();
  });

  test("optionally signs receipts with a provided signer", () => {
    const receipt = createReceipt(
      {
        type: "job.run",
        provider: "test",
        adapter: "test",
        capabilityPath: "job.run",
        supportLevel: "native",
        startedAt: new Date("2026-01-01T00:00:00.000Z"),
        finishedAt: new Date("2026-01-01T00:00:00.500Z"),
        policy: { decision: "allowed", applied: {} },
        resource: { id: "job_123" }
      },
      {
        algorithm: "test-signature",
        keyId: "test-key",
        sign: (unsigned) => `${unsigned.type}:${unsigned.resource?.id}:${unsigned.durationMs}`
      }
    );

    expect(receipt.signature).toEqual({
      algorithm: "test-signature",
      keyId: "test-key",
      value: "job.run:job_123:500"
    });
  });

  test("records sanitized provider options on receipts", () => {
    const receipt = createReceipt({
      type: "job.run",
      provider: "test",
      adapter: "test",
      capabilityPath: "job.run",
      supportLevel: "native",
      startedAt: new Date("2026-01-01T00:00:00.000Z"),
      finishedAt: new Date("2026-01-01T00:00:00.500Z"),
      providerOptions: {
        region: "us-east-1",
        retryCount: 2,
        nested: {
          placement: "spot",
          apiToken: "secret-token"
        },
        env: [{ name: "VISIBLE", value: "safe" }, { name: "PRIVATE", secret: "secret-value" }]
      }
    });

    expect(receipt.providerOptions).toEqual({
      region: "us-east-1",
      retryCount: 2,
      nested: {
        placement: "spot",
        apiToken: "[REDACTED]"
      },
      env: [{ name: "VISIBLE", value: "safe" }, { name: "PRIVATE", secret: "[REDACTED]" }]
    });
    expect(JSON.stringify(receipt)).not.toContain("secret-token");
    expect(JSON.stringify(receipt)).not.toContain("secret-value");
  });

  test("redacts sensitive receipt metadata before signing or storing", () => {
    const receipt = createReceipt(
      {
        type: "job.run",
        provider: "test",
        adapter: "test",
        capabilityPath: "job.run",
        supportLevel: "native",
        startedAt: new Date("2026-01-01T00:00:00.000Z"),
        finishedAt: new Date("2026-01-01T00:00:00.500Z"),
        policy: { decision: "allowed", applied: {} },
        metadata: {
          providerRequestId: "req_123",
          idempotencyKey: "idem_123",
          idempotencyScope: "job.run",
          authorization: "Bearer secret-token",
          Authorization: "Bearer uppercase-secret",
          xApiKey: "header-api-key",
          bearerToken: "bearer-secret",
          authToken: "auth-secret",
          nested: {
            apiKey: "provider-api-key",
            apiToken: "provider-api-token",
            safe: "visible"
          },
          attempts: [{ session_token: "session-secret", providerRequestId: "req_retry" }]
        }
      },
      {
        algorithm: "test-signature",
        sign: (unsigned) => JSON.stringify(unsigned.metadata)
      }
    );

    expect(receipt.metadata).toEqual({
      providerRequestId: "req_123",
      idempotencyKey: "idem_123",
      idempotencyScope: "job.run",
      authorization: "[REDACTED]",
      Authorization: "[REDACTED]",
      xApiKey: "[REDACTED]",
      bearerToken: "[REDACTED]",
      authToken: "[REDACTED]",
      nested: {
        apiKey: "[REDACTED]",
        apiToken: "[REDACTED]",
        safe: "visible"
      },
      attempts: [{ session_token: "[REDACTED]", providerRequestId: "req_retry" }]
    });
    expect(receipt.signature?.value).not.toContain("secret-token");
    expect(receipt.signature?.value).not.toContain("uppercase-secret");
    expect(JSON.stringify(receipt)).not.toContain("header-api-key");
    expect(JSON.stringify(receipt)).not.toContain("bearer-secret");
    expect(JSON.stringify(receipt)).not.toContain("auth-secret");
    expect(JSON.stringify(receipt)).not.toContain("provider-api-key");
    expect(JSON.stringify(receipt)).not.toContain("provider-api-token");
    expect(JSON.stringify(receipt)).not.toContain("session-secret");
  });

  test("records receipts into a configured store", async () => {
    const receiptStore = new MemoryReceiptStore();
    const receiptAdapter: CapsuleAdapter = {
      ...adapter,
      sandbox: {
        create: async (_spec, context) => {
          context.createReceipt({ type: "sandbox.create", capabilityPath: "sandbox.create", startedAt: new Date("2026-01-01T00:00:00.000Z") });
          return adapter.sandbox!.create({}, context);
        }
      }
    };
    const capsule = new Capsule({ adapter: receiptAdapter, receipts: true, receiptStore });
    await capsule.sandbox.create({});
    expect(receiptStore.receipts[0]?.type).toBe("sandbox.create");
  });

  test("continues when best-effort receipt persistence fails", async () => {
    const receiptAdapter: CapsuleAdapter = {
      ...adapter,
      sandbox: {
        create: async (_spec, context) => {
          context.createReceipt({ type: "sandbox.create", capabilityPath: "sandbox.create", startedAt: new Date("2026-01-01T00:00:00.000Z") });
          return adapter.sandbox!.create({}, context);
        }
      }
    };
    const capsule = new Capsule({
      adapter: receiptAdapter,
      receipts: true,
      receiptPersistence: "best-effort",
      receiptStore: {
        write: async () => {
          throw new Error("disk full");
        }
      }
    });

    await expect(capsule.sandbox.create({})).resolves.toMatchObject({
      handle: { id: "box", provider: "test" }
    });
  });

  test("fails closed when required receipt persistence fails", async () => {
    const receiptAdapter: CapsuleAdapter = {
      ...adapter,
      sandbox: {
        create: async (_spec, context) => {
          context.createReceipt({ type: "sandbox.create", capabilityPath: "sandbox.create", startedAt: new Date("2026-01-01T00:00:00.000Z") });
          return adapter.sandbox!.create({}, context);
        }
      }
    };
    const capsule = new Capsule({
      adapter: receiptAdapter,
      receipts: true,
      receiptPersistence: "required",
      receiptStore: {
        write: async () => {
          throw new Error("disk full");
        }
      }
    });

    await expect(capsule.sandbox.create({})).rejects.toThrow("disk full");
  });

  test("required receipt persistence rejects when no store is configured", async () => {
    const receiptAdapter: CapsuleAdapter = {
      ...adapter,
      sandbox: {
        create: async (_spec, context) => {
          context.createReceipt({ type: "sandbox.create", capabilityPath: "sandbox.create", startedAt: new Date("2026-01-01T00:00:00.000Z") });
          return adapter.sandbox!.create({}, context);
        }
      }
    };
    const capsule = new Capsule({ adapter: receiptAdapter, receipts: true, receiptPersistence: "required" });

    await expect(capsule.sandbox.create({})).rejects.toThrow("Receipt persistence is required but no receiptStore is configured");
  });

  test("lets adapters propagate typed provider options into receipts without leaking secrets", async () => {
    const receiptStore = new MemoryReceiptStore();
    const receiptAdapter: CapsuleAdapter = {
      ...adapter,
      capabilities: {
        ...capabilities,
        job: {
          ...capabilities.job!,
          run: "native"
        }
      },
      job: {
        run: async (spec, context) => {
          const receipt = context.createReceipt({
            type: "job.run",
            capabilityPath: "job.run",
            startedAt: new Date("2026-01-01T00:00:00.000Z"),
            finishedAt: new Date("2026-01-01T00:00:00.500Z"),
            image: spec.image,
            providerOptions: spec.providerOptions
          });
          return { id: "job_123", provider: "test", status: "queued", receipt };
        }
      }
    };
    const capsule = new Capsule({ adapter: receiptAdapter, receipts: true, receiptStore });
    await capsule.job.run({
      image: "node:22",
      providerOptions: {
        region: "iad",
        concurrency: 1,
        bearerToken: "do-not-store"
      }
    });

    expect(receiptStore.receipts[0]?.providerOptions).toEqual({
      region: "iad",
      concurrency: 1,
      bearerToken: "[REDACTED]"
    });
    expect(JSON.stringify(receiptStore.receipts[0])).not.toContain("do-not-store");
  });

  test("signs receipts created through Capsule context", async () => {
    const receiptStore = new MemoryReceiptStore();
    const receiptAdapter: CapsuleAdapter = {
      ...adapter,
      sandbox: {
        create: async (_spec, context) => {
          context.createReceipt({ type: "sandbox.create", capabilityPath: "sandbox.create", startedAt: new Date("2026-01-01T00:00:00.000Z") });
          return adapter.sandbox!.create({}, context);
        }
      }
    };
    const capsule = new Capsule({
      adapter: receiptAdapter,
      receipts: true,
      receiptStore,
      receiptSigner: {
        algorithm: "test-signature",
        sign: (unsigned) => `signed:${unsigned.type}:${unsigned.provider}`
      }
    });
    await capsule.sandbox.create({});
    expect(receiptStore.receipts[0]?.signature).toMatchObject({
      algorithm: "test-signature",
      value: "signed:sandbox.create:test"
    });
  });

  test("exports a JSON Schema artifact for receipts", () => {
    const artifact = JSON.parse(readFileSync(new URL("../../../schemas/capsule-receipt.schema.json", import.meta.url), "utf8"));
    expect(artifact).toEqual(capsuleReceiptJsonSchema);
    const receipt = createReceipt(
      {
        type: "sandbox.exec",
        provider: "test",
        adapter: "test",
        capabilityPath: "sandbox.exec",
        supportLevel: "native",
        startedAt: new Date("2026-01-01T00:00:00.000Z"),
        finishedAt: new Date("2026-01-01T00:00:01.000Z"),
        command: ["node", "index.js"],
        image: "node:22",
        stdout: "ok",
        stderr: "",
        providerOptions: { region: "test" },
        policy: { decision: "allowed", applied: { network: { mode: "none" } }, notes: ["observed"] },
        resource: { id: "box", status: "ready" },
        metadata: { example: true, providerRequestId: "req_123", idempotencyKey: "idem_123", idempotencyScope: "sandbox.exec" }
      },
      { algorithm: "test-signature", sign: (unsigned) => `signed:${unsigned.id}` }
    );
    expect(capsuleReceiptJsonSchema.properties.metadata.properties).toMatchObject({
      providerRequestId: { type: "string" },
      idempotencyKey: { type: "string" },
      idempotencyScope: { type: "string" }
    });
    expect(validateAgainstSimpleSchema(capsuleReceiptJsonSchema, JSON.parse(JSON.stringify(receipt)))).toEqual([]);
  });
});
