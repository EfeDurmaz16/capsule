import { Capsule } from "@capsule/core";
import { mockNeon } from "@capsule/adapter-mock";

const capsule = new Capsule({ adapter: mockNeon(), receipts: true });
const branch = await capsule.database.branch.create({ project: "app", parent: "main", name: "pr-42" });
console.log(branch.connectionString);
console.log(branch.receipt);
