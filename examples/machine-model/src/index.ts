import { Capsule } from "@capsule/core";
import { mockEC2 } from "@capsule/adapter-mock";

const capsule = new Capsule({ adapter: mockEC2(), receipts: true });
console.log("Example mode: mock EC2 machine model. No real provider APIs are called.");
console.log("Machines are lower-level and leakier than sandbox/job/service primitives.");
console.log(await capsule.machine.create({ name: "runner", image: "ami-mock", region: "us-east-1", size: "t3.micro" }));
