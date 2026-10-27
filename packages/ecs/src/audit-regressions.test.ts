// Audit regressions for the M1 campaign (ECS). Each test asserts the INTENDED behavior from the M1
// manifest and is marked it.fails while the defect is present on the baseline (7d3a28a). The owner who
// fixes an ID flips its it.fails to it in the same commit. The client is an injected fake.
import { describe, expect, it } from "vitest";
import { Capsule, PendingOperationError } from "@capsule-sdk/core";
import { ecs } from "./index.js";

describe("M1 audit regressions: ecs", () => {
  it("AWS-04: a DRAINING service with running tasks is never reported deleted", async () => {
    let rejection: unknown;
    const capsule = new Capsule({
      adapter: ecs({
        cluster: "audit",
        taskDefinition: "audit:1",
        containerName: "main",
        deleteObservation: { deadlineMs: 50, intervalMs: 5 },
        client: {
          send: async () => ({
            service: { serviceArn: "arn:audit", status: "DRAINING", runningCount: 1 },
            services: [{ serviceArn: "arn:audit", status: "DRAINING", runningCount: 1 }]
          })
        } as never
      }),
      receipts: true
    });
    const outcome = await Promise.race([
      capsule.service.delete({ id: "arn:audit", force: true }).then(
        (value) => ({ state: "resolved" as const, status: value.status as string, receiptStatus: value.receipt?.resource?.status }),
        (error: unknown) => {
          rejection = error;
          return { state: "rejected" as const, status: undefined, receiptStatus: undefined };
        }
      ),
      new Promise<{ state: "pending"; status: undefined; receiptStatus: undefined }>((resolve) =>
        setTimeout(() => resolve({ state: "pending", status: undefined, receiptStatus: undefined }), 1000)
      )
    ]);
    expect(outcome.status).not.toBe("deleted");
    expect(outcome.receiptStatus).not.toBe("deleted");
    expect(outcome.state).toBe("rejected");
    expect(rejection).toBeInstanceOf(PendingOperationError);
    expect(rejection).toMatchObject({ operation: "service.delete", state: "DRAINING", resource: { provider: "ecs", kind: "service", nativeId: "arn:audit" } });
  });
});

// GAP-14 fixtures are DOC-DERIVED, not recorded live responses. They are shaped from the documented
// DescribeServices Service/Deployment fields (currentServiceDeployment, deployments[].status,
// rolloutState) and the DescribeServiceDeployments ServiceDeployment fields (status, statusReason,
// rollback) in the Amazon ECS API Reference and the "View service history using Amazon ECS service
// deployments" guide, read on 27 Oct 2026. Documented lifecycle: a circuit-breaker rollback moves the
// failing service deployment itself to ROLLBACK_IN_PROGRESS and then ROLLBACK_SUCCESSFUL or ROLLBACK_FAILED;
// a user who starts a new deployment moves the old one to STOP_REQUESTED and gets a new service deployment
// that starts PENDING or IN_PROGRESS. Free-text values (statusReason, rollback.reason) are placeholders.
const serviceArn = "arn:aws:ecs:us-east-1:111122223333:service/audit/api";
const currentArn = "arn:aws:ecs:us-east-1:111122223333:service-deployment/audit/api/doc-derived-current";

function describedService(overrides: Record<string, unknown> = {}) {
  return {
    serviceArn,
    serviceName: "api",
    status: "ACTIVE",
    desiredCount: 2,
    runningCount: 2,
    pendingCount: 0,
    currentServiceDeployment: currentArn,
    deployments: [
      { id: "ecs-svc/doc-derived-primary", status: "PRIMARY", rolloutState: "IN_PROGRESS", taskDefinition: "api:4", desiredCount: 2, runningCount: 1 },
      { id: "ecs-svc/doc-derived-failed", status: "ACTIVE", rolloutState: "FAILED", taskDefinition: "api:3", desiredCount: 0, runningCount: 1 }
    ],
    ...overrides
  };
}

function statusClient(service: Record<string, unknown>, serviceDeployments: (() => Promise<unknown>) | Record<string, unknown>) {
  const sent: string[] = [];
  return {
    sent,
    client: {
      send: async (command: { constructor: { name: string } }) => {
        sent.push(command.constructor.name);
        if (command.constructor.name === "DescribeServicesCommand") return { services: [service], failures: [] };
        if (command.constructor.name === "DescribeServiceDeploymentsCommand") {
          return typeof serviceDeployments === "function" ? serviceDeployments() : { serviceDeployments: [serviceDeployments], failures: [] };
        }
        throw new Error(`unexpected ${command.constructor.name}`);
      }
    }
  };
}

async function statusOf(client: unknown) {
  const capsule = new Capsule({
    adapter: ecs({ cluster: "audit", taskDefinition: "api:4", containerName: "main", client: client as never }),
    receipts: true
  });
  return capsule.service.status({ id: "api" });
}

describe("GAP-14: an older FAILED deployment next to a PRIMARY deployment that did not fail", () => {
  it("a superseding deployment in progress reports deploying, not failed", async () => {
    const fake = statusClient(describedService(), { serviceDeploymentArn: currentArn, serviceArn, status: "IN_PROGRESS" });
    const status = await statusOf(fake.client);
    expect(status.status).toBe("deploying");
    expect(status.receipt?.resource?.status).toBe("deploying");
    expect(fake.sent).toEqual(["DescribeServicesCommand", "DescribeServiceDeploymentsCommand"]);
    expect(status.metadata).toMatchObject({
      currentServiceDeployment: currentArn,
      serviceDeployment: { source: "describe-service-deployments", serviceDeploymentArn: currentArn, status: "IN_PROGRESS" }
    });
  });

  it("a superseding deployment that completed reports ready while the failed one still drains", async () => {
    const service = describedService({
      deployments: [
        { id: "ecs-svc/doc-derived-primary", status: "PRIMARY", rolloutState: "COMPLETED", taskDefinition: "api:4", desiredCount: 2, runningCount: 2 },
        { id: "ecs-svc/doc-derived-failed", status: "ACTIVE", rolloutState: "FAILED", taskDefinition: "api:3", desiredCount: 0, runningCount: 1 }
      ]
    });
    const fake = statusClient(service, { serviceDeploymentArn: currentArn, serviceArn, status: "SUCCESSFUL" });
    await expect(statusOf(fake.client)).resolves.toMatchObject({ status: "ready" });
  });

  it.each(["ROLLBACK_REQUESTED", "ROLLBACK_IN_PROGRESS", "ROLLBACK_SUCCESSFUL", "ROLLBACK_FAILED", "STOP_REQUESTED", "STOPPED", "A_FUTURE_STATE"])(
    "a current service deployment in %s keeps failed",
    async (deploymentStatus) => {
      const fake = statusClient(describedService(), {
        serviceDeploymentArn: currentArn,
        serviceArn,
        status: deploymentStatus,
        statusReason: "doc-derived placeholder",
        rollback: { reason: "doc-derived placeholder", startedAt: new Date("2026-10-27T00:00:00.000Z"), serviceRevisionArn: "arn:doc-derived:revision" }
      });
      const status = await statusOf(fake.client);
      expect(status.status).toBe("failed");
      expect(status.metadata).toMatchObject({ serviceDeployment: { source: "describe-service-deployments", status: deploymentStatus } });
    }
  );

  it("keeps failed when DescribeServices names no current service deployment", async () => {
    const fake = statusClient(describedService({ currentServiceDeployment: undefined }), {});
    const status = await statusOf(fake.client);
    expect(status.status).toBe("failed");
    expect(fake.sent).toEqual(["DescribeServicesCommand"]);
    expect(status.metadata).toMatchObject({ serviceDeployment: { source: "unavailable" } });
  });

  it("keeps failed when the service deployment cannot be read and names the provider error", async () => {
    const denied = Object.assign(new Error("not authorized to perform ecs:DescribeServiceDeployments"), { name: "AccessDeniedException" });
    const fake = statusClient(describedService(), async () => {
      throw denied;
    });
    const status = await statusOf(fake.client);
    expect(status.status).toBe("failed");
    expect(status.metadata).toMatchObject({ serviceDeployment: { source: "unavailable", reason: expect.stringContaining("AccessDeniedException") } });
  });

  it("keeps failed when the returned service deployment is missing or belongs to another service", async () => {
    const missing = statusClient(describedService(), async () => ({ serviceDeployments: [], failures: [{ arn: currentArn, reason: "MISSING" }] }));
    await expect(statusOf(missing.client)).resolves.toMatchObject({ status: "failed" });
    const foreign = statusClient(describedService(), { serviceDeploymentArn: currentArn, serviceArn: `${serviceArn}-other`, status: "IN_PROGRESS" });
    await expect(statusOf(foreign.client)).resolves.toMatchObject({ status: "failed" });
  });

  it("a FAILED PRIMARY deployment reports failed without a second read", async () => {
    const service = describedService({
      deployments: [{ id: "ecs-svc/doc-derived-primary", status: "PRIMARY", rolloutState: "FAILED", taskDefinition: "api:4" }]
    });
    const fake = statusClient(service, { serviceDeploymentArn: currentArn, serviceArn, status: "IN_PROGRESS" });
    await expect(statusOf(fake.client)).resolves.toMatchObject({ status: "failed" });
    expect(fake.sent).toEqual(["DescribeServicesCommand"]);
  });
});
