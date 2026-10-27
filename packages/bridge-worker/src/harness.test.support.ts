import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { parseWorkerConfig, type WorkerConfig } from "./config.js";
import type { BridgeDriver } from "./driver.js";
import { FixtureProvider, fixtureDriver } from "./fixture.js";
import { decodeBody, encodeFrame, FrameReader } from "./frame.js";
import { fixtureProfile } from "./profiles.js";
import { WorkerSession } from "./session.js";
import { MAX_FRAME_BYTES } from "./wire.js";

// Test support shared by the bridge worker tests. The name holds ".test." so the build prunes its declarations, and vitest does not run it.

export const fixturesRoot = join(import.meta.dirname, "..", "..", "..", "protocol", "bridge", "v1");

export function readFixture<T = Record<string, unknown>>(path: string): T {
  return JSON.parse(readFileSync(join(fixturesRoot, path), "utf8")) as T;
}

export function fixtureNames(dir: string): string[] {
  return readdirSync(join(fixturesRoot, dir))
    .filter((name) => name.endsWith(".json"))
    .map((name) => name.slice(0, -".json".length))
    .sort();
}

export function frameOf(message: object): Buffer {
  return encodeFrame(message, MAX_FRAME_BYTES);
}

/** A worker session on in-memory streams, with the worker's frames decoded into a queue. */
export class TestConnection {
  readonly session: WorkerSession;
  readonly frames: Buffer[] = [];
  readonly stderr: string[] = [];
  private readonly received: Record<string, unknown>[] = [];
  private readonly reader = new FrameReader(() => MAX_FRAME_BYTES);
  inputStopped = false;
  closed = false;
  exitCode: number | undefined;

  constructor(driver: BridgeDriver, config: WorkerConfig) {
    this.session = new WorkerSession({
      driver,
      config,
      io: {
        write: (frame) => {
          if (this.closed) throw new Error("the worker wrote after closing its output");
          this.frames.push(frame);
          this.reader.push(frame);
          for (let body = this.reader.next(); body; body = this.reader.next()) this.received.push(decodeBody(body));
        },
        close: () => {
          this.closed = true;
        },
        exit: (code) => {
          this.exitCode = code;
        },
        stopInput: () => {
          this.inputStopped = true;
        },
        stderr: (text) => {
          this.stderr.push(text);
        }
      }
    });
  }

  /** Sends messages as one chunk, the way back-to-back frames arrive on a pipe. */
  send(...messages: object[]): void {
    this.session.push(Buffer.concat(messages.map((message) => frameOf(message))));
  }

  sendBytes(bytes: Uint8Array): void {
    this.session.push(bytes);
  }

  /** The next message the worker wrote, waiting a bounded number of event loop turns for it. */
  async next(): Promise<Record<string, unknown>> {
    for (let turn = 0; turn < 10_000; turn += 1) {
      const message = this.received.shift();
      if (message) return message;
      await new Promise((resolve) => setImmediate(resolve));
    }
    throw new Error("the worker wrote nothing");
  }

  /** Every message still queued after the worker has had time to settle. */
  async drain(turns = 50): Promise<Record<string, unknown>[]> {
    for (let turn = 0; turn < turns; turn += 1) await new Promise((resolve) => setImmediate(resolve));
    return this.received.splice(0);
  }
}

export interface ScenarioState {
  binding: { account: string; project: string };
  policy: unknown;
  approvals: unknown;
  sandboxes: unknown[];
  script: unknown[];
}

export function fixtureWorld(state: ScenarioState): { provider: FixtureProvider; config: WorkerConfig; connect: () => TestConnection } {
  const config = parseWorkerConfig({ binding: state.binding, policy: state.policy, approvals: state.approvals }, fixtureProfile);
  const provider = new FixtureProvider(state.binding, { sandboxes: state.sandboxes, script: state.script });
  return { provider, config, connect: () => new TestConnection(fixtureDriver(provider), config) };
}

/** Removes the fields scenario comparison ignores: error and protocol_error message strings. */
export function comparable(message: Record<string, unknown>): Record<string, unknown> {
  const copy = structuredClone(message);
  if (copy.type === "error" && typeof copy.error === "object" && copy.error !== null) delete (copy.error as Record<string, unknown>).message;
  if (copy.type === "protocol_error") delete copy.message;
  return copy;
}
