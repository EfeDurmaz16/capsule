import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createReceipt } from "@capsule-sdk/core";
import { afterEach, describe, expect, test, vi } from "vitest";
import { main } from "./index.js";

const receipt = (at: string, decision: "allowed" | "denied", notes?: string[]) =>
  createReceipt({
    type: "sandbox.exec",
    provider: "docker",
    adapter: "docker",
    capabilityPath: "sandbox.exec",
    supportLevel: "native",
    startedAt: new Date(at),
    policy: { decision, applied: {}, ...(notes ? { notes } : {}) }
  });

let root: string | undefined;
afterEach(async () => {
  vi.restoreAllMocks();
  if (root) await rm(root, { recursive: true, force: true });
});

async function exportLines(args: string[]) {
  root = await mkdtemp(join(tmpdir(), "capsule-audit-export-"));
  const file = join(root, "receipts.jsonl");
  const receipts = [
    receipt("2026-11-01T00:00:00.000Z", "allowed"),
    receipt("2026-11-02T00:00:00.000Z", "denied", ["approval missing"]),
    receipt("2026-11-03T00:00:00.000Z", "allowed")
  ];
  await writeFile(file, receipts.map((entry) => JSON.stringify(entry)).join("\n") + "\n", "utf8");
  const out: string[] = [];
  vi.spyOn(process.stdout, "write").mockImplementation((chunk: string | Uint8Array) => {
    out.push(String(chunk));
    return true;
  });
  await main(["audit", "export", "--receipt-file", file, ...args]);
  return {
    receipts,
    lines: out
      .join("")
      .split("\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line) as Record<string, unknown>)
  };
}

describe("capsule audit export", () => {
  test("writes one JSONL line per receipt and one per decision inside [since, until)", async () => {
    const { receipts, lines } = await exportLines(["--since", "2026-11-02T00:00:00Z", "--until", "2026-11-03T00:00:00Z", "--json"]);
    const denied = receipts[1]!;
    expect(lines).toEqual([
      { kind: "receipt", at: denied.startedAt, receipt: denied },
      {
        kind: "decision",
        at: denied.startedAt,
        receipt_id: denied.id,
        provider: "docker",
        capability: "sandbox.exec",
        decision: "denied",
        notes: ["approval missing"]
      }
    ]);
  });

  test("without bounds exports everything in store order", async () => {
    const { receipts, lines } = await exportLines([]);
    expect(lines.filter((line) => line.kind === "receipt").map((line) => (line.receipt as { id: string }).id)).toEqual(receipts.map((entry) => entry.id));
    expect(lines).toHaveLength(6);
  });

  test("a time that is not ISO 8601 is a usage error", async () => {
    await expect(exportLines(["--since", "yesterday"])).rejects.toThrow(/--since/);
  });
});
