// In-process cost of one request through WorkerSession on the fixture profile: no spawn, no pipes.
// Usage: node inproc-bench.mjs <dist/index.js> <label> <n>
const [, , entry, label, nArg] = process.argv;
const n = Number(nArg ?? 20000);
const m = await import(entry);
const { WorkerSession, fixtureDriver, FixtureProvider, parseWorkerConfig, fixtureProfile, encodeFrame, FrameReader, decodeBody } = m;
const binding = { account: "acct-a", project: "proj-1" };
const config = parseWorkerConfig({ binding, policy: { images: ["fixture/ok"] }, approvals: [] }, fixtureProfile);
const provider = new FixtureProvider(binding, {
  sandboxes: [{ native_id: "fx-seed", project: "proj-1", owner_job: "01K8W3A00000000000000000J1", status: "ready" }]
});
const reader = new FrameReader(() => 16 << 20);
let pending;
const session = new WorkerSession({
  driver: fixtureDriver(provider),
  config,
  io: {
    write: (frame) => {
      reader.push(frame);
      for (let body = reader.next(); body; body = reader.next()) {
        const msg = decodeBody(body);
        if (pending && (msg.type === "result" || msg.type === "error" || msg.type === "hello_ack")) {
          const p = pending;
          pending = undefined;
          p(msg);
        }
      }
    },
    close() {},
    exit() {}
  }
});
const send = (msg) =>
  new Promise((resolve) => {
    pending = resolve;
    session.push(encodeFrame(msg, 16 << 20));
  });
await send({
  type: "hello",
  versions: { min: 1, max: 1 },
  fabric: "fabric/0.1.0",
  profile: "fixture",
  limits: { max_request_bytes: 1048576, max_frame_bytes: 16777216, max_in_flight: 8, max_stderr_bytes: 65536 }
});
const scope = { job: "01K8W3A00000000000000000J1", task: "01K8W3A00000000000000000T1", attempt: "01K8W3A00000000000000000A1", generation: "1" };
const target = { provider: "fixture", scope: binding, kind: "sandbox", native_id: "fx-seed" };
const req = (i, action, extra) => ({
  type: "request",
  request_id: `r-${i}`,
  operation: { id: `01K8W3A000000000000${String(i).padStart(7, "0")}`, key: `k-${i}`, digest: i.toString(16).padStart(64, "0") },
  scope,
  action,
  ...extra,
  approval: null,
  deadline_ms: 30000
});
const kinds = {
  exec: (i) =>
    req(i, "sandbox.exec", { target, params: { argv: ["echo", "hi"], stdin: null, cwd: null, timeout_ms: 1000, max_output_bytes: 1024, secret_names: [] } }),
  refusal: (i) => req(i, "sandbox.create", { params: { image: "denied/image", env: {}, secret_names: [], labels: {} } })
};
let id = 0;
const out = { label, node: process.version, n };
for (const [name, make] of Object.entries(kinds)) {
  for (let w = 0; w < 2000; w += 1) await send(make(++id)); // warm up
  const t0 = performance.now();
  for (let i = 0; i < n; i += 1) await send(make(++id));
  out[`${name}UsPerRequest`] = Number((((performance.now() - t0) * 1000) / n).toFixed(2));
}
console.log(JSON.stringify(out));
