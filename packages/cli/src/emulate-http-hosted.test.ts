import { expect, test } from "vitest";
import { runHostedProviderHttp, type HostedHttpProvider } from "./emulate-http-hosted.js";

const cases: { provider: HostedHttpProvider; methods: string[]; operations: string[]; status: string }[] = [
  { provider: "vercel", methods: ["POST", "GET"], operations: ["edge.deploy", "edge.status"], status: "ready" },
  { provider: "neon", methods: ["POST", "DELETE"], operations: ["database.branchCreate", "database.branchDelete"], status: "deleted" },
  { provider: "cloudflare", methods: ["PUT"], operations: ["edge.deploy"], status: "ready" },
  { provider: "fly", methods: ["POST", "GET", "DELETE"], operations: ["machine.create", "machine.status", "machine.destroy"], status: "deleted" }
];

test.each(cases)("$provider serializes requests through its own client", async ({ provider, methods, operations, status }) => {
  const run = await runHostedProviderHttp(provider);
  expect(run.evidence).toBe("provider-http");
  expect(run.requests.map((request) => request.method)).toEqual(methods);
  expect(run.operations).toEqual(operations);
  expect(run.result.status).toBe(status);
  expect(run.receipts.every((receipt) => receipt.metadata?.providerEvidence === "provider-http" && receipt.supportLevel === "emulated")).toBe(true);
});
