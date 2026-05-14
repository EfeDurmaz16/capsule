import { describe, expect, test } from "vitest";
import { classifyProviderService, providerServiceClassifications } from "./index.js";

describe("provider service classifier", () => {
  test("classifies Stripe Projects style Neon Postgres resources as database resources", () => {
    expect(classifyProviderService({ provider: "neon", service: "postgres" })).toMatchObject({
      provider: "neon",
      service: "postgres",
      matchedBy: "exact",
      classification: {
        domains: ["database", "resource"],
        likelyCapabilities: ["database.branchCreate", "database.branchDelete", "database.branchReset", "database.connectionString"],
        notCapabilities: ["service.deploy", "edge.deploy", "machine.create"]
      }
    });
  });

  test("distinguishes Fly managed Postgres from Fly Machines", () => {
    expect(classifyProviderService({ provider: "fly", service: "mpg" })).toMatchObject({
      classification: {
        domains: ["database", "resource"],
        likelyCapabilities: ["database.connectionString"],
        notCapabilities: ["machine.create", "job.run", "edge.deploy"]
      }
    });
    expect(classifyProviderService({ provider: "fly", service: "machines" })).toMatchObject({
      classification: {
        domains: ["machine", "job"],
        likelyCapabilities: expect.arrayContaining(["machine.create", "job.run"])
      }
    });
  });

  test("matches provider service aliases without changing the declared classification", () => {
    expect(classifyProviderService({ provider: "cloudflare", service: "worker" })).toMatchObject({
      matchedBy: "alias",
      classification: {
        provider: "cloudflare",
        service: "workers",
        domains: ["edge"]
      }
    });
  });

  test("returns explicit no-claim notes for unknown provider services", () => {
    expect(classifyProviderService({ provider: "unknown-cloud", service: "magic-runtime" })).toEqual({
      provider: "unknown-cloud",
      service: "magic-runtime",
      notes: [
        "No built-in Capsule classification exists for this provider service.",
        "Add an explicit classification before claiming domain or capability support."
      ]
    });
  });

  test("exports a non-empty registry for docs and CLI use", () => {
    expect(providerServiceClassifications.length).toBeGreaterThan(5);
    expect(providerServiceClassifications.map((entry) => `${entry.provider}/${entry.service}`)).toContain("cloudflare/workers");
  });
});
