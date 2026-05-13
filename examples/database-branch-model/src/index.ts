import { Capsule } from "@capsule/core";
import { mockNeon } from "@capsule/adapter-mock";
import { neon } from "@capsule/adapter-neon";

const live = process.env.CAPSULE_LIVE_TESTS === "1" && Boolean(process.env.NEON_API_KEY && process.env.NEON_PROJECT_ID);
const capsule = new Capsule({
  adapter: live
    ? neon({
        apiKey: process.env.NEON_API_KEY,
        databaseName: process.env.NEON_DATABASE,
        roleName: process.env.NEON_ROLE
      })
    : mockNeon(),
  receipts: true
});

console.log(
  live
    ? "Example mode: live Neon database branch. This will call the Neon provider API."
    : "Example mode: mock Neon database branch. No real provider APIs are called. Set CAPSULE_LIVE_TESTS=1, NEON_API_KEY, and NEON_PROJECT_ID to use the real adapter."
);
const branch = await capsule.database.branch.create({
  project: process.env.NEON_PROJECT_ID ?? "app",
  parent: process.env.NEON_PARENT_BRANCH_ID ?? "main",
  name: process.env.CAPSULE_EXAMPLE_BRANCH_NAME ?? "pr-42"
});
console.log(branch.connectionString);
console.log(branch.receipt);
