export class CapsuleError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly cause?: unknown
  ) {
    super(message);
    this.name = "CapsuleError";
  }
}

export const capabilityModelDocsUrl = "https://github.com/EfeDurmaz16/capsule/blob/main/docs/capability-model.md";

export const unsupportedCapabilitySafeRetryGuidance =
  "Safe retry: inspect adapter capabilities or choose a supported adapter before retrying; Capsule failed before provider execution.";

export class UnsupportedCapabilityError extends CapsuleError {
  constructor(
    public readonly capabilityPath: string,
    public readonly remediation?: string
  ) {
    super(unsupportedCapabilityMessage(capabilityPath, remediation), "CAPSULE_UNSUPPORTED_CAPABILITY");
    this.name = "UnsupportedCapabilityError";
  }
}

function unsupportedCapabilityMessage(capabilityPath: string, remediation?: string): string {
  const remediationText = remediation ?? `Choose an adapter that supports ${capabilityPath} or change the workflow requirements.`;
  return `Capability is unsupported: ${capabilityPath}. ${remediationText} Docs: ${capabilityModelDocsUrl}. ${unsupportedCapabilitySafeRetryGuidance}`;
}

export class PolicyViolationError extends CapsuleError {
  constructor(
    message: string,
    public readonly notes: string[] = []
  ) {
    super(message, "CAPSULE_POLICY_VIOLATION");
    this.name = "PolicyViolationError";
  }
}

export class AdapterExecutionError extends CapsuleError {
  constructor(message: string, cause?: unknown, code = "CAPSULE_ADAPTER_EXECUTION_ERROR") {
    super(message, code, cause);
    this.name = "AdapterExecutionError";
  }
}

export type ProviderErrorCategory = "retryable" | "rate-limit" | "auth" | "validation" | "unknown";

export interface ProviderErrorClassification {
  category: ProviderErrorCategory;
  retryable: boolean;
  status?: number;
  retryAfterMs?: number;
  code?: string;
}

export class ProviderAuthError extends AdapterExecutionError {
  constructor(
    message: string,
    public readonly classification: ProviderErrorClassification,
    cause?: unknown
  ) {
    super(message, cause, "CAPSULE_PROVIDER_AUTH_ERROR");
    this.name = "ProviderAuthError";
  }
}

export class ProviderValidationError extends AdapterExecutionError {
  constructor(
    message: string,
    public readonly classification: ProviderErrorClassification,
    cause?: unknown
  ) {
    super(message, cause, "CAPSULE_PROVIDER_VALIDATION_ERROR");
    this.name = "ProviderValidationError";
  }
}

export class ProviderRateLimitError extends AdapterExecutionError {
  constructor(
    message: string,
    public readonly classification: ProviderErrorClassification,
    cause?: unknown
  ) {
    super(message, cause, "CAPSULE_PROVIDER_RATE_LIMIT_ERROR");
    this.name = "ProviderRateLimitError";
  }
}

export class ProviderRetryableError extends AdapterExecutionError {
  constructor(
    message: string,
    public readonly classification: ProviderErrorClassification,
    cause?: unknown
  ) {
    super(message, cause, "CAPSULE_PROVIDER_RETRYABLE_ERROR");
    this.name = "ProviderRetryableError";
  }
}

export class CleanupFailureError<TCleanup extends object = object> extends AdapterExecutionError {
  constructor(
    message: string,
    public readonly cleanup: TCleanup,
    cause?: unknown
  ) {
    super(message, cause, "CAPSULE_CLEANUP_FAILURE");
    this.name = "CleanupFailureError";
  }
}

export function providerExecutionError(message: string, classification: ProviderErrorClassification, cause?: unknown): AdapterExecutionError {
  const errorCause = providerCause(cause, classification);
  switch (classification.category) {
    case "auth":
      return new ProviderAuthError(message, classification, errorCause);
    case "validation":
      return new ProviderValidationError(message, classification, errorCause);
    case "rate-limit":
      return new ProviderRateLimitError(message, classification, errorCause);
    case "retryable":
      return new ProviderRetryableError(message, classification, errorCause);
    case "unknown":
      return new AdapterExecutionError(message, errorCause);
  }
}

export interface ClassifyProviderErrorInput {
  status?: number;
  code?: string | number;
  headers?: { get(name: string): string | null } | Record<string, string | null | undefined>;
  error?: unknown;
}

const rateLimitSignals = ["rate_limited", "too_many_requests", "resource_exhausted"];
const authSignals = ["unauthenticated", "permission_denied", "unauthorized", "forbidden", "invalid_token", "missing_credentials"];
const retryableSignals = ["unavailable", "deadline_exceeded", "internal", "timeout", "timedout", "etimedout", "econnreset", "temporarily_unavailable"];
const validationSignals = ["invalid_argument", "failed_precondition", "not_found", "already_exists", "bad_request", "conflict", "invalid", "missing"];

export function classifyProviderError(input: ClassifyProviderErrorInput): ProviderErrorClassification {
  const status = normalizeStatus(input.status);
  const code = normalizeCode(input.code ?? extractErrorField(input.error, ["code", "status", "reason"]));
  const signal = `${code ?? ""} ${normalizeCode(extractErrorField(input.error, ["message", "error_description"])) ?? ""}`.toLowerCase().replace(/[\s-]+/g, "_");
  const retryAfterMs = retryAfter(input.headers);

  if (status === 429 || matches(signal, rateLimitSignals)) {
    return classification("rate-limit", true, status, retryAfterMs, code);
  }
  if (status === 401 || status === 403 || matches(signal, authSignals)) {
    return classification("auth", false, status, retryAfterMs, code);
  }
  if (status === 408 || status === 425 || (status !== undefined && status >= 500) || matches(signal, retryableSignals)) {
    return classification("retryable", true, status, retryAfterMs, code);
  }
  if (status === 400 || status === 404 || status === 409 || status === 422 || matches(signal, validationSignals)) {
    return classification("validation", false, status, retryAfterMs, code);
  }
  return classification("unknown", false, status, retryAfterMs, code);
}

function classification(
  category: ProviderErrorCategory,
  retryable: boolean,
  status?: number,
  retryAfterMs?: number,
  code?: string
): ProviderErrorClassification {
  return {
    category,
    retryable,
    ...(status === undefined ? {} : { status }),
    ...(retryAfterMs === undefined ? {} : { retryAfterMs }),
    ...(code === undefined ? {} : { code })
  };
}

function providerCause(cause: unknown, classification: ProviderErrorClassification): unknown {
  if (cause === undefined) {
    return { providerError: classification };
  }
  if (cause instanceof Error) {
    return { providerError: classification, cause };
  }
  if (isRecord(cause)) {
    return "providerError" in cause ? cause : { ...cause, providerError: classification };
  }
  return { providerError: classification, cause };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizeStatus(status: number | undefined): number | undefined {
  return typeof status === "number" && Number.isInteger(status) && status > 0 ? status : undefined;
}

function normalizeCode(value: unknown): string | undefined {
  return typeof value === "string" || typeof value === "number" ? String(value) : undefined;
}

function extractErrorField(error: unknown, keys: string[]): unknown {
  if (!error || typeof error !== "object") {
    return typeof error === "string" ? error : undefined;
  }
  const record = error as Record<string, unknown>;
  for (const key of keys) {
    if (record[key] !== undefined) return record[key];
  }
  for (const nestedKey of ["error", "data"]) {
    const nested = extractErrorField(record[nestedKey], keys);
    if (nested !== undefined) return nested;
  }
  if (Array.isArray(record.errors)) {
    for (const item of record.errors) {
      const nested = extractErrorField(item, keys);
      if (nested !== undefined) return nested;
    }
  }
  return undefined;
}

function matches(signal: string, values: string[]): boolean {
  return values.some((value) => signal.includes(value));
}

function retryAfter(headers: ClassifyProviderErrorInput["headers"]): number | undefined {
  const value = headerValue(headers, "retry-after");
  if (!value) return undefined;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) return Math.round(seconds * 1000);
  const date = Date.parse(value);
  return Number.isNaN(date) ? undefined : Math.max(0, date - Date.now());
}

function headerValue(headers: ClassifyProviderErrorInput["headers"], name: string): string | undefined {
  if (!headers) return undefined;
  if ("get" in headers && typeof headers.get === "function") return headers.get(name) ?? undefined;
  const lowerName = name.toLowerCase();
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() === lowerName) return value ?? undefined;
  }
  return undefined;
}
