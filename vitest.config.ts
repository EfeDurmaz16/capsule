import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

const packageAliases = {
  "@capsule/adapter-azure-container-apps": "./packages/adapter-azure-container-apps/src/index.ts",
  "@capsule/adapter-cloud-run": "./packages/adapter-cloud-run/src/index.ts",
  "@capsule/adapter-cloudflare": "./packages/adapter-cloudflare/src/index.ts",
  "@capsule/adapter-daytona": "./packages/adapter-daytona/src/index.ts",
  "@capsule/adapter-docker": "./packages/adapter-docker/src/index.ts",
  "@capsule/adapter-e2b": "./packages/adapter-e2b/src/index.ts",
  "@capsule/adapter-ec2": "./packages/adapter-ec2/src/index.ts",
  "@capsule/adapter-ecs": "./packages/adapter-ecs/src/index.ts",
  "@capsule/adapter-fly": "./packages/adapter-fly/src/index.ts",
  "@capsule/adapter-kubernetes": "./packages/adapter-kubernetes/src/index.ts",
  "@capsule/adapter-lambda": "./packages/adapter-lambda/src/index.ts",
  "@capsule/adapter-mock": "./packages/adapter-mock/src/index.ts",
  "@capsule/adapter-modal": "./packages/adapter-modal/src/index.ts",
  "@capsule/adapter-neon": "./packages/adapter-neon/src/index.ts",
  "@capsule/adapter-vercel": "./packages/adapter-vercel/src/index.ts",
  "@capsule/ai": "./packages/ai/src/index.ts",
  "@capsule/cli": "./packages/cli/src/index.ts",
  "@capsule/core": "./packages/core/src/index.ts",
  "@capsule/presets": "./packages/presets/src/index.ts",
  "@capsule/preview": "./packages/preview/src/index.ts",
  "@capsule/store-jsonl": "./packages/store-jsonl/src/index.ts",
  "@capsule/store-sqlite": "./packages/store-sqlite/src/index.ts",
  "@capsule/test-utils": "./packages/test-utils/src/index.ts"
};

export default defineConfig({
  resolve: {
    alias: Object.fromEntries(
      Object.entries(packageAliases).map(([name, path]) => [name, fileURLToPath(new URL(path, import.meta.url))])
    )
  },
  test: {
    include: ["packages/**/*.test.ts", "examples/**/*.test.ts"],
    environment: "node"
  }
});
