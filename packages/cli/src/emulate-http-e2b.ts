import assert from "node:assert/strict";
import { e2b } from "@capsule-sdk/e2b";
import { fixtureJson, runProviderHttpFixture } from "./emulate-http-fixture.js";

export function runE2BHttp() {
  // In E2B 2.20, debug mode skips the control plane even with an explicit API URL.
  if (process.env.E2B_DEBUG?.toLowerCase() === "true") {
    throw new Error("Unset E2B_DEBUG to exercise the E2B control plane emulator.");
  }
  const sandboxId = "capsule-e2b-fixture";
  const apiKey = "capsule-local-e2b-key";
  const accessToken = "capsule-local-e2b-token";
  let state: "empty" | "running" | "deleted" = "empty";
  return runProviderHttpFixture({
    provider: "e2b",
    adapter: (origin) => e2b({ apiUrl: origin, sandboxUrl: origin, apiKey, accessToken }),
    handle({ method, url, headers, body }) {
      assert.equal(headers["x-api-key"], apiKey);
      // Older SDKs also send their account token on sandbox requests.
      if (headers.authorization !== undefined) assert.equal(headers.authorization, `Bearer ${accessToken}`);
      if (method === "POST" && (url.pathname === "/sandboxes" || url.pathname === "/v2/sandboxes")) {
        assert.equal(state, "empty");
        const request = JSON.parse(body.toString("utf8"));
        assert.equal(request.templateID, "base");
        assert.equal(request.metadata.name, "capsule-example");
        assert.equal(request.timeout, 60);
        state = "running";
        return fixtureJson(201, { sandboxID: sandboxId, templateID: "base", envdVersion: "0.2.0", domain: "localhost" });
      }
      if (method === "DELETE" && url.pathname === `/sandboxes/${sandboxId}`) {
        assert.equal(state, "running");
        state = "deleted";
        return { status: 204 };
      }
    },
    async exercise(capsule) {
      const sandbox = await capsule.sandbox.create({ image: "base", name: "capsule-example", timeoutMs: 60_000 });
      assert.equal(sandbox.handle.id, sandboxId);
      await sandbox.destroy();
      assert.equal(state, "deleted");
      return {
        result: { resourceId: sandboxId, status: "deleted" },
        cleanup: "emulator-destroyed",
        assertions: ["The E2B SDK sent the requested template, name, and timeout.", "The SDK killed the sandbox returned by the emulator."]
      };
    }
  });
}
