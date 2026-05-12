import { describe, expect, it } from "vitest";
import { Capsule, runAdapterContract } from "@capsule/core";
import { ecs, ecsCapabilities } from "./index.js";

describe("ecs adapter", () => {
  it("runs the shared adapter contract suite", async () => {
    await runAdapterContract(ecs({ cluster: "contract", taskDefinition: "contract:1", containerName: "main" }));
  });

  it("declares job and service capabilities", () => {
    expect(ecsCapabilities.job?.run).toBe("native");
    expect(ecsCapabilities.service?.deploy).toBe("native");
  });

  it("runs an ECS task using an existing task definition", async () => {
    const sent: any[] = [];
    const client = {
      send: async (command: any) => {
        sent.push(command.input);
        return { tasks: [{ taskArn: "arn:task/123", lastStatus: "PENDING" }] };
      }
    };
    const capsule = new Capsule({
      adapter: ecs({
        cluster: "cluster-a",
        taskDefinition: "task-def:1",
        containerName: "main",
        subnets: ["subnet-1"],
        securityGroups: ["sg-1"],
        client
      }),
      receipts: true
    });
    const run = await capsule.job.run({
      name: "ignored",
      image: "ghcr.io/acme/job:latest",
      command: ["node", "job.js"],
      env: { NODE_ENV: "test" },
      resources: { cpu: 256, memoryMb: 512 },
      labels: { capsule: "true" }
    });

    expect(run.status).toBe("running");
    expect(run.receipt?.type).toBe("job.run");
    expect(sent[0]).toMatchObject({
      cluster: "cluster-a",
      taskDefinition: "task-def:1",
      launchType: "FARGATE",
      networkConfiguration: { awsvpcConfiguration: { subnets: ["subnet-1"], securityGroups: ["sg-1"], assignPublicIp: "DISABLED" } },
      overrides: {
        containerOverrides: [{ name: "main", command: ["node", "job.js"], environment: [{ name: "NODE_ENV", value: "test" }], cpu: 256, memory: 512 }]
      }
    });
  });

  it("creates an ECS service using an existing task definition", async () => {
    const sent: any[] = [];
    const client = {
      send: async (command: any) => {
        sent.push(command.input);
        return { service: { serviceArn: "arn:service/api" } };
      }
    };
    const capsule = new Capsule({
      adapter: ecs({ cluster: "cluster-a", taskDefinition: "api:3", containerName: "main", launchType: "EC2", client }),
      receipts: true
    });
    const deployment = await capsule.service.deploy({ name: "api", image: "ignored", scale: { min: 2 } });

    expect(deployment).toMatchObject({ id: "arn:service/api", provider: "ecs", status: "deploying" });
    expect(deployment.receipt?.type).toBe("service.deploy");
    expect(sent[0]).toMatchObject({ cluster: "cluster-a", serviceName: "api", taskDefinition: "api:3", launchType: "EC2", desiredCount: 2 });
  });
});
