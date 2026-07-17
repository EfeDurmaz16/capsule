import { Capsule } from "@capsule-sdk/core";
import { docker } from "@capsule-sdk/docker";

console.log("Example mode: live local Docker CLI. This calls Docker on this machine, not a cloud provider API.");
const capsule = new Capsule({ adapter: docker(), receipts: true });
const run = await capsule.job.run({ image: "node:22", command: ["node", "-e", "console.log('hello job')"] });
console.log(run.result?.stdout);
console.log(run.receipt);
