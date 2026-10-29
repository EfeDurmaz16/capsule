import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import { JsonlReceiptStore } from "@capsule-sdk/store-jsonl";
import type { DockerCommandResult, RunDockerOptions } from "@capsule-sdk/docker";
import { parseWorkerConfig } from "./config.js";
import { dockerDriver } from "./docker.js";
import { readFixture, TestConnection } from "./harness.test.support.js";
import { checkWorkerMessage } from "./outbound.js";
import { dockerProfile } from "./profiles.js";
import type { CapabilityProfile } from "./wire.js";

// The Docker profile against an in-memory stand-in for the docker CLI. It proves the mapping (labels,
// pull never, scope, ownership, dedupe by label, receipts) without a daemon. The physical proof against
// a real local engine is scripts/bridge-docker-smoke.mjs.

interface FakeContainer {
  id: string;
  name: string;
  image: string;
  labels: Record<string, string>;
  env: string[];
  status: "created" | "running";
}

class FakeEngine {
  readonly images = new Set(["debian:bookworm-slim"]);
  readonly containers = new Map<string, FakeContainer>();
  readonly calls: string[][] = [];
  /** The context each call named with --context=, or undefined when it named none. */
  readonly routed: Array<string | undefined> = [];
  /** What `docker context show` prints: the CLI's current context. */
  current = "fake-engine";
  /** Makes `docker rm` come back the way runDocker reports its own timeout. */
  rmTimesOut = false;
  /** Subcommands that fail as an unreachable engine does. */
  readonly down = new Set<string>();
  /** Milliseconds each docker subcommand takes before it answers, by subcommand. */
  delays: Partial<Record<string, number>> = {};
  /** While set, docker exec runs until it settles: a long command. */
  execGate: Promise<void> | undefined;
  /** docker exec commands running now, and the most that ran at once. */
  execsRunning = 0;
  execsPeak = 0;
  private next = 1;

  runner = async (given: string[], _options?: RunDockerOptions): Promise<DockerCommandResult> => {
    const route = given[0]?.startsWith("--context=") ? given[0].slice("--context=".length) : undefined;
    const args = route === undefined ? given : given.slice(1);
    this.calls.push(args);
    this.routed.push(route);
    const delay = this.delays[args[0]!];
    if (delay) await new Promise((resolve) => setTimeout(resolve, delay));
    if (this.down.has(args[0]!)) {
      return { exitCode: 1, stdout: "", stderr: "failed to connect to the docker API at unix:///fake.sock; check if the daemon is running" };
    }
    const ok = (stdout = ""): DockerCommandResult => ({ exitCode: 0, stdout, stderr: "" });
    const fail = (stderr: string, exitCode = 1): DockerCommandResult => ({ exitCode, stdout: "", stderr });
    const find = (ref: string) => [...this.containers.values()].find((container) => container.id === ref || container.name === ref);
    switch (args[0]) {
      case "context":
        return ok(`${this.current}\n`);
      case "version":
        return ok("29.0.0\n");
      case "create": {
        const name = args[args.indexOf("--name") + 1]!;
        const pull = args.includes("--pull") ? args[args.indexOf("--pull") + 1] : "missing";
        const labels: Record<string, string> = {};
        const env: string[] = [];
        let index = 1;
        let image = "";
        while (index < args.length) {
          const arg = args[index]!;
          if (["--name", "--workdir", "--pull", "--network", "--publish"].includes(arg)) index += 2;
          else if (arg === "--label") {
            const [key, ...value] = args[index + 1]!.split("=");
            labels[key!] = value.join("=");
            index += 2;
          } else if (arg === "--env") {
            env.push(args[index + 1]!);
            index += 2;
          } else {
            image = arg;
            break;
          }
        }
        if (!this.images.has(image)) {
          if (pull === "never") return fail(`Error: No such image: ${image}`, 125);
          throw new Error("the fake engine would have pulled an image");
        }
        const id = `${"c".repeat(60)}${String(this.next++).padStart(4, "0")}`;
        this.containers.set(id, { id, name, image, labels, env, status: "created" });
        return ok(`${id}\n`);
      }
      case "start": {
        const container = find(args[1]!);
        if (!container) return fail(`Error: No such container: ${args[1]}`);
        container.status = "running";
        return ok(`${args[1]}\n`);
      }
      case "inspect": {
        const container = find(args.at(-1)!);
        if (!container) return fail(`Error: No such container: ${args.at(-1)}`);
        const format = args[args.indexOf("--format") + 1];
        if (format === "{{.Created}}") return ok("2026-10-27T10:00:00Z\n");
        return ok(`${JSON.stringify({ Status: container.status, Running: container.status === "running" })}\t${JSON.stringify(container.labels)}\n`);
      }
      case "ps": {
        const filter = args[args.indexOf("--filter") + 1]!.replace(/^label=/, "");
        const [key, value] = filter.split("=");
        return ok(
          [...this.containers.values()]
            .filter((container) => container.labels[key!] === value)
            .map((container) => `${container.id}\n`)
            .join("")
        );
      }
      case "exec": {
        const rest = args.slice(1);
        while (rest[0]?.startsWith("-")) rest.splice(0, rest[0] === "-i" ? 1 : 2);
        const container = find(rest[0]!);
        if (!container) return fail(`Error: No such container: ${rest[0]}`);
        const argv = rest.slice(1);
        if (this.execGate) {
          this.execsRunning += 1;
          this.execsPeak = Math.max(this.execsPeak, this.execsRunning);
          await this.execGate;
          this.execsRunning -= 1;
        }
        return argv[0] === "echo" ? ok(`${argv.slice(1).join(" ")}\n`) : { exitCode: 2, stdout: "", stderr: "fake: unsupported\n" };
      }
      case "rm": {
        if (this.rmTimesOut) return { exitCode: 124, stdout: "", stderr: "Command timed out after 20000ms", timedOut: true };
        const container = find(args.at(-1)!);
        if (!container) return fail(`Error: No such container: ${args.at(-1)}`);
        this.containers.delete(container.id);
        return ok(`${args.at(-1)}\n`);
      }
      default:
        throw new Error(`fake engine: unexpected docker ${args.join(" ")}`);
    }
  };
}

const hello = { ...readFixture<{ message: Record<string, unknown> }>("cases/hello_valid.json").message, profile: "docker" };
const scope = { job: "01K8W3A00000000000000000J1", task: "01K8W3A00000000000000000T1", attempt: "01K8W3A00000000000000000A1", generation: "3" };
const engineScope = { engine: "fake-engine" };
const dirs: string[] = [];

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function request(n: number, action: string, extra: Record<string, unknown>): Record<string, unknown> {
  return {
    type: "request",
    request_id: `r-${n}`,
    operation: { id: `01K8W3A0000000000000000D${String(n).padStart(2, "0")}`, key: `key-docker-${n}`, digest: "cd".repeat(32) },
    scope,
    action,
    ...extra,
    approval: null,
    deadline_ms: 30_000
  };
}

const create = (n: number, image = "debian:bookworm-slim", secretNames: string[] = []) =>
  request(n, "sandbox.create", { params: { image, env: { MODE: "test" }, secret_names: secretNames, labels: { purpose: "bridge-test" } } });
const target = (id: string) => ({ provider: "docker", scope: engineScope, kind: "container", native_id: id });

function connect(
  engine: FakeEngine,
  options: {
    receiptsPath?: string;
    approvals?: unknown[];
    secrets?: string[];
    binding?: { engine: string };
    realAvailability?: boolean;
    profile?: CapabilityProfile;
  } = {}
) {
  const config = parseWorkerConfig(
    { policy: { images: ["debian:bookworm-slim"], ...(options.secrets ? { secrets: { allowed: options.secrets } } : {}) }, approvals: options.approvals ?? [] },
    dockerProfile
  );
  const driver = dockerDriver({
    runner: engine.runner,
    ...(options.binding ? { binding: options.binding } : {}),
    ...(options.realAvailability ? {} : { checkAvailable: async () => true }),
    ...(options.receiptsPath ? { receipts: { store: new JsonlReceiptStore({ path: options.receiptsPath }), durable: true } } : {}),
    secret: (name) => (options.secrets?.includes(name) ? `value-of-${name}` : undefined)
  });
  return new TestConnection(options.profile ? { ...driver, profile: options.profile } : driver, config);
}

async function handshake(connection: TestConnection) {
  connection.send(hello);
  const ack = await connection.next();
  expect(ack).toMatchObject({ type: "hello_ack", profile: { profile: "docker" } });
}

describe("docker profile on a fake engine", () => {
  test("create, exec and destroy map onto labeled containers with the engine scope", async () => {
    const engine = new FakeEngine();
    const dir = mkdtempSync(join(tmpdir(), "capsule-bridge-receipts-"));
    dirs.push(dir);
    const receiptsPath = join(dir, "receipts.jsonl");
    const connection = connect(engine, { receiptsPath, approvals: [{ ref: "apr-destroy", action: "sandbox.destroy", native_id: null }] });
    await handshake(connection);

    connection.send(create(1));
    const created = await connection.next();
    expect(checkWorkerMessage(created, { profile: dockerProfile })).toBeUndefined();
    expect(created).toMatchObject({ type: "result", state: "completed", output: { status: "ready" }, replayed: false });
    const id = (created.resource as { native_id: string }).native_id;
    expect(created.resource).toEqual(target(id));
    const container = engine.containers.get(id)!;
    expect(container.labels).toMatchObject({
      purpose: "bridge-test",
      "fabric.operation": "01K8W3A0000000000000000D01",
      "fabric.job": scope.job,
      "fabric.attempt": scope.attempt,
      "fabric.generation": "3"
    });
    expect(engine.calls.find((call) => call[0] === "create")).toEqual(expect.arrayContaining(["--pull", "never"]));
    const receipts = created.receipts as Array<{ algorithm: string; digest: string; ref: string }>;
    expect(receipts).toHaveLength(1);
    expect(readFileSync(receiptsPath, "utf8")).toContain(receipts[0]!.ref);

    connection.send(
      request(2, "sandbox.exec", {
        target: target(id),
        params: { argv: ["echo", "hi"], stdin: null, cwd: null, timeout_ms: 10_000, max_output_bytes: 1024, secret_names: [] }
      })
    );
    expect(await connection.next()).toMatchObject({
      type: "result",
      state: "completed",
      output: { exit_code: 0, stdout: { text: "hi\n", captured_bytes: 3 } }
    });

    connection.send({ ...request(3, "sandbox.destroy", { target: target(id), params: {} }), approval: { ref: "apr-destroy" } });
    expect(await connection.next()).toMatchObject({ type: "result", state: "completed", output: { status: "destroyed" }, resource: target(id) });
    expect(engine.containers.size).toBe(0);
  });

  test("a docker rm that timed out is an unknown destroy with the target locator, so Fabric can observe it", async () => {
    const engine = new FakeEngine();
    const connection = connect(engine, { approvals: [{ ref: "apr-destroy", action: "sandbox.destroy", native_id: null }] });
    await handshake(connection);
    connection.send(create(1));
    const id = ((await connection.next()).resource as { native_id: string }).native_id;
    engine.rmTimesOut = true;
    connection.send({ ...request(2, "sandbox.destroy", { target: target(id), params: {} }), approval: { ref: "apr-destroy" } });
    const answer = await connection.next();
    expect(answer).toEqual({
      type: "error",
      request_id: "r-2",
      operation_id: "01K8W3A0000000000000000D02",
      error: { code: "unknown", reason: "reply_lost", message: expect.any(String), effect: "unknown", resource: target(id) }
    });
    expect(checkWorkerMessage(answer, { profile: dockerProfile })).toBeUndefined();
  });

  test("a missing image is never pulled: provider_failed not_found with no effect", async () => {
    const engine = new FakeEngine();
    const connection = connect(engine);
    await handshake(connection);
    connection.send({ ...create(1, "debian:bookworm-slim"), params: { image: "debian:bookworm-slim", env: {}, secret_names: [], labels: {} } });
    await connection.next();
    engine.images.clear();
    connection.send(create(2));
    expect(await connection.next()).toMatchObject({ error: { code: "provider_failed", reason: "not_found", effect: "none" } });
    expect(engine.containers.size).toBe(1);
  });

  test("a container without this job's labels is never acted on", async () => {
    const engine = new FakeEngine();
    engine.containers.set("foreign", { id: "foreign", name: "foreign", image: "debian:bookworm-slim", labels: {}, env: [], status: "running" });
    const connection = connect(engine, { approvals: [{ ref: "apr-destroy", action: "sandbox.destroy", native_id: null }] });
    await handshake(connection);
    connection.send({ ...request(1, "sandbox.destroy", { target: target("foreign"), params: {} }), approval: { ref: "apr-destroy" } });
    expect(await connection.next()).toMatchObject({ error: { code: "denied", reason: "owner_mismatch", effect: "none" } });
    expect(engine.calls.map((call) => call[0])).toEqual(["context", "inspect"]);
  });

  test("after a worker restart the same create finds its container by label instead of making another", async () => {
    const engine = new FakeEngine();
    const first = connect(engine);
    await handshake(first);
    first.send(create(1));
    const created = await first.next();
    first.session.kill();
    const second = connect(engine);
    await handshake(second);
    second.send(create(1));
    const replayed = await second.next();
    expect(replayed).toMatchObject({ type: "result", state: "completed", replayed: true, resource: created.resource });
    expect(engine.calls.filter((call) => call[0] === "create")).toHaveLength(1);
  });

  test("docker exec has no cancel: the ack is unsupported", async () => {
    const engine = new FakeEngine();
    const connection = connect(engine);
    await handshake(connection);
    connection.send(create(1));
    const id = ((await connection.next()).resource as { native_id: string }).native_id;
    connection.send(
      request(2, "sandbox.exec", {
        target: target(id),
        params: { argv: ["echo", "x"], stdin: null, cwd: null, timeout_ms: 10_000, max_output_bytes: 64, secret_names: [] }
      }),
      { type: "cancel", request_id: "r-3", cancels: "r-2", operation_id: "01K8W3A0000000000000000D02" }
    );
    const answers = await connection.drain();
    expect(answers).toContainEqual({ type: "cancel_ack", request_id: "r-3", cancels: "r-2", state: "unsupported" });
    expect(answers).toContainEqual(expect.objectContaining({ type: "result", request_id: "r-2", state: "completed" }));
  });

  test("secrets resolve only for names the worker policy allows, and values never reach the answer", async () => {
    const engine = new FakeEngine();
    const connection = connect(engine, { secrets: ["API_TOKEN"] });
    await handshake(connection);
    connection.send(create(1, "debian:bookworm-slim", ["DB_URL"]));
    expect(await connection.next()).toMatchObject({ error: { code: "denied", reason: "secret_not_allowed", effect: "none" } });
    expect(engine.calls.some((call) => call[0] === "create")).toBe(false);
    connection.send(create(2, "debian:bookworm-slim", ["API_TOKEN"]));
    const answer = await connection.next();
    expect(answer).toMatchObject({ type: "result", state: "completed" });
    expect(JSON.stringify(answer)).not.toContain("value-of-API_TOKEN");
    expect([...engine.containers.values()][0]!.env).toContain("API_TOKEN=value-of-API_TOKEN");
  });

  test("values that would read as docker CLI options are refused before any docker call", async () => {
    const engine = new FakeEngine();
    const connection = connect(engine, { approvals: [{ ref: "apr-destroy", action: "sandbox.destroy", native_id: null }] });
    await handshake(connection);
    engine.images.add("--privileged");
    connection.send({ ...create(1), params: { image: "--privileged", env: {}, secret_names: [], labels: {} } });
    expect(await connection.next()).toMatchObject({ error: { code: "provider_failed", reason: "provider_refused", effect: "none" } });
    connection.send({ ...create(2), params: { image: "debian:bookworm-slim", env: {}, secret_names: [], labels: { "a=fabric.job": "x" } } });
    expect(await connection.next()).toMatchObject({ error: { code: "provider_failed", reason: "provider_refused", effect: "none" } });
    connection.send({ ...create(4), params: { image: "debian:bookworm-slim", env: { "PATH=/evil:": "x" }, secret_names: [], labels: {} } });
    expect(await connection.next()).toMatchObject({ error: { code: "provider_failed", reason: "provider_refused", effect: "none" } });
    connection.send({ ...request(3, "sandbox.destroy", { target: target("--help"), params: {} }), approval: { ref: "apr-destroy" } });
    expect(await connection.next()).toMatchObject({ error: { code: "provider_failed", effect: "none" } });
    expect(engine.calls.map((call) => call[0])).toEqual(["context"]);
  });

  test("every docker command goes to the bound engine's context, not to the CLI's current one", async () => {
    const engine = new FakeEngine();
    engine.current = "orbstack";
    const bound = { engine: "desktop-linux" };
    const connection = connect(engine, {
      binding: bound,
      realAvailability: true,
      approvals: [{ ref: "apr-destroy", action: "sandbox.destroy", native_id: null }]
    });
    await handshake(connection);
    connection.send(create(1));
    const created = await connection.next();
    expect(created).toMatchObject({ type: "result", state: "completed", resource: { scope: bound } });
    const locator = created.resource as Record<string, unknown>;
    connection.send(
      request(2, "sandbox.exec", {
        target: locator,
        params: { argv: ["echo", "hi"], stdin: null, cwd: null, timeout_ms: 10_000, max_output_bytes: 64, secret_names: [] }
      })
    );
    expect(await connection.next()).toMatchObject({ type: "result", state: "completed" });
    connection.send({ ...request(3, "sandbox.destroy", { target: locator, params: {} }), approval: { ref: "apr-destroy" } });
    expect(await connection.next()).toMatchObject({ type: "result", state: "completed", output: { status: "destroyed" } });
    expect(engine.calls.map((call) => call[0])).toEqual(expect.arrayContaining(["version", "ps", "create", "start", "inspect", "exec", "rm"]));
    expect(engine.calls.some((call) => call[0] === "context")).toBe(false);
    expect(engine.routed).toEqual(engine.calls.map(() => "desktop-linux"));
  });

  test("without a binding, the context read at the first request stays the route after the CLI switches", async () => {
    const engine = new FakeEngine();
    const connection = connect(engine);
    await handshake(connection);
    connection.send(create(1));
    const id = ((await connection.next()).resource as { native_id: string }).native_id;
    engine.current = "another-engine";
    connection.send(
      request(2, "sandbox.exec", {
        target: target(id),
        params: { argv: ["echo", "hi"], stdin: null, cwd: null, timeout_ms: 10_000, max_output_bytes: 64, secret_names: [] }
      })
    );
    expect(await connection.next()).toMatchObject({ type: "result", state: "completed", resource: { scope: engineScope } });
    expect(engine.calls.filter((call) => call[0] === "context")).toHaveLength(1);
    expect(engine.routed.filter((_, index) => engine.calls[index]![0] !== "context")).toEqual(
      engine.calls.filter((call) => call[0] !== "context").map(() => "fake-engine")
    );
  });

  test("an exec answered running at its deadline keeps its in-flight slot until the command ends", async () => {
    const engine = new FakeEngine();
    const connection = connect(engine);
    connection.send({ ...hello, limits: { ...((hello as Record<string, unknown>).limits as object), max_in_flight: 1 } });
    expect(await connection.next()).toMatchObject({ type: "hello_ack", limits: { max_in_flight: 1 } });
    connection.send(create(1));
    const id = ((await connection.next()).resource as { native_id: string }).native_id;
    let release: () => void = () => undefined;
    engine.execGate = new Promise((resolve) => (release = resolve));
    const execRequest = (n: number) => ({
      ...request(n, "sandbox.exec", {
        target: target(id),
        params: { argv: ["echo", `run-${n}`], stdin: null, cwd: null, timeout_ms: 600_000, max_output_bytes: 64, secret_names: [] }
      }),
      deadline_ms: 250
    });
    connection.send(execRequest(2));
    expect(await connection.nextWithin(2_000)).toMatchObject({ type: "result", request_id: "r-2", state: "running" });
    connection.send(execRequest(3));
    expect(await connection.next()).toMatchObject({ type: "error", request_id: "r-3", error: { code: "unavailable", reason: "busy", effect: "none" } });
    expect(engine.execsPeak).toBe(1);
    release();
    engine.execGate = undefined;
    await connection.drain();
    connection.send(execRequest(4));
    expect(await connection.nextWithin(2_000)).toMatchObject({ type: "result", request_id: "r-4", state: "completed" });
  });

  test("an exec answered running at its deadline is reported by observe once the command ends, and never run again", async () => {
    const engine = new FakeEngine();
    const profile = { ...dockerProfile, actions: dockerProfile.actions.map((a) => (a.action === "sandbox.exec" ? { ...a, observe: true } : a)) };
    const connection = connect(engine, { profile });
    await handshake(connection);
    connection.send(create(1));
    const id = ((await connection.next()).resource as { native_id: string }).native_id;
    let release: () => void = () => undefined;
    engine.execGate = new Promise((resolve) => (release = resolve));
    connection.send({
      ...request(2, "sandbox.exec", {
        target: target(id),
        params: { argv: ["echo", "late"], stdin: null, cwd: null, timeout_ms: 600_000, max_output_bytes: 64, secret_names: [] }
      }),
      deadline_ms: 250
    });
    expect(await connection.nextWithin(2_000)).toMatchObject({ type: "result", request_id: "r-2", state: "running", output: { exit_code: null } });
    const observe = (n: number, waitMs: number) => ({
      type: "observe",
      request_id: `r-${n}`,
      operation_id: "01K8W3A0000000000000000D02",
      action: "sandbox.exec",
      resource: target(id),
      wait_ms: waitMs
    });
    connection.send(observe(3, 300));
    expect(await connection.nextWithin(2_000)).toMatchObject({
      type: "error",
      request_id: "r-3",
      error: { code: "pending", reason: "observation_deadline", effect: "pending", state: "running", deadline_ms: 300 }
    });
    release();
    engine.execGate = undefined;
    connection.send(observe(4, 2_000));
    expect(await connection.nextWithin(3_000)).toMatchObject({
      type: "result",
      request_id: "r-4",
      state: "completed",
      output: { exit_code: 0, stdout: { text: "late\n" } },
      replayed: false
    });
    expect(engine.calls.filter((call) => call[0] === "exec")).toHaveLength(1);
  });

  test("a create still in the docker CLI at deadline_ms is answered unknown with the name it was given, in time", async () => {
    const engine = new FakeEngine();
    const connection = connect(engine);
    await handshake(connection);
    engine.delays.create = 600;
    const started = Date.now();
    connection.send({ ...create(1), deadline_ms: 150 });
    const answer = await connection.nextWithin(2_000);
    expect(Date.now() - started).toBeLessThan(500);
    const named = { provider: "docker", scope: engineScope, kind: "container", native_id: "capsule-fabric-01k8w3a0000000000000000d01" };
    expect(answer).toEqual({
      type: "error",
      request_id: "r-1",
      operation_id: "01K8W3A0000000000000000D01",
      error: { code: "unknown", reason: "reply_lost", message: expect.any(String), effect: "unknown", resource: named }
    });
    expect(checkWorkerMessage(answer, { profile: dockerProfile })).toBeUndefined();
    expect(engine.containers.size).toBe(0);
    // The create goes on in the background; Fabric reconciles it by observe with the original id.
    await new Promise((resolve) => setTimeout(resolve, 700));
    expect(engine.containers.size).toBe(1);
    connection.send({
      type: "observe",
      request_id: "r-2",
      operation_id: "01K8W3A0000000000000000D01",
      action: "sandbox.create",
      resource: named,
      wait_ms: 2_000
    });
    expect(await connection.nextWithin(2_000)).toMatchObject({ type: "result", request_id: "r-2", state: "completed", resource: named });
  });

  test("an observation read still in the docker CLI at deadline_ms is answered pending with the locator, in time", async () => {
    const engine = new FakeEngine();
    const connection = connect(engine);
    await handshake(connection);
    engine.delays.inspect = 1_000;
    const started = Date.now();
    connection.send({ ...create(1), deadline_ms: 200 });
    const answer = await connection.nextWithin(2_000);
    expect(Date.now() - started).toBeLessThan(800);
    const id = [...engine.containers.keys()][0]!;
    expect(answer).toMatchObject({
      type: "error",
      error: { code: "pending", reason: "observation_deadline", effect: "pending", resource: target(id), observations: 1, deadline_ms: 200 }
    });
  });

  test("a check still reading at deadline_ms is refused before any effect, and no create follows it", async () => {
    const engine = new FakeEngine();
    const connection = connect(engine);
    await handshake(connection);
    engine.delays.ps = 400;
    const started = Date.now();
    connection.send({ ...create(1), deadline_ms: 100 });
    expect(await connection.nextWithin(2_000)).toMatchObject({ type: "error", error: { code: "provider_failed", reason: "provider_refused", effect: "none" } });
    expect(Date.now() - started).toBeLessThan(350);
    await new Promise((resolve) => setTimeout(resolve, 500));
    expect(engine.calls.some((call) => call[0] === "create")).toBe(false);
  });

  test("a create whose dedupe lookup cannot reach the engine is refused before any effect, not unknown", async () => {
    const engine = new FakeEngine();
    const connection = connect(engine);
    await handshake(connection);
    engine.down.add("ps");
    connection.send(create(1));
    expect(await connection.next()).toMatchObject({ type: "error", error: { code: "provider_failed", reason: "provider_refused", effect: "none" } });
    expect(engine.calls.some((call) => call[0] === "create")).toBe(false);
  });

  test("a locator in another engine scope is refused before any docker call", async () => {
    const engine = new FakeEngine();
    const connection = connect(engine);
    await handshake(connection);
    connection.send(
      request(1, "sandbox.exec", {
        target: { ...target("abc"), scope: { engine: "other" } },
        params: { argv: ["echo"], stdin: null, cwd: null, timeout_ms: 1000, max_output_bytes: 64, secret_names: [] }
      })
    );
    expect(await connection.next()).toMatchObject({ error: { code: "denied", reason: "scope_mismatch", effect: "none" } });
    expect(engine.calls.map((call) => call[0])).toEqual(["context"]);
  });
});
