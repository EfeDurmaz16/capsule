import assert from "node:assert/strict";
import { ec2 } from "@capsule-sdk/ec2";
import { ecs } from "@capsule-sdk/ecs";
import { lambda } from "@capsule-sdk/lambda";
import { fixtureJson, runProviderHttpFixture, type ProviderHttpRequest } from "./emulate-http-fixture.js";

const region = "us-west-2";
const name = "capsule-example";
const image = "example:fixture";
const command = ["echo", "fixture"];

function clientConfig(endpoint: string) {
  return { endpoint, credentials: { accessKeyId: "CAPSULEFIXTURE", secretAccessKey: "local-fixture-only" }, maxAttempts: 1 };
}

// Verify that the real SDK signed the serialized request with the fixture identity and expected service scope.
function isSignedPost(request: ProviderHttpRequest, service: string, path: string) {
  return (
    request.method === "POST" &&
    request.url.pathname === path &&
    new RegExp(`^AWS4-HMAC-SHA256 Credential=CAPSULEFIXTURE/\\d{8}/${region}/${service}/aws4_request,`).test(request.headers.authorization ?? "")
  );
}

function ec2Response(action: string, content: string) {
  return {
    status: 200,
    headers: { "content-type": "text/xml" },
    body: `<${action}Response xmlns="http://ec2.amazonaws.com/doc/2016-11-15/"><requestId>fixture</requestId>${content}</${action}Response>`
  };
}

function runEc2() {
  const instanceId = "i-00000000000000001";
  const imageId = "ami-00000000000000001";
  const instance = `<instancesSet><item><instanceId>${instanceId}</instanceId><instanceState><code>16</code><name>running</name></instanceState></item></instancesSet>`;
  let running = false;

  return runProviderHttpFixture({
    provider: "ec2",
    adapter: (endpoint) => ec2({ region, clientOptions: clientConfig(endpoint) }),
    handle(request) {
      if (!isSignedPost(request, "ec2", "/")) return;
      const form = new URLSearchParams(request.body.toString());
      assert.equal(form.get("Version"), "2016-11-15");
      const action = form.get("Action");
      switch (action) {
        case "RunInstances":
          assert.equal(running, false);
          assert.equal(form.get("ImageId"), imageId);
          assert.equal(form.get("InstanceType"), "t3.micro");
          assert.equal(form.get("MinCount"), "1");
          assert.equal(form.get("MaxCount"), "1");
          running = true;
          return ec2Response(action, instance);
        case "DescribeInstances":
          assert.equal(running, true);
          assert.equal(form.get("InstanceId.1"), instanceId);
          return ec2Response(action, `<reservationSet><item>${instance}</item></reservationSet>`);
        case "TerminateInstances":
          assert.equal(running, true);
          assert.equal(form.get("InstanceId.1"), instanceId);
          running = false;
          return ec2Response(
            action,
            `<instancesSet><item><instanceId>${instanceId}</instanceId><currentState><code>48</code><name>terminated</name></currentState></item></instancesSet>`
          );
      }
    },
    async exercise(capsule) {
      const created = await capsule.machine.create({ name, image: imageId, size: "t3.micro" });
      try {
        assert.equal(created.id, instanceId);
        const observed = await capsule.machine.status({ id: created.id });
        assert.equal(observed.status, "running");
      } finally {
        const removed = await capsule.machine.destroy({ id: created.id });
        assert.equal(removed.status, "deleted");
      }
      assert.equal(running, false);
      return {
        result: { resourceId: created.id, status: "deleted" },
        cleanup: "emulator-destroyed",
        assertions: ["EC2 Query created, described, and terminated the same fixture instance."]
      };
    }
  });
}

function runEcs() {
  const cluster = "capsule-cluster";
  const taskDefinition = "capsule-task:1";
  const taskArn = `arn:aws:ecs:${region}:000000000000:task/${cluster}/00000000000000000000000000000001`;
  let started = false;
  return runProviderHttpFixture({
    provider: "ecs",
    adapter: (endpoint) => ecs({ region, cluster, taskDefinition, containerName: name, clientOptions: clientConfig(endpoint) }),
    handle(request) {
      if (!isSignedPost(request, "ecs", "/")) return;
      const input = JSON.parse(request.body.toString());
      assert.equal(input.cluster, cluster);
      switch (request.headers["x-amz-target"]) {
        case "AmazonEC2ContainerServiceV20141113.RunTask":
          assert.equal(started, false);
          assert.equal(input.taskDefinition, taskDefinition);
          assert.equal(input.overrides.containerOverrides[0].name, name);
          assert.deepEqual(input.overrides.containerOverrides[0].command, command);
          started = true;
          return fixtureJson(200, { tasks: [{ taskArn, lastStatus: "RUNNING" }] });
        case "AmazonEC2ContainerServiceV20141113.DescribeTasks":
          assert.equal(started, true);
          assert.deepEqual(input.tasks, [taskArn]);
          started = false;
          return fixtureJson(200, { tasks: [{ taskArn, lastStatus: "STOPPED", containers: [{ name, exitCode: 0 }] }] });
      }
    },
    async exercise(capsule) {
      const job = await capsule.job.run({ name, image, command });
      assert.equal(job.id, taskArn);
      assert.equal(job.status, "running");
      const completed = await capsule.job.status({ id: job.id });
      assert.equal(completed.id, job.id);
      assert.equal(completed.status, "succeeded");
      return {
        result: { resourceId: job.id, status: completed.status },
        cleanup: "no-retained-emulator-state",
        assertions: ["ECS accepted the task override and returned a stopped main container with exit code zero."]
      };
    }
  });
}

export function handleLambdaInvoke(request: ProviderHttpRequest) {
  if (!isSignedPost(request, "lambda", `/2015-03-31/functions/${name}/invocations`)) return;
  assert.equal(request.headers["x-amz-invocation-type"], "RequestResponse");
  const input = JSON.parse(request.body.toString());
  assert.equal(input.capsule, true);
  assert.equal(input.image, image);
  assert.deepEqual(input.command, command);
  return fixtureJson(200, { marker: "fixture" });
}

function runLambda() {
  return runProviderHttpFixture({
    provider: "lambda",
    adapter: (endpoint) => lambda({ region, clientOptions: clientConfig(endpoint) }),
    handle: handleLambdaInvoke,
    async exercise(capsule) {
      const job = await capsule.job.run({ name, image, command });
      assert.equal(job.id, name);
      assert.equal(job.status, "succeeded");
      assert.equal(job.result?.exitCode, 0);
      assert.equal(job.result.stdout, '{"marker":"fixture"}');
      return {
        result: { resourceId: job.id, status: job.status },
        cleanup: "no-retained-emulator-state",
        assertions: ["Lambda received the Capsule event and returned the fixture payload to the synchronous caller."]
      };
    }
  });
}

export function runAwsProviderHttp(provider: "ec2" | "ecs" | "lambda") {
  switch (provider) {
    case "ec2":
      return runEc2();
    case "ecs":
      return runEcs();
    case "lambda":
      return runLambda();
  }
}
