export const capsuleReceiptJsonSchema = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  $id: "https://capsule.dev/schemas/capsule-receipt.schema.json",
  title: "CapsuleReceipt",
  type: "object",
  additionalProperties: false,
  required: ["id", "type", "provider", "adapter", "capabilityPath", "supportLevel", "startedAt", "finishedAt", "durationMs", "policy"],
  properties: {
    id: { type: "string" },
    schemaVersion: { type: "string", const: "capsule.receipt.v1" },
    parentId: { type: "string" },
    type: {
      type: "string",
      enum: [
        "sandbox.create",
        "sandbox.exec",
        "sandbox.file.write",
        "sandbox.file.read",
        "sandbox.file.list",
        "sandbox.destroy",
        "job.run",
        "job.status",
        "job.cancel",
        "job.logs",
        "service.deploy",
        "service.status",
        "service.update",
        "service.rollback",
        "service.delete",
        "service.logs",
        "edge.deploy",
        "edge.status",
        "edge.version",
        "edge.release",
        "edge.rollback",
        "edge.logs",
        "database.branch.create",
        "database.branch.delete",
        "database.branch.reset",
        "database.migrate",
        "preview.create",
        "preview.destroy",
        "preview.status",
        "preview.logs",
        "preview.urls",
        "preview.cleanup",
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
        notes: { type: "array", items: { type: "string" } },
        enforcement: { type: "string", enum: ["native", "delegated", "advisory", "unsupported"] },
        trace: {
          type: "array",
          items: {
            type: "object",
            additionalProperties: false,
            required: ["check", "verdict"],
            properties: {
              check: { type: "string" },
              verdict: { type: "string", enum: ["passed", "noted", "denied"] }
            }
          }
        },
        cost: {
          type: "object",
          additionalProperties: false,
          required: ["limitUsd", "withinLimit"],
          properties: {
            requestedUsd: { type: "number" },
            limitUsd: { type: "number" },
            withinLimit: { type: "boolean" }
          }
        },
        ttl: {
          type: "object",
          additionalProperties: false,
          required: ["limitMs", "withinLimit"],
          properties: {
            requestedMs: { type: "number" },
            limitMs: { type: "number" },
            withinLimit: { type: "boolean" }
          }
        },
        network: {
          type: "object",
          additionalProperties: false,
          required: ["mode", "support", "hosts"],
          properties: {
            mode: { type: "string", enum: ["none", "allowlist", "all"] },
            support: { type: "string", enum: ["native", "emulated", "unsupported", "experimental", "unknown"] },
            hosts: {
              type: "array",
              items: {
                type: "object",
                additionalProperties: false,
                required: ["host", "allowed"],
                properties: {
                  host: { type: "string" },
                  allowed: { type: "boolean" }
                }
              }
            }
          }
        }
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
    metadata: {
      type: "object",
      additionalProperties: true,
      properties: {
        providerRequestId: {
          type: "string",
          description:
            "Opaque request id returned by the provider control plane for the API call Capsule observed. This must not contain credentials or bearer tokens."
        },
        providerApiVersion: {
          type: "string",
          description: "Provider API surface version used by the adapter for the observed operation, when known."
        },
        providerRegion: {
          type: "string",
          description: "Provider region or location that scoped the observed operation, when known."
        },
        runtimeVersion: {
          type: "string",
          description: "Runtime version of the process or provider execution environment observed by the adapter, when known."
        },
        adapterVersion: {
          type: "string",
          description: "Published Capsule adapter package version that produced the receipt, when available."
        },
        idempotencyKey: {
          type: "string",
          description: "Opaque idempotency key supplied to or observed from the provider request, when the adapter can safely record it."
        },
        idempotencyScope: {
          type: "string",
          description: "Provider-specific operation or resource scope where the idempotency key applies."
        },
        operationTag: { type: "string" },
        sourceResourceId: {
          type: "string",
          description: "Resource id this operation derived from, when the receipt records lineage from a source resource."
        },
        parentResourceId: {
          type: "string",
          description: "Resource id that owns or precedes the resource in this receipt, when the receipt records resource lineage."
        }
      }
    },
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
