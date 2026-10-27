import { describe, expect, test } from "vitest";
import { IdempotencyTable, type Answer } from "./dispatch.js";
import type { BridgeDriver } from "./driver.js";
import { fixtureDriver } from "./fixture.js";
import { fixtureWorld, readFixture, TestConnection, type ScenarioState } from "./harness.test.support.js";
import { checkWorkerMessage } from "./outbound.js";
import { fixtureProfile } from "./profiles.js";

// Session behavior beyond the shared scenarios: admission limits, request ids, cancel states, drains
// on shutdown, end of input and signals, and that refusals never reach the provider.

const hello = readFixture<{ message: Record<string, unknown> }>("cases/hello_valid.json").message;
const createRequest = readFixture<{ message: Record<string, unknown> }>("cases/request_create_valid.json").message;
const execRequest = readFixture<{ message: Record<string, unknown> }>("cases/request_exec_valid.json").message;
const destroyRequest = readFixture<{ message: Record<string, unknown> }>("cases/request_destroy_valid.json").message;
const base = readFixture<{ provider_state: ScenarioState }>("scenarios/create_exec_destroy.json").provider_state;
const owned = { native_id: "fx-key-create-1", project: "proj-1", owner_job: "01K8W3A00000000000000000J1", status: "ready" };
const longExec = { action: "sandbox.exec", native_id: "fx-key-create-1", behavior: "run_until_cancelled" };

function exec(n: number, overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    ...execRequest,
    request_id: `r-${n}`,
    operation: { id: `01K8W3A0000000000000000E${String(n).padStart(2, "0")}`, key: `key-exec-${n}`, digest: "ab".repeat(32) },
    ...overrides
  };
}

async function started(state: Partial<ScenarioState> = {}) {
  const world = fixtureWorld({ ...base, sandboxes: [owned], script: [], ...state });
  const connection = world.connect();
  connection.send(hello);
  await connection.next();
  return { world, connection };
}

describe("admission", () => {
  test("a request beyond the negotiated in-flight cap is busy and reaches no provider", async () => {
    const { world, connection } = await started({ script: [longExec] });
    connection.send(exec(1), exec(2), exec(3), exec(4), exec(5));
    const answers = await connection.drain();
    expect(answers.filter((answer) => answer.type === "progress")).toHaveLength(4);
    expect(answers.find((answer) => answer.type === "error")).toMatchObject({
      request_id: "r-5",
      error: { code: "unavailable", reason: "busy", effect: "none" }
    });
    expect(world.provider.effects).toHaveLength(4);
  });

  test("a repeated request_id is refused, and so is a request whose request_id cannot correlate", async () => {
    const { world, connection } = await started({ sandboxes: [] });
    connection.send(createRequest);
    expect((await connection.next()).type).toBe("result");
    connection.send({ ...createRequest, operation: { ...(createRequest.operation as object), key: "key-create-2" } });
    expect(await connection.next()).toMatchObject({ type: "error", request_id: "r-1", error: { code: "invalid", reason: "duplicate_request_id" } });
    connection.send({ ...createRequest, request_id: "has space" });
    expect(await connection.next()).toMatchObject({ type: "protocol_error", code: "malformed" });
    expect(connection.exitCode).toBe(2);
    expect(world.provider.providerCalls).toBe(1);
  });

  test("request labels cannot claim the worker's fabric. labels", async () => {
    const { world, connection } = await started({ sandboxes: [] });
    connection.send({ ...createRequest, params: { ...(createRequest.params as object), labels: { "fabric.job": "01K8W3A00000000000000000J9" } } });
    expect(await connection.next()).toMatchObject({ type: "result", state: "completed" });
    expect(world.provider.sandbox("fx-key-create-1")?.owner_job).toBe("01K8W3A00000000000000000J1");
  });

  test("a same-key request while the first is in flight is an idempotency conflict", async () => {
    const { world, connection } = await started({ script: [longExec] });
    connection.send(exec(1), exec(2, { operation: { id: "01K8W3A0000000000000000E01", key: "key-exec-1", digest: "ab".repeat(32) } }));
    const answers = await connection.drain();
    expect(answers).toContainEqual(
      expect.objectContaining({ request_id: "r-2", error: expect.objectContaining({ code: "invalid", reason: "idempotency_conflict" }) })
    );
    expect(world.provider.effects).toHaveLength(1);
  });

  test("a grant for another sandbox is out of scope, and no effect happens", async () => {
    const { world, connection } = await started({
      approvals: [{ ref: "apr-other", action: "sandbox.destroy", native_id: "fx-other", expired: false }]
    });
    connection.send({ ...destroyRequest, approval: { ref: "apr-other" } });
    expect(await connection.next()).toMatchObject({ error: { code: "denied", reason: "approval_scope", effect: "none" } });
    expect(world.provider.effects).toEqual([]);
  });

  test("an unknown approval ref is no approval", async () => {
    const { world, connection } = await started();
    connection.send({ ...destroyRequest, approval: { ref: "apr-nobody" } });
    expect(await connection.next()).toMatchObject({ error: { code: "denied", reason: "approval_required", effect: "none" } });
    expect(world.provider.effects).toEqual([]);
  });

  test("a target that does not exist is a definite not_found with no effect", async () => {
    const { world, connection } = await started({ sandboxes: [] });
    connection.send(execRequest);
    expect(await connection.next()).toMatchObject({ error: { code: "provider_failed", reason: "not_found", effect: "none" } });
    expect(world.provider.effects).toEqual([]);
  });

  test("a destroyed sandbox is gone: exec and a second destroy are not_found with no effect, as on Docker", async () => {
    const { world, connection } = await started();
    connection.send(destroyRequest);
    expect(await connection.next()).toMatchObject({ type: "result", state: "completed", output: { status: "destroyed" } });
    connection.send(exec(1, { params: { ...(execRequest.params as object), argv: ["echo", "ran-in-destroyed-sandbox"] } }));
    expect(await connection.next()).toMatchObject({ type: "error", error: { code: "provider_failed", reason: "not_found", effect: "none" } });
    connection.send({ ...destroyRequest, request_id: "r-4", operation: { id: "01K8W3A00000000000000000P4", key: "key-destroy-9", digest: "ab".repeat(32) } });
    expect(await connection.next()).toMatchObject({ type: "error", error: { code: "provider_failed", reason: "not_found", effect: "none" } });
    expect(world.provider.effects).toEqual([{ call: "destroy", native_id: "fx-key-create-1" }]);
  });

  test("a sandbox that is stopping refuses exec at the provider and reports no output", async () => {
    const { world, connection } = await started({
      script: [{ action: "sandbox.destroy", native_id: "fx-key-create-1", behavior: "stay_stopping_until_settle" }]
    });
    connection.send({ ...destroyRequest, deadline_ms: 1000 });
    expect(await connection.next()).toMatchObject({ error: { code: "pending", state: "stopping" } });
    connection.send(exec(1));
    expect(await connection.next()).toMatchObject({ type: "error", error: { code: "provider_failed", reason: "provider_refused", effect: "none" } });
    expect(world.provider.sandbox("fx-key-create-1")?.status).toBe("stopping");
  });
});

describe("dedupe", () => {
  test("a create whose key finds another job's resource claims nothing", async () => {
    const { world, connection } = await started({ sandboxes: [{ ...owned, owner_job: "01K8W3A00000000000000000J9" }] });
    connection.send(createRequest);
    expect(await connection.next()).toMatchObject({ error: { code: "denied", reason: "owner_mismatch", effect: "none" } });
    expect(world.provider.effects).toEqual([]);
  });

  test("a create whose key finds this job's resource replays it with no provider call", async () => {
    const { world, connection } = await started();
    connection.send(createRequest);
    expect(await connection.next()).toMatchObject({ type: "result", state: "completed", replayed: true, resource: { native_id: "fx-key-create-1" } });
    expect(world.provider.effects).toEqual([]);
  });
});

describe("cancel", () => {
  test("cancel of an answered request is already_answered; of an unknown one not_found", async () => {
    const { connection } = await started();
    connection.send(execRequest);
    expect(await connection.next()).toMatchObject({ type: "result", request_id: "r-2" });
    connection.send({ type: "cancel", request_id: "r-9", cancels: "r-2", operation_id: "01K8W3A00000000000000000P2" });
    expect(await connection.next()).toEqual({ type: "cancel_ack", request_id: "r-9", cancels: "r-2", state: "already_answered" });
  });

  test("cancel of a terminal-only destroy is unsupported and the destroy still answers", async () => {
    const { connection } = await started({ script: [{ action: "sandbox.destroy", native_id: "fx-key-create-1", behavior: "stay_stopping_until_settle" }] });
    connection.send(
      { ...destroyRequest, deadline_ms: 600_000 },
      { type: "cancel", request_id: "r-9", cancels: "r-3", operation_id: "01K8W3A00000000000000000P3" }
    );
    const answers = await connection.drain(2000);
    expect(answers[0]).toEqual({ type: "cancel_ack", request_id: "r-9", cancels: "r-3", state: "unsupported" });
    expect(answers[1]).toMatchObject({ type: "error", request_id: "r-3", error: { code: "pending", observations: 600 } });
  });
});

describe("shutdown, end of input and signals", () => {
  test("after shutdown new work is refused as shutting_down", async () => {
    const { world, connection } = await started({ script: [longExec] });
    connection.send(exec(1), { type: "shutdown", request_id: "r-99", drain_ms: 1000 }, { ...createRequest, request_id: "r-50" });
    const answers = await connection.drain();
    expect(answers.map((answer) => answer.type)).toEqual(["error", "progress", "error", "shutdown_ack"]);
    expect(answers[0]).toMatchObject({ request_id: "r-50", error: { code: "unavailable", reason: "shutting_down", effect: "none" } });
    expect(answers[2]).toMatchObject({ request_id: "r-1", error: { code: "pending", reason: "shutting_down", state: "running" } });
    expect(answers[3]).toMatchObject({ type: "shutdown_ack", request_id: "r-99", unresolved: [{ request_id: "r-1", state: "pending" }] });
    expect(connection.exitCode).toBe(0);
    expect(world.provider.cancels).toEqual([]);
  });

  test("a cancel during the drain is still handled and the cancelled request is not unresolved", async () => {
    const { world, connection } = await started({ script: [longExec] });
    connection.send(exec(1));
    expect((await connection.next()).type).toBe("progress");
    connection.send(
      { type: "shutdown", request_id: "r-99", drain_ms: 30_000 },
      { type: "cancel", request_id: "r-98", cancels: "r-1", operation_id: "01K8W3A0000000000000000E01" }
    );
    const answers = await connection.drain();
    expect(answers[0]).toEqual({ type: "cancel_ack", request_id: "r-98", cancels: "r-1", state: "requested" });
    expect(answers[1]).toMatchObject({ type: "result", request_id: "r-1", state: "cancelled" });
    expect(answers[2]).toEqual({ type: "shutdown_ack", request_id: "r-99", unresolved: [] });
    expect(world.provider.cancels).toEqual(["fx-key-create-1"]);
  });

  test("end of input drains with 0 ms, cancels nothing and exits 0 without an ack", async () => {
    const { world, connection } = await started({ script: [longExec] });
    connection.send(exec(1));
    expect((await connection.next()).type).toBe("progress");
    connection.session.end();
    const answers = await connection.drain();
    expect(answers).toHaveLength(1);
    expect(answers[0]).toMatchObject({ type: "error", request_id: "r-1", error: { code: "pending", reason: "shutting_down", effect: "pending" } });
    expect(connection.exitCode).toBe(0);
    expect(world.provider.cancels).toEqual([]);
    expect(world.provider.sandbox("fx-key-create-1")?.status).toBe("ready");
  });

  test("a signal drains like a shutdown without an ack", async () => {
    const { connection } = await started();
    connection.session.terminate(5000);
    expect(await connection.drain()).toEqual([]);
    expect(connection.exitCode).toBe(0);
  });

  test("end of input before any hello exits 0 and writes nothing", async () => {
    const world = fixtureWorld({ ...base, sandboxes: [], script: [] });
    const connection = world.connect();
    connection.session.end();
    expect(await connection.drain()).toEqual([]);
    expect(connection.exitCode).toBe(0);
  });

  test("a second hello in session is unexpected", async () => {
    const { connection } = await started();
    connection.send(hello);
    expect(await connection.next()).toMatchObject({ type: "protocol_error", code: "unexpected" });
    expect(connection.exitCode).toBe(2);
  });
});

describe("evidence", () => {
  test("a receipt store that cannot take writes refuses the request before any effect", async () => {
    const world = fixtureWorld({ ...base, sandboxes: [], script: [] });
    const driver = fixtureDriver(world.provider);
    const broken: BridgeDriver = {
      ...driver,
      receipts: { store: { ready: () => Promise.reject(new Error("disk full")), write: () => undefined }, durable: true }
    };
    const connection = new TestConnection(broken, world.config);
    connection.send(hello);
    await connection.next();
    connection.send(createRequest);
    expect(await connection.next()).toMatchObject({ error: { code: "provider_failed", reason: "provider_refused", effect: "none" } });
    expect(world.provider.effects).toEqual([]);
  });
});

describe("outputs", () => {
  test("exec output is bounded while captured and reported as truncated", async () => {
    const { connection } = await started();
    connection.send(exec(1, { params: { ...(execRequest.params as object), argv: ["echo", "abcdefgh"], max_output_bytes: 4 } }));
    const answer = await connection.next();
    expect(answer).toMatchObject({
      type: "result",
      state: "completed",
      output: { exit_code: 0, stdout: { text: "abcd", captured_bytes: 4, truncated: true, lossy: false } }
    });
    expect(checkWorkerMessage(answer, { profile: fixtureProfile })).toBeUndefined();
  });

  test("a nonzero exit is a completed result and the sandbox stays", async () => {
    const { world, connection } = await started();
    connection.send(exec(1, { params: { ...(execRequest.params as object), argv: ["fail", "3", "boom"] } }));
    const answer = await connection.next();
    expect(answer).toMatchObject({ type: "result", state: "completed", output: { exit_code: 3, stderr: { text: "boom\n", captured_bytes: 5 } } });
    expect(world.provider.sandbox("fx-key-create-1")?.status).toBe("ready");
  });

  test("a create grant is accepted for create and receipts stay in the fixture store", async () => {
    const { world, connection } = await started({ sandboxes: [] });
    connection.send({ ...createRequest, approval: { ref: "apr-create-only" } });
    const answer = await connection.next();
    expect(answer).toMatchObject({ type: "result", state: "completed", receipts: [] });
    expect(world.provider.receipts.receipts.map((receipt) => receipt.type)).toEqual(["sandbox.create"]);
    expect(JSON.stringify(world.provider.receipts.receipts)).not.toContain("apr-create-only");
  });

  test("stderr diagnostics stay within the negotiated byte budget", async () => {
    const world = fixtureWorld({ ...base, sandboxes: [], script: [] });
    const connection = world.connect();
    connection.send({ ...hello, limits: { ...(hello.limits as object), max_stderr_bytes: 10 } });
    await connection.next();
    connection.send({ type: "shutdown", request_id: "r-1", drain_ms: 1 }, { type: "shutdown", request_id: "r-2", drain_ms: 1 });
    await connection.drain();
    expect(connection.stderr.join("").length).toBeLessThanOrEqual(10);
  });
});

describe("observe", () => {
  const locator = (nativeId: string) => ({ provider: "fixture", scope: { account: "acct-a", project: "proj-1" }, kind: "sandbox", native_id: nativeId });
  const observe = (requestId: string, operationId: string, action: string, nativeId: string) => ({
    type: "observe",
    request_id: requestId,
    operation_id: operationId,
    action,
    resource: locator(nativeId),
    wait_ms: 1000
  });

  test("an observe of a create answers only for the operation that made the resource", async () => {
    const { world, connection } = await started({ sandboxes: [] });
    connection.send(createRequest);
    expect(await connection.next()).toMatchObject({ type: "result", operation_id: "01K8W3A00000000000000000P1", state: "completed" });
    connection.send(observe("r-10", "01K8W3A00000000000000000P9", "sandbox.create", "fx-key-create-1"));
    expect(await connection.next()).toEqual({
      type: "error",
      request_id: "r-10",
      operation_id: "01K8W3A00000000000000000P9",
      error: { code: "denied", reason: "owner_mismatch", message: expect.any(String), effect: "none" }
    });
    connection.send(observe("r-11", "01K8W3A00000000000000000P1", "sandbox.create", "fx-key-create-1"));
    expect(await connection.next()).toMatchObject({ type: "result", request_id: "r-11", state: "completed", output: { status: "ready" } });
    expect(world.provider.effects).toHaveLength(1);
  });

  test("an observe of a create refuses a seeded sandbox labelled with another operation, and answers its own", async () => {
    const seeded = {
      native_id: "fx-other-job",
      project: "proj-1",
      owner_job: "01K8W3A00000000000000000J2",
      operation: "01K8W3A00000000000000000Q2",
      status: "ready"
    };
    const { connection } = await started({ sandboxes: [seeded] });
    connection.send(observe("r-10", "01K8W3A00000000000000000Q1", "sandbox.create", "fx-other-job"));
    expect(await connection.next()).toMatchObject({ type: "error", error: { code: "denied", reason: "owner_mismatch", effect: "none" } });
    connection.send(observe("r-11", "01K8W3A00000000000000000Q2", "sandbox.create", "fx-other-job"));
    expect(await connection.next()).toMatchObject({ type: "result", state: "completed" });
  });

  test("an observe of a destroy refuses a resource no Fabric job made, without reporting its state", async () => {
    const { connection } = await started({ sandboxes: [{ native_id: "fx-foreign", project: "proj-1", status: "ready" }] });
    connection.send(observe("r-10", "01K8W3A00000000000000000P3", "sandbox.destroy", "fx-foreign"));
    const answer = await connection.next();
    expect(answer).toMatchObject({ type: "error", error: { code: "denied", reason: "owner_mismatch", effect: "none" } });
    expect(answer.error).not.toHaveProperty("state");
  });
});

describe("idempotency memory", () => {
  const big = (n: number, chars: number): Answer => ({
    type: "result",
    request_id: `r-${n}`,
    operation_id: "01K8W3A00000000000000000P2",
    state: "completed",
    resource: { provider: "fixture", scope: { account: "acct-a", project: "proj-1" }, kind: "sandbox", native_id: "fx-key-create-1" },
    output: {
      exit_code: 0,
      stdout: { text: "x".repeat(chars), captured_bytes: chars, truncated: false, lossy: false },
      stderr: { text: "", captured_bytes: 0, truncated: false, lossy: false }
    },
    replayed: false,
    receipts: []
  });

  test("held answers stay within the output budget; older ones keep only their key and digest", () => {
    const table = new IdempotencyTable(4096, 4 << 20);
    for (let n = 0; n < 100; n += 1) {
      table.begin(`key-${n}`, "ab".repeat(32));
      table.finish(`key-${n}`, big(n, 1 << 20));
    }
    expect(table.heldChars).toBeLessThanOrEqual(4 << 20);
    expect(table.get("key-99")?.answer).toBeDefined();
    expect(table.get("key-0")).toMatchObject({ digest: "ab".repeat(32) });
    expect(table.get("key-0")?.answer).toBeUndefined();
  });

  test("a repeat of a key whose answer was dropped is refused as a conflict and never runs again", async () => {
    const { world, connection } = await started();
    const payload = "y".repeat(1_000_000);
    for (let n = 1; n <= 20; n += 1) {
      connection.send(exec(n, { params: { ...(execRequest.params as object), argv: ["echo", payload], max_output_bytes: 1 << 20 } }));
      expect(await connection.next()).toMatchObject({ type: "result", state: "completed" });
    }
    connection.send(
      exec(21, {
        operation: { id: "01K8W3A0000000000000000E01", key: "key-exec-1", digest: "ab".repeat(32) },
        params: { ...(execRequest.params as object), argv: ["echo", payload], max_output_bytes: 1 << 20 }
      })
    );
    expect(await connection.next()).toMatchObject({
      type: "error",
      request_id: "r-21",
      error: { code: "invalid", reason: "idempotency_conflict", effect: "none" }
    });
    connection.send(
      exec(22, {
        operation: { id: "01K8W3A0000000000000000E20", key: "key-exec-20", digest: "ab".repeat(32) },
        params: { ...(execRequest.params as object), argv: ["echo", payload], max_output_bytes: 1 << 20 }
      })
    );
    expect(await connection.next()).toMatchObject({ type: "result", request_id: "r-22", replayed: true });
    expect(world.provider.effects).toHaveLength(20);
  });
});
