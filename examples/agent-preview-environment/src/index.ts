import { pathToFileURL } from "node:url";
import { Capsule, type CapsuleReceipt } from "@capsule-sdk/core";
import { createCodeExecutionTool } from "@capsule-sdk/ai";
import { mockE2B, mockNeon, mockVercel, mockCloudRun } from "@capsule-sdk/mock";
import { createPreviewGraph, cleanupPreviewEnvironment, PreviewCreationError, type PreviewPlan } from "@capsule-sdk/preview";

// End-to-end shape: an agent runs a code-execution check in a Capsule sandbox, and only if that
// check passes does it provision a preview environment (database branch + web edge + api service)
// and then tear it down. Everything uses mock adapters, so it runs credential-free.
export interface AgentPreviewResult {
  check: { exitCode: number; stdout: string; receiptId?: string };
  provisioned: boolean;
  previewId?: string;
  createdResources: number;
  cleanupStatus?: string;
  cleanedResources?: number;
  receiptCount: number;
}

const previewName = "pr-101";
const workerSource = { path: "dist/worker.js", entrypoint: "worker.js" };

function receiptCapsule(adapter: ConstructorParameters<typeof Capsule>[0]["adapter"]): Capsule {
  return new Capsule({ adapter, receipts: true });
}

// The agent's pre-provision gate: run the project's smoke check in a sandbox and return the result.
export async function runAgentCheck(): Promise<{ exitCode: number; stdout: string; receipt?: CapsuleReceipt }> {
  const tool = createCodeExecutionTool(receiptCapsule(mockE2B()));
  const result = await tool.execute({
    language: "javascript",
    files: [{ path: "/workspace/smoke.js", content: "console.log('preview smoke passed')" }],
    command: ["node", "/workspace/smoke.js"]
  });
  return { exitCode: result.exitCode, stdout: result.stdout, receipt: result.receipt };
}

export async function run(): Promise<AgentPreviewResult> {
  console.log("Example mode: mock agent preview environment. No real provider APIs are called.");

  // Step 1: the agent runs a code-execution check before provisioning anything.
  const check = await runAgentCheck();
  console.log(`agent check: exit ${check.exitCode} (${check.stdout.trim()})`);

  if (check.exitCode !== 0) {
    console.log("agent check failed; skipping preview provisioning.");
    return {
      check: { exitCode: check.exitCode, stdout: check.stdout, receiptId: check.receipt?.id },
      provisioned: false,
      createdResources: 0,
      receiptCount: 0
    };
  }

  // Step 2: the check passed, so provision a preview environment across mock providers: a database
  // branch, a web edge, and a smoke job that the preview runs.
  const plan: PreviewPlan = {
    name: previewName,
    allowMockProviders: true,
    labels: { example: "agent-preview-environment" },
    databases: [{ capsule: receiptCapsule(mockNeon()), spec: { project: "acme-app", name: previewName } }],
    edges: [{ capsule: receiptCapsule(mockVercel()), spec: { name: "web", source: workerSource } }],
    jobs: [{ capsule: receiptCapsule(mockCloudRun()), spec: { name: "smoke", image: "us-docker.pkg.dev/cloudrun/container/hello", command: "echo ok" } }]
  };
  let graph: Awaited<ReturnType<typeof createPreviewGraph>>;
  try {
    graph = await createPreviewGraph(plan);
  } catch (error) {
    // createPreviewGraph does not clean up on failure. The error carries the resources created before
    // the failure, bound to their own Capsules, plus a cleanup plan for exactly those resources.
    if (error instanceof PreviewCreationError) {
      const partial = await cleanupPreviewEnvironment(error.preview, error.resources, { cleanupPlan: error.cleanupPlan });
      console.log(`preview creation failed; partial cleanup ${partial.status}, cleaned ${partial.cleaned.length}, failed ${partial.failed.length}`);
    }
    throw error;
  }
  console.log(`preview ${graph.preview.id}: ${graph.resources.length} resources, ${graph.preview.urls.length} urls`);

  // Step 3: tear the preview down and keep the cleanup receipts.
  const cleanup = await cleanupPreviewEnvironment(graph.preview, graph.resources);
  console.log(`cleanup ${cleanup.previewId}: ${cleanup.status}, cleaned ${cleanup.cleaned.length}, failed ${cleanup.failed.length}`);

  return {
    check: { exitCode: check.exitCode, stdout: check.stdout, receiptId: check.receipt?.id },
    provisioned: true,
    previewId: graph.preview.id,
    createdResources: graph.resources.length,
    cleanupStatus: cleanup.status,
    cleanedResources: cleanup.cleaned.length,
    receiptCount: graph.receipts.length + cleanup.receipts.length + (check.receipt ? 1 : 0)
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await run();
}
