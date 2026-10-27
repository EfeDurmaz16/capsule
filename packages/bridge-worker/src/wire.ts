// Wire types of bridge protocol v1. The specification is Fabric's docs/bridge-protocol.md; the golden
// fixtures in protocol/bridge/v1 are part of it. Wire fields are snake_case to match Fabric's frame
// convention. Inside the worker, Capsule types keep their own camelCase names.

/** The one bridge protocol major this worker speaks. */
export const PROTOCOL_VERSION = 1;

/**
 * The worker identity sent in hello_ack. It is protocol-visible: the shared scenarios compare it
 * exactly, so it changes only together with the fixtures.
 */
export const WORKER_ID = "capsule-worker/0.1.0";

/** Fabric to worker, every frame including hello, and worker hello_ack / hello_refused: 1 MiB. */
export const MAX_REQUEST_BYTES = 1 << 20;
/** Every other worker frame: 16 MiB. */
export const MAX_FRAME_BYTES = 16 << 20;
/** The most requests and observes this worker runs at once. hello_ack lowers Fabric's value to it. */
export const WORKER_MAX_IN_FLIGHT = 4;
/** The most stderr bytes this worker writes per connection. */
export const WORKER_MAX_STDERR_BYTES = 65_536;
/** Largest drain a shutdown may ask for. */
export const MAX_DRAIN_MS = 30_000;

export const ACTIONS = ["sandbox.create", "sandbox.exec", "sandbox.destroy"] as const;
export type BridgeAction = (typeof ACTIONS)[number];

export interface WireLocator {
  provider: string;
  scope: Record<string, string>;
  kind: string;
  native_id: string;
  native_operation_id?: string;
}

export interface HelloLimits {
  max_request_bytes: number;
  max_frame_bytes: number;
  max_in_flight: number;
  max_stderr_bytes: number;
}

export interface Hello {
  type: "hello";
  versions: { min: number; max: number };
  fabric: string;
  profile: string;
  limits: HelloLimits;
}

export interface OperationRef {
  id: string;
  key: string;
  digest: string;
}

export interface RequestScope {
  job: string;
  task: string;
  attempt: string;
  generation: string;
}

export interface CreateParams {
  image: string;
  env: Record<string, string>;
  secret_names: string[];
  labels: Record<string, string>;
}

export interface ExecParams {
  argv: string[];
  stdin: string | null;
  cwd: string | null;
  timeout_ms: number;
  max_output_bytes: number;
  secret_names: string[];
}

export type DestroyParams = Record<string, never>;

export interface RequestPolicy {
  secrets?: { allowed?: string[] };
}

interface RequestBase {
  type: "request";
  request_id: string;
  operation: OperationRef;
  scope: RequestScope;
  approval: { ref: string } | null;
  policy?: RequestPolicy;
  deadline_ms: number;
}

export type BridgeRequest =
  | (RequestBase & { action: "sandbox.create"; params: CreateParams })
  | (RequestBase & { action: "sandbox.exec"; target: WireLocator; params: ExecParams })
  | (RequestBase & { action: "sandbox.destroy"; target: WireLocator; params: DestroyParams });

export interface Observe {
  type: "observe";
  request_id: string;
  operation_id: string;
  action: BridgeAction;
  resource: WireLocator;
  wait_ms: number;
}

export interface Cancel {
  type: "cancel";
  request_id: string;
  cancels: string;
  operation_id: string;
}

export interface Shutdown {
  type: "shutdown";
  request_id: string;
  drain_ms: number;
}

export type FabricMessage = Hello | BridgeRequest | Observe | Cancel | Shutdown;

export interface ActionCapability {
  action: BridgeAction;
  effect: "create" | "mutate" | "destroy";
  terminal_only: boolean;
  observe: boolean;
  cancel: boolean;
  approval: "optional" | "required";
  dedupe: "provider_key" | "label_query" | "none";
  secrets: boolean;
}

export interface ProfileLimits {
  max_deadline_ms: number;
  max_observe_wait_ms: number;
  max_output_bytes: number;
  max_stdin_bytes: number;
  max_argv: number;
  max_receipts: number;
}

export interface CapabilityProfile {
  profile: string;
  version: number;
  provider: string;
  scope_keys: string[];
  resource_kinds: string[];
  clock: "virtual" | "wall";
  observe_interval_ms: number;
  image_pull?: "never";
  actions: ActionCapability[];
  limits: ProfileLimits;
}

export interface HelloAck {
  type: "hello_ack";
  protocol: number;
  worker: string;
  profile: CapabilityProfile;
  limits: HelloLimits;
}

export type HelloRefusedCode = "unsupported_version" | "unsupported_profile" | "invalid";

export interface HelloRefused {
  type: "hello_refused";
  versions: { min: number; max: number };
  reason: { code: HelloRefusedCode; message: string };
}

export interface ReceiptRef {
  algorithm: "sha256";
  digest: string;
  ref: string;
}

export interface ExecStream {
  text: string;
  captured_bytes: number;
  truncated: boolean;
  lossy: boolean;
}

export type ResultOutput = { status: "ready" } | { status: "destroyed" } | { exit_code: number | null; stdout: ExecStream; stderr: ExecStream };

export interface Result {
  type: "result";
  request_id: string;
  operation_id: string;
  state: "completed" | "cancelled" | "accepted" | "running";
  resource: WireLocator;
  output: ResultOutput;
  replayed: boolean;
  receipts: ReceiptRef[];
  evidence_error?: { reason: "receipt_write_failed"; message: string };
}

export type ErrorCode = "invalid" | "unsupported" | "denied" | "unavailable" | "provider_failed" | "pending" | "unknown";
export type Effect = "none" | "applied" | "pending" | "unknown";

/** Reasons per code, exactly the v1 table. */
export const ERROR_REASONS: Readonly<Record<ErrorCode, readonly string[]>> = {
  invalid: ["unknown_field", "missing_field", "bad_integer", "bad_id", "bad_string", "bad_locator", "limit", "duplicate_request_id", "idempotency_conflict"],
  unsupported: ["action", "observe", "cancel"],
  denied: ["policy_denied", "approval_required", "approval_expired", "approval_scope", "secret_not_allowed", "scope_mismatch", "owner_mismatch"],
  unavailable: ["busy", "shutting_down"],
  provider_failed: ["provider_refused", "not_found", "quota"],
  pending: ["observation_deadline", "shutting_down"],
  unknown: ["reply_lost", "observation_failed"]
};

/** The effect each code allows. */
export const ERROR_EFFECTS: Readonly<Record<ErrorCode, readonly Effect[]>> = {
  invalid: ["none"],
  unsupported: ["none"],
  denied: ["none"],
  unavailable: ["none"],
  provider_failed: ["none", "applied"],
  pending: ["pending"],
  unknown: ["unknown"]
};

export interface CleanupReport {
  status: "not-attempted" | "succeeded" | "failed" | "pending" | "unknown";
  residual: WireLocator[];
}

export interface ErrorBody {
  code: ErrorCode;
  reason: string;
  message: string;
  effect: Effect;
  resource?: WireLocator;
  state?: string;
  observations?: number;
  deadline_ms?: number;
  cleanup?: CleanupReport;
}

export interface ErrorMessage {
  type: "error";
  request_id: string;
  operation_id: string;
  error: ErrorBody;
}

export interface Progress {
  type: "progress";
  request_id: string;
  operation_id: string;
  seq: number;
  state: string;
  resource: WireLocator;
}

export interface CancelAck {
  type: "cancel_ack";
  request_id: string;
  cancels: string;
  state: "requested" | "not_found" | "already_answered" | "unsupported";
}

export interface Unresolved {
  request_id: string;
  operation_id: string;
  state: "pending" | "unknown";
  resource?: WireLocator;
}

export interface ShutdownAck {
  type: "shutdown_ack";
  request_id: string;
  unresolved: Unresolved[];
}

export type ProtocolErrorCode = "oversize" | "truncated" | "empty" | "malformed" | "unexpected";

export interface ProtocolError {
  type: "protocol_error";
  code: ProtocolErrorCode;
  message: string;
}

export type WorkerMessage = HelloAck | HelloRefused | Result | ErrorMessage | Progress | CancelAck | ShutdownAck | ProtocolError;
