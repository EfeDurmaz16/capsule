import { createMockAdapter } from "./factory.js";
import { capabilities } from "./capabilities.js";

export const mockNeonCapabilities = capabilities({
  databaseBranchCreate: "native",
  databaseBranchDelete: "native",
  databaseConnectionString: "native",
  preview: "experimental"
});
export const mockNeon = () => createMockAdapter({ name: "mock-neon", provider: "neon", capabilities: mockNeonCapabilities });
