export class CapsuleError extends Error {
  constructor(message: string, public readonly code: string, public readonly cause?: unknown) {
    super(message);
    this.name = "CapsuleError";
  }
}

export class UnsupportedCapabilityError extends CapsuleError {
  constructor(public readonly capabilityPath: string) {
    super(`Capability is unsupported: ${capabilityPath}`, "CAPSULE_UNSUPPORTED_CAPABILITY");
    this.name = "UnsupportedCapabilityError";
  }
}

export class PolicyViolationError extends CapsuleError {
  constructor(message: string, public readonly notes: string[] = []) {
    super(message, "CAPSULE_POLICY_VIOLATION");
    this.name = "PolicyViolationError";
  }
}

export class AdapterExecutionError extends CapsuleError {
  constructor(message: string, cause?: unknown) {
    super(message, "CAPSULE_ADAPTER_EXECUTION_ERROR", cause);
    this.name = "AdapterExecutionError";
  }
}
