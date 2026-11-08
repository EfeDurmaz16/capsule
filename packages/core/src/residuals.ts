import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { homedir, hostname } from "node:os";
import { join } from "node:path";
import type { CapsuleAdapter } from "./adapters.js";
import type { CapsuleApprovalGrant, CleanupApprovalRequest, CleanupApprovalResolver } from "./types.js";

// Crash-safe cleanup. A Capsule with an owner labels everything it creates with the creating operation
// and the owning job. A residual is a labelled resource whose owner is provably not running any more:
// its job ended, or the process that held the job's lease is gone. A resource whose owner cannot be
// decided (no job label, no lease on this machine, a lease from another host) is kept, never removed.

/** The label keys Capsule owns on a created resource. Underscores, so every provider's label rules accept them. */
export const capsuleOwnerLabelKeys = { operation: "capsule_operation", job: "capsule_job" } as const;

const ownerValue = /^[A-Za-z0-9][A-Za-z0-9_-]{0,62}$/;

/** Throws unless `value` is a valid owner id: 1 to 63 letters, digits, _ or -, starting with a letter or digit. */
export function assertOwnerId(value: string, label: string): void {
  if (!ownerValue.test(value)) {
    throw new TypeError(`${label} must be 1 to 63 letters, digits, _ or -, starting with a letter or digit.`);
  }
}

/** The labels a create carries for one operation of one job. */
export function capsuleOwnerLabels(owner: { operation: string; job?: string }): Record<string, string> {
  return { [capsuleOwnerLabelKeys.operation]: owner.operation, ...(owner.job ? { [capsuleOwnerLabelKeys.job]: owner.job } : {}) };
}

/** A new operation id for one create. */
export function newOperationId(): string {
  return `op_${randomUUID().replaceAll("-", "")}`;
}

/** One resource an adapter can see that carries the Capsule operation label. */
export interface LabeledResource {
  provider: string;
  /** `sandbox` is removable by gc; other kinds are reported only. */
  kind: "sandbox" | "job-container" | string;
  id: string;
  operation: string;
  job?: string;
  /** Provider-native state, for example "running" or "exited". */
  status?: string;
  createdAt?: string;
}

/** Read-only listing of labelled resources. An adapter that can label and list implements it. */
export interface ResidualAdapter {
  /** Every resource this adapter can see that carries the capsule_operation label. Changes nothing. */
  list(): Promise<LabeledResource[]>;
}

/**
 * Whether an owner is running: `live` (keep), `ended` (its job ended and left this behind), `exited`
 * (the process that owned it is gone, for example after kill -9) or `unknown` (cannot be decided; keep).
 */
export type OwnerVerdict = "live" | "ended" | "exited" | "unknown";

export type Liveness = (owner: { operation: string; job?: string }) => OwnerVerdict | Promise<OwnerVerdict>;

/** A liveness from sets the caller holds: anything outside them has ended. */
export function liveSet(live: { operations?: Iterable<string>; jobs?: Iterable<string> }): Liveness {
  const operations = new Set(live.operations ?? []);
  const jobs = new Set(live.jobs ?? []);
  return (owner) => (operations.has(owner.operation) || (owner.job !== undefined && jobs.has(owner.job)) ? "live" : "ended");
}

export interface ResidualEntry {
  resource: LabeledResource;
  verdict: OwnerVerdict;
}

export interface ResidualScan {
  provider: string;
  adapter: string;
  /** Resources whose owner ended or exited. */
  residuals: ResidualEntry[];
  /** Labelled resources gc leaves alone: owner live or unknown. */
  kept: ResidualEntry[];
}

export type GcOutcome = "removed" | "unconfirmed" | "denied" | "failed" | "skipped";

export interface GcResult {
  resource: LabeledResource;
  verdict: OwnerVerdict;
  outcome: GcOutcome;
  /** Why it was denied, failed, skipped or is unconfirmed. */
  detail?: string;
  /** The removal's receipts. */
  receipts: string[];
  /** The id of the grant that authorized the removal. */
  approval?: string;
}

export interface GcReport {
  provider: string;
  adapter: string;
  results: GcResult[];
  kept: ResidualEntry[];
}

/** Splits labelled resources by verdict. */
export async function classifyResiduals(provider: string, adapter: string, resources: LabeledResource[], liveness: Liveness): Promise<ResidualScan> {
  const residuals: ResidualEntry[] = [];
  const kept: ResidualEntry[] = [];
  for (const resource of resources) {
    const verdict = await liveness({ operation: resource.operation, ...(resource.job ? { job: resource.job } : {}) });
    (verdict === "ended" || verdict === "exited" ? residuals : kept).push({ resource, verdict });
  }
  return { provider, adapter, residuals, kept };
}

/**
 * Why `grant` is not a fresh cleanup grant for `request`, or undefined when it is. A cleanup grant is
 * approved, unexpired, scoped to exactly the cleanup capability and to this resource, and authorizes no
 * create, so a grant that let something be made can never remove it.
 */
export function cleanupGrantProblem(grant: CapsuleApprovalGrant, request: CleanupApprovalRequest, now: Date = new Date()): string | undefined {
  if (!grant.approved) return "the grant is not approved";
  if (grant.expiresAt === undefined) return "the grant has no expiresAt";
  const expires = new Date(grant.expiresAt).getTime();
  if (!Number.isFinite(expires)) return "the grant has an invalid expiresAt";
  if (expires <= now.getTime()) return `the grant expired at ${grant.expiresAt}`;
  if (!grant.capabilities || grant.capabilities.length === 0) return "the grant is not scoped to capabilities";
  if (grant.capabilities.some((path) => /\.(create|run|deploy|branchCreate)$/.test(path))) return "the grant also authorizes a create";
  if (!grant.capabilities.includes(request.capabilityPath)) return `the grant is not valid for ${request.capabilityPath}`;
  if (!grant.resources || grant.resources.length === 0) return "the grant is not scoped to resources";
  const target = request.resource as Record<string, unknown>;
  const matches = grant.resources.some(
    (scope) => scope.id === request.resource.id && Object.entries(scope).every(([key, value]) => value === undefined || target[key] === value)
  );
  if (!matches) return `the grant is not valid for ${request.resource.id ?? "this resource"}`;
  return undefined;
}

/**
 * Approvals for the resources a person saw and confirmed: each id gets one grant, made when it is asked
 * for, short-lived and scoped to the cleanup capability and that resource. Anything else gets none.
 */
export function consentApprovals(
  ids: Iterable<string>,
  options: { approver: string; reason?: string; ttlMs?: number; now?: () => Date }
): CleanupApprovalResolver {
  const pending = new Set(ids);
  return (request) => {
    if (request.resource.id === undefined || !pending.delete(request.resource.id)) return undefined;
    const now = (options.now ?? (() => new Date()))();
    return {
      approved: true,
      id: `gc_${randomUUID().replaceAll("-", "")}`,
      approver: options.approver,
      ...(options.reason === undefined ? {} : { reason: options.reason }),
      approvedAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + (options.ttlMs ?? 60_000)).toISOString(),
      capabilities: [request.capabilityPath],
      resources: [request.resource]
    };
  };
}

/** Where job leases live for this user: CAPSULE_STATE_DIR/jobs, else XDG_STATE_HOME/capsule/jobs, else ~/.local/state/capsule/jobs. */
export function defaultLeaseDir(env: NodeJS.ProcessEnv = process.env): string {
  const state = env.CAPSULE_STATE_DIR || (env.XDG_STATE_HOME ? join(env.XDG_STATE_HOME, "capsule") : join(homedir(), ".local", "state", "capsule"));
  return join(state, "jobs");
}

/** One job's lease, as written to `<dir>/<job>.json`. */
export interface JobLease {
  job: string;
  host: string;
  pid: number;
  startedAt: string;
  adapter?: string;
  endedAt?: string;
}

export interface OpenLease {
  readonly job: string;
  /**
   * Ends the lease. `released: true` deletes it: the job removed everything it made. Otherwise the
   * lease stays, marked ended, so gc can tell what the job left behind.
   */
  end(options?: { released?: boolean }): Promise<void>;
}

function processRunning(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    // EPERM: the process exists but belongs to someone else.
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}

/**
 * Job leases in one directory. A lease names the host and process that run a job; gc reads it to tell a
 * crashed job (process gone) from a running one. A reused pid reads as running, which keeps the resource.
 */
export class JobLeases {
  constructor(
    readonly dir: string,
    private readonly host: string = hostname(),
    private readonly running: (pid: number) => boolean = processRunning
  ) {}

  private path(job: string): string {
    assertOwnerId(job, "job");
    return join(this.dir, `${job}.json`);
  }

  private async write(lease: JobLease): Promise<void> {
    await mkdir(this.dir, { recursive: true });
    const target = this.path(lease.job);
    const temporary = `${target}.${process.pid}.tmp`;
    await writeFile(temporary, `${JSON.stringify(lease)}\n`, { mode: 0o600 });
    await rename(temporary, target);
  }

  /** Opens a lease for a new job (or `job`) held by this process. Written before any provider call. */
  async open(options: { job?: string; adapter?: string } = {}): Promise<OpenLease> {
    const job = options.job ?? `job_${randomUUID().replaceAll("-", "")}`;
    const lease: JobLease = {
      job,
      host: this.host,
      pid: process.pid,
      startedAt: new Date().toISOString(),
      ...(options.adapter ? { adapter: options.adapter } : {})
    };
    await this.write(lease);
    return {
      job,
      end: async ({ released = false } = {}) => {
        if (released) await rm(this.path(job), { force: true });
        else await this.write({ ...lease, endedAt: new Date().toISOString() });
      }
    };
  }

  async read(job: string): Promise<JobLease | undefined> {
    if (!ownerValue.test(job)) return undefined;
    let text: string;
    try {
      text = await readFile(this.path(job), "utf8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
      throw error;
    }
    const value = JSON.parse(text) as Partial<JobLease>;
    if (value.job !== job || typeof value.host !== "string" || !Number.isSafeInteger(value.pid) || typeof value.startedAt !== "string") return undefined;
    return value as JobLease;
  }

  /** Removes the lease of a job gc found nothing left for. */
  async forget(job: string): Promise<void> {
    await rm(this.path(job), { force: true });
  }

  /** Forgets every job in `report` whose residuals were all removed and that has nothing kept. */
  readonly forgetFinished = async (report: GcReport): Promise<void> => {
    const jobs = new Set(report.results.flatMap((result) => (result.resource.job ? [result.resource.job] : [])));
    for (const job of jobs) {
      const left = [...report.results.filter((result) => result.outcome !== "removed"), ...report.kept].some((entry) => entry.resource.job === job);
      if (!left) await this.forget(job);
    }
  };

  /** The liveness these leases prove. */
  readonly liveness: Liveness = async (owner) => {
    if (owner.job === undefined) return "unknown";
    const lease = await this.read(owner.job);
    if (!lease || lease.host !== this.host) return "unknown";
    if (lease.endedAt !== undefined) return "ended";
    return this.running(lease.pid) ? "live" : "exited";
  };
}

/**
 * Runs `work` as one job. When the adapter can list what it labelled, a lease is written first and
 * `work` gets the owner to create its Capsule with; the lease is released only when `work` returns, so a
 * crash, a kill or a throw leaves it for gc. Otherwise `work` gets no owner and no lease is written.
 */
export async function withJobLease<T>(adapter: CapsuleAdapter, work: (owner?: { job: string }) => Promise<T>, leases?: JobLeases): Promise<T> {
  if (!adapter.residuals) return work();
  const lease = await (leases ?? new JobLeases(defaultLeaseDir())).open({ adapter: adapter.name });
  let released = false;
  try {
    const result = await work({ job: lease.job });
    released = true;
    return result;
  } finally {
    await lease.end({ released });
  }
}
