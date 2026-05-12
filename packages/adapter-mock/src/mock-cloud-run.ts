import { createMockAdapter } from "./factory.js";
import { capabilities } from "./capabilities.js";

export const mockCloudRunCapabilities = capabilities({ job: "native", service: "native", preview: "experimental" });
export const mockCloudRun = () => createMockAdapter({ name: "mock-cloud-run", provider: "cloud-run", capabilities: mockCloudRunCapabilities });
