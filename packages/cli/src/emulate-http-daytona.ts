import assert from "node:assert/strict";
import { EventEmitter, once } from "node:events";
import { daytona } from "@capsule-sdk/daytona";
import { fixtureJson, runProviderHttpFixture } from "./emulate-http-fixture.js";

export function runDaytonaHttp() {
  const id = "daytona-emulated-sandbox";
  const apiKey = "local-emulator-key";
  const name = "capsule-emulate";
  const command = "echo capsule";
  let allocated = false;
  const events = new EventEmitter();

  return runProviderHttpFixture({
    provider: "daytona",
    adapter: (origin) => daytona({ apiUrl: origin + "/api", apiKey, target: "local" }),
    handle({ method, url, headers, body }) {
      assert.equal(headers.authorization, "Bearer " + apiKey);
      if (method === "POST" && url.pathname === "/api/sandbox") {
        const spec = JSON.parse(body.toString("utf8"));
        assert.equal(spec.name, name);
        assert.equal(spec.target, "local");
        assert.equal(allocated, false);
        allocated = true;
        return fixtureJson(201, { id, name, state: "started", labels: spec.labels, toolboxProxyUrl: url.origin + "/toolbox" });
      }
      if (method === "POST" && url.pathname === `/toolbox/${id}/process/execute`) {
        assert.equal(allocated, true);
        assert.equal(JSON.parse(body.toString("utf8")).command, command);
        return fixtureJson(200, { exitCode: 0, result: "capsule\n" });
      }
      if (method === "DELETE" && url.pathname === `/api/sandbox/${id}`) {
        assert.equal(allocated, true);
        allocated = false;
        return { status: 204 };
      }
      if (method === "GET" && url.pathname === `/api/sandbox/${id}` && !allocated) {
        events.emit("deletion-observed");
        return fixtureJson(404, { message: "Sandbox not found" });
      }
    },
    async exercise(capsule) {
      const sandbox = await capsule.sandbox.create({ name, timeoutMs: 5000 });
      try {
        assert.equal(sandbox.handle.id, id);
        const output = await sandbox.exec({ command, timeoutMs: 5000 });
        assert.equal(output.exitCode, 0);
        assert.equal(output.stdout, "capsule\n");
      } finally {
        // SDK 0.175 refreshes state asynchronously after accepting DELETE.
        await Promise.all([once(events, "deletion-observed", { signal: AbortSignal.timeout(5000) }), sandbox.destroy()]);
      }
      assert.equal(allocated, false);
      return {
        result: { resourceId: id, status: "deleted" },
        cleanup: "emulator-destroyed",
        assertions: ["The Daytona SDK created the sandbox, executed the fixture command through its toolbox URL, and observed deletion."]
      };
    }
  });
}
