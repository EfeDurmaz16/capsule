import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { decodeBody, FrameError, FrameReader } from "./frame.js";
import { fixtureNames, fixturesRoot, fixtureWorld, readFixture, type ScenarioState } from "./harness.test.support.js";
import { checkWorkerMessage } from "./outbound.js";
import { dockerProfile, fixtureProfile } from "./profiles.js";
import { HelloRefusal, parseCancel, parseHello, parseObserve, parseRequest, parseShutdown, Refusal } from "./validate.js";
import { MAX_FRAME_BYTES, MAX_REQUEST_BYTES } from "./wire.js";

// The shared frame, case and profile fixtures, checked against this implementation. Fabric checks the
// same files against its own, so a disagreement fails one side until the protocol text is fixed.

interface FrameFixture {
  case: string;
  direction: "fabric_to_worker" | "worker_to_fabric";
  phase: "handshake" | "session";
  hex: string;
  expect: { outcome: "accept"; type: string } | { outcome: "reject"; code: string; read_body: boolean };
}

interface CaseFixture {
  case: string;
  direction: "fabric_to_worker" | "worker_to_fabric";
  phase: "handshake" | "session";
  expect: { outcome: "accept" } | { outcome: "reject"; code: string; reason: string };
  message: Record<string, unknown>;
}

const hello = readFixture<CaseFixture>("cases/hello_valid.json").message;
const helloAckHex = readFixture<FrameFixture>("frames/hello_ack_valid.json").hex;
const baseState = readFixture<{ provider_state: ScenarioState }>("scenarios/create_exec_destroy.json").provider_state;

function cap(fixture: FrameFixture): number {
  return fixture.direction === "fabric_to_worker" || fixture.phase === "handshake" ? MAX_REQUEST_BYTES : MAX_FRAME_BYTES;
}

describe("frames", () => {
  const names = fixtureNames("frames");

  test("the frame set is the v1 set", () => {
    expect(names).toHaveLength(15);
  });

  for (const name of names) {
    test(`reader: ${name}`, () => {
      const fixture = readFixture<FrameFixture>(`frames/${name}.json`);
      const bytes = Buffer.from(fixture.hex, "hex");
      const reader = new FrameReader(() => cap(fixture));
      if (fixture.expect.outcome === "accept") {
        reader.push(bytes);
        const body = reader.next();
        expect(body).toBeDefined();
        const message = decodeBody(body!);
        expect(message.type).toBe(fixture.expect.type);
        expect(message).toEqual(readFixture<CaseFixture>(`cases/${fixture.case}.json`).message);
        reader.end();
        return;
      }
      const expected = fixture.expect;
      // Push only what fits in a length prefix first: a read_body: false refusal must come from it alone.
      const header = bytes.subarray(0, Math.min(4, bytes.length));
      reader.push(header);
      let error: unknown;
      try {
        const early = reader.next();
        if (expected.read_body === false && early === undefined) reader.end();
        if (expected.read_body === true) {
          reader.push(bytes.subarray(header.length));
          const body = reader.next();
          if (body === undefined) reader.end();
          else decodeBody(body);
        }
      } catch (caught) {
        error = caught;
      }
      expect(error, name).toBeInstanceOf(FrameError);
      expect((error as FrameError).code).toBe(expected.code);
    });
  }

  for (const name of names) {
    const fixture = readFixture<FrameFixture>(`frames/${name}.json`);
    if (fixture.direction !== "fabric_to_worker") continue;
    test(`worker session: ${name}`, async () => {
      const world = fixtureWorld({ ...baseState, sandboxes: [], script: [] });
      const connection = world.connect();
      if (fixture.phase === "session") {
        connection.send(hello);
        await connection.next();
      }
      const bytes = Buffer.from(fixture.hex, "hex");
      if (fixture.expect.outcome === "accept") {
        connection.sendBytes(bytes);
        const answer = await connection.next();
        expect(answer.type).toBe(fixture.expect.type === "hello" ? "hello_ack" : "result");
        return;
      }
      if (fixture.expect.read_body === false && bytes.length >= 4) {
        // Only the length prefix arrives; the worker must refuse without waiting for a body.
        connection.sendBytes(bytes.subarray(0, 4));
      } else {
        connection.sendBytes(bytes);
        connection.session.end();
      }
      const answer = await connection.next();
      expect(answer).toMatchObject({ type: "protocol_error", code: fixture.expect.code });
      expect(connection.exitCode).toBe(2);
      expect(connection.inputStopped || fixture.expect.code === "truncated").toBe(true);
      expect(world.provider.effects).toEqual([]);
    });
  }

  test("the worker's own hello_ack frame is byte-identical to the fixture", async () => {
    const world = fixtureWorld({ ...baseState, sandboxes: [], script: [] });
    const connection = world.connect();
    connection.send(hello);
    await connection.next();
    expect(connection.frames[0]!.toString("hex")).toBe(helloAckHex);
  });

  test("the worker's hello_refused frame is byte-identical to the fixture", async () => {
    const world = fixtureWorld({ ...baseState, sandboxes: [], script: [] });
    const connection = world.connect();
    connection.send(readFixture<CaseFixture>("cases/hello_bad_version.json").message);
    await connection.next();
    expect(connection.frames[0]!.toString("hex")).toBe(readFixture<FrameFixture>("frames/hello_refused_valid.json").hex);
    expect(connection.exitCode).toBe(2);
  });

  test("an oversize request after the handshake is refused from its length alone", async () => {
    const world = fixtureWorld({ ...baseState, sandboxes: [], script: [] });
    const connection = world.connect();
    connection.send(hello);
    await connection.next();
    const header = Buffer.alloc(4);
    header.writeUInt32LE(MAX_REQUEST_BYTES + 1, 0);
    connection.sendBytes(header);
    expect(await connection.next()).toMatchObject({ type: "protocol_error", code: "oversize" });
    // Nothing more is buffered or parsed: a later megabyte of body is ignored.
    connection.sendBytes(Buffer.alloc(1 << 20, 0x7b));
    expect(await connection.drain()).toEqual([]);
    expect(connection.exitCode).toBe(2);
  });
});

describe("cases", () => {
  const names = fixtureNames("cases");

  test("the case set is the v1 set", () => {
    expect(names).toHaveLength(50);
  });

  for (const name of names) {
    test(name, async () => {
      const fixture = readFixture<CaseFixture>(`cases/${name}.json`);
      const message = fixture.message;
      if (fixture.direction === "worker_to_fabric") {
        const violation = checkWorkerMessage(message, { profile: fixtureProfile, helloLimits: hello.limits as never });
        if (fixture.expect.outcome === "accept") expect(violation).toBeUndefined();
        else expect(violation).toMatchObject({ code: fixture.expect.code, reason: fixture.expect.reason });
        return;
      }
      if (fixture.expect.outcome === "accept") {
        const parsed =
          message.type === "hello"
            ? parseHello(message, fixtureProfile, { min: 1, max: 1 })
            : message.type === "request"
              ? parseRequest(message, fixtureProfile)
              : message.type === "observe"
                ? parseObserve(message, fixtureProfile)
                : message.type === "cancel"
                  ? parseCancel(message)
                  : parseShutdown(message);
        // An accepted message writes back to the same JSON.
        expect(JSON.stringify(parsed)).toBe(JSON.stringify(message));
        return;
      }
      const expected = fixture.expect;
      if (expected.code === "hello_refused") {
        expect(() => parseHello(message, fixtureProfile, { min: 1, max: 1 })).toThrow(HelloRefusal);
        try {
          parseHello(message, fixtureProfile, { min: 1, max: 1 });
        } catch (error) {
          expect((error as HelloRefusal).code).toBe(expected.reason);
        }
        return;
      }
      if (expected.code === "protocol_error") {
        const world = fixtureWorld({ ...baseState, sandboxes: [], script: [] });
        const connection = world.connect();
        connection.send(message);
        expect(await connection.next()).toMatchObject({ type: "protocol_error", code: expected.reason });
        expect(connection.exitCode).toBe(2);
        return;
      }
      // A refused session message: the parser refuses it, and the session answers an error with effect none.
      const parse = message.type === "observe" ? parseObserve : parseRequest;
      let refusal: unknown;
      try {
        parse(message, fixtureProfile);
      } catch (error) {
        refusal = error;
      }
      expect(refusal).toBeInstanceOf(Refusal);
      expect({ code: (refusal as Refusal).code, reason: (refusal as Refusal).reason }).toEqual({ code: expected.code, reason: expected.reason });
      const world = fixtureWorld({ ...baseState, sandboxes: [], script: [] });
      const connection = world.connect();
      connection.send(hello);
      await connection.next();
      connection.send(message);
      const answer = await connection.next();
      expect(answer).toMatchObject({ type: "error", request_id: message.request_id, error: { code: expected.code, reason: expected.reason, effect: "none" } });
      expect(world.provider.effects).toEqual([]);
    });
  }
});

describe("profiles", () => {
  test("the worker's profile documents are the fixture files, byte for byte", () => {
    for (const profile of [fixtureProfile, dockerProfile]) {
      const text = readFileSync(join(fixturesRoot, "profiles", `${profile.profile}.json`), "utf8");
      expect(`${JSON.stringify(profile, null, 2)}\n`).toBe(text);
    }
  });
});
