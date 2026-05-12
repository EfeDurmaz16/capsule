import { createMockAdapter } from "./factory.js";
import { capabilities } from "./capabilities.js";

export const mockE2BCapabilities = capabilities({ sandbox: "native", job: "emulated" });
export const mockE2B = () => createMockAdapter({ name: "mock-e2b", provider: "e2b", capabilities: mockE2BCapabilities });
