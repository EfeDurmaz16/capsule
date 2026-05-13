import { Capsule } from "@capsule/core";
import { mockE2B } from "@capsule/adapter-mock";

console.log("Example mode: mock E2B policy and receipt flow. No real provider APIs are called.");
const capsule = new Capsule({ adapter: mockE2B(), receipts: true, policy: { network: { mode: "none" }, limits: { timeoutMs: 1_000 } } });
const box = await capsule.sandbox.create({ image: "node:22" });
const result = await box.exec({ command: ["node", "-e", "console.log('receipt')"], timeoutMs: 2_000 });
console.log(result.receipt?.policy.decision);
console.log(result.receipt?.stdoutHash, result.receipt?.stderrHash);
