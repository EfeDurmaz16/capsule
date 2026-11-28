import { spawnSync } from "node:child_process";
import { expect, test } from "vitest";
import { runDockerHttp } from "./emulate-http-docker.js";

test.skipIf(spawnSync("docker", ["--version"]).status !== 0)("real Docker CLI exercises the Engine emulator without a daemon", async () => {
  const run = await runDockerHttp();
  expect(run.operations).toEqual(["sandbox.create", "sandbox.destroy"]);
  expect(run.cleanup).toBe("emulator-destroyed");
  expect(run.requests.some((request) => request.path.endsWith("/containers/create"))).toBe(true);
  expect(run.requests.some((request) => request.method === "DELETE")).toBe(true);
});
