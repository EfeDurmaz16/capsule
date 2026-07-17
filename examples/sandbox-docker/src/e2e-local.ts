import { Capsule, verifyReceipt } from "@capsule-sdk/core";
import { docker } from "@capsule-sdk/docker";

const image = process.env.CAPSULE_E2E_IMAGE ?? "node:22";
const capsule = new Capsule({ adapter: docker(), receipts: true, policy: { network: { mode: "none" }, limits: { timeoutMs: 60_000 } } });

console.log(`e2e: sandbox lifecycle on local Docker with ${image}`);
const box = await capsule.sandbox.create({ image });
try {
  await box.writeFile("/workspace/index.js", "console.log('hello from capsule e2e')");
  const result = await box.exec({ command: ["node", "/workspace/index.js"] });
  if (result.exitCode !== 0) throw new Error(`exec failed: ${result.stderr}`);
  if (!result.stdout.includes("hello from capsule e2e")) throw new Error(`unexpected stdout: ${result.stdout}`);
  if (!result.receipt) throw new Error("missing exec receipt");
  const verdict = verifyReceipt(result.receipt);
  if (!verdict.valid) throw new Error(`receipt failed verification: ${JSON.stringify(verdict)}`);
  const files = await box.listFiles("/workspace");
  if (!files.some((f) => f.path.endsWith("index.js"))) throw new Error("listFiles missing written file");
  const read = new TextDecoder().decode(await box.readFile("/workspace/index.js"));
  if (!read.includes("hello from capsule e2e")) throw new Error("readFile mismatch");
  console.log("e2e: exec + files + receipt verification passed");

  const job = await capsule.job.run({ image, command: ["node", "-e", "console.log('job ok')"] });
  if (!job.result || job.result.exitCode !== 0) throw new Error(`job failed: ${JSON.stringify(job.status)}`);
  if (!job.result.stdout.includes("job ok")) throw new Error(`unexpected job stdout: ${job.result.stdout}`);
  if (!job.receipt || !verifyReceipt(job.receipt).valid) throw new Error("job receipt failed verification");
  console.log("e2e: job.run + receipt verification passed");
} finally {
  await box.destroy();
}
console.log("e2e: sandbox destroyed, all checks passed");
