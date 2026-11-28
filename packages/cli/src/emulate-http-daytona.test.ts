import { afterEach, expect, it, vi } from "vitest";
import { runDaytonaHttp } from "./emulate-http-daytona.js";

afterEach(() => vi.unstubAllEnvs());

it("uses Daytona control-plane and toolbox HTTP clients across the sandbox lifecycle", async () => {
  vi.stubEnv("no_proxy", "127.0.0.1");
  vi.stubEnv("npm_config_no_proxy", "127.0.0.1");
  vi.stubEnv("DAYTONA_OTEL_ENABLED", "false");
  vi.stubEnv("DAYTONA_EXPERIMENTAL_OTEL_ENABLED", "false");
  const result = await runDaytonaHttp();
  expect(result.operations).toEqual(["sandbox.create", "sandbox.exec", "sandbox.destroy"]);
  expect(result.requests).toEqual([
    { method: "POST", path: "/api/sandbox" },
    { method: "POST", path: "/toolbox/daytona-emulated-sandbox/process/execute" },
    { method: "DELETE", path: "/api/sandbox/daytona-emulated-sandbox" },
    { method: "GET", path: "/api/sandbox/daytona-emulated-sandbox" }
  ]);
});
