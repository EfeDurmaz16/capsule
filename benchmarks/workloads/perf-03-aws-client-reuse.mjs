// PERF-03 (AWS-05): SDK client construction count across repeated provider calls.
// MOCK: the real installed AWS SDK client classes are constructed by the adapters, but their `send`
// is replaced with a synthetic response, so no request, credential lookup or network IO happens.
import { loadPackage, requireFromPackage } from "../lib/packages.mjs";
import { percentile } from "../lib/measure.mjs";

const { Capsule } = await loadPackage("core");

// Fake region/credentials are never used because send is intercepted; set them so nothing probes the host.
process.env.AWS_REGION = "us-east-1";
process.env.AWS_ACCESS_KEY_ID = "BENCHFAKEKEYID";
process.env.AWS_SECRET_ACCESS_KEY = "bench-fake-secret";
process.env.AWS_EC2_METADATA_DISABLED = "true";

function interceptSend(packageName, sdkName, className, respond) {
  const sdk = requireFromPackage(packageName, sdkName);
  const clients = new Set();
  let calls = 0;
  sdk[className].prototype.send = async function (command) {
    clients.add(this);
    calls += 1;
    return respond(command);
  };
  return { stats: () => ({ uniqueSdkClients: clients.size, sendCalls: calls }) };
}

async function repeated(operations, run) {
  const timings = [];
  for (let i = 0; i < operations; i += 1) {
    const started = performance.now();
    await run(i);
    timings.push(performance.now() - started);
  }
  return { firstCallMs: timings[0], warmCallMedianMs: percentile(timings.slice(1), 50), warmCallP95Ms: percentile(timings.slice(1), 95) };
}

const adapters = {
  ec2: async (operations, injected) => {
    const { ec2 } = await loadPackage("ec2");
    const response = () => ({ Reservations: [{ Instances: [{ InstanceId: "i-bench", State: { Name: "running" } }] }] });
    const probe = interceptSend("ec2", "@aws-sdk/client-ec2", "EC2Client", response);
    const injectedCalls = { count: 0 };
    const client = injected ? { send: async () => (injectedCalls.count++, response()) } : undefined;
    const capsule = new Capsule({ adapter: ec2({ region: "us-east-1", client }) });
    const timing = await repeated(operations, () => capsule.machine.status({ id: "i-bench" }));
    return { ...timing, ...probe.stats(), injectedClientCalls: injectedCalls.count };
  },
  ecs: async (operations, injected) => {
    const { ecs } = await loadPackage("ecs");
    const response = () => ({
      services: [
        {
          serviceArn: "arn:aws:ecs:us-east-1:000000000000:service/bench/svc",
          serviceName: "svc",
          status: "ACTIVE",
          runningCount: 1,
          desiredCount: 1,
          deployments: []
        }
      ]
    });
    const probe = interceptSend("ecs", "@aws-sdk/client-ecs", "ECSClient", response);
    const injectedCalls = { count: 0 };
    const client = injected ? { send: async () => (injectedCalls.count++, response()) } : undefined;
    const capsule = new Capsule({ adapter: ecs({ region: "us-east-1", cluster: "bench", taskDefinition: "bench:1", containerName: "main", client }) });
    const timing = await repeated(operations, () => capsule.service.status({ id: "svc" }));
    return { ...timing, ...probe.stats(), injectedClientCalls: injectedCalls.count };
  },
  lambda: async (operations, injected) => {
    const { lambda } = await loadPackage("lambda");
    const response = () => ({ StatusCode: 200, Payload: new TextEncoder().encode('{"ok":true}') });
    const probe = interceptSend("lambda", "@aws-sdk/client-lambda", "LambdaClient", response);
    const injectedCalls = { count: 0 };
    const client = injected ? { send: async () => (injectedCalls.count++, response()) } : undefined;
    const capsule = new Capsule({ adapter: lambda({ region: "us-east-1", functionName: "bench", client }) });
    const timing = await repeated(operations, () => capsule.job.run({ image: "bench", command: ["noop"] }));
    return { ...timing, ...probe.stats(), injectedClientCalls: injectedCalls.count };
  }
};

const operations = 50;
const cases = [];
for (const name of Object.keys(adapters)) {
  cases.push({
    name: `${name}-owned-client`,
    description: `${operations} sequential ${name} operations through one adapter instance with an adapter-owned SDK client.`,
    params: { operations },
    headline: ["uniqueSdkClients", "sendCalls", "firstCallMs", "warmCallMedianMs"],
    run: ({ params }) => adapters[name](params.operations, false)
  });
  cases.push({
    name: `${name}-injected-client`,
    description: `${operations} operations with an injected client. Ownership check: the adapter must use it and construct no SDK client.`,
    params: { operations },
    headline: ["uniqueSdkClients", "injectedClientCalls"],
    run: ({ params }) => adapters[name](params.operations, true)
  });
}

export const workload = {
  id: "perf-03-aws-client-reuse",
  perfIds: ["PERF-03"],
  manifestIds: ["AWS-05"],
  description: "Repeated provider calls per adapter instance: SDK client construction count, cold and warm call timing (mock send).",
  reps: 5,
  cases
};
