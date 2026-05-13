import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { Capsule } from "@capsule/core";
import { mockCloudflare, mockVercel } from "@capsule/adapter-mock";
import { vercel } from "@capsule/adapter-vercel";

const liveVercel = process.env.CAPSULE_LIVE_TESTS === "1" && Boolean(process.env.VERCEL_TOKEN);
const sourceDir = join(tmpdir(), "capsule-edge-example");
const sourcePath = join(sourceDir, "index.js");

if (liveVercel) {
  await mkdir(sourceDir, { recursive: true });
  await writeFile(sourcePath, "export default function handler() { return new Response('hello from capsule'); }\n");
}

console.log(
  liveVercel
    ? "Example mode: live Vercel edge deployment plus mock Cloudflare comparison. This will call the Vercel provider API."
    : "Example mode: mock Vercel and Cloudflare edge deployments. No real provider APIs are called. Set CAPSULE_LIVE_TESTS=1 and VERCEL_TOKEN to use the real Vercel adapter."
);

for (const adapter of [liveVercel ? vercel({ token: process.env.VERCEL_TOKEN, project: process.env.VERCEL_PROJECT, teamId: process.env.VERCEL_TEAM_ID }) : mockVercel(), mockCloudflare()]) {
  const capsule = new Capsule({ adapter, receipts: true });
  console.log(
    adapter.name,
    capsule.supportLevel("edge.deploy"),
    await capsule.edge.deploy({
      name: process.env.CAPSULE_EXAMPLE_EDGE_NAME ?? "router",
      runtime: adapter.provider === "cloudflare" ? "workers" : "edge",
      routes: ["/api/*"],
      source: liveVercel && adapter.provider === "vercel" ? { path: sourcePath, entrypoint: "index.js" } : undefined
    })
  );
}
