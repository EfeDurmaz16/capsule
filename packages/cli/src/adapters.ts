// Lazy provider adapter loading for the CLI.
//
// Provider adapter packages pull in large SDKs (AWS, Kubernetes, Google auth, E2B, Daytona, Modal).
// Importing them eagerly made every invocation, including help and shell completion, pay their load
// time and memory. Each factory below is imported only when a command actually selects that adapter.
// Loading a module has no side effects beyond module evaluation: no client, credential lookup or
// network call happens until the returned factory is invoked by createCapsule.
import type { CapsuleAdapter } from "@capsule-sdk/core";

export const providerAdapterNames = [
  "azure-container-apps",
  "cloud-run",
  "cloudflare",
  "daytona",
  "docker",
  "e2b",
  "ec2",
  "ecs",
  "fly",
  "kubernetes",
  "lambda",
  "modal",
  "neon",
  "vercel"
] as const;

export type ProviderAdapterName = (typeof providerAdapterNames)[number];

export function isProviderAdapterName(value: string): value is ProviderAdapterName {
  return (providerAdapterNames as readonly string[]).includes(value);
}

// The CLI-relevant subset of parsed flags that adapter factories read.
export interface ProviderAdapterOptions {
  image?: string;
  database?: string;
  role?: string;
  apiUrl?: string;
  target?: string;
  appName?: string;
  compatibilityDate?: string;
  workersDevSubdomain?: string;
  zoneId?: string;
  projectId?: string;
  location?: string;
  projectName?: string;
  namespace?: string;
  context?: string;
  kubeconfig?: string;
  region?: string;
  functionName?: string;
  subscriptionId?: string;
  resourceGroup?: string;
  environmentId?: string;
  cluster?: string;
  taskDefinition?: string;
  containerName?: string;
  subnets?: string[];
  securityGroups?: string[];
  subnetId?: string;
  imageId?: string;
  instanceType?: string;
}

export async function loadProviderAdapter(name: ProviderAdapterName, options: ProviderAdapterOptions): Promise<CapsuleAdapter> {
  if (name === "ecs" && (!options.cluster || !options.taskDefinition || !options.containerName)) {
    throw new Error("ECS adapter requires --cluster, --task-definition, and --container-name");
  }
  switch (name) {
    case "azure-container-apps": {
      const { azureContainerApps } = await import("@capsule-sdk/azure");
      return azureContainerApps({
        subscriptionId: options.subscriptionId,
        resourceGroupName: options.resourceGroup,
        location: options.location,
        environmentId: options.environmentId
      });
    }
    case "cloud-run": {
      const { cloudRun } = await import("@capsule-sdk/cloud-run");
      return cloudRun({ projectId: options.projectId, location: options.location });
    }
    case "cloudflare": {
      const { cloudflare } = await import("@capsule-sdk/cloudflare");
      return cloudflare({ compatibilityDate: options.compatibilityDate, workersDevSubdomain: options.workersDevSubdomain, zoneId: options.zoneId });
    }
    case "daytona": {
      const { daytona } = await import("@capsule-sdk/daytona");
      return daytona({ apiUrl: options.apiUrl, target: options.target });
    }
    case "docker": {
      const { docker } = await import("@capsule-sdk/docker");
      return docker();
    }
    case "e2b": {
      const { e2b } = await import("@capsule-sdk/e2b");
      return e2b();
    }
    case "ec2": {
      const { ec2 } = await import("@capsule-sdk/ec2");
      return ec2({
        region: options.region,
        imageId: options.imageId,
        instanceType: options.instanceType,
        subnetId: options.subnetId,
        securityGroupIds: options.securityGroups
      });
    }
    case "ecs": {
      const { ecs } = await import("@capsule-sdk/ecs");
      return ecs({
        region: options.region,
        cluster: options.cluster as string,
        taskDefinition: options.taskDefinition as string,
        containerName: options.containerName as string,
        subnets: options.subnets,
        securityGroups: options.securityGroups
      });
    }
    case "fly": {
      const { fly } = await import("@capsule-sdk/fly");
      return fly({ appName: options.appName, region: options.region, defaultImage: options.image });
    }
    case "kubernetes": {
      const { kubernetes } = await import("@capsule-sdk/kubernetes");
      return kubernetes({ namespace: options.namespace, context: options.context, kubeconfigPath: options.kubeconfig });
    }
    case "lambda": {
      const { lambda } = await import("@capsule-sdk/lambda");
      return lambda({ region: options.region, functionName: options.functionName });
    }
    case "modal": {
      const { modal } = await import("@capsule-sdk/modal");
      return modal({ appName: options.appName, defaultImage: options.image });
    }
    case "neon": {
      const { neon } = await import("@capsule-sdk/neon");
      return neon({ databaseName: options.database, roleName: options.role });
    }
    case "vercel": {
      const { vercel } = await import("@capsule-sdk/vercel");
      return vercel({ project: options.projectName, target: options.target });
    }
  }
}

export async function dockerAvailableLazy(): Promise<boolean> {
  const { dockerAvailable } = await import("@capsule-sdk/docker");
  return await dockerAvailable();
}
