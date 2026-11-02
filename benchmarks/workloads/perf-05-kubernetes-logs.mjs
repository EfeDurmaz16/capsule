// PERF-05 (SVC-01, SVC-09): Kubernetes Service logs across many pods and containers.
// MOCK: injected fake CoreV1 client with fixed synthetic latency; no cluster access.
import { percentile, seededRandom, sleep } from "../lib/measure.mjs";
import { loadPackage } from "../lib/packages.mjs";

const { Capsule } = await loadPackage("core");
const { kubernetes } = await loadPackage("kubernetes");

function buildCluster(params) {
  const random = seededRandom(params.seed);
  const pods = [];
  for (let p = 0; p < params.pods; p += 1) {
    const containers = Array.from({ length: params.containers }, (_, c) => ({
      name: `c${c}`,
      env: [{ name: "TOKEN", value: `synthetic-secret-pod${p}-c${c}` }]
    }));
    pods.push({ metadata: { name: `pod-${String(p).padStart(3, "0")}` }, spec: { containers } });
  }
  // Provider pod order is shuffled relative to log recency so order-dependence is visible.
  for (let i = pods.length - 1; i > 0; i -= 1) {
    const j = Math.floor(random() * (i + 1));
    [pods[i], pods[j]] = [pods[j], pods[i]];
  }
  const lines = new Map();
  const allLines = [];
  for (const pod of pods) {
    for (const container of pod.spec.containers) {
      const key = `${pod.metadata.name}/${container.name}`;
      const podLines = [];
      for (let l = 0; l < params.linesPerContainer; l += 1) {
        // Nanosecond timestamps spread over one hour, seeded; message carries the container's secret.
        const nanos = Math.floor(random() * 3600e9);
        const seconds = Math.floor(nanos / 1e9);
        const fraction = String(nanos % 1e9).padStart(9, "0");
        const timestamp = new Date(Date.UTC(2026, 9, 25, 10, 0, 0) + seconds * 1000).toISOString().replace(/\.\d{3}Z$/, `.${fraction}Z`);
        podLines.push({
          timestamp,
          sortKey: BigInt(Date.UTC(2026, 9, 25, 10, 0, 0) + seconds * 1000) * 1_000_000n + BigInt(nanos % 1e9),
          message: `${key} line ${l} token=${container.env[0].value}`
        });
      }
      podLines.sort((left, right) => (left.sortKey < right.sortKey ? -1 : left.sortKey > right.sortKey ? 1 : 0));
      lines.set(key, podLines);
      allLines.push(...podLines);
    }
  }
  allLines.sort((left, right) => (left.sortKey < right.sortKey ? -1 : left.sortKey > right.sortKey ? 1 : 0));
  return { pods, lines, allLines, secrets: pods.flatMap((pod) => pod.spec.containers.map((container) => container.env[0].value)) };
}

async function run(params) {
  const cluster = buildCluster(params);
  let outstanding = 0;
  let maxOutstanding = 0;
  const callOrder = [];
  const core = {
    readNamespacedService: async () => ({ metadata: { name: "bench" }, spec: { selector: { app: "bench" } } }),
    listNamespacedPod: async () => ({ items: cluster.pods }),
    readNamespacedPodLog: async ({ name, container, tailLines }) => {
      outstanding += 1;
      maxOutstanding = Math.max(maxOutstanding, outstanding);
      callOrder.push(`${name}/${container}`);
      await sleep(params.latencyMs);
      outstanding -= 1;
      const podLines = cluster.lines.get(`${name}/${container}`) ?? [];
      const selected = tailLines === undefined ? podLines : podLines.slice(-tailLines);
      return selected.map((line) => `${line.timestamp} ${line.message}`).join("\n");
    }
  };
  const capsule = new Capsule({
    adapter: kubernetes({ namespace: "bench", clients: { batch: {}, apps: {}, core } }),
    policy: { secrets: { redactFromLogs: true } }
  });
  const started = performance.now();
  const result = await capsule.service.logs({ id: "bench", ...(params.limit === undefined ? {} : { limit: params.limit }) });
  const elapsedMs = performance.now() - started;
  const messages = result.logs.map((entry) => entry.message);
  const leakedSecrets = cluster.secrets.filter((secret) => messages.some((message) => message.includes(secret))).length;
  const expectedNewest = (params.limit === undefined ? cluster.allLines : cluster.allLines.slice(-params.limit)).map((line) =>
    line.message.replace(/token=.*$/, "")
  );
  const returnedKeys = messages.map((message) => message.replace(/token=.*$/, ""));
  const ascending = result.logs.every((entry, index, all) => index === 0 || entry.timestamp >= all[index - 1].timestamp);
  return {
    pods: params.pods,
    containersPerPod: params.containers,
    logRequests: callOrder.length,
    maxOutstandingRequests: maxOutstanding,
    elapsedMs,
    entriesReturned: result.logs.length,
    leakedSecrets,
    globallyAscendingTimestamps: ascending,
    matchesGlobalNewestSet: JSON.stringify([...returnedKeys].sort()) === JSON.stringify([...expectedNewest].sort()),
    matchesGlobalNewestInOrder: JSON.stringify(returnedKeys) === JSON.stringify(expectedNewest),
    firstRequestedSources: callOrder.slice(0, 3)
  };
}

export const workload = {
  id: "perf-05-kubernetes-logs",
  perfIds: ["PERF-05"],
  manifestIds: ["SVC-01", "SVC-09"],
  description:
    "Many pods and containers: max outstanding log requests, elapsed time, global order, newest-limit selection and secret redaction (mock CoreV1 client).",
  reps: 5,
  cases: [
    {
      name: "40-pods-3-containers-all",
      description: "40 pods x 3 containers, 25 lines each, 5 ms per log request, no limit.",
      params: { pods: 40, containers: 3, linesPerContainer: 25, latencyMs: 5, seed: 3 },
      headline: ["maxOutstandingRequests", "elapsedMs", "leakedSecrets", "globallyAscendingTimestamps"],
      run: ({ params }) => run(params)
    },
    {
      name: "40-pods-3-containers-limit-20",
      description: "Same cluster, limit 20: must be the 20 globally newest lines regardless of provider pod order.",
      params: { pods: 40, containers: 3, linesPerContainer: 25, latencyMs: 5, seed: 3, limit: 20 },
      headline: ["maxOutstandingRequests", "elapsedMs", "leakedSecrets", "matchesGlobalNewestSet", "matchesGlobalNewestInOrder"],
      run: ({ params }) => run(params)
    }
  ]
};
