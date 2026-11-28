import { expect, test, vi } from "vitest";
import { runE2BHttp } from "./emulate-http-e2b.js";

test("the E2B SDK creates and kills a sandbox using only the fixture endpoints and credentials", async () => {
  vi.stubEnv("E2B_ACCESS_TOKEN", "unused-token");
  vi.stubEnv("E2B_API_KEY", "unused-key");
  vi.stubEnv("E2B_API_URL", "http://127.0.0.1:1");
  vi.stubEnv("E2B_SANDBOX_URL", "http://127.0.0.1:1");
  vi.stubEnv("E2B_DEBUG", "false");
  try {
    const result = await runE2BHttp();
    expect(result.operations).toEqual(["sandbox.create", "sandbox.destroy"]);
    expect(result.requests).toEqual([
      { method: "POST", path: "/sandboxes" },
      { method: "DELETE", path: "/sandboxes/capsule-e2b-fixture" }
    ]);
  } finally {
    vi.unstubAllEnvs();
  }
});
