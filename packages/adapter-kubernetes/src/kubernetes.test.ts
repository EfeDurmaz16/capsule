import { describe, expect, it } from "vitest";
import { AdapterExecutionError, Capsule, runAdapterContract } from "@capsule/core";
import { kubernetes, kubernetesCapabilities } from "./index.js";

describe("kubernetes adapter", () => {
  it("runs the shared adapter contract suite", async () => {
    await runAdapterContract(kubernetes());
  });

  it("declares job and service capabilities", () => {
    expect(kubernetesCapabilities.job?.run).toBe("native");
    expect(kubernetesCapabilities.job?.status).toBe("native");
    expect(kubernetesCapabilities.job?.cancel).toBe("native");
    expect(kubernetesCapabilities.job?.logs).toBe("native");
    expect(kubernetesCapabilities.service?.deploy).toBe("native");
    expect(kubernetesCapabilities.service?.status).toBe("native");
    expect(kubernetesCapabilities.service?.delete).toBe("native");
    expect(kubernetesCapabilities.service?.logs).toBe("native");
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

  it("reads Job pod logs through the selector and redacts literal pod env values", async () => {
    const lists: Array<{ namespace: string; labelSelector?: string }> = [];
    const logReads: Array<{
      namespace: string;
      name: string;
      container?: string;
      follow?: boolean;
      sinceSeconds?: number;
      stream?: "Stdout" | "Stderr";
      tailLines?: number;
      timestamps?: boolean;
    }> = [];
    const capsule = new Capsule({
      adapter: kubernetes({
        namespace: "jobs",
        clients: {
          batch: {
            createNamespacedJob: async () => ({}),
            readNamespacedJob: async () => ({
              metadata: { name: "build-job", uid: "job-uid" },
              spec: {
                selector: {
                  matchLabels: { "batch.kubernetes.io/job-name": "build-job", "capsule.dev/run": "abc" },
                  matchExpressions: [{ key: "capsule.dev/component", operator: "In", values: ["worker", "runner"] }]
                }
              },
              status: { active: 1 }
            })
          },
          apps: { createNamespacedDeployment: async () => ({}) },
          core: {
            createNamespacedService: async () => ({}),
            listNamespacedPod: async (input) => {
              lists.push(input);
              return {
                items: [
                  {
                    metadata: { name: "build-job-pod" },
                    spec: { containers: [{ name: "main", env: [{ name: "SECRET", value: "shh" }] }] }
                  }
                ]
              };
            },
            readNamespacedPodLog: async (input) => {
              logReads.push(input);
              return "2026-05-13T10:00:00Z stdout shh\n2026-05-13T10:00:01Z stderr shh\n";
            }
          }
        }
      }),
      policy: { secrets: { redactFromLogs: true } },
      receipts: true
    });

    const logs = await capsule.job.logs({ id: "build-job", since: "2026-05-13T09:59:50Z", limit: 10, follow: false });

    expect(lists).toEqual([{ namespace: "jobs", labelSelector: "batch.kubernetes.io/job-name=build-job,capsule.dev/run=abc,capsule.dev/component in (worker,runner)" }]);
    expect(logReads).toEqual([
      {
        namespace: "jobs",
        name: "build-job-pod",
        container: "main",
        sinceSeconds: expect.any(Number),
        tailLines: 10,
        timestamps: true
      }
    ]);
    expect(logs).toMatchObject({
      id: "build-job",
      provider: "kubernetes",
      logs: [
        { timestamp: "2026-05-13T10:00:00Z", stream: "stdout", message: "stdout [REDACTED]" },
        { timestamp: "2026-05-13T10:00:01Z", stream: "stdout", message: "stderr [REDACTED]" }
      ],
      metadata: {
        namespace: "jobs",
        selector: "batch.kubernetes.io/job-name=build-job,capsule.dev/run=abc,capsule.dev/component in (worker,runner)",
        selectorSource: "job.spec.selector",
        podNames: ["build-job-pod"],
        redactedFromPodEnv: true
      }
    });
    expect(logs.receipt?.type).toBe("job.logs");
  });

  it("rejects Job logs when the Job has no selector", async () => {
    const capsule = new Capsule({
      adapter: kubernetes({
        namespace: "jobs",
        clients: {
          batch: {
            createNamespacedJob: async () => ({}),
            readNamespacedJob: async () => ({ metadata: { name: "selectorless" }, spec: {}, status: {} })
          },
          apps: { createNamespacedDeployment: async () => ({}) },
          core: {
            createNamespacedService: async () => ({}),
            listNamespacedPod: async () => ({ items: [] }),
            readNamespacedPodLog: async () => ""
          }
        }
      })
    });

    await expect(capsule.job.logs({ id: "selectorless" })).rejects.toThrow(AdapterExecutionError);
  });

  it("rejects Kubernetes follow-mode logs until streaming is explicitly modeled", async () => {
    const capsule = new Capsule({
      adapter: kubernetes({
        namespace: "jobs",
        clients: {
          batch: {
            createNamespacedJob: async () => ({}),
            readNamespacedJob: async () => ({ metadata: { name: "build-job" }, spec: { selector: { matchLabels: { app: "build" } } }, status: {} })
          },
          apps: { createNamespacedDeployment: async () => ({}) },
          core: {
            createNamespacedService: async () => ({}),
            listNamespacedPod: async () => ({ items: [] }),
            readNamespacedPodLog: async () => ""
          }
        }
      })
    });

    await expect(capsule.job.logs({ id: "build-job", follow: true })).rejects.toThrow("follow mode is not supported");
  });

  it("serializes expression-only Job selectors", async () => {
    const lists: Array<{ namespace: string; labelSelector?: string }> = [];
    const capsule = new Capsule({
      adapter: kubernetes({
        namespace: "jobs",
        clients: {
          batch: {
            createNamespacedJob: async () => ({}),
            readNamespacedJob: async () => ({
              metadata: { name: "expr-job" },
              spec: { selector: { matchExpressions: [{ key: "job-tier", operator: "Exists" }, { key: "phase", operator: "NotIn", values: ["done"] }] } },
              status: {}
            })
          },
          apps: { createNamespacedDeployment: async () => ({}) },
          core: {
            createNamespacedService: async () => ({}),
            listNamespacedPod: async (input) => {
              lists.push(input);
              return { items: [] };
            },
            readNamespacedPodLog: async () => ""
          }
        }
      })
    });

    await capsule.job.logs({ id: "expr-job" });

    expect(lists).toEqual([{ namespace: "jobs", labelSelector: "job-tier,phase notin (done)" }]);
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

  it("reads Deployment and LoadBalancer Service status with an external URL", async () => {
    const reads = {
      deployments: [] as Array<{ namespace: string; name: string }>,
      services: [] as Array<{ namespace: string; name: string }>
    };
    const capsule = new Capsule({
      adapter: kubernetes({
        namespace: "preview",
        clients: {
          batch: { createNamespacedJob: async () => ({}) },
          apps: {
            createNamespacedDeployment: async () => ({}),
            readNamespacedDeployment: async (input) => {
              reads.deployments.push(input);
              return {
                metadata: { name: "api", uid: "deployment-uid" },
                spec: { replicas: 2 },
                status: { readyReplicas: 2, availableReplicas: 2 }
              };
            },
            deleteNamespacedDeployment: async () => ({})
          },
          core: {
            createNamespacedService: async () => ({}),
            readNamespacedService: async (input) => {
              reads.services.push(input);
              return {
                metadata: { name: "api", uid: "service-uid" },
                spec: { type: "LoadBalancer", ports: [{ port: 8080 }] },
                status: { loadBalancer: { ingress: [{ hostname: "api.example.test" }] } }
              };
            },
            deleteNamespacedService: async () => ({})
          }
        }
      }),
      receipts: true
    });

    const status = await capsule.service.status({ id: "api" });

    expect(status).toMatchObject({
      id: "api",
      provider: "kubernetes",
      name: "api",
      status: "ready",
      url: "http://api.example.test:8080"
    });
    expect(status.receipt?.type).toBe("service.status");
    expect(reads.deployments).toEqual([{ namespace: "preview", name: "api" }]);
    expect(reads.services).toEqual([{ namespace: "preview", name: "api" }]);
  });

  it("falls back to the cluster-local Service URL when LoadBalancer ingress is not assigned", async () => {
    const capsule = new Capsule({
      adapter: kubernetes({
        namespace: "internal",
        clients: {
          batch: { createNamespacedJob: async () => ({}) },
          apps: {
            createNamespacedDeployment: async () => ({}),
            readNamespacedDeployment: async () => ({
              metadata: { name: "worker" },
              spec: { replicas: 1 },
              status: { readyReplicas: 0, availableReplicas: 0 }
            })
          },
          core: {
            createNamespacedService: async () => ({}),
            readNamespacedService: async () => ({
              metadata: { name: "worker" },
              spec: { type: "ClusterIP", ports: [{ port: 9090 }] },
              status: {}
            })
          }
        }
      })
    });

    await expect(capsule.service.status({ id: "worker" })).resolves.toMatchObject({
      status: "deploying",
      url: "http://worker.internal.svc.cluster.local:9090"
    });
  });

  it("deletes the Deployment and Service in the configured namespace", async () => {
    const deletions = {
      deployments: [] as Array<{ namespace: string; name: string; gracePeriodSeconds?: number; propagationPolicy?: string; body?: unknown }>,
      services: [] as Array<{ namespace: string; name: string; gracePeriodSeconds?: number; propagationPolicy?: string; body?: unknown }>
    };
    const capsule = new Capsule({
      adapter: kubernetes({
        namespace: "preview",
        clients: {
          batch: { createNamespacedJob: async () => ({}) },
          apps: {
            createNamespacedDeployment: async () => ({}),
            deleteNamespacedDeployment: async (input) => {
              deletions.deployments.push(input);
              return { metadata: { name: input.name, uid: "deployment-uid" } };
            }
          },
          core: {
            createNamespacedService: async () => ({}),
            deleteNamespacedService: async (input) => {
              deletions.services.push(input);
              return { metadata: { name: input.name, uid: "service-uid" } };
            }
          }
        }
      }),
      receipts: true
    });

    await expect(capsule.service.delete({ id: "api", reason: "cleanup" })).resolves.toMatchObject({
      id: "api",
      provider: "kubernetes",
      status: "deleted",
      metadata: { namespace: "preview", reason: "cleanup" }
    });
    const expectedDeleteOptions = {
      apiVersion: "v1",
      kind: "DeleteOptions",
      gracePeriodSeconds: 0,
      propagationPolicy: "Foreground"
    };
    expect(deletions.deployments).toEqual([
      { namespace: "preview", name: "api", gracePeriodSeconds: 0, propagationPolicy: "Foreground", body: expectedDeleteOptions }
    ]);
    expect(deletions.services).toEqual([
      { namespace: "preview", name: "api", gracePeriodSeconds: 0, propagationPolicy: "Foreground", body: expectedDeleteOptions }
    ]);
  });

  it("reads Service pod logs through service.spec.selector", async () => {
    const lists: Array<{ namespace: string; labelSelector?: string }> = [];
    const logReads: Array<{ namespace: string; name: string; container?: string; stream?: "Stdout" | "Stderr"; tailLines?: number; timestamps?: boolean }> = [];
    const capsule = new Capsule({
      adapter: kubernetes({
        namespace: "preview",
        clients: {
          batch: { createNamespacedJob: async () => ({}) },
          apps: { createNamespacedDeployment: async () => ({}) },
          core: {
            createNamespacedService: async () => ({}),
            readNamespacedService: async () => ({
              metadata: { name: "api", uid: "service-uid" },
              spec: { selector: { "app.kubernetes.io/name": "api", "app.kubernetes.io/managed-by": "capsule" } }
            }),
            listNamespacedPod: async (input) => {
              lists.push(input);
              return {
                items: [
                  {
                    metadata: { name: "api-pod-a" },
                    spec: { containers: [{ name: "web" }, { name: "sidecar" }] }
                  }
                ]
              };
            },
            readNamespacedPodLog: async (input) => {
              logReads.push(input);
              return `2026-05-13T10:01:00.123456789Z ${input.container} ready\n`;
            }
          }
        }
      })
    });

    const logs = await capsule.service.logs({ id: "api", limit: 2 });

    expect(lists).toEqual([{ namespace: "preview", labelSelector: "app.kubernetes.io/managed-by=capsule,app.kubernetes.io/name=api" }]);
    expect(logReads).toEqual([
      { namespace: "preview", name: "api-pod-a", container: "web", tailLines: 2, timestamps: true },
      { namespace: "preview", name: "api-pod-a", container: "sidecar", tailLines: 2, timestamps: true }
    ]);
    expect(logs).toMatchObject({
      id: "api",
      provider: "kubernetes",
      name: "api",
      logs: [
        { timestamp: "2026-05-13T10:01:00.123456789Z", stream: "stdout", message: "web ready" },
        { timestamp: "2026-05-13T10:01:00.123456789Z", stream: "stdout", message: "sidecar ready" }
      ],
      metadata: {
        namespace: "preview",
        selector: "app.kubernetes.io/managed-by=capsule,app.kubernetes.io/name=api",
        selectorSource: "service.spec.selector",
        podNames: ["api-pod-a"]
      }
    });
  });

  it("rejects Service logs when the Service has no pod selector", async () => {
    const capsule = new Capsule({
      adapter: kubernetes({
        namespace: "preview",
        clients: {
          batch: { createNamespacedJob: async () => ({}) },
          apps: { createNamespacedDeployment: async () => ({}) },
          core: {
            createNamespacedService: async () => ({}),
            readNamespacedService: async () => ({ metadata: { name: "external" }, spec: { type: "ExternalName" } }),
            listNamespacedPod: async () => ({ items: [] }),
            readNamespacedPodLog: async () => ""
          }
        }
      })
    });

    await expect(capsule.service.logs({ id: "external" })).rejects.toThrow(AdapterExecutionError);
  });
});
