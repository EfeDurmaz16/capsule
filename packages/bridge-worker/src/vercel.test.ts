import { APIError } from "@vercel/sandbox";
import { describe, expect, it, vi } from "vitest";
import { vercelDriver } from "./vercel.js";

const binding = { account: "team_test", project: "prj_test" };

describe("Vercel bridge driver", () => {
  it("finds an operation in its configured project without resuming the sandbox", async () => {
    const get = vi.fn();
    const driver = vercelDriver({ binding, token: "test-credential", sdk: { get, create: vi.fn() } });
    const name = driver.resourceName("operation-a", "key-a");
    expect(driver.resourceName("operation-a", "different-key")).not.toBe(name);
    expect(driver.resourceName("operation-b", "key-a")).toBe(name);
    get.mockResolvedValue({ name, status: "stopped", tags: { "fabric.operation": "operation-a", "fabric.job": "job-a" } });

    expect(await driver.findCreated("operation-a", "key-a")).toBe(name);
    expect(await driver.read(name)).toEqual({ exists: true, status: "stopped", owner: { operation: "operation-a", job: "job-a" } });
    expect(get).toHaveBeenCalledWith({ name, resume: false, teamId: binding.account, projectId: binding.project, token: "test-credential" });

    get.mockResolvedValue({ name, tags: { "fabric.operation": "other-operation" } });
    await expect(driver.findCreated("operation-a", "key-a")).rejects.toThrow("sandbox name collision");
  });

  it("treats a 404 as absent and propagates authorization failures", async () => {
    const get = vi.fn();
    const driver = vercelDriver({ binding, token: "test-credential", sdk: { get, create: vi.fn() } });
    get.mockRejectedValue(new APIError(new Response(null, { status: 404 })));
    await expect(driver.read("missing")).resolves.toEqual({ exists: false });
    await expect(driver.findCreated("operation", "key")).resolves.toBeUndefined();
    get.mockRejectedValue(new APIError(new Response(null, { status: 403 })));
    await expect(driver.read("forbidden")).rejects.toBeInstanceOf(APIError);
  });
});
