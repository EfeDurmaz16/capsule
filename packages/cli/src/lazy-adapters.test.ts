// PERF-09: report-only commands must not import provider adapter packages (and their SDKs). Every
// provider package is wrapped so that evaluating it records its name; the real module is still used.
import { afterEach, describe, expect, it, vi } from "vitest";

const loaded = vi.hoisted(() => [] as string[]);

vi.mock("@capsule-sdk/azure", async (importOriginal) => (loaded.push("azure-container-apps"), await importOriginal()));
vi.mock("@capsule-sdk/cloud-run", async (importOriginal) => (loaded.push("cloud-run"), await importOriginal()));
vi.mock("@capsule-sdk/cloudflare", async (importOriginal) => (loaded.push("cloudflare"), await importOriginal()));
vi.mock("@capsule-sdk/daytona", async (importOriginal) => (loaded.push("daytona"), await importOriginal()));
vi.mock("@capsule-sdk/docker", async (importOriginal) => (loaded.push("docker"), await importOriginal()));
vi.mock("@capsule-sdk/e2b", async (importOriginal) => (loaded.push("e2b"), await importOriginal()));
vi.mock("@capsule-sdk/ec2", async (importOriginal) => (loaded.push("ec2"), await importOriginal()));
vi.mock("@capsule-sdk/ecs", async (importOriginal) => (loaded.push("ecs"), await importOriginal()));
vi.mock("@capsule-sdk/fly", async (importOriginal) => (loaded.push("fly"), await importOriginal()));
vi.mock("@capsule-sdk/kubernetes", async (importOriginal) => (loaded.push("kubernetes"), await importOriginal()));
vi.mock("@capsule-sdk/lambda", async (importOriginal) => (loaded.push("lambda"), await importOriginal()));
vi.mock("@capsule-sdk/modal", async (importOriginal) => (loaded.push("modal"), await importOriginal()));
vi.mock("@capsule-sdk/neon", async (importOriginal) => (loaded.push("neon"), await importOriginal()));
vi.mock("@capsule-sdk/vercel", async (importOriginal) => (loaded.push("vercel"), await importOriginal()));

const { main } = await import("./index.js");

describe("PERF-09: provider adapters load lazily", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("importing the CLI and running help, completion and preset reports loads no provider adapter", async () => {
    vi.spyOn(console, "log").mockImplementation(() => undefined);
    expect(loaded).toEqual([]);
    await main([]);
    await main(["completion", "bash"]);
    await main(["completion", "zsh"]);
    await main(["preset", "list", "--json"]);
    expect(loaded).toEqual([]);
  });

  it("selecting one adapter loads only that adapter package", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
    await main(["capabilities", "--adapter", "e2b", "--json"]);
    expect(loaded).toEqual(["e2b"]);
    expect(JSON.parse(String(log.mock.calls[0]?.[0]))).toMatchObject({ adapter: "e2b" });
  });
});
