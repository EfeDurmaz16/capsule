import { flyVercelNeonPreviewPreset } from "@capsule/presets";

const preset = flyVercelNeonPreviewPreset({
  name: "pr-42",
  source: {
    repo: "https://github.com/acme/product",
    ref: "refs/pull/42/head"
  },
  ttlMs: 24 * 60 * 60 * 1000,
  web: {
    name: "web-pr-42",
    sourcePath: "dist/vercel/index.js",
    project: "acme-web",
    target: "preview"
  },
  api: {
    name: "api-pr-42",
    image: "registry.example.com/acme/api:pr-42",
    region: "iad",
    port: 8080,
    memoryMb: 512
  },
  database: {
    project: "neon-project-id",
    name: "pr-42",
    parent: "main",
    ttlMs: 24 * 60 * 60 * 1000,
    databaseName: "app",
    roleName: "app_owner",
    pooled: true
  },
  checks: [
    {
      name: "smoke",
      image: "node:22",
      command: ["node", "-e", "console.log('preview smoke ok')"],
      timeoutMs: 60_000
    }
  ]
});

console.log("Provider preset only. No real provider APIs are called by this example.");
console.log(JSON.stringify(preset, null, 2));
