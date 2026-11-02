import { describe, expect, test } from "vitest";
import { fixtureWorld, readFixture, type ScenarioState, type TestConnection } from "./harness.test.support.js";
import { checkWorkerMessage } from "./outbound.js";
import { fixtureProfile } from "./profiles.js";

// Attach (Fabric's "Reconciliation (M4)") on the fixture provider, past what the shared scenarios
// pin: a create whose answer died with its worker is found by the next worker and never made again,
// a cleanup of it needs its own fresh destroy grant, and a shutdown answers open attaches truthfully.

const hello = readFixture<{ message: Record<string, unknown> }>("cases/hello_valid.json").message;
const base = readFixture<{ provider_state: ScenarioState }>("scenarios/create_exec_destroy.json").provider_state;
const scope = { job: "01K8W3A00000000000000000J1", task: "01K8W3A00000000000000000T1", attempt: "01K8W3A00000000000000000A1", generation: "1" };
const lost = { id: "01K8W3A0000000000000000P40", key: "key-lost-1" };
const sandbox = (nativeId: string) => ({ provider: "fixture", scope: { account: "acct-a", project: "proj-1" }, kind: "sandbox", native_id: nativeId });

const attach = (n: number, operationId: string, key: string, waitMs = 1000) => ({
  type: "attach",
  request_id: `r-${n}`,
  operation_id: operationId,
  key,
  scope,
  action: "sandbox.create",
  wait_ms: waitMs
});

const destroy = (n: number, approval: { ref: string } | null) => ({
  type: "request",
  request_id: `r-${n}`,
  operation: { id: `01K8W3A0000000000000000P${40 + n}`, key: `key-cleanup-${n}`, digest: "4".repeat(64) },
  scope,
  action: "sandbox.destroy",
  target: sandbox("fx-key-lost-1"),
  params: {},
  approval,
  deadline_ms: 30_000
});

async function handshake(connection: TestConnection): Promise<void> {
  connection.send(hello);
  expect((await connection.next()).type).toBe("hello_ack");
}

describe("attach on the fixture provider", () => {
  test("a create whose answer died with its worker is attached by the next one, not created again; its cleanup needs a fresh destroy grant", async () => {
    const world = fixtureWorld({
      ...base,
      approvals: [
        { ref: "apr-cleanup-lost", action: "sandbox.destroy", native_id: "fx-key-lost-1", expired: false },
        { ref: "apr-create-only", action: "sandbox.create", native_id: null, expired: false }
      ]
    });
    const first = world.connect();
    await handshake(first);
    first.send({
      type: "request",
      request_id: "r-1",
      operation: { id: lost.id, key: lost.key, digest: "1".repeat(64) },
      scope,
      action: "sandbox.create",
      params: { image: "fixture/ok", env: {}, secret_names: [], labels: {} },
      approval: null,
      deadline_ms: 30_000
    });
    // The worker dies with the create in flight: the provider applies it and Fabric never reads an answer.
    first.session.kill();
    expect(await first.drain()).toEqual([]);
    expect(world.provider.effects).toEqual([{ call: "create", native_id: "fx-key-lost-1", operation: lost.id }]);

    const second = world.connect();
    await handshake(second);
    second.send(attach(2, lost.id, lost.key));
    const attached = await second.next();
    expect(checkWorkerMessage(attached, { profile: fixtureProfile })).toBeUndefined();
    expect(attached).toEqual({
      type: "result",
      request_id: "r-2",
      operation_id: lost.id,
      state: "completed",
      resource: sandbox("fx-key-lost-1"),
      output: { status: "ready" },
      replayed: false,
      receipts: []
    });
    expect(world.provider.providerCalls).toBe(1);

    // Cleanup is an ordinary destroy: without a grant, or under the create's grant, it is refused before any effect.
    second.send(destroy(3, null));
    expect(await second.next()).toMatchObject({ type: "error", error: { code: "denied", reason: "approval_required", effect: "none" } });
    second.send(destroy(4, { ref: "apr-create-only" }));
    expect(await second.next()).toMatchObject({ type: "error", error: { code: "denied", reason: "approval_scope", effect: "none" } });
    expect(world.provider.providerCalls).toBe(1);
    expect(world.provider.sandbox("fx-key-lost-1")?.status).toBe("ready");

    second.send(destroy(5, { ref: "apr-cleanup-lost" }));
    expect(await second.next()).toMatchObject({ type: "result", state: "completed", output: { status: "destroyed" } });
    expect(world.provider.effects.map((effect) => effect.call)).toEqual(["create", "destroy"]);
  });

  test("a cancel of an attach is unsupported; a shutdown answers an open attach pending with the locator when it found one, else absent with the looks made", async () => {
    const world = fixtureWorld({
      ...base,
      sandboxes: [{ native_id: "fx-key-attach-9", project: "proj-1", owner_job: scope.job, operation: "01K8W3A0000000000000000P49", status: "starting" }]
    });
    const connection = world.connect();
    await handshake(connection);
    connection.send(
      attach(1, "01K8W3A0000000000000000P49", "key-attach-9", 30_000),
      attach(2, "01K8W3A0000000000000000P48", "key-attach-8", 30_000),
      { type: "cancel", request_id: "r-3", cancels: "r-1", operation_id: "01K8W3A0000000000000000P49" },
      { type: "shutdown", request_id: "r-99", drain_ms: 1500 }
    );
    expect(await connection.next()).toEqual({ type: "cancel_ack", request_id: "r-3", cancels: "r-1", state: "unsupported" });
    // The two attaches end in either order; the ack comes last.
    const answers = [await connection.next(), await connection.next(), await connection.next()];
    for (const answer of answers) expect(checkWorkerMessage(answer, { profile: fixtureProfile })).toBeUndefined();
    const ack = answers.pop()!;
    answers.sort((left, right) => String(left.request_id).localeCompare(String(right.request_id)));
    (ack.unresolved as Array<{ request_id: string }>).sort((left, right) => left.request_id.localeCompare(right.request_id));
    answers.push(ack);
    const searched = { provider: "fixture", scope: { account: "acct-a", project: "proj-1" }, kind: "sandbox" };
    expect(answers).toEqual([
      {
        type: "error",
        request_id: "r-1",
        operation_id: "01K8W3A0000000000000000P49",
        error: {
          code: "pending",
          reason: "shutting_down",
          message: expect.any(String),
          effect: "pending",
          resource: sandbox("fx-key-attach-9"),
          state: "starting",
          observations: 2,
          deadline_ms: 30_000
        }
      },
      {
        type: "error",
        request_id: "r-2",
        operation_id: "01K8W3A0000000000000000P48",
        error: { code: "unknown", reason: "absent", message: expect.any(String), effect: "unknown", observations: 2, deadline_ms: 30_000, searched }
      },
      {
        type: "shutdown_ack",
        request_id: "r-99",
        unresolved: [
          { request_id: "r-1", operation_id: "01K8W3A0000000000000000P49", state: "pending", resource: sandbox("fx-key-attach-9") },
          { request_id: "r-2", operation_id: "01K8W3A0000000000000000P48", state: "unknown" }
        ]
      }
    ]);
    expect(world.provider.providerCalls).toBe(0);
    expect(connection.exitCode).toBe(0);
  });
});
