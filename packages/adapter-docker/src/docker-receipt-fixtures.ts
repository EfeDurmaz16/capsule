import type { CapsuleReceipt } from "@capsule/core";

type JsonFixture = Record<string, unknown>;

function compactUndefined(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => compactUndefined(item));
  }
  if (typeof value !== "object" || value === null) {
    return value;
  }
  return Object.fromEntries(
    Object.entries(value)
      .filter(([, entryValue]) => entryValue !== undefined)
      .map(([entryKey, entryValue]) => [entryKey, compactUndefined(entryValue)])
  );
}

function normalizeResource(resource: CapsuleReceipt["resource"]): CapsuleReceipt["resource"] {
  if (!resource) {
    return undefined;
  }
  return {
    ...resource,
    id: resource.id ? "<docker-resource-id>" : undefined,
    name: resource.name?.startsWith("capsule-test-") ? "<docker-resource-name>" : resource.name
  };
}

export function normalizeDockerReceiptFixture(receipt: CapsuleReceipt): JsonFixture {
  return compactUndefined({
    ...receipt,
    id: "<receipt-id>",
    startedAt: "<started-at>",
    finishedAt: "<finished-at>",
    durationMs: "<duration-ms>",
    resource: normalizeResource(receipt.resource)
  }) as JsonFixture;
}

export function normalizeDockerReceiptFixtures(receipts: readonly CapsuleReceipt[]): JsonFixture[] {
  return receipts.map((receipt) => normalizeDockerReceiptFixture(receipt));
}
