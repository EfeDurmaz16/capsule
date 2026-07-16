import { describe, expect, test } from "vitest";
import {
  AdapterExecutionError,
  ProviderAuthError,
  ProviderRateLimitError,
  ProviderRetryableError,
  ProviderValidationError,
  asProviderError,
  callProvider,
  classifySdkError
} from "./errors.js";

describe("classifySdkError", () => {
  test("maps AWS SDK http status codes to categories", () => {
    expect(classifySdkError({ name: "ThrottlingException", $metadata: { httpStatusCode: 429 } })).toMatchObject({
      category: "rate-limit",
      retryable: true,
      status: 429
    });
    expect(classifySdkError({ name: "AccessDeniedException", $metadata: { httpStatusCode: 403 } })).toMatchObject({
      category: "auth",
      retryable: false,
      status: 403
    });
    expect(classifySdkError({ name: "ValidationException", $metadata: { httpStatusCode: 400 } })).toMatchObject({
      category: "validation",
      retryable: false,
      status: 400
    });
    expect(classifySdkError({ $metadata: { httpStatusCode: 503 } })).toMatchObject({ category: "retryable", retryable: true, status: 503 });
  });

  test("maps Kubernetes client status codes from statusCode and body", () => {
    expect(classifySdkError({ statusCode: 409 })).toMatchObject({ category: "validation", retryable: false, status: 409 });
    expect(classifySdkError({ body: { code: 401, reason: "Unauthorized" } })).toMatchObject({ category: "auth", retryable: false, status: 401 });
  });

  test("falls back to SDK error names when no status is present", () => {
    expect(classifySdkError({ name: "RateLimitError" })).toMatchObject({ category: "rate-limit", retryable: true });
    expect(classifySdkError({ name: "AuthenticationError" })).toMatchObject({ category: "auth", retryable: false });
    expect(classifySdkError({ name: "TimeoutError" })).toMatchObject({ category: "retryable", retryable: true });
    expect(classifySdkError({ name: "ValidationException" })).toMatchObject({ category: "validation", retryable: false });
  });

  test("classifies Node system error codes as retryable", () => {
    expect(classifySdkError(Object.assign(new Error("boom"), { code: "ECONNRESET" }))).toMatchObject({ category: "retryable", retryable: true });
  });

  test("returns unknown for unrecognized errors", () => {
    expect(classifySdkError(new Error("mystery"))).toMatchObject({ category: "unknown", retryable: false });
  });
});

describe("asProviderError", () => {
  test("wraps SDK errors into typed provider errors with a providerError cause", () => {
    const error = asProviderError({ name: "ThrottlingException", message: "Rate exceeded", $metadata: { httpStatusCode: 429 } }, "fallback");
    expect(error).toBeInstanceOf(ProviderRateLimitError);
    expect(error.message).toBe("Rate exceeded");
    expect(error.cause).toMatchObject({ providerError: { category: "rate-limit", retryable: true, status: 429 } });
  });

  test("uses the fallback message when the error carries none", () => {
    const error = asProviderError({ $metadata: { httpStatusCode: 500 } }, "Provider call failed.");
    expect(error).toBeInstanceOf(ProviderRetryableError);
    expect(error.message).toBe("Provider call failed.");
  });

  test("maps auth failures to ProviderAuthError", () => {
    const error = asProviderError({ name: "AccessDeniedException", $metadata: { httpStatusCode: 403 } }, "fallback");
    expect(error).toBeInstanceOf(ProviderAuthError);
    expect(error.cause).toMatchObject({ providerError: { category: "auth", retryable: false, status: 403 } });
  });

  test("passes through existing AdapterExecutionError instances", () => {
    const original = new AdapterExecutionError("already wrapped");
    expect(asProviderError(original, "fallback")).toBe(original);
  });
});

describe("callProvider", () => {
  test("returns operation results untouched", async () => {
    await expect(callProvider("fallback", async () => 42)).resolves.toBe(42);
  });

  test("classifies thrown errors", async () => {
    await expect(
      callProvider("fallback", async () => {
        throw { statusCode: 400 };
      })
    ).rejects.toBeInstanceOf(ProviderValidationError);
  });

  test("does not double-wrap provider errors thrown from nested calls", async () => {
    const inner = asProviderError({ name: "AccessDeniedException", $metadata: { httpStatusCode: 403 } }, "inner");
    await expect(
      callProvider("outer", async () => {
        throw inner;
      })
    ).rejects.toBe(inner);
  });
});
