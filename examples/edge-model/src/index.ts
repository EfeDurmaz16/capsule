import { Capsule } from "@capsule/core";
import { mockCloudflare, mockVercel } from "@capsule/adapter-mock";

for (const adapter of [mockVercel(), mockCloudflare()]) {
  const capsule = new Capsule({ adapter, receipts: true });
  console.log(adapter.name, capsule.supportLevel("edge.deploy"), await capsule.edge.deploy({ name: "router", runtime: adapter.provider === "cloudflare" ? "workers" : "edge", routes: ["/api/*"] }));
}
