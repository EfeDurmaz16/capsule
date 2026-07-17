import { createMockAdapter } from "./factory.js";
import { capabilities } from "./capabilities.js";

export const mockDaytonaCapabilities = capabilities({ sandbox: "native", job: "emulated", preview: "experimental" });
export const mockDaytona = () => createMockAdapter({ name: "mock-daytona", provider: "daytona", capabilities: mockDaytonaCapabilities });
