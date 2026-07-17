import { createMockAdapter } from "./factory.js";
import { capabilities } from "./capabilities.js";

export const mockLambdaCapabilities = capabilities({ job: "native", edge: "experimental" });
export const mockLambda = () => createMockAdapter({ name: "mock-lambda", provider: "lambda", capabilities: mockLambdaCapabilities });
