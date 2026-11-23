import { Capsule } from "@capsule-sdk/core";
import { expect, it, vi } from "vitest";
import { gce } from "./index.js";

it("reuses the GCE request ID for a retried machine create and sets runner protections", async () => {
  const fetcher = vi.fn(async (_url: string | URL | Request, _init?: RequestInit) => Response.json({ name: "operation-1", status: "PENDING" }));
  const capsule = new Capsule({
    adapter: gce({
      projectId: "example-project",
      zone: "europe-west3-c",
      accessToken: () => "fixture-token",
      fetch: fetcher,
      maxRunSeconds: 7200,
      startupScript: "#!/bin/sh\ntrue"
    })
  });
  const spec = { name: "fabric-smoke", idempotencyKey: "smoke-1" };
  await capsule.machine.create(spec);
  await capsule.machine.create(spec);
  const [url, init] = fetcher.mock.calls[0]!;
  expect(fetcher.mock.calls[1]![0]).toBe(url);
  expect(new URL(String(url)).searchParams.get("requestId")).toMatch(/^[\da-f-]{36}$/);
  const body = JSON.parse(String(init?.body));
  expect(body.disks[0].autoDelete).toBe(true);
  expect(body.serviceAccounts).toEqual([]);
  expect(body.scheduling).toEqual({ maxRunDuration: { seconds: "7200" }, instanceTerminationAction: "DELETE" });
  expect(body.metadata.items).toContainEqual({ key: "block-project-ssh-keys", value: "TRUE" });
});

it("distinguishes a pending deletion from a confirmed absence", async () => {
  const fetcher = vi
    .fn<typeof fetch>()
    .mockResolvedValueOnce(Response.json({ name: "operation-2", status: "RUNNING" }))
    .mockResolvedValueOnce(new Response(null, { status: 404 }));
  const capsule = new Capsule({
    adapter: gce({ projectId: "example-project", zone: "europe-west3-c", accessToken: () => "fixture-token", fetch: fetcher })
  });
  await expect(capsule.machine.destroy({ id: "fabric-smoke" })).resolves.toMatchObject({ status: "destroying" });
  await expect(capsule.machine.status({ id: "fabric-smoke" })).resolves.toMatchObject({ status: "deleted" });
});
