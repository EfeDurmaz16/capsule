import { Capsule } from "@capsule/core";
import { createCodeExecutionTool } from "@capsule/ai";
import { mockE2B } from "@capsule/adapter-mock";

const capsule = new Capsule({ adapter: mockE2B(), receipts: true });
const tool = createCodeExecutionTool(capsule);
const result = await tool.execute({
  language: "javascript",
  files: [{ path: "/workspace/index.js", content: "console.log('agent code')" }],
  command: ["node", "/workspace/index.js"]
});
console.log(result.stdout);
console.log(result.receipt);
