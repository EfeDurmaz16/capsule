import {
  ciJobPreset,
  costLimitedPreviewPreset,
  dockerLocalAgentPreset,
  edgeWorkerPreset,
  httpServicePreset,
  nodeJobPreset,
  nodeSandboxPreset,
  previewDatabaseBranchPreset,
  previewEnvironmentPreset
} from "@capsule/core";
import { describe, expect, test } from "vitest";
import {
  cloudflareNeonPreviewPreset,
  cloudflareWorkerPreset,
  flyHttpServicePreset,
  flyMachinePreset,
  flyVercelNeonPreviewPreset,
  neonPreviewBranchPreset,
  presetCatalog,
  vercelNeonPreviewPreset,
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

describe("flyMachinePreset", () => {
  test("produces the full machine spec with a preset label and provider options", () => {
    const preset = flyMachinePreset({
      name: "api",
      image: "registry.example/api:latest",
      region: "iad",
      env: { NODE_ENV: "production" },
      memoryMb: 512,
      cpu: 2,
      labels: { team: "core" }
    });

    expect(preset.name).toBe("fly-machine");
    expect(preset.domain).toBe("machine");
    expect(preset.capabilityPaths).toEqual(["machine.create", "machine.status", "machine.start", "machine.stop", "machine.destroy"]);
    expect(preset.spec).toEqual({
      name: "api",
      image: "registry.example/api:latest",
      region: "iad",
      env: { NODE_ENV: "production" },
      labels: { team: "core", "capsule.io/preset": "fly-machine" },
      providerOptions: { memoryMb: 512, cpu: 2 }
    });
    expect(preset.notes.length).toBeGreaterThan(0);
  });

  test("omits absent provider options and still stamps the preset label", () => {
    const preset = flyMachinePreset({ name: "api", image: "registry.example/api:latest" });

    expect(preset.spec.providerOptions).toEqual({});
    expect(preset.spec.labels).toEqual({ "capsule.io/preset": "fly-machine" });
  });

  test("rejects non-positive resource inputs", () => {
    expect(() => flyMachinePreset({ name: "api", image: "img:1", memoryMb: 0 })).toThrow("fly-machine memoryMb must be greater than 0");
    expect(() => flyMachinePreset({ name: "api", image: "img:1", cpu: -1 })).toThrow("fly-machine cpu must be greater than 0");
  });
});

describe("flyHttpServicePreset", () => {
  test("produces the full service spec with ports, scale, and provider options", () => {
    const preset = flyHttpServicePreset({
      name: "api",
      image: "registry.example/api:latest",
      region: "iad",
      env: { PORT: "3000" },
      port: 3000,
      memoryMb: 256,
      cpu: 1,
      minScale: 1,
      maxScale: 3,
      labels: { team: "core" }
    });

    expect(preset.domain).toBe("service");
    expect(preset.capabilityPaths).toEqual(["service.deploy", "service.status", "service.url"]);
    expect(preset.spec).toEqual({
      name: "api",
      image: "registry.example/api:latest",
      ports: [{ port: 3000, public: true, protocol: "http" }],
      env: { PORT: "3000" },
      resources: { memoryMb: 256, cpu: 1 },
      scale: { min: 1, max: 3 },
      labels: { team: "core", "capsule.io/preset": "fly-http-service" },
      providerOptions: { region: "iad" }
    });
  });

  test("defaults the port to 8080 and omits scale when unset", () => {
    const preset = flyHttpServicePreset({ name: "api", image: "img:1" });

    expect(preset.spec.ports).toEqual([{ port: 8080, public: true, protocol: "http" }]);
    expect(preset.spec.scale).toBeUndefined();
    expect(preset.spec.providerOptions).toEqual({});
  });

  test("allows a zero minScale floor", () => {
    const preset = flyHttpServicePreset({ name: "api", image: "img:1", minScale: 0 });

    expect(preset.spec.scale).toEqual({ min: 0 });
  });

  test("rejects out-of-range ports and non-integer scale", () => {
    expect(() => flyHttpServicePreset({ name: "api", image: "img:1", port: 70_000 })).toThrow("fly-http-service port must be between 1 and 65535");
    expect(() => flyHttpServicePreset({ name: "api", image: "img:1", minScale: 1.5 })).toThrow("fly-http-service minScale must be greater than or equal to 0");
    expect(() => flyHttpServicePreset({ name: "api", image: "img:1", memoryMb: 0 })).toThrow("fly-http-service memoryMb must be greater than 0");
  });
});

describe("vercelWebPreset", () => {
  test("produces the full edge spec with source, routes, and provider options", () => {
    const preset = vercelWebPreset({
      name: "web",
      sourcePath: "dist/index.js",
      entrypoint: "index.js",
      project: "capsule-web",
      target: "production",
      env: { NODE_ENV: "production" },
      routes: ["/*"],
      labels: { team: "core" }
    });

    expect(preset.domain).toBe("edge");
    expect(preset.capabilityPaths).toEqual(["edge.deploy", "edge.status", "edge.release", "edge.url"]);
    expect(preset.spec).toEqual({
      name: "web",
      source: { path: "dist/index.js", entrypoint: "index.js" },
      runtime: "edge",
      env: { NODE_ENV: "production" },
      routes: ["/*"],
      labels: { team: "core", "capsule.io/preset": "vercel-web" },
      providerOptions: { project: "capsule-web", target: "production" }
    });
  });

  test("defaults the deployment target to preview", () => {
    const preset = vercelWebPreset({ name: "web", sourcePath: "dist/index.js" });

    expect(preset.spec.providerOptions).toEqual({ target: "preview" });
  });

  test("rejects missing name or source path", () => {
    expect(() => vercelWebPreset({ name: "", sourcePath: "dist/index.js" })).toThrow("vercel-web name is required");
    expect(() => vercelWebPreset({ name: "web", sourcePath: "" })).toThrow("vercel-web sourcePath is required");
  });
});

describe("cloudflareWorkerPreset", () => {
  test("produces the full worker spec without provider options", () => {
    const preset = cloudflareWorkerPreset({
      name: "worker",
      sourcePath: "worker.js",
      entrypoint: "worker.js",
      env: { LOG: "info" },
      routes: ["preview.example.com/*"],
      labels: { team: "core" }
    });

    expect(preset.domain).toBe("edge");
    expect(preset.capabilityPaths).toEqual(["edge.deploy", "edge.version", "edge.rollback", "edge.routes"]);
    expect(preset.spec).toEqual({
      name: "worker",
      source: { path: "worker.js", entrypoint: "worker.js" },
      runtime: "workers",
      env: { LOG: "info" },
      routes: ["preview.example.com/*"],
      labels: { team: "core", "capsule.io/preset": "cloudflare-worker" }
    });
    expect(preset.spec).not.toHaveProperty("providerOptions");
  });

  test("rejects missing name or source path", () => {
    expect(() => cloudflareWorkerPreset({ name: "", sourcePath: "worker.js" })).toThrow("cloudflare-worker name is required");
    expect(() => cloudflareWorkerPreset({ name: "worker", sourcePath: "" })).toThrow("cloudflare-worker sourcePath is required");
  });
});

describe("neonPreviewBranchPreset", () => {
  test("produces the full branch spec, provider options, and a ttl policy", () => {
    const preset = neonPreviewBranchPreset({
      project: "silent-river-123",
      name: "pr-42",
      parent: "main",
      ttlMs: 3_600_000,
      databaseName: "app",
      roleName: "app_role",
      pooled: false,
      labels: { team: "core" }
    });

    expect(preset.domain).toBe("database");
    expect(preset.capabilityPaths).toEqual(["database.branchCreate", "database.connectionString", "database.branchDelete"]);
    expect(preset.spec).toEqual({
      project: "silent-river-123",
      name: "pr-42",
      parent: "main",
      ttlMs: 3_600_000,
      labels: { team: "core", "capsule.io/preset": "neon-preview-branch" },
      providerOptions: { databaseName: "app", roleName: "app_role", pooled: false }
    });
    expect(preset.policy).toEqual({ ttl: { maxMs: 3_600_000 } });
  });

  test("omits the policy and provider options when they are unset", () => {
    const preset = neonPreviewBranchPreset({ project: "silent-river-123", name: "pr-42" });

    expect(preset.policy).toBeUndefined();
    expect(preset.spec.providerOptions).toEqual({});
  });
});

describe("flyVercelNeonPreviewPreset composition", () => {
  test("propagates component names, images, and branches into the preview sub-specs", () => {
    const preset = flyVercelNeonPreviewPreset({
      name: "pr-42",
      source: { repo: "github.com/acme/app", ref: "feature" },
      ttlMs: 86_400_000,
      web: { name: "web-pr-42", sourcePath: "dist/index.js", project: "capsule-web" },
      api: { name: "api-pr-42", image: "registry.example/api:latest", port: 8080 },
      database: { project: "silent-river-123", name: "branch-pr-42" },
      checks: [
        { image: "node:22", command: ["node", "-e", "console.log('a')"] },
        { image: "node:22", command: ["echo", "ok"] }
      ],
      labels: { team: "core" }
    });

    expect(preset.name).toBe("fly-vercel-neon-preview");
    expect(preset.preview.spec.name).toBe("pr-42");
    expect(preset.preview.spec.source).toEqual({ repo: "github.com/acme/app", ref: "feature" });
    expect(preset.preview.spec.ttlMs).toBe(86_400_000);

    expect(preset.preview.spec.edges?.[0]).toBe(preset.components.web?.spec);
    expect(preset.preview.spec.edges?.[0]?.name).toBe("web-pr-42");
    expect(preset.preview.spec.edges?.[0]?.source).toEqual({ path: "dist/index.js", entrypoint: undefined });

    expect(preset.preview.spec.services?.[0]).toBe(preset.components.api?.spec);
    expect(preset.preview.spec.services?.[0]?.name).toBe("api-pr-42");
    expect(preset.preview.spec.services?.[0]?.image).toBe("registry.example/api:latest");

    expect(preset.preview.spec.databases?.[0]).toBe(preset.components.database?.spec);
    expect(preset.preview.spec.databases?.[0]?.name).toBe("branch-pr-42");
    expect(preset.preview.spec.databases?.[0]?.project).toBe("silent-river-123");
  });

  test("aggregates component capability paths onto the preview preset", () => {
    const preset = flyVercelNeonPreviewPreset({
      name: "pr-42",
      web: { name: "web-pr-42", sourcePath: "dist/index.js" },
      api: { name: "api-pr-42", image: "registry.example/api:latest" },
      database: { project: "silent-river-123", name: "branch-pr-42" },
      checks: [{ image: "node:22", command: ["echo", "ok"] }]
    });

    expect(preset.preview.capabilityPaths).toEqual([
      "preview.create",
      "preview.destroy",
      "preview.urls",
      "edge.deploy",
      "edge.status",
      "edge.release",
      "edge.url",
      "service.deploy",
      "service.status",
      "service.url",
      "database.branchCreate",
      "database.connectionString",
      "database.branchDelete",
      "job.run",
      "job.logs"
    ]);
  });

  test("names checks sequentially and stamps them with the composition preset label", () => {
    const preset = flyVercelNeonPreviewPreset({
      name: "pr-42",
      checks: [
        { image: "node:22", command: ["echo", "one"], labels: { kind: "smoke" } },
        { image: "node:22", command: ["echo", "two"] }
      ]
    });

    expect(preset.components.checks.map((check) => check.name)).toEqual(["preview-check-1", "preview-check-2"]);
    expect(preset.components.checks[0].capabilityPaths).toEqual(["job.run", "job.logs"]);
    expect(preset.components.checks[0].spec.labels).toEqual({ kind: "smoke", "capsule.io/preset": "fly-vercel-neon-preview" });
    expect(preset.preview.spec.jobs).toHaveLength(2);
  });

  test("leaves component slots empty when no components are provided", () => {
    const preset = flyVercelNeonPreviewPreset({ name: "pr-42" });

    expect(preset.components.web).toBeUndefined();
    expect(preset.components.api).toBeUndefined();
    expect(preset.components.database).toBeUndefined();
    expect(preset.components.checks).toEqual([]);
    expect(preset.preview.spec.edges).toBeUndefined();
    expect(preset.preview.spec.services).toBeUndefined();
    expect(preset.preview.spec.databases).toBeUndefined();
    expect(preset.preview.spec.jobs).toEqual([]);
    expect(preset.preview.capabilityPaths).toEqual(["preview.create", "preview.destroy", "preview.urls"]);
  });

  test("shares one policy object between the preview spec and the returned preset", () => {
    const preset = flyVercelNeonPreviewPreset({ name: "pr-42" });

    expect(preset.policy).toBe(preset.preview.policy);
    expect(preset.policy.limits?.timeoutMs).toBe(300_000);
  });

  test("passes a caller-provided policy through unchanged", () => {
    const policy = { network: { mode: "allowlist" as const, allowedHosts: ["*.internal.test"] } };
    const preset = flyVercelNeonPreviewPreset({ name: "pr-42", policy });

    expect(preset.policy).toBe(policy);
    expect(preset.preview.policy).toBe(policy);
  });

  test("rejects a non-positive ttl before composing sub-specs", () => {
    expect(() => flyVercelNeonPreviewPreset({ name: "pr-42", ttlMs: 0 })).toThrow("fly-vercel-neon-preview ttlMs must be greater than 0");
  });

  test("propagates invalid component inputs from the underlying preset validation", () => {
    expect(() => flyVercelNeonPreviewPreset({ name: "pr-42", api: { name: "api", image: "" } })).toThrow("fly-http-service image is required");
  });
});

describe("cloudflareNeonPreviewPreset", () => {
  test("composes a Cloudflare Worker edge and a Neon branch into a preview", () => {
    const preset = cloudflareNeonPreviewPreset({
      name: "pr-42",
      ttlMs: 86_400_000,
      worker: { name: "worker-pr-42", sourcePath: "worker.js" },
      database: { project: "silent-river-123", name: "pr-42" },
      checks: [{ image: "node:22", command: ["echo", "ok"] }]
    });

    expect(preset.name).toBe("cloudflare-neon-preview");
    expect(preset.preview.domain).toBe("preview");
    expect(preset.preview.spec.edges).toHaveLength(1);
    expect(preset.preview.spec.databases).toHaveLength(1);
    expect(preset.preview.spec.services).toBeUndefined();
    expect(preset.components.web?.name).toBe("cloudflare-worker");
    expect(preset.components.api).toBeUndefined();
    expect(preset.preview.capabilityPaths).toContain("edge.rollback");
    expect(preset.preview.capabilityPaths).toContain("database.branchCreate");
    expect(preset.policy.network).toEqual({ mode: "allowlist", allowedHosts: ["*.workers.dev", "*.neon.tech"] });
    expect(preset.components.checks[0].spec.labels).toEqual({ "capsule.io/preset": "cloudflare-neon-preview" });
  });

  test("validates name, ttl, and allowlist policies", () => {
    expect(() => cloudflareNeonPreviewPreset({ name: "" })).toThrow("cloudflare-neon-preview name is required");
    expect(() => cloudflareNeonPreviewPreset({ name: "pr-42", ttlMs: 0 })).toThrow("cloudflare-neon-preview ttlMs must be greater than 0");
    expect(() => cloudflareNeonPreviewPreset({ name: "pr-42", policy: { network: { mode: "allowlist" } } })).toThrow(
      "network allowlist requires at least one allowed host"
    );
  });
});

describe("vercelNeonPreviewPreset", () => {
  test("composes a Vercel web edge and a Neon branch into a preview", () => {
    const preset = vercelNeonPreviewPreset({
      name: "pr-42",
      ttlMs: 86_400_000,
      web: { name: "web-pr-42", sourcePath: "dist/index.js" },
      database: { project: "silent-river-123", name: "pr-42" }
    });

    expect(preset.name).toBe("vercel-neon-preview");
    expect(preset.preview.spec.edges).toHaveLength(1);
    expect(preset.preview.spec.databases).toHaveLength(1);
    expect(preset.components.web?.name).toBe("vercel-web");
    expect(preset.preview.capabilityPaths).toContain("edge.release");
    expect(preset.policy.network).toEqual({ mode: "allowlist", allowedHosts: ["*.vercel.app", "*.neon.tech"] });
  });

  test("validates name and ttl before composing sub-specs", () => {
    expect(() => vercelNeonPreviewPreset({ name: "pr-42", ttlMs: -1 })).toThrow("vercel-neon-preview ttlMs must be greater than 0");
    expect(() => vercelNeonPreviewPreset({ name: "pr-42", web: { name: "web", sourcePath: "" } })).toThrow("vercel-web sourcePath is required");
  });
});

describe("presetCatalog", () => {
  test("has unique ids and covers core and provider presets", () => {
    const ids = presetCatalog.map((entry) => entry.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toContain("cost-limited-preview");
    expect(ids).toContain("cloudflare-neon-preview");
    expect(ids).toContain("vercel-neon-preview");
    expect(presetCatalog.some((entry) => entry.package === "@capsule/core")).toBe(true);
    expect(presetCatalog.some((entry) => entry.package === "@capsule/presets")).toBe(true);
  });

  test("catalog capabilityPaths stay in sync with the non-composed factories", () => {
    const factoryPaths: Record<string, string[]> = {
      "node-sandbox": nodeSandboxPreset().capabilityPaths,
      "node-job": nodeJobPreset({ command: ["node", "-e", "1"] }).capabilityPaths,
      "ci-job": ciJobPreset({ command: ["pnpm", "test"] }).capabilityPaths,
      "docker-local-agent": dockerLocalAgentPreset().capabilityPaths,
      "http-service": httpServicePreset({ name: "api", image: "example/api" }).capabilityPaths,
      "edge-worker": edgeWorkerPreset({ name: "worker" }).capabilityPaths,
      "preview-database-branch": previewDatabaseBranchPreset({ project: "app", name: "pr-42" }).capabilityPaths,
      "preview-environment": previewEnvironmentPreset({ name: "pr-42" }).capabilityPaths,
      "cost-limited-preview": costLimitedPreviewPreset({ name: "pr-42" }).capabilityPaths,
      "fly-machine": flyMachinePreset({ name: "api", image: "img:1" }).capabilityPaths,
      "fly-http-service": flyHttpServicePreset({ name: "api", image: "img:1" }).capabilityPaths,
      "vercel-web": vercelWebPreset({ name: "web", sourcePath: "dist/index.js" }).capabilityPaths,
      "cloudflare-worker": cloudflareWorkerPreset({ name: "worker", sourcePath: "worker.js" }).capabilityPaths,
      "neon-preview-branch": neonPreviewBranchPreset({ project: "app", name: "pr-42" }).capabilityPaths
    };
    for (const [id, paths] of Object.entries(factoryPaths)) {
      expect(presetCatalog.find((entry) => entry.id === id)?.capabilityPaths, id).toEqual(paths);
    }
  });
});
