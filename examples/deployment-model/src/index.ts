import { Capsule } from "@capsule/core";
import { mockCloudRun, mockCloudflare, mockVercel } from "@capsule/adapter-mock";

console.log("Example mode: mock deployment model only. No real provider APIs are called.");
for (const adapter of [mockCloudRun(), mockVercel(), mockCloudflare()]) {
  const capsule = new Capsule({ adapter, receipts: true });
  if (capsule.supports("service.deploy")) console.log(await capsule.service.deploy({ name: "api", image: "example/api:latest" }));
  if (capsule.supports("edge.deploy")) console.log(await capsule.edge.deploy({ name: "web", runtime: "edge" }));
}
