import { describe, expect, it } from "vitest";
import {
  AdapterExecutionError,
  Capsule,
  capsuleOperationTag,
  CleanupFailureError,
  PendingOperationError,
  ProviderRetryableError,
  ProviderValidationError,
  runAdapterContract
} from "@capsule-sdk/core";
import { ecs, ecsCapabilities } from "./index.js";

function awsError(name: string, httpStatusCode: number, message = name): Error {
  return Object.assign(new Error(message), { name, $metadata: { httpStatusCode } });
}

function failingEcs(error: Error) {
  return ecs({ cluster: "contract", taskDefinition: "contract:1", containerName: "main", client: { send: async () => Promise.reject(error) } });
}

describe("ecs adapter", () => {
  it("runs the shared adapter contract suite and classifies provider failures", async () => {
    await runAdapterContract(failingEcs(awsError("InvalidParameterException", 400, "invalid task definition")), {
      failureScenarios: [
        {
          name: "ECS invalid parameters surface as validation provider errors",
          exercise: (capsule) => capsule.job.status({ id: "arn:task/1" }),
          expectError: (error) => {
            expect(error).toBeInstanceOf(ProviderValidationError);
            expect((error as AdapterExecutionError).cause).toMatchObject({ providerError: { category: "validation", retryable: false, status: 400 } });
          }
        }
      ]
    });
  });

  it("classifies ECS server failures as retryable provider errors", async () => {
    const capsule = new Capsule({ adapter: failingEcs(awsError("ServiceUnavailableException", 503, "service unavailable")) });

    let thrown: unknown;
    try {
      await capsule.job.status({ id: "arn:task/2" });
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(ProviderRetryableError);
    expect((thrown as Error).message).toBe("service unavailable");
    expect((thrown as AdapterExecutionError).cause).toMatchObject({ providerError: { category: "retryable", retryable: true, status: 503 } });
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
      labels: { capsule: "true" },
      idempotencyKey: "ecs-run-key"
    });

    expect(run.status).toBe("running");
    expect(run.receipt?.type).toBe("job.run");
    expect(run.receipt?.metadata).toMatchObject({ taskArn: "arn:task/123", lastStatus: "PENDING" });
    expect(sent[0]).toMatchObject({
      cluster: "cluster-a",
      taskDefinition: "task-def:1",
      launchType: "FARGATE",
      networkConfiguration: { awsvpcConfiguration: { subnets: ["subnet-1"], securityGroups: ["sg-1"], assignPublicIp: "DISABLED" } },
      tags: expect.arrayContaining([
        { key: "capsule", value: "true" },
        { key: "capsule_operation_scope", value: "job_run" }
      ]),
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
    const deployment = await capsule.service.deploy({ name: "api", image: "ignored", scale: { min: 2 }, idempotencyKey: "ecs-service-key" });

    expect(deployment).toMatchObject({ id: "arn:service/api", provider: "ecs", status: "deploying" });
    expect(deployment.receipt?.type).toBe("service.deploy");
    expect(sent[0]).toMatchObject({ cluster: "cluster-a", serviceName: "api", taskDefinition: "api:3", launchType: "EC2", desiredCount: 2 });
    expect(sent[0].tags).toEqual(expect.arrayContaining([{ key: "capsule_operation_scope", value: "service_deploy" }]));
  });

  it("deletes created ECS services when deploy fails after CreateService", async () => {
    const sent: any[] = [];
    const client = {
      send: async (command: any) => {
        sent.push({ name: command.constructor.name, input: command.input });
        if (command.constructor.name === "CreateServiceCommand") {
          return { service: { serviceArn: "arn:service/api", serviceName: "api" } };
        }
        return { service: { serviceArn: "arn:service/api", serviceName: "api", status: "DRAINING" } };
      }
    };
    const capsule = new Capsule({
      adapter: ecs({ cluster: "cluster-a", taskDefinition: "api:3", containerName: "main", client }),
      receipts: true,
      receiptSigner: {
        algorithm: "test-signature",
        sign: () => {
          throw new Error("receipt signing failed");
        }
      }
    });

    let thrown: unknown;
    try {
      await capsule.service.deploy({ name: "api", image: "ignored", scale: { min: 2 } });
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(Error);
    expect((thrown as Error).message).toBe("receipt signing failed");
    // DeleteService answered DRAINING: deletion was accepted, not completed.
    expect((thrown as { cleanup?: Record<string, unknown> }).cleanup).toMatchObject({
      action: "delete-created-service",
      service: "arn:service/api",
      status: "pending",
      providerStatus: "DRAINING",
      cluster: "cluster-a"
    });
    expect(sent).toEqual([
      { name: "CreateServiceCommand", input: { cluster: "cluster-a", serviceName: "api", taskDefinition: "api:3", launchType: "FARGATE", desiredCount: 2 } },
      { name: "DeleteServiceCommand", input: { cluster: "cluster-a", service: "arn:service/api", force: true } }
    ]);
  });

  it("wraps ECS cleanup failures after service deploy errors", async () => {
    const client = {
      send: async (command: any) => {
        if (command.constructor.name === "CreateServiceCommand") {
          return { service: { serviceArn: "arn:service/api", serviceName: "api" } };
        }
        if (command.constructor.name === "DeleteServiceCommand") {
          throw new Error("ecs delete failed");
        }
        return {};
      }
    };
    const capsule = new Capsule({
      adapter: ecs({ cluster: "cluster-a", taskDefinition: "api:3", containerName: "main", client }),
      receipts: true,
      receiptSigner: {
        algorithm: "test-signature",
        sign: () => {
          throw new Error("receipt signing failed");
        }
      }
    });

    let thrown: unknown;
    try {
      await capsule.service.deploy({ name: "api", image: "ignored", scale: { min: 2 } });
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(CleanupFailureError);
    expect((thrown as Error).message).toBe("ECS service cleanup failed after service creation.");
    expect((thrown as { cleanup?: Record<string, unknown> }).cleanup).toMatchObject({
      action: "delete-created-service",
      service: "arn:service/api",
      status: "failed",
      cluster: "cluster-a",
      error: "ecs delete failed"
    });
    expect((thrown as CleanupFailureError).cause).toMatchObject({
      operationError: expect.objectContaining({ message: "receipt signing failed" })
    });
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
        if (command.constructor.name === "DescribeServicesCommand") {
          return { services: [{ serviceArn: "arn:service/api", serviceName: "api", status: "INACTIVE", desiredCount: 0, runningCount: 0, pendingCount: 0 }] };
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
      force: true,
      status: "INACTIVE",
      deletion: { acknowledgedStatus: "DRAINING", observedTerminal: "INACTIVE", observations: 1 }
    });
    expect(sent).toEqual([
      { name: "UpdateServiceCommand", input: { cluster: "cluster-a", service: "api", desiredCount: 0 } },
      { name: "DeleteServiceCommand", input: { cluster: "cluster-a", service: "api", force: true } },
      { name: "DescribeServicesCommand", input: { cluster: "cluster-a", services: ["arn:service/api"] } }
    ]);
  });
  it("decides stopped task completion from the configured main container only", async () => {
    const statusFor = async (stopCode: string, containers: Array<{ name: string; exitCode?: number; reason?: string; lastStatus?: string }>) => {
      const capsule = new Capsule({
        adapter: ecs({
          cluster: "cluster-a",
          taskDefinition: "task-def:1",
          containerName: "main",
          client: { send: async () => ({ tasks: [{ taskArn: "arn:task/9", lastStatus: "STOPPED", stopCode, containers }] }) }
        })
      });
      return capsule.job.status({ id: "arn:task/9" });
    };
    // A non-essential helper failing does not fail a main container that completed.
    expect(
      (
        await statusFor("EssentialContainerExited", [
          { name: "helper", exitCode: 1 },
          { name: "main", exitCode: 0 }
        ])
      ).status
    ).toBe("succeeded");
    // A main container that never produced an exit code is not rescued by a helper that exited 0.
    const neverRan = await statusFor("TaskFailedToStart", [
      { name: "helper", exitCode: 0, lastStatus: "STOPPED" },
      { name: "main", reason: "CannotPullContainerError", lastStatus: "STOPPED" }
    ]);
    expect(neverRan.status).toBe("failed");
    expect(neverRan.metadata).toMatchObject({
      stopCode: "TaskFailedToStart",
      completionContainer: "main",
      containers: [
        { name: "helper", exitCode: 0, lastStatus: "STOPPED" },
        { name: "main", reason: "CannotPullContainerError", lastStatus: "STOPPED" }
      ]
    });
    expect(
      (
        await statusFor("EssentialContainerExited", [
          { name: "main", exitCode: 2 },
          { name: "helper", exitCode: 0 }
        ])
      ).status
    ).toBe("failed");
    expect((await statusFor("EssentialContainerExited", [{ name: "helper", exitCode: 0 }])).status).toBe("failed");
  });
  it("observes a DRAINING deletion until ECS reports the service INACTIVE, MISSING or not found", async () => {
    const scenario = async (terminal: () => unknown) => {
      let describes = 0;
      const client = {
        send: async (command: any) => {
          const name = command.constructor.name;
          if (name === "UpdateServiceCommand") return { service: { serviceArn: "arn:service/api", desiredCount: 0, runningCount: 0, pendingCount: 0 } };
          if (name === "DeleteServiceCommand") return { service: { serviceArn: "arn:service/api", serviceName: "api", status: "DRAINING", runningCount: 0 } };
          describes += 1;
          if (describes < 3) return { services: [{ serviceArn: "arn:service/api", serviceName: "api", status: "DRAINING", runningCount: 1 }] };
          return terminal();
        }
      };
      const capsule = new Capsule({
        adapter: ecs({ cluster: "cluster-a", taskDefinition: "api:3", containerName: "main", deleteObservation: { deadlineMs: 5_000, intervalMs: 1 }, client }),
        receipts: true
      });
      const deleted = await capsule.service.delete({ id: "api", force: true });
      return { deleted, describes };
    };

    const inactive = await scenario(() => ({ services: [{ serviceArn: "arn:service/api", serviceName: "api", status: "INACTIVE" }] }));
    expect(inactive.describes).toBe(3);
    expect(inactive.deleted).toMatchObject({
      status: "deleted",
      metadata: { deletion: { acknowledgedStatus: "DRAINING", observedTerminal: "INACTIVE", observations: 3 } }
    });
    expect(inactive.deleted.receipt?.resource).toMatchObject({ status: "deleted" });

    const missing = await scenario(() => ({ services: [], failures: [{ arn: "arn:service/api", reason: "MISSING" }] }));
    expect(missing.deleted.metadata).toMatchObject({ deletion: { observedTerminal: "MISSING" } });

    const notFound = await scenario(() => Promise.reject(awsError("ServiceNotFoundException", 400, "Service not found.")));
    expect(notFound.deleted.metadata).toMatchObject({ deletion: { observedTerminal: "not-found" } });
  });

  it("resolves without observing when DeleteService already reports INACTIVE", async () => {
    const sent: string[] = [];
    const client = {
      send: async (command: any) => {
        sent.push(command.constructor.name);
        if (command.constructor.name === "UpdateServiceCommand") return { service: { serviceArn: "arn:service/api", runningCount: 0, pendingCount: 0 } };
        return { service: { serviceArn: "arn:service/api", serviceName: "api", status: "INACTIVE" } };
      }
    };
    const capsule = new Capsule({ adapter: ecs({ cluster: "cluster-a", taskDefinition: "api:3", containerName: "main", client }) });
    await expect(capsule.service.delete({ id: "api", force: true })).resolves.toMatchObject({
      status: "deleted",
      metadata: { deletion: { acknowledgedStatus: "INACTIVE", observedTerminal: "INACTIVE", observations: 0 } }
    });
    expect(sent).toEqual(["UpdateServiceCommand", "DeleteServiceCommand"]);
  });

  it("reports a deletion still DRAINING at the deadline as pending with a safe locator and no receipt", async () => {
    const receipts: unknown[] = [];
    const client = {
      send: async (command: any) => {
        if (command.constructor.name === "DescribeServicesCommand")
          return { services: [{ serviceArn: "arn:aws:ecs:us-east-1:1:service/c/api", status: "DRAINING", runningCount: 2 }] };
        return { service: { serviceArn: "arn:aws:ecs:us-east-1:1:service/c/api", status: "DRAINING", runningCount: 2 } };
      }
    };
    const capsule = new Capsule({
      adapter: ecs({
        region: "us-east-1",
        cluster: "c",
        taskDefinition: "api:3",
        containerName: "main",
        deleteObservation: { deadlineMs: 30, intervalMs: 5 },
        client
      }),
      receipts: true,
      receiptStore: { write: (receipt: unknown) => void receipts.push(receipt) } as never
    });
    const error = await capsule.service.delete({ id: "api", force: true }).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(PendingOperationError);
    expect(error).toMatchObject({
      code: "CAPSULE_OPERATION_PENDING",
      outcome: "pending",
      operation: "service.delete",
      state: "DRAINING",
      deadlineMs: 30,
      resource: { provider: "ecs", kind: "service", nativeId: "arn:aws:ecs:us-east-1:1:service/c/api", scope: { cluster: "c", region: "us-east-1" } }
    });
    expect(receipts).toEqual([]);
  });
  it("waits for scale-down to drain running tasks before a non-forced DeleteService", async () => {
    const sent: Array<{ name: string; input: any }> = [];
    let deleted = false;
    let drainDescribes = 0;
    const client = {
      send: async (command: any) => {
        const name = command.constructor.name;
        sent.push({ name, input: command.input });
        if (name === "UpdateServiceCommand")
          return { service: { serviceArn: "arn:service/api", status: "ACTIVE", desiredCount: 0, runningCount: 1, pendingCount: 0 } };
        if (name === "DeleteServiceCommand") {
          deleted = true;
          return { service: { serviceArn: "arn:service/api", status: "DRAINING", runningCount: 0 } };
        }
        if (deleted) return { services: [{ serviceArn: "arn:service/api", status: "INACTIVE" }] };
        drainDescribes += 1;
        return { services: [{ serviceArn: "arn:service/api", status: "ACTIVE", desiredCount: 0, runningCount: drainDescribes < 2 ? 1 : 0, pendingCount: 0 }] };
      }
    };
    const capsule = new Capsule({
      adapter: ecs({ cluster: "cluster-a", taskDefinition: "api:3", containerName: "main", deleteObservation: { deadlineMs: 5_000, intervalMs: 1 }, client })
    });
    await expect(capsule.service.delete({ id: "api" })).resolves.toMatchObject({ status: "deleted" });
    expect(sent.map((entry) => entry.name)).toEqual([
      "UpdateServiceCommand",
      "DescribeServicesCommand",
      "DescribeServicesCommand",
      "DeleteServiceCommand",
      "DescribeServicesCommand"
    ]);
    expect(sent[3]?.input).toEqual({ cluster: "cluster-a", service: "api", force: undefined });
  });

  it("does not call DeleteService when scale-down tasks are still running at the deadline", async () => {
    const sent: string[] = [];
    const client = {
      send: async (command: any) => {
        sent.push(command.constructor.name);
        if (command.constructor.name === "DescribeServicesCommand")
          return { services: [{ serviceArn: "arn:service/api", status: "ACTIVE", runningCount: 1, pendingCount: 0 }] };
        return { service: { serviceArn: "arn:service/api", status: "ACTIVE", desiredCount: 0, runningCount: 1, pendingCount: 0 } };
      }
    };
    const capsule = new Capsule({
      adapter: ecs({ cluster: "cluster-a", taskDefinition: "api:3", containerName: "main", deleteObservation: { deadlineMs: 30, intervalMs: 5 }, client })
    });
    const error = await capsule.service.delete({ id: "api" }).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(PendingOperationError);
    expect(error).toMatchObject({ operation: "service.delete", state: "ACTIVE runningCount=1 pendingCount=0" });
    expect(sent).not.toContain("DeleteServiceCommand");
  });

  // The observation deadline aborts the in-flight DescribeServices through its abortSignal, so the
  // injected client must receive send()'s options through the error-classifying wrapper.
  it.each([
    { phase: "scale-down drain", force: false },
    { phase: "INACTIVE observation", force: true }
  ])("hands the observation abortSignal to the client during the $phase", async ({ force }) => {
    const describeOptions: Array<{ abortSignal?: AbortSignal } | undefined> = [];
    const client = {
      send: async (command: any, options?: { abortSignal?: AbortSignal }) => {
        const name = command.constructor.name;
        if (name === "UpdateServiceCommand")
          return { service: { serviceArn: "arn:service/api", status: "ACTIVE", desiredCount: 0, runningCount: 1, pendingCount: 0 } };
        if (name === "DeleteServiceCommand") return { service: { serviceArn: "arn:service/api", status: "DRAINING" } };
        describeOptions.push(options);
        // Like the SDK, settle only when the request is aborted.
        return new Promise((_resolve, reject) => options?.abortSignal?.addEventListener("abort", () => reject(options.abortSignal?.reason)));
      }
    };
    const capsule = new Capsule({
      adapter: ecs({ cluster: "cluster-a", taskDefinition: "api:3", containerName: "main", deleteObservation: { deadlineMs: 30, intervalMs: 5 }, client })
    });
    const error = await capsule.service.delete({ id: "api", force }).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(PendingOperationError);
    expect(describeOptions).toHaveLength(1);
    expect(describeOptions[0]?.abortSignal).toBeInstanceOf(AbortSignal);
    expect(describeOptions[0]?.abortSignal?.aborted).toBe(true);
  });

  it("maps a job idempotency key to a hashed RunTask clientToken scoped to region and cluster", async () => {
    const inputs: any[] = [];
    const runWith = async (options: { region?: string; cluster: string }, idempotencyKey?: string) => {
      const capsule = new Capsule({
        adapter: ecs({
          ...options,
          taskDefinition: "task-def:1",
          containerName: "main",
          client: {
            send: async (command: any) => {
              inputs.push(command.input);
              return { tasks: [{ taskArn: "arn:task/1", lastStatus: "PENDING" }] };
            }
          }
        }),
        receipts: true
      });
      const run = await capsule.job.run({ image: "intent", command: ["true"], idempotencyKey });
      return { token: inputs.at(-1).clientToken as string | undefined, run };
    };
    const first = await runWith({ region: "us-east-1", cluster: "a" }, "order-42");
    const retry = await runWith({ region: "us-east-1", cluster: "a" }, "order-42");
    expect(first.token).toBe(retry.token);
    expect(first.token).toBe(capsuleOperationTag({ idempotencyKey: "order-42", capabilityPath: "job.run", idempotencyScope: "ecs:job.run:us-east-1:a" }));
    expect(first.token).toMatch(/^[0-9a-f]{32}$/);
    expect(first.token).not.toContain("order-42");
    expect((await runWith({ region: "us-east-1", cluster: "b" }, "order-42")).token).not.toBe(first.token);
    expect((await runWith({ region: "eu-west-1", cluster: "a" }, "order-42")).token).not.toBe(first.token);
    expect((await runWith({ region: "us-east-1", cluster: "a" }, "order-43")).token).not.toBe(first.token);
    expect((await runWith({ region: "us-east-1", cluster: "a" })).token).toBeUndefined();
    expect(first.run.receipt?.policy.notes?.some((note) => note.includes("RunTask clientToken") && note.includes("not an exactly-once guarantee"))).toBe(true);
  });

  it("surfaces a clientToken ConflictException as a provider error instead of a started job", async () => {
    const conflict = Object.assign(new Error("The specified client token is already in use."), {
      name: "ConflictException",
      $fault: "client",
      $metadata: { httpStatusCode: 400 },
      resourceIds: ["arn:task/original"]
    });
    const capsule = new Capsule({
      adapter: ecs({ cluster: "a", taskDefinition: "task-def:1", containerName: "main", client: { send: async () => Promise.reject(conflict) } })
    });
    const error = await capsule.job.run({ image: "intent", command: ["true"], idempotencyKey: "order-42" }).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(AdapterExecutionError);
    expect((error as AdapterExecutionError).cause).toMatchObject({ cause: { name: "ConflictException", resourceIds: ["arn:task/original"] } });
  });
});
