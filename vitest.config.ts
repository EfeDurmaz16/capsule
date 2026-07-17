import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

const packageAliases = {
  "@capsule-sdk/azure": "./packages/azure/src/index.ts",
  "@capsule-sdk/cloud-run": "./packages/cloud-run/src/index.ts",
  "@capsule-sdk/cloudflare": "./packages/cloudflare/src/index.ts",
  "@capsule-sdk/daytona": "./packages/daytona/src/index.ts",
  "@capsule-sdk/docker": "./packages/docker/src/index.ts",
  "@capsule-sdk/e2b": "./packages/e2b/src/index.ts",
  "@capsule-sdk/ec2": "./packages/ec2/src/index.ts",
  "@capsule-sdk/ecs": "./packages/ecs/src/index.ts",
  "@capsule-sdk/fly": "./packages/fly/src/index.ts",
  "@capsule-sdk/kubernetes": "./packages/kubernetes/src/index.ts",
  "@capsule-sdk/lambda": "./packages/lambda/src/index.ts",
  "@capsule-sdk/mock": "./packages/mock/src/index.ts",
  "@capsule-sdk/modal": "./packages/modal/src/index.ts",
  "@capsule-sdk/neon": "./packages/neon/src/index.ts",
  "@capsule-sdk/vercel": "./packages/vercel/src/index.ts",
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
