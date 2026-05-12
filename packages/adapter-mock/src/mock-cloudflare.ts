import { createMockAdapter } from "./factory.js";
import { capabilities } from "./capabilities.js";

export const mockCloudflareCapabilities = capabilities({
  sandbox: "experimental",
  job: "experimental",
  service: "experimental",
  edge: "native",
  database: "experimental",
  preview: "experimental"
});
export const mockCloudflare = () => createMockAdapter({ name: "mock-cloudflare", provider: "cloudflare", capabilities: mockCloudflareCapabilities });
