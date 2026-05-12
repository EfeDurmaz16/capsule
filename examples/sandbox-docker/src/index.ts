import { Capsule } from "@capsule/core";
import { docker } from "@capsule/adapter-docker";

const capsule = new Capsule({ adapter: docker(), receipts: true, policy: { network: { mode: "none" }, limits: { timeoutMs: 60_000 } } });
const box = await capsule.sandbox.create({ image: "node:22" });
try {
  await box.writeFile("/workspace/index.js", "console.log('hello from capsule')");
  const result = await box.exec({ command: ["node", "/workspace/index.js"] });
  console.log(result.stdout);
  console.log(result.receipt);
} finally {
  await box.destroy();
}
