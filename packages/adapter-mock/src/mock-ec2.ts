import { createMockAdapter } from "./factory.js";
import { capabilities } from "./capabilities.js";

export const mockEC2Capabilities = capabilities({ job: "emulated", service: "emulated", machine: "native" });
export const mockEC2 = () => createMockAdapter({ name: "mock-ec2", provider: "ec2", capabilities: mockEC2Capabilities });
