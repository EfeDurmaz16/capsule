import { createMockAdapter } from "./factory.js";
import { capabilities } from "./capabilities.js";

export const mockVercelCapabilities = capabilities({ service: "experimental", edge: "native", preview: "experimental" });
export const mockVercel = () => createMockAdapter({ name: "mock-vercel", provider: "vercel", capabilities: mockVercelCapabilities });
