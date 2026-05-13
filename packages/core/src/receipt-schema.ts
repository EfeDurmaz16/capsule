export const capsuleReceiptJsonSchema = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  $id: "https://capsule.dev/schemas/capsule-receipt.schema.json",
  title: "CapsuleReceipt",
  type: "object",
  additionalProperties: false,
  required: ["id", "type", "provider", "adapter", "capabilityPath", "supportLevel", "startedAt", "finishedAt", "durationMs", "policy"],
  properties: {
    id: { type: "string" },
    type: {
      type: "string",
      enum: [
        "sandbox.create",
        "sandbox.exec",
        "sandbox.destroy",
        "job.run",
        "job.status",
        "job.cancel",
        "service.deploy",
        "service.status",
        "service.update",
        "service.delete",
        "edge.deploy",
        "edge.status",
        "edge.version",
        "edge.release",
        "edge.rollback",
        "database.branch.create",
        "database.branch.delete",
        "database.branch.reset",
        "database.migrate",
        "preview.create",
        "preview.destroy",
        "machine.create",
        "machine.status",
        "machine.start",
        "machine.stop",
        "machine.exec",
        "machine.destroy"
      ]
    },
    provider: { type: "string" },
    adapter: { type: "string" },
    capabilityPath: { type: "string" },
    supportLevel: { type: "string", enum: ["native", "emulated", "unsupported", "experimental"] },
    command: { type: "array", items: { type: "string" } },
    image: { type: "string" },
    source: { type: "object", additionalProperties: true },
    cwd: { type: "string" },
    providerOptions: { type: "object", additionalProperties: true },
    startedAt: { type: "string" },
    finishedAt: { type: "string" },
    durationMs: { type: "number" },
    exitCode: { type: "number" },
    stdoutHash: { type: "string" },
    stderrHash: { type: "string" },
    artifactHashes: { type: "array", items: { type: "string" } },
    policy: {
      type: "object",
      additionalProperties: false,
      required: ["decision", "applied"],
      properties: {
        decision: { type: "string", enum: ["allowed", "denied"] },
        applied: { type: "object", additionalProperties: true },
        notes: { type: "array", items: { type: "string" } }
      }
    },
    resource: {
      type: "object",
      additionalProperties: false,
      properties: {
        id: { type: "string" },
        name: { type: "string" },
        url: { type: "string" },
        status: { type: "string" }
      }
    },
    metadata: { type: "object", additionalProperties: true },
    signature: {
      type: "object",
      additionalProperties: false,
      required: ["algorithm", "value"],
      properties: {
        algorithm: { type: "string" },
        value: { type: "string" },
        keyId: { type: "string" }
      }
    }
  }
} as const;
