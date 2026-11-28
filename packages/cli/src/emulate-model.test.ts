import { afterEach, describe, expect, test, vi } from "vitest";
import { modelScenarioOperations } from "./emulate-catalog.js";
import { runModelScenario } from "./emulate-model.js";

afterEach(() => vi.unstubAllGlobals());

describe("credential-free Capsule model scenarios", () => {
  test.each(Object.entries(modelScenarioOperations))("%s runs every advertised operation with deterministic evidence", async (provider, operations) => {
    const fetch = vi.fn(() => {
      throw new Error("Unexpected network request");
    });
    vi.stubGlobal("fetch", fetch);
    const first = await runModelScenario(provider);
    const second = await runModelScenario(provider);
    expect(second).toEqual(first);
    expect(first).toMatchObject({ provider, evidence: "model", operations });
    expect(first.result.resourceId).toBeTruthy();
    expect(first.assertions.length).toBeGreaterThan(1);
    expect(fetch).not.toHaveBeenCalled();
  });

  test.each(["unknown", "__proto__", "constructor"])("refuses unknown provider %s", async (name) => {
    await expect(runModelScenario(name)).rejects.toThrow("Unknown emulation provider");
  });
});
