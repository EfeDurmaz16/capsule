import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { docker, runDocker, type RunDockerOptions } from "@capsule-sdk/docker";
import { fixtureJson, runProviderHttpFixture } from "./emulate-http-fixture.js";

export async function runDockerHttp() {
  const id = "c4".repeat(32);
  const image = "capsule-emulator:local";
  const name = "capsule-emulator";
  const apiVersion = "1.47";
  const profile = await mkdtemp(join(tmpdir(), "capsule-docker-emulate-"));
  let state: "absent" | "created" | "running" | "deleted" = "absent";
  try {
    return await runProviderHttpFixture({
      provider: "docker",
      adapter(origin) {
        // A fresh profile and a replacement environment isolate credentials, contexts, TLS and proxies.
        const env = { PATH: process.env.PATH, HOME: profile, DOCKER_CONFIG: profile };
        const host = "tcp://" + new URL(origin).host;
        const runner = (args: string[], options?: RunDockerOptions) => runDocker(["--host", host, ...args], { ...options, env });
        return docker({
          runner,
          pull: "never",
          checkAvailable: async () => {
            try {
              return (await runner(["version", "--format", "{{.Server.Version}}"], { timeoutMs: 5_000 })).exitCode === 0;
            } catch (error) {
              if ((error as NodeJS.ErrnoException).code === "ENOENT")
                throw new Error("Docker provider-http requires the docker CLI on PATH.", { cause: error });
              throw error;
            }
          }
        });
      },
      handle({ method, url, body }) {
        const path = url.pathname.replace(/^\/v1\.\d+(?=\/)/, "");
        if ((method === "HEAD" || method === "GET") && path === "/_ping") {
          return { status: 200, headers: { "API-Version": apiVersion, OSType: "linux" }, body: method === "GET" ? "OK" : "" };
        }
        if (method === "GET" && path === "/version") return fixtureJson(200, { Version: "27.5.1", ApiVersion: apiVersion, Os: "linux", Arch: "amd64" });
        if (method === "POST" && path === "/containers/create") {
          assert.equal(state, "absent");
          assert.equal(url.searchParams.get("name"), name);
          assert.equal(JSON.parse(body.toString()).Image, image);
          state = "created";
          return fixtureJson(201, { Id: id, Warnings: [] });
        }
        if (method === "POST" && path === `/containers/${id}/start`) {
          assert.equal(state, "created");
          state = "running";
          return { status: 204 };
        }
        if (method === "DELETE" && path === `/containers/${id}`) {
          assert.equal(state, "running");
          assert.equal(url.searchParams.get("force"), "1");
          state = "deleted";
          return { status: 204 };
        }
      },
      async exercise(capsule) {
        const sandbox = await capsule.sandbox.create({ name, image, timeoutMs: 5_000 });
        assert.equal(sandbox.handle.id, id);
        assert.equal(state, "running");
        await sandbox.destroy();
        assert.equal(state, "deleted");
        return {
          result: { resourceId: id, status: "deleted" },
          cleanup: "emulator-destroyed",
          assertions: ["Docker CLI created and started the named container", "Docker CLI removed the same container by ID"]
        };
      }
    });
  } finally {
    await rm(profile, { recursive: true, force: true });
  }
}
