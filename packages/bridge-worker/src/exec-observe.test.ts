import { describe, expect, test } from "vitest";
import { parseWorkerConfig } from "./config.js";
import { ExecLedger, type Answer } from "./dispatch.js";
import type { BridgeDriver } from "./driver.js";
import { FixtureProvider, fixtureDriver } from "./fixture.js";
import { readFixture, TestConnection, type ScenarioState } from "./harness.test.support.js";
import { checkWorkerMessage } from "./outbound.js";
import { fixtureProfile } from "./profiles.js";

// Observe of an exec: the worker's ledger reports how an exec it sent ended, after an answer of
// `running` or one that never reached Fabric, and never runs the command again.

const hello = readFixture<{ message: Record<string, unknown> }>("cases/hello_valid.json").message;
const execRequest = readFixture<{ message: Record<string, unknown> }>("cases/request_exec_valid.json").message;
const base = readFixture<{ provider_state: ScenarioState }>("scenarios/create_exec_destroy.json").provider_state;
const job = "01K8W3A00000000000000000J1";
const owned = { native_id: "fx-key-create-1", project: "proj-1", owner_job: job, operation: "01K8W3A00000000000000000P1", status: "ready" };
const other = { native_id: "fx-key-other-1", project: "proj-1", owner_job: job, operation: "01K8W3A00000000000000000P9", status: "ready" };
const locator = (nativeId: string) => ({ provider: "fixture", scope: { account: "acct-a", project: "proj-1" }, kind: "sandbox", native_id: nativeId });

function world(script: unknown[] = []) {
  const provider = new FixtureProvider(base.binding, { sandboxes: [owned, other], script });
  const driver: BridgeDriver = fixtureDriver(provider);
  const config = parseWorkerConfig({ binding: base.binding, policy: base.policy, approvals: base.approvals }, fixtureProfile);
  const connect = async () => {
    const connection = new TestConnection(driver, config);
    connection.send(hello);
    expect(await connection.next()).toMatchObject({ type: "hello_ack" });
    return connection;
  };
  return { provider, driver, connect };
}

const exec = (argv: string[]) => ({ ...execRequest, params: { ...(execRequest.params as object), argv } });
const scopeOf = (jobId: string) => ({ job: jobId, task: "01K8W3A00000000000000000T1", attempt: "01K8W3A00000000000000000A1", generation: "1" });
const observe = (requestId: string, nativeId = "fx-key-create-1", waitMs = 3000, jobId = job) => ({
  type: "observe",
  request_id: requestId,
  operation_id: "01K8W3A00000000000000000P2",
  scope: scopeOf(jobId),
  action: "sandbox.exec",
  resource: locator(nativeId),
  wait_ms: waitMs
});

async function answer(connection: TestConnection, driver: BridgeDriver): Promise<Record<string, unknown>> {
  const message = await connection.next();
  expect(checkWorkerMessage(message, { profile: driver.profile, helloLimits: hello.limits as never })).toBeUndefined();
  return message;
}

const settledOutput = {
  exit_code: 0,
  stdout: { text: "settled\n", captured_bytes: 8, truncated: false, lossy: false },
  stderr: { text: "", captured_bytes: 0, truncated: false, lossy: false }
};

describe("exec observe on the fixture provider", () => {
  test("an exec the provider runs on answers running, observe waits it out as pending, then reports its output", async () => {
    const { provider, driver, connect } = world([{ action: "sandbox.exec", native_id: "fx-key-create-1", behavior: "run_until_settle" }]);
    const connection = await connect();
    connection.send(exec(["echo", "settled"]));
    expect(await answer(connection, driver)).toEqual({
      type: "result",
      request_id: "r-2",
      operation_id: "01K8W3A00000000000000000P2",
      state: "running",
      resource: locator("fx-key-create-1"),
      output: {
        exit_code: null,
        stdout: { text: "", captured_bytes: 0, truncated: false, lossy: false },
        stderr: { text: "", captured_bytes: 0, truncated: false, lossy: false }
      },
      replayed: false,
      receipts: []
    });
    connection.send(observe("r-3"));
    expect(await answer(connection, driver)).toMatchObject({
      type: "error",
      request_id: "r-3",
      error: {
        code: "pending",
        reason: "observation_deadline",
        effect: "pending",
        resource: locator("fx-key-create-1"),
        state: "running",
        observations: 3,
        deadline_ms: 3000
      }
    });
    provider.settle();
    connection.send(observe("r-4"));
    expect(await answer(connection, driver)).toEqual({
      type: "result",
      request_id: "r-4",
      operation_id: "01K8W3A00000000000000000P2",
      state: "completed",
      resource: locator("fx-key-create-1"),
      output: settledOutput,
      replayed: false,
      receipts: []
    });
    expect(provider.effects).toEqual([{ call: "exec", native_id: "fx-key-create-1", operation: "01K8W3A00000000000000000P2" }]);
  });

  test("an exec answered completed is reported again by observe, for an answer Fabric never read", async () => {
    const { provider, driver, connect } = world();
    const connection = await connect();
    connection.send(exec(["echo", "settled"]));
    expect(await answer(connection, driver)).toMatchObject({ type: "result", state: "completed", output: settledOutput });
    connection.send(observe("r-3"));
    expect(await answer(connection, driver)).toMatchObject({ type: "result", request_id: "r-3", state: "completed", output: settledOutput, replayed: false });
    expect(provider.providerCalls).toBe(1);
  });

  test("an exec a lost worker ran is unknown to the next worker, which never runs it again", async () => {
    const { provider, driver, connect } = world([{ action: "sandbox.exec", native_id: "fx-key-create-1", behavior: "run_until_settle" }]);
    const first = await connect();
    first.send(exec(["echo", "settled"]));
    expect(await answer(first, driver)).toMatchObject({ type: "result", state: "running" });
    first.session.kill();
    const second = await connect();
    second.send(observe("r-3"));
    expect(await answer(second, driver)).toMatchObject({
      type: "error",
      request_id: "r-3",
      error: { code: "unknown", reason: "observation_failed", effect: "unknown", resource: locator("fx-key-create-1") }
    });
    provider.settle();
    second.send(observe("r-4"));
    expect(await answer(second, driver)).toMatchObject({ type: "error", error: { code: "unknown", reason: "observation_failed" } });
    expect(provider.providerCalls).toBe(1);
  });

  test("an exec observe that names another sandbox or another job is refused and reports nothing about the exec", async () => {
    const { driver, connect } = world([{ action: "sandbox.exec", native_id: "fx-key-create-1", behavior: "run_until_settle" }]);
    const connection = await connect();
    connection.send(exec(["echo", "settled"]));
    expect(await answer(connection, driver)).toMatchObject({ type: "result", state: "running" });
    connection.send(observe("r-3", "fx-key-other-1"));
    expect(await answer(connection, driver)).toMatchObject({ type: "error", error: { code: "denied", reason: "owner_mismatch", effect: "none" } });
    connection.send(observe("r-4", "fx-key-create-1", 3000, "01K8W3A00000000000000000J2"));
    const refused = await answer(connection, driver);
    expect(refused).toMatchObject({ type: "error", error: { code: "denied", reason: "owner_mismatch", effect: "none" } });
    expect(refused.error).not.toHaveProperty("state");
  });

  test("an exec answered running holds its in-flight slot until it ends", async () => {
    const { provider, driver } = world([{ action: "sandbox.exec", native_id: "fx-key-create-1", behavior: "run_until_settle" }]);
    const connection = new TestConnection(driver, parseWorkerConfig({ binding: base.binding, policy: base.policy, approvals: base.approvals }, fixtureProfile));
    connection.send({ ...hello, limits: { ...(hello.limits as object), max_in_flight: 1 } });
    expect(await connection.next()).toMatchObject({ type: "hello_ack", limits: { max_in_flight: 1 } });
    connection.send(exec(["echo", "settled"]));
    expect(await answer(connection, driver)).toMatchObject({ type: "result", state: "running" });
    connection.send(observe("r-3"));
    expect(await answer(connection, driver)).toMatchObject({ type: "error", error: { code: "unavailable", reason: "busy", effect: "none" } });
    provider.settle();
    await connection.drain();
    connection.send(observe("r-4"));
    expect(await answer(connection, driver)).toMatchObject({ type: "result", state: "completed", output: settledOutput });
  });
});

describe("exec ledger bounds", () => {
  const ended = (text: string): Answer => ({
    type: "result",
    request_id: "r-1",
    operation_id: "01K8W3A00000000000000000P1",
    state: "completed",
    resource: locator("fx-a"),
    output: {
      exit_code: 0,
      stdout: { text, captured_bytes: text.length, truncated: false, lossy: false },
      stderr: { text: "", captured_bytes: 0, truncated: false, lossy: false }
    },
    replayed: false,
    receipts: []
  });

  test("past its record count the oldest ended record is dropped, never one in progress", () => {
    const ledger = new ExecLedger(2, 1 << 20);
    const running = ledger.begin("op-running", "fx-a", "job");
    const first = ledger.begin("op-1", "fx-a", "job");
    ledger.finish("op-1", first, ended("one"));
    const second = ledger.begin("op-2", "fx-a", "job");
    ledger.finish("op-2", second, ended("two"));
    expect(ledger.get("op-running")).toBe(running);
    expect(ledger.get("op-1")).toBeUndefined();
    expect(ledger.get("op-2")?.done).toBeDefined();
    expect(ledger.size).toBe(2);
  });

  test("an operation id that runs again is a record in progress, which eviction never drops", () => {
    const ledger = new ExecLedger(1, 1 << 20);
    const first = ledger.begin("op-1", "fx-a", "job");
    ledger.finish("op-1", first, ended("one"));
    const again = ledger.begin("op-1", "fx-a", "job");
    const other = ledger.begin("op-2", "fx-a", "job");
    ledger.finish("op-2", other, ended("two"));
    // Over the count of 1, only an ended record can go: op-2, not the op-1 that runs again.
    expect(ledger.get("op-1")).toBe(again);
    expect(ledger.get("op-1")?.done).toBeUndefined();
    expect(ledger.get("op-2")).toBeUndefined();
    expect(ledger.heldChars).toBe(0);
  });

  test("past its text budget the oldest ended records are dropped whole", () => {
    const ledger = new ExecLedger(100, 256 * 2 + 10);
    for (const [index, text] of ["a".repeat(5), "b".repeat(5), "c".repeat(5)].entries()) {
      const record = ledger.begin(`op-${index}`, "fx-a", "job");
      ledger.finish(`op-${index}`, record, ended(text));
    }
    expect(ledger.get("op-0")).toBeUndefined();
    expect(ledger.get("op-1")?.done).toBeDefined();
    expect(ledger.get("op-2")?.done).toBeDefined();
    expect(ledger.heldChars).toBeLessThanOrEqual(256 * 2 + 10);
  });
});
