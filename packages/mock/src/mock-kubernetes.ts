import { createMockAdapter } from "./factory.js";
import { capabilities } from "./capabilities.js";

export const mockKubernetesCapabilities = capabilities({
  sandbox: "experimental",
  job: "native",
  service: "native",
  database: "experimental",
  preview: "experimental",
  machine: "experimental"
});
export const mockKubernetes = () => createMockAdapter({ name: "mock-kubernetes", provider: "kubernetes", capabilities: mockKubernetesCapabilities });
