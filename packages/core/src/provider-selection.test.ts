import { describe, expect, test } from "vitest";
import {
  getProviderSelectionRecipe,
  providerSelectionRecipeIds,
  rankProvidersByRecipe,
  type CapabilityMap
} from "./index.js";

const sandboxNative: CapabilityMap = {
  sandbox: {
    create: "native",
    exec: "native",
    fileRead: "native",
    fileWrite: "native",
    fileList: "native",
    destroy: "native",
    exposePort: "experimental"
  }
};

const serviceNative: CapabilityMap = {
  service: {
    deploy: "native",
    update: "native",
    delete: "native",
    status: "native",
    logs: "native",
    url: "native"
  }
};

describe("provider selection recipes", () => {
  test("exposes typed built-in recipe ids with required capability requirements", () => {
    expect(providerSelectionRecipeIds).toEqual(["sandbox", "agent-code-execution", "preview-web-db", "edge-web", "service-api", "machine"]);
    expect(getProviderSelectionRecipe("agent-code-execution")).toMatchObject({
      id: "agent-code-execution",
      required: expect.arrayContaining([
        expect.objectContaining({ path: "sandbox.create" }),
        expect.objectContaining({ path: "sandbox.exec" }),
        expect.objectContaining({ path: "sandbox.fileWrite" })
      ]),
      optional: expect.arrayContaining([
        expect.objectContaining({ path: "sandbox.networkPolicy", optional: true }),
        expect.objectContaining({ path: "sandbox.artifacts", optional: true })
      ])
    });
  });

  test("ranks providers by declared support for a recipe", () => {
    const ranked = rankProvidersByRecipe(
      [
        { provider: "service-only", capabilities: serviceNative },
        { provider: "sandbox-native", capabilities: sandboxNative }
      ],
      "sandbox"
    );

    expect(ranked.map((entry) => entry.provider)).toEqual(["sandbox-native", "service-only"]);
    expect(ranked[0]).toMatchObject({
      provider: "sandbox-native",
      score: expect.any(Number),
      requiredSatisfied: 6,
      requiredTotal: 6,
      missingRequired: []
    });
    expect(ranked[1]?.missingRequired.map((entry) => entry.path)).toEqual([
      "sandbox.create",
      "sandbox.exec",
      "sandbox.fileRead",
      "sandbox.fileWrite",
      "sandbox.fileList",
      "sandbox.destroy"
    ]);
  });
});
