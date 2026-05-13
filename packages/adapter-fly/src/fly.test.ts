import { describe, expect, test } from "vitest";
import { Capsule, runAdapterContract } from "@capsule/core";
import { fly, flyCapabilities } from "./index.js";

function response(body: unknown, status = 200): Response {
  return new Response(body === undefined ? undefined : JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" }
  });
}

describe("fly adapter", () => {
  test("runs the shared adapter contract suite", async () => {
    await runAdapterContract(fly({ appName: "capsule-test", apiToken: "fly-token" }));
  });

  test("declares Fly machine and job capabilities honestly", () => {
    expect(flyCapabilities.machine?.create).toBe("native");
    expect(flyCapabilities.machine?.status).toBe("native");
    expect(flyCapabilities.machine?.start).toBe("native");
    expect(flyCapabilities.machine?.stop).toBe("native");
    expect(flyCapabilities.machine?.destroy).toBe("native");
    expect(flyCapabilities.job?.run).toBe("native");
    expect(flyCapabilities.job?.logs).toBe("unsupported");
  });

  test("creates a Fly Machine", async () => {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const fetchMock = (async (url: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(url), init: init ?? {} });
      return response({ id: "fly-machine-1", name: "dev", state: "started", region: "iad" });
    }) as typeof fetch;
    const capsule = new Capsule({
      adapter: fly({ appName: "capsule-app", apiToken: "fly-token", fetch: fetchMock, memoryMb: 512, cpus: 1 }),
      receipts: true
    });

    const machine = await capsule.machine.create({ name: "dev", image: "registry.example/app:latest", env: { NODE_ENV: "test" } });

    expect(machine).toMatchObject({ id: "fly-machine-1", provider: "fly", status: "running" });
    expect(machine.receipt?.type).toBe("machine.create");
    expect(calls[0]?.url).toBe("https://api.machines.dev/v1/apps/capsule-app/machines");
    expect(calls[0]?.init.headers).toMatchObject({ authorization: "Bearer fly-token" });
    expect(JSON.parse(String(calls[0]?.init.body))).toMatchObject({
      name: "dev",
      config: {
        image: "registry.example/app:latest",
        env: { NODE_ENV: "test" },
        guest: { cpu_kind: "shared", cpus: 1, memory_mb: 512 }
      }
    });
  });

  test("runs a job as an auto-destroy Fly Machine", async () => {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const fetchMock = (async (url: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(url), init: init ?? {} });
      return response({ id: "job-machine-1", name: "smoke", state: "created", region: "iad" }, 201);
    }) as typeof fetch;
    const capsule = new Capsule({ adapter: fly({ appName: "capsule-app", apiToken: "fly-token", fetch: fetchMock }), receipts: true });

    const run = await capsule.job.run({ name: "smoke", image: "node:22", command: ["node", "smoke.js"], resources: { memoryMb: 256, cpu: 1 } });

    expect(run).toMatchObject({ id: "job-machine-1", provider: "fly", status: "running" });
    expect(run.receipt?.type).toBe("job.run");
    expect(JSON.parse(String(calls[0]?.init.body))).toMatchObject({
      name: "smoke",
      auto_destroy: true,
      config: {
        image: "node:22",
        restart: { policy: "no" },
        processes: [{ cmd: ["node", "smoke.js"] }]
      }
    });
  });

  test("gets, starts, stops, and destroys Fly Machines", async () => {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const fetchMock = (async (url: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(url), init: init ?? {} });
      if (String(url).endsWith("/start")) return response({ id: "fly-machine-1", state: "starting" });
      if (String(url).endsWith("/stop")) return response({ id: "fly-machine-1", state: "stopped" });
      if (init?.method === "DELETE") return response(undefined, 200);
      return response({ id: "fly-machine-1", name: "dev", state: "started", region: "iad" });
    }) as typeof fetch;
    const capsule = new Capsule({ adapter: fly({ appName: "capsule-app", apiToken: "fly-token", fetch: fetchMock }), receipts: true });

    expect(await capsule.machine.status({ id: "fly-machine-1" })).toMatchObject({ status: "running" });
    expect(await capsule.machine.start({ id: "fly-machine-1" })).toMatchObject({ status: "starting" });
    expect(await capsule.machine.stop({ id: "fly-machine-1", force: true })).toMatchObject({ status: "stopped" });
    expect(await capsule.machine.destroy({ id: "fly-machine-1" })).toMatchObject({ status: "deleted" });
    expect(calls.map((call) => [call.init.method ?? "GET", call.url])).toEqual([
      ["GET", "https://api.machines.dev/v1/apps/capsule-app/machines/fly-machine-1"],
      ["POST", "https://api.machines.dev/v1/apps/capsule-app/machines/fly-machine-1/start"],
      ["POST", "https://api.machines.dev/v1/apps/capsule-app/machines/fly-machine-1/stop"],
      ["DELETE", "https://api.machines.dev/v1/apps/capsule-app/machines/fly-machine-1"]
    ]);
  });
});
