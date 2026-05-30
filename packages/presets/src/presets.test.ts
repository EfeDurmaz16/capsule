import { describe, expect, test } from "vitest";
import {
  cloudflareWorkerPreset,
  flyHttpServicePreset,
  flyMachinePreset,
  flyVercelNeonPreviewPreset,
  neonPreviewBranchPreset,
  vercelWebPreset
} from "./index.js";

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

  test("rejects provider preset inputs before adapter execution", () => {
    expect(() => flyMachinePreset({ name: "", image: "registry.example/api:latest" })).toThrow("fly-machine name is required");
    expect(() => flyMachinePreset({ name: "api", image: "" })).toThrow("fly-machine image is required");
    expect(() => flyHttpServicePreset({ name: "api", image: "registry.example/api:latest", port: 0 })).toThrow(
      "fly-http-service port must be between 1 and 65535"
    );
    expect(() => flyHttpServicePreset({ name: "api", image: "registry.example/api:latest", minScale: 3, maxScale: 1 })).toThrow(
      "fly-http-service minScale must be less than or equal to maxScale"
    );
    expect(() => vercelWebPreset({ name: "web", sourcePath: "" })).toThrow("vercel-web sourcePath is required");
    expect(() => cloudflareWorkerPreset({ name: "worker", sourcePath: "" })).toThrow("cloudflare-worker sourcePath is required");
    expect(() => neonPreviewBranchPreset({ project: "", name: "pr-42" })).toThrow("neon-preview-branch project is required");
    expect(() => neonPreviewBranchPreset({ project: "silent-river-123", name: "pr-42", ttlMs: -1 })).toThrow(
      "neon-preview-branch ttlMs must be greater than 0"
    );
  });

  test("requires composed preview allowlist policies to include explicit hosts", () => {
    expect(() => flyVercelNeonPreviewPreset({ name: "pr-42", policy: { network: { mode: "allowlist" } } })).toThrow(
      "network allowlist requires at least one allowed host"
    );

    expect(flyVercelNeonPreviewPreset({ name: "pr-42" }).policy.network).toEqual({
      mode: "allowlist",
      allowedHosts: ["*.fly.dev", "*.vercel.app", "*.neon.tech"]
    });
  });
});
