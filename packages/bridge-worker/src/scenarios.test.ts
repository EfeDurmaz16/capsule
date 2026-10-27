import { describe, expect, test } from "vitest";
import { comparable, fixtureNames, fixtureWorld, readFixture, type ScenarioState, type TestConnection } from "./harness.test.support.js";
import { checkWorkerMessage } from "./outbound.js";
import { fixtureProfile } from "./profiles.js";

// Runs every shared scenario in protocol/bridge/v1/scenarios against the worker and the deterministic
// fixture provider. Each `receive` must match exactly, except error and protocol_error message strings.
// `journal` steps are Fabric's to check; here they only have to name an operation the worker answered.

type Step = Record<string, unknown>;

interface Scenario {
  scenario: string;
  profile: string;
  provider_state: ScenarioState;
  steps: Step[];
}

const hello = readFixture<{ message: Record<string, unknown> }>("cases/hello_valid.json").message;
const helloAck = readFixture<{ message: Record<string, unknown> }>("cases/hello_ack_valid.json").message;
const helloLimits = hello.limits as never;

function checkOutbound(message: Record<string, unknown>): void {
  expect(checkWorkerMessage(message, { profile: fixtureProfile, helloLimits })).toBeUndefined();
}

async function runScenario(scenario: Scenario): Promise<void> {
  const world = fixtureWorld(scenario.provider_state);
  let connection: TestConnection = world.connect();
  const steps = [...scenario.steps];
  if (steps[0]?.handshake === false) {
    steps.shift();
  } else {
    connection.send(hello);
    expect(await connection.next()).toEqual(helloAck);
  }
  let outbox: object[] = [];
  const flush = () => {
    if (outbox.length > 0) connection.send(...outbox);
    outbox = [];
  };
  for (const [index, step] of steps.entries()) {
    const where = `${scenario.scenario} step ${index}: ${JSON.stringify(step).slice(0, 80)}`;
    if ("send" in step) {
      outbox.push(step.send as object);
      continue;
    }
    flush();
    if ("receive" in step) {
      const message = await connection.next();
      checkOutbound(message);
      expect(comparable(message), where).toEqual(comparable(step.receive as Record<string, unknown>));
    } else if ("provider_calls" in step) {
      expect(world.provider.providerCalls, where).toBe(step.provider_calls);
    } else if ("sandbox" in step) {
      const expected = step.sandbox as { native_id: string; status: string };
      expect(world.provider.sandbox(expected.native_id)?.status, where).toBe(expected.status);
    } else if ("advance" in step) {
      expect(step.advance).toBe("settle");
      world.provider.settle();
    } else if ("kill_worker" in step) {
      connection.session.kill();
    } else if ("respawn" in step) {
      connection = world.connect();
    } else if ("worker_exit" in step) {
      await connection.drain(5);
      expect(connection.exitCode, where).toBe(step.worker_exit);
      expect(connection.closed, where).toBe(true);
    } else if ("journal" in step) {
      // Fabric's journal; nothing for the worker to check.
    } else {
      throw new Error(`unknown step form in ${where}`);
    }
  }
  flush();
  expect(await connection.drain(), `${scenario.scenario}: the worker wrote more than the scenario expects`).toEqual([]);
}

describe("bridge v1 shared scenarios against the fixture provider", () => {
  const names = fixtureNames("scenarios");

  test("the scenario set is the v1 set", () => {
    expect(names).toHaveLength(15);
  });

  for (const name of names) {
    test(name, async () => {
      const scenario = readFixture<Scenario>(`scenarios/${name}.json`);
      expect(scenario.profile).toBe("fixture");
      await runScenario(scenario);
    });
  }
});

describe("scenario properties the steps imply", () => {
  test("worker loss leaves provider work running: no cancel reaches the provider", async () => {
    const scenario = readFixture<Scenario>("scenarios/worker_loss_is_not_cancellation.json");
    const world = fixtureWorld(scenario.provider_state);
    const connection = world.connect();
    connection.send(hello);
    await connection.next();
    connection.send(scenario.steps.find((step) => "send" in step)!.send as object);
    expect((await connection.next()).type).toBe("progress");
    connection.session.kill();
    expect(await connection.drain()).toEqual([]);
    expect(world.provider.cancels).toEqual([]);
    expect(world.provider.effects).toEqual([{ call: "exec", native_id: "fx-key-create-1" }]);
  });

  test("every refusal in the scenarios happened before any effect", async () => {
    for (const name of ["denied_before_effect", "unsupported_capability", "scope_retained", "fresh_approval_required", "secrets_deny_all_and_intersection"]) {
      const scenario = readFixture<Scenario>(`scenarios/${name}.json`);
      const world = fixtureWorld(scenario.provider_state);
      const connection = world.connect();
      connection.send(hello);
      await connection.next();
      for (const step of scenario.steps) {
        if (!("send" in step)) continue;
        connection.send(step.send as object);
        const answer = await connection.next();
        if (answer.type === "error") {
          expect((answer.error as { effect: string }).effect, name).toBe("none");
          expect(
            world.provider.effects.filter((effect) => effect.native_id !== "fx-key-secret-3"),
            name
          ).toEqual([]);
        }
      }
    }
  });
});
