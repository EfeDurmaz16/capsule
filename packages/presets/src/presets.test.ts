import { describe, expect, test } from "vitest";
import { cloudflareWorkerPreset, flyMachinePreset, flyVercelNeonPreviewPreset, neonPreviewBranchPreset, vercelWebPreset } from "./index.js";

describe("@capsule/presets", () => {
  test("creates provider-specific presets without executing providers", () => {
    const fly = flyMachinePreset({ name: "api", image: "registry.example/api:latest", region: "iad" });
    const vercel = vercelWebPreset({ name: "web", sourcePath: "dist/index.js", project: "capsule-web" });
    const neon = neonPreviewBranchPreset({ project: "silent-river-123", name: "pr-42", ttlMs: 86_400_000 });
    const cloudflare = cloudflareWorkerPreset({ name: "worker", sourcePath: "worker.js", routes: ["preview.example.com/*"] });

    expect(fly.capabilityPaths).toContain("machine.create");
    expect(vercel.spec.providerOptions).toMatchObject({ project: "capsule-web", target: "preview" });
    expect(neon.policy).toEqual({ ttl: { maxMs: 86_400_000 } });
    expect(cloudflare.capabilityPaths).toContain("edge.routes");
  });

  test("composes a Fly + Vercel + Neon preview preset", () => {
    const preset = flyVercelNeonPreviewPreset({
      name: "pr-42",
      ttlMs: 86_400_000,
      web: { name: "web-pr-42", sourcePath: "dist/index.js" },
      api: { name: "api-pr-42", image: "registry.example/api:latest", port: 8080 },
      database: { project: "silent-river-123", name: "pr-42" },
      checks: [{ image: "node:22", command: ["node", "-e", "console.log('ok')"] }]
    });

    expect(preset.preview.domain).toBe("preview");
    expect(preset.preview.spec.edges).toHaveLength(1);
    expect(preset.preview.spec.services).toHaveLength(1);
    expect(preset.preview.spec.databases).toHaveLength(1);
    expect(preset.preview.spec.jobs).toHaveLength(1);
    expect(preset.preview.capabilityPaths).toContain("edge.deploy");
    expect(preset.preview.capabilityPaths).toContain("database.branchCreate");
    expect(preset.policy.network?.mode).toBe("allowlist");
  });
});
