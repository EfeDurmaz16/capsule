#!/usr/bin/env node
import { parseArgs } from "node:util";
import { ConfigError } from "./config.js";
import { buildDriver, runStdioWorker } from "./stdio.js";
import { globalTracer } from "./trace.js";
import { PROTOCOL_VERSION, WORKER_ID } from "./wire.js";

const usage = `Usage: capsule-bridge-worker --profile <fixture|docker> [--config <file.json>] [--receipts <file.jsonl>] [--engine <name>]

Capsule provider worker for the Fabric bridge protocol v${PROTOCOL_VERSION}. Fabric spawns it and speaks
length-prefixed JSON frames on stdin and stdout. Stdout carries frames only; diagnostics go to stderr.

  --profile   capability profile to serve: fixture (deterministic in-memory provider) or docker (local engine)
  --config    worker config: binding, policy, approvals; for fixture also sandboxes and script
  --receipts  docker only: append receipts to this JSONL file and list them in results
  --engine    docker only: the docker context every command goes to, when the config has no binding
              (default: the CLI's current context, read once)

Tracing: start the worker with an OpenTelemetry SDK registered (node --import ./otel.mjs) and every
request gets a span linked to its Fabric operation; TRACEPARENT links them to the spawning session.
`;

let values;
try {
  ({ values } = parseArgs({
    options: {
      profile: { type: "string" },
      config: { type: "string" },
      receipts: { type: "string" },
      engine: { type: "string" },
      help: { type: "boolean" },
      version: { type: "boolean" }
    },
    strict: true,
    allowPositionals: false
  }));
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n${usage}`);
  process.exit(2);
}

if (values.help) {
  process.stderr.write(usage);
  process.exit(0);
}
if (values.version) {
  process.stderr.write(`${WORKER_ID} bridge protocol ${PROTOCOL_VERSION}\n`);
  process.exit(0);
}
if (!values.profile) {
  process.stderr.write(`--profile is required\n${usage}`);
  process.exit(2);
}

try {
  const { driver, config } = buildDriver({
    profile: values.profile,
    ...(values.config ? { configPath: values.config } : {}),
    ...(values.receipts ? { receiptsPath: values.receipts } : {}),
    ...(values.engine ? { engine: values.engine } : {})
  });
  // Traces only when the process registered an OpenTelemetry SDK, for example with node --import.
  // No top-level await: the single executable build bundles this file as CommonJS.
  void globalTracer(WORKER_ID)
    .then((tracer) => runStdioWorker(driver, config, tracer ? { tracer, ...(process.env.TRACEPARENT ? { parent: process.env.TRACEPARENT } : {}) } : undefined))
    .catch((error: unknown) => {
      process.stderr.write(`capsule-bridge-worker: ${error instanceof Error ? error.message : String(error)}\n`);
      process.exit(2);
    });
} catch (error) {
  if (error instanceof ConfigError || error instanceof Error) {
    process.stderr.write(`capsule-bridge-worker: ${error.message}\n`);
    process.exit(2);
  }
  throw error;
}
