import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

const packageAliases = {
  "@capsule-sdk/adapter-azure-container-apps": "./packages/adapter-azure-container-apps/src/index.ts",
  "@capsule-sdk/adapter-cloud-run": "./packages/adapter-cloud-run/src/index.ts",
  "@capsule-sdk/adapter-cloudflare": "./packages/adapter-cloudflare/src/index.ts",
  "@capsule-sdk/adapter-daytona": "./packages/adapter-daytona/src/index.ts",
  "@capsule-sdk/adapter-docker": "./packages/adapter-docker/src/index.ts",
  "@capsule-sdk/adapter-e2b": "./packages/adapter-e2b/src/index.ts",
  "@capsule-sdk/adapter-ec2": "./packages/adapter-ec2/src/index.ts",
  "@capsule-sdk/adapter-ecs": "./packages/adapter-ecs/src/index.ts",
  "@capsule-sdk/adapter-fly": "./packages/adapter-fly/src/index.ts",
  "@capsule-sdk/adapter-kubernetes": "./packages/adapter-kubernetes/src/index.ts",
  "@capsule-sdk/adapter-lambda": "./packages/adapter-lambda/src/index.ts",
  "@capsule-sdk/adapter-mock": "./packages/adapter-mock/src/index.ts",
  "@capsule-sdk/adapter-modal": "./packages/adapter-modal/src/index.ts",
  "@capsule-sdk/adapter-neon": "./packages/adapter-neon/src/index.ts",
  "@capsule-sdk/adapter-vercel": "./packages/adapter-vercel/src/index.ts",
  "@capsule-sdk/ai": "./packages/ai/src/index.ts",
  "@capsule-sdk/cli": "./packages/cli/src/index.ts",
  "@capsule-sdk/core": "./packages/core/src/index.ts",
  "@capsule-sdk/presets": "./packages/presets/src/index.ts",
  "@capsule-sdk/preview": "./packages/preview/src/index.ts",
  "@capsule-sdk/store-jsonl": "./packages/store-jsonl/src/index.ts",
  "@capsule-sdk/store-sqlite": "./packages/store-sqlite/src/index.ts",
  "@capsule-sdk/test-utils": "./packages/test-utils/src/index.ts"
};

export default defineConfig({
  resolve: {
    alias: Object.fromEntries(Object.entries(packageAliases).map(([name, path]) => [name, fileURLToPath(new URL(path, import.meta.url))]))
  },
  test: {
    include: ["packages/**/*.test.ts", "examples/**/*.test.ts"],
    environment: "node"
  }
});
