import { createMockAdapter } from "./factory.js";
import { capabilities } from "./capabilities.js";

export const mockModalCapabilities = capabilities({ sandbox: "native", job: "native", service: "experimental", preview: "experimental" });
export const mockModal = () => createMockAdapter({ name: "mock-modal", provider: "modal", capabilities: mockModalCapabilities });
