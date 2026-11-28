import { expect, it } from "vitest";
import { runPlatformProviderHttp } from "./emulate-http-platform.js";

it.each([
  ["cloud-run", 1, "service.status", "ready"],
  ["azure-container-apps", 1, "service.status", "ready"],
  ["kubernetes", 2, "service.status", "ready"],
  ["gce", 1, "machine.status", "running"]
] as const)("reads %s status through its real HTTP client", async (provider, reads, operation, status) => {
  const evidence = await runPlatformProviderHttp(provider);
  expect(evidence.requests).toHaveLength(reads);
  expect(evidence.operations).toEqual([operation]);
  expect(evidence.result.status).toBe(status);
  expect(evidence.receipts[0]?.supportLevel).toBe("emulated");
});
