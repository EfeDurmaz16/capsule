import { createMockAdapter } from "./factory.js";
import { capabilities } from "./capabilities.js";

export const mockECSCapabilities = capabilities({ job: "native", service: "native", preview: "experimental" });
export const mockECS = () => createMockAdapter({ name: "mock-ecs", provider: "ecs", capabilities: mockECSCapabilities });
