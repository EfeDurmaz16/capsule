import { Capsule } from "@capsule/core";
import { docker } from "@capsule/adapter-docker";

const capsule = new Capsule({ adapter: docker(), receipts: true });
const run = await capsule.job.run({ image: "node:22", command: ["node", "-e", "console.log('hello job')"] });
console.log(run.result?.stdout);
console.log(run.receipt);
