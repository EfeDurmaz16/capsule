import { readFileSync } from "node:fs";
import { JsonlReceiptStore } from "@capsule-sdk/store-jsonl";
import { ConfigError, parseWorkerConfig, type WorkerConfig } from "./config.js";
import { dockerDriver } from "./docker.js";
import type { BridgeDriver } from "./driver.js";
import { fixtureDriver, fixtureProviderFromConfig } from "./fixture.js";
import { profiles } from "./profiles.js";
import { WorkerSession } from "./session.js";

export interface StdioWorkerOptions {
  profile: string;
  /** Path of a JSON worker config (binding, policy, approvals, and for the fixture its seed). */
  configPath?: string;
  /** JSONL receipt file. Receipts written there are listed in results by digest and id. */
  receiptsPath?: string;
  /** Docker engine scope when no binding is configured. */
  engine?: string;
}

/** Builds the driver a worker process serves. Throws ConfigError before any frame is read. */
export function buildDriver(options: StdioWorkerOptions): { driver: BridgeDriver; config: WorkerConfig } {
  const profile = profiles[options.profile];
  if (!profile) throw new ConfigError(`unknown profile ${options.profile}; v1 profiles are ${Object.keys(profiles).join(", ")}`);
  let raw: unknown = {};
  if (options.configPath) {
    try {
      raw = JSON.parse(readFileSync(options.configPath, "utf8"));
    } catch (error) {
      throw new ConfigError(`cannot read config: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  const config = parseWorkerConfig(raw, profile);
  if (profile.profile === "fixture") {
    if (options.receiptsPath) throw new ConfigError("the fixture profile keeps receipts in memory; --receipts is for docker");
    return { driver: fixtureDriver(fixtureProviderFromConfig(config)), config };
  }
  const allowedSecrets = new Set(config.policy.secrets?.allowed ?? []);
  const binding = config.binding ?? (options.engine ? { engine: options.engine } : undefined);
  const driver = dockerDriver({
    ...(binding ? { binding: { engine: binding.engine! } } : {}),
    ...(options.receiptsPath ? { receipts: { store: new JsonlReceiptStore({ path: options.receiptsPath }), durable: true } } : {}),
    // Only secrets the worker's own policy names can be read from its environment.
    secret: (name) => (allowedSecrets.has(name) ? process.env[name] : undefined)
  });
  return { driver, config };
}

/**
 * Runs one worker session on this process's stdin and stdout. Stdout carries frames and nothing else;
 * diagnostics go to stderr, bounded. The process exits when the session ends: 0 after a shutdown or
 * end of input, 2 after a framing error or a refused hello.
 */
export function runStdioWorker(driver: BridgeDriver, config: WorkerConfig): WorkerSession {
  const stdin = process.stdin;
  const stdout = process.stdout;
  let exiting = false;
  const session = new WorkerSession({
    driver,
    config,
    io: {
      write: (frame) => {
        stdout.write(frame);
      },
      close: () => undefined,
      exit: (code) => {
        if (exiting) return;
        exiting = true;
        stdin.pause();
        stdout.end(() => process.exit(code));
        // If the reader of stdout has gone away, the flush never completes; exit anyway.
        setTimeout(() => process.exit(code), 5_000).unref();
      },
      stopInput: () => {
        stdin.pause();
        stdin.removeAllListeners("data");
      },
      stderr: (text) => {
        process.stderr.write(text);
      }
    }
  });
  stdin.on("data", (chunk: Buffer) => session.push(chunk));
  stdin.on("end", () => session.end());
  stdin.on("error", () => session.end());
  // A signal is a shutdown with a 5 s drain and no acknowledgement. Provider work is not cancelled.
  const onSignal = () => session.terminate(5_000);
  process.once("SIGTERM", onSignal);
  process.once("SIGINT", onSignal);
  return session;
}
