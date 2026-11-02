# Agent preview environment (end to end)

A credential-free example that chains an agent code-execution tool with preview orchestration. It uses `@capsule-sdk/mock` for every provider, so it calls no real provider API.

## The chain

1. **Agent check**: `@capsule-sdk/ai` `createCodeExecutionTool` runs a smoke check inside a Capsule sandbox (mock E2B) and returns stdout plus an execution receipt.
2. **Provision**: only if the check passes, `@capsule-sdk/preview` `createPreviewGraph` provisions a preview across three mock providers: a Neon-style database branch, a Vercel-style web edge, and a Cloud Run-style smoke job.
3. **Cleanup**: `cleanupPreviewEnvironment` tears the preview down in reverse create order and returns cleanup receipts.

This is the shape an agent uses to gate a preview on a passing check and to attempt cleanup afterward. Cleanup is not a guarantee: the edge and the job have no cleanup action, and a provider delete can fail and leave a `leaked` resource. Read the dispositions.

If `createPreviewGraph` throws part-way, it does not clean up by itself. The thrown `PreviewCreationError` carries `resources` (the resources created before the failure, each bound to its own Capsule), a `cleanupPlan` for exactly those resources, and their `receipts`. The example passes them to `cleanupPreviewEnvironment` before rethrowing. `createPreviewEnvironmentWithCleanup` is the variant that runs that cleanup for you.

## Run it

```bash
pnpm --filter @capsule-sdk/example-agent-preview-environment start
```

Expected output (ids are illustrative):

```
Example mode: mock agent preview environment. No real provider APIs are called.
agent check: exit 0 (mock:e2b: node /workspace/smoke.js)
preview preview_pr-101_...: 3 resources, 1 urls
cleanup preview_pr-101_...: unsupported, cleaned 1, failed 0
```

The database branch is deleted on cleanup. The edge deployment and the smoke job have no cleanup action by design, so they resolve to an `unsupported` disposition rather than a failure. `unsupported` cleanup status means only by-design-uncleanable resources were left behind, and it exits zero.

## What to take from it

- The agent's code-execution result gates provisioning. A failing check skips the preview entirely.
- Preview create and cleanup both emit receipts, so the whole run is auditable.
- Swap the mock adapters for real ones (E2B, Neon, Vercel, Cloud Run) and add credentials to run the same chain live. The orchestration does not change.
