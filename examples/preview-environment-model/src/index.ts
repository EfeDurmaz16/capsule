import { Capsule } from "@capsule/core";
import { mockCloudflare } from "@capsule/adapter-mock";

console.log("Mock preview orchestration; this models future composition.");
const capsule = new Capsule({ adapter: mockCloudflare(), receipts: true, policy: { ttl: { maxMs: 86_400_000 }, cost: { maxUsd: 5 } } });
console.log(await capsule.preview.create({
  name: "pr-42",
  services: [{ name: "api", image: "example/api:latest" }],
  edges: [{ name: "web", runtime: "workers" }],
  databases: [{ project: "app", name: "pr-42" }],
  jobs: [{ name: "smoke", image: "node:22", command: ["node", "-e", "console.log('ok')"] }]
}));
