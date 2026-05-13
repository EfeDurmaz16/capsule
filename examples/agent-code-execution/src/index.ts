import { Capsule } from "@capsule/core";
import { createCodeExecutionTool } from "@capsule/ai";
import { e2b } from "@capsule/adapter-e2b";
import { mockE2B } from "@capsule/adapter-mock";

const live = process.env.CAPSULE_LIVE_TESTS === "1" && Boolean(process.env.E2B_API_KEY);
const capsule = new Capsule({ adapter: live ? e2b({ apiKey: process.env.E2B_API_KEY }) : mockE2B(), receipts: true });

console.log(
  live
    ? "Example mode: live E2B sandbox. This will call the E2B provider API."
    : "Example mode: mock E2B sandbox. No real provider APIs are called. Set CAPSULE_LIVE_TESTS=1 and E2B_API_KEY to use the real adapter."
);
const tool = createCodeExecutionTool(capsule);
const result = await tool.execute({
  language: "javascript",
  files: [{ path: "/workspace/index.js", content: "console.log('agent code')" }],
  command: ["node", "/workspace/index.js"]
});
console.log(result.stdout);
console.log(result.receipt);
