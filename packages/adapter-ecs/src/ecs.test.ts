import { describe, expect, it } from "vitest";
import { Capsule, runAdapterContract } from "@capsule/core";
import { ecs, ecsCapabilities } from "./index.js";

describe("ecs adapter", () => {
  it("runs the shared adapter contract suite", async () => {
    await runAdapterContract(ecs({ cluster: "contract", taskDefinition: "contract:1", containerName: "main" }));
  });

  it("declares job and service capabilities", () => {
    expect(ecsCapabilities.job?.run).toBe("native");
    expect(ecsCapabilities.job?.status).toBe("native");
    expect(ecsCapabilities.job?.cancel).toBe("native");
    expect(ecsCapabilities.service?.deploy).toBe("native");
    expect(ecsCapabilities.service?.status).toBe("native");
    expect(ecsCapabilities.service?.delete).toBe("native");
    expect(ecsCapabilities.service?.url).toBe("unsupported");
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
    expect(run.receipt?.metadata).toMatchObject({ taskArn: "arn:task/123", lastStatus: "PENDING" });
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

  it("describes ECS task status from task ARN", async () => {
    const sent: any[] = [];
    const client = {
      send: async (command: any) => {
        sent.push(command.input);
        return {
          tasks: [
            {
              taskArn: "arn:task/123",
              lastStatus: "STOPPED",
              desiredStatus: "STOPPED",
              stopCode: "EssentialContainerExited",
              stoppedReason: "Essential container in task exited",
              containers: [{ name: "main", exitCode: 0 }]
            }
          ]
        };
      }
    };
    const capsule = new Capsule({
      adapter: ecs({ cluster: "cluster-a", taskDefinition: "task-def:1", containerName: "main", client }),
      receipts: true
    });

    const status = await capsule.job.status({ id: "arn:task/123" });

    expect(status).toMatchObject({ id: "arn:task/123", provider: "ecs", status: "succeeded" });
    expect(status.receipt?.type).toBe("job.status");
    expect(status.receipt?.resource).toMatchObject({ id: "arn:task/123", status: "succeeded" });
    expect(status.receipt?.metadata).toMatchObject({
      cluster: "cluster-a",
      taskArn: "arn:task/123",
      lastStatus: "STOPPED",
      desiredStatus: "STOPPED",
      stopCode: "EssentialContainerExited",
      stoppedReason: "Essential container in task exited"
    });
    expect(sent[0]).toMatchObject({ cluster: "cluster-a", tasks: ["arn:task/123"] });
  });

  it("cancels ECS tasks with StopTask", async () => {
    const sent: any[] = [];
    const client = {
      send: async (command: any) => {
        sent.push(command.input);
        return {
          task: {
            taskArn: "arn:task/123",
            lastStatus: "STOPPED",
            desiredStatus: "STOPPED",
            stopCode: "UserInitiated",
            stoppedReason: "Task stopped by user"
          }
        };
      }
    };
    const capsule = new Capsule({
      adapter: ecs({ cluster: "cluster-a", taskDefinition: "task-def:1", containerName: "main", client }),
      receipts: true
    });

    const cancel = await capsule.job.cancel({ id: "arn:task/123", reason: "user requested cancellation" });

    expect(cancel).toMatchObject({ id: "arn:task/123", provider: "ecs", status: "cancelled" });
    expect(cancel.receipt?.type).toBe("job.cancel");
    expect(cancel.receipt?.metadata).toMatchObject({
      cluster: "cluster-a",
      taskArn: "arn:task/123",
      lastStatus: "STOPPED",
      stopCode: "UserInitiated",
      reason: "user requested cancellation"
    });
    expect(sent[0]).toMatchObject({ cluster: "cluster-a", task: "arn:task/123", reason: "user requested cancellation" });
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

  it("describes ECS service rollout status from DescribeServices", async () => {
    const sent: any[] = [];
    const client = {
      send: async (command: any) => {
        sent.push(command.input);
        return {
          services: [
            {
              serviceArn: "arn:service/api",
              serviceName: "api",
              status: "ACTIVE",
              desiredCount: 2,
              runningCount: 2,
              pendingCount: 0,
              deployments: [
                {
                  id: "ecs-svc/123",
                  status: "PRIMARY",
                  rolloutState: "COMPLETED",
                  desiredCount: 2,
                  runningCount: 2,
                  pendingCount: 0,
                  taskDefinition: "api:3"
                }
              ],
              events: [{ id: "event-1", message: "service reached a steady state" }]
            }
          ]
        };
      }
    };
    const capsule = new Capsule({
      adapter: ecs({ cluster: "cluster-a", taskDefinition: "api:3", containerName: "main", client }),
      receipts: true
    });

    const status = await capsule.service.status({ id: "api" });

    expect(status).toMatchObject({ id: "arn:service/api", provider: "ecs", name: "api", status: "ready" });
    expect(status.receipt?.type).toBe("service.status");
    expect(status.receipt?.resource).toMatchObject({ id: "arn:service/api", name: "api", status: "ready" });
    expect(status.metadata).toMatchObject({
      cluster: "cluster-a",
      serviceArn: "arn:service/api",
      serviceName: "api",
      status: "ACTIVE",
      desiredCount: 2,
      runningCount: 2,
      pendingCount: 0,
      deployments: [{ id: "ecs-svc/123", status: "PRIMARY", rolloutState: "COMPLETED", taskDefinition: "api:3" }]
    });
    expect(sent[0]).toMatchObject({ cluster: "cluster-a", services: ["api"] });
  });

  it("marks ECS service rollout failures as failed", async () => {
    const client = {
      send: async () => ({
        services: [
          {
            serviceArn: "arn:service/api",
            serviceName: "api",
            status: "ACTIVE",
            desiredCount: 2,
            runningCount: 1,
            pendingCount: 0,
            deployments: [{ id: "ecs-svc/123", status: "PRIMARY", rolloutState: "FAILED", rolloutStateReason: "deployment failed" }]
          }
        ]
      })
    };
    const capsule = new Capsule({
      adapter: ecs({ cluster: "cluster-a", taskDefinition: "api:3", containerName: "main", client })
    });

    await expect(capsule.service.status({ id: "api" })).resolves.toMatchObject({ status: "failed" });
  });

  it("scales ECS services to zero before deleting them", async () => {
    const sent: any[] = [];
    const client = {
      send: async (command: any) => {
        sent.push({ name: command.constructor.name, input: command.input });
        if (command.constructor.name === "UpdateServiceCommand") {
          return { service: { serviceArn: "arn:service/api", serviceName: "api", desiredCount: 0, runningCount: 1, pendingCount: 0 } };
        }
        return { service: { serviceArn: "arn:service/api", serviceName: "api", status: "DRAINING", desiredCount: 0, runningCount: 0, pendingCount: 0 } };
      }
    };
    const capsule = new Capsule({
      adapter: ecs({ cluster: "cluster-a", taskDefinition: "api:3", containerName: "main", client }),
      receipts: true
    });

    const deleted = await capsule.service.delete({ id: "api", force: true, reason: "cleanup" });

    expect(deleted).toMatchObject({ id: "arn:service/api", provider: "ecs", name: "api", status: "deleted" });
    expect(deleted.receipt?.type).toBe("service.delete");
    expect(deleted.metadata).toMatchObject({
      cluster: "cluster-a",
      serviceArn: "arn:service/api",
      serviceName: "api",
      semantics: "scale-to-zero-then-delete-service",
      reason: "cleanup",
      force: true
    });
    expect(sent).toEqual([
      { name: "UpdateServiceCommand", input: { cluster: "cluster-a", service: "api", desiredCount: 0 } },
      { name: "DeleteServiceCommand", input: { cluster: "cluster-a", service: "api", force: true } }
    ]);
  });
});
