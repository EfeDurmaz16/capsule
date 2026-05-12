import { describe, expect, it } from "vitest";
import { Capsule, runAdapterContract } from "@capsule/core";
import { kubernetes, kubernetesCapabilities } from "./index.js";

describe("kubernetes adapter", () => {
  it("runs the shared adapter contract suite", async () => {
    await runAdapterContract(kubernetes());
  });

  it("declares job and service capabilities", () => {
    expect(kubernetesCapabilities.job?.run).toBe("native");
    expect(kubernetesCapabilities.job?.status).toBe("native");
    expect(kubernetesCapabilities.job?.cancel).toBe("native");
    expect(kubernetesCapabilities.service?.deploy).toBe("native");
    expect(kubernetesCapabilities.service?.url).toBe("experimental");
  });

  it("creates a Kubernetes Job from RunJobSpec", async () => {
    const calls: Array<{ namespace: string; body: any }> = [];
    const capsule = new Capsule({
      adapter: kubernetes({
        namespace: "capsule",
        clients: {
          batch: {
            createNamespacedJob: async (input) => {
              calls.push(input);
              return { metadata: { uid: "job-uid", name: "build-job" } };
            }
          },
          apps: { createNamespacedDeployment: async () => ({}) },
          core: { createNamespacedService: async () => ({}) }
        }
      }),
      receipts: true
    });

    const run = await capsule.job.run({
      name: "Build Job",
      image: "node:22",
      command: ["node", "index.js"],
      env: { NODE_ENV: "test" },
      timeoutMs: 45_000,
      resources: { cpu: 1, memoryMb: 512 },
      labels: { "capsule.dev/example": "true" }
    });

    expect(run.id).toBe("build-job");
    expect(run.status).toBe("running");
    expect(run.receipt?.type).toBe("job.run");
    expect(run.receipt?.metadata).toMatchObject({ kubernetesName: "build-job", uid: "job-uid" });
    expect(calls[0]?.namespace).toBe("capsule");
    expect(calls[0]?.body).toMatchObject({
      apiVersion: "batch/v1",
      kind: "Job",
      metadata: { name: "build-job" },
      spec: {
        activeDeadlineSeconds: 45,
        template: {
          spec: {
            restartPolicy: "Never",
            containers: [
              {
                name: "main",
                image: "node:22",
                command: ["node"],
                args: ["index.js"],
                env: [{ name: "NODE_ENV", value: "test" }],
                resources: { limits: { cpu: "1", memory: "512Mi" } }
              }
            ]
          }
        }
      }
    });
  });

  it("reads Kubernetes Job status phases from the Batch API", async () => {
    const jobs: Record<string, any> = {
      queued: { metadata: { name: "queued", uid: "uid-queued" }, status: {} },
      running: { metadata: { name: "running" }, status: { active: 1 } },
      succeeded: { metadata: { name: "succeeded" }, status: { conditions: [{ type: "Complete", status: "True" }] } },
      failed: { metadata: { name: "failed" }, status: { conditions: [{ type: "Failed", status: "True" }] } },
      deleted: { metadata: { name: "deleted", deletionTimestamp: "2026-05-13T00:00:00Z" }, status: { active: 1 } }
    };
    const reads: Array<{ namespace: string; name: string }> = [];
    const capsule = new Capsule({
      adapter: kubernetes({
        namespace: "jobs",
        clients: {
          batch: {
            createNamespacedJob: async () => ({}),
            readNamespacedJob: async (input) => {
              reads.push(input);
              return jobs[input.name];
            },
            deleteNamespacedJob: async () => ({})
          },
          apps: { createNamespacedDeployment: async () => ({}) },
          core: { createNamespacedService: async () => ({}) }
        }
      })
    });

    await expect(capsule.job.status({ id: "queued" })).resolves.toMatchObject({ id: "queued", provider: "kubernetes", status: "queued" });
    await expect(capsule.job.status({ id: "running" })).resolves.toMatchObject({ id: "running", provider: "kubernetes", status: "running" });
    await expect(capsule.job.status({ id: "succeeded" })).resolves.toMatchObject({ id: "succeeded", provider: "kubernetes", status: "succeeded" });
    await expect(capsule.job.status({ id: "failed" })).resolves.toMatchObject({ id: "failed", provider: "kubernetes", status: "failed" });
    await expect(capsule.job.status({ id: "deleted" })).resolves.toMatchObject({ id: "deleted", provider: "kubernetes", status: "cancelled" });
    expect(reads).toEqual([
      { namespace: "jobs", name: "queued" },
      { namespace: "jobs", name: "running" },
      { namespace: "jobs", name: "succeeded" },
      { namespace: "jobs", name: "failed" },
      { namespace: "jobs", name: "deleted" }
    ]);
  });

  it("maps cancel to an explicit foreground Job deletion request", async () => {
    const deletes: Array<{ namespace: string; name: string; gracePeriodSeconds?: number; propagationPolicy?: string; body?: unknown }> = [];
    const capsule = new Capsule({
      adapter: kubernetes({
        namespace: "jobs",
        clients: {
          batch: {
            createNamespacedJob: async () => ({}),
            readNamespacedJob: async () => ({}),
            deleteNamespacedJob: async (input) => {
              deletes.push(input);
              return { metadata: { name: input.name, uid: "job-uid" } };
            }
          },
          apps: { createNamespacedDeployment: async () => ({}) },
          core: { createNamespacedService: async () => ({}) }
        }
      })
    });

    await expect(capsule.job.cancel({ id: "build-job", reason: "user requested stop" })).resolves.toMatchObject({
      id: "build-job",
      provider: "kubernetes",
      status: "cancelling",
      metadata: {
        namespace: "jobs",
        kubernetesName: "build-job",
        reason: "user requested stop",
        semantics: "delete-job-foreground"
      }
    });
    expect(deletes).toEqual([
      {
        namespace: "jobs",
        name: "build-job",
        gracePeriodSeconds: 0,
        propagationPolicy: "Foreground",
        body: {
          apiVersion: "v1",
          kind: "DeleteOptions",
          gracePeriodSeconds: 0,
          propagationPolicy: "Foreground"
        }
      }
    ]);
  });

  it("creates a Deployment and Service from DeployServiceSpec", async () => {
    const deployments: Array<{ namespace: string; body: any }> = [];
    const services: Array<{ namespace: string; body: any }> = [];
    const capsule = new Capsule({
      adapter: kubernetes({
        namespace: "preview",
        clients: {
          batch: { createNamespacedJob: async () => ({}) },
          apps: {
            createNamespacedDeployment: async (input) => {
              deployments.push(input);
              return { metadata: { uid: "deployment-uid", name: "api" } };
            }
          },
          core: {
            createNamespacedService: async (input) => {
              services.push(input);
              return { metadata: { uid: "service-uid", name: "api" } };
            }
          }
        }
      }),
      receipts: true
    });

    const deployment = await capsule.service.deploy({
      name: "api",
      image: "ghcr.io/example/api:latest",
      ports: [{ port: 8080, public: true, protocol: "http" }],
      scale: { min: 2, max: 5 },
      healthcheck: { path: "/healthz" },
      env: { NODE_ENV: "production" }
    });

    expect(deployment).toMatchObject({
      id: "deployment-uid",
      provider: "kubernetes",
      status: "deploying",
      url: "http://api.preview.svc.cluster.local:8080"
    });
    expect(deployment.receipt?.type).toBe("service.deploy");
    expect(deployments[0]?.body).toMatchObject({
      apiVersion: "apps/v1",
      kind: "Deployment",
      spec: {
        replicas: 2,
        template: {
          spec: {
            containers: [{ image: "ghcr.io/example/api:latest", ports: [{ containerPort: 8080, protocol: "TCP" }] }]
          }
        }
      }
    });
    expect(services[0]?.body).toMatchObject({
      apiVersion: "v1",
      kind: "Service",
      spec: { type: "LoadBalancer", ports: [{ port: 8080, targetPort: 8080, protocol: "TCP" }] }
    });
  });
});
