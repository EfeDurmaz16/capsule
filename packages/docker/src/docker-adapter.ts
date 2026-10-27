import { lstat, mkdir, mkdtemp, rm, writeFile, readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import { basename, dirname, join, posix } from "node:path";
import {
  AdapterExecutionError,
  CleanupFailureError,
  PartialEffectsError,
  UnknownOutcomeError,
  providerExecutionError,
  resourceLocator,
  type AdapterContext,
  type Artifact,
  type CaptureBounds,
  type CaptureTruncation,
  type CapsuleAdapter,
  type CapabilityMap,
  type CreateSandboxSpec,
  type ExecResult,
  type ExecSpec,
  type FileEntry,
  type PartialEffects,
  type ProviderErrorClassification,
  type ResourceLocator,
  type RunJobSpec,
  type Sandbox,
  type SandboxHandle
} from "@capsule-sdk/core";
import { capsuleOperationTags, collectFileArtifacts, logsFromOutput, redactSecrets, resolveExecOutputBounds } from "@capsule-sdk/core";
import { dockerAvailable, runDocker, type DockerCommandResult, type DockerOutputBounds, type RunDockerOptions } from "./docker-cli.js";

type DockerRunner = (args: string[], options?: RunDockerOptions) => Promise<DockerCommandResult>;

export interface DockerAdapterOptions {
  defaultImage?: string;
  // Seams for tests and custom hosts: override the docker CLI runner and the daemon reachability probe.
  runner?: DockerRunner;
  checkAvailable?: () => Promise<boolean>;
}

const dockerDaemonSignals = [
  "cannot connect to the docker daemon",
  "is the docker daemon running",
  "daemon is not running",
  "connection refused",
  "error during connect"
];
const dockerAuthSignals = [
  "permission denied",
  "pull access denied",
  "unauthorized",
  "authentication required",
  "access denied",
  "denied: requested access",
  "docker login",
  "error getting credentials"
];
const dockerImageSignals = [
  "no such image",
  "manifest unknown",
  "not found",
  "repository does not exist",
  "no such container",
  "no such object",
  "invalid reference format"
];

// Docker exposes no structured error codes, so classify conservatively from the CLI exit code and
// stderr text: unreachable daemon or timeout is retryable, missing image/container is a validation
// error, and permission or registry-auth failures are auth errors.
export function classifyDockerCliError(exitCode: number, stderr: string): ProviderErrorClassification {
  if (exitCode === 124) {
    return { category: "retryable", retryable: true };
  }
  const signal = stderr.toLowerCase();
  if (dockerDaemonSignals.some((token) => signal.includes(token))) {
    return { category: "retryable", retryable: true };
  }
  if (dockerAuthSignals.some((token) => signal.includes(token))) {
    return { category: "auth", retryable: false };
  }
  if (dockerImageSignals.some((token) => signal.includes(token))) {
    return { category: "validation", retryable: false };
  }
  return { category: "unknown", retryable: false };
}

function isNoSuchContainer(stderr: string): boolean {
  return stderr.toLowerCase().includes("no such container");
}

function dockerCliError(message: string, result: DockerCommandResult): AdapterExecutionError {
  return providerExecutionError(message, classifyDockerCliError(result.exitCode, result.stderr), { exitCode: result.exitCode, stderr: result.stderr });
}

interface DockerSandboxCreateArgsInput {
  name: string;
  workdir: string;
  image: string;
  env?: Record<string, string>;
  labels?: Record<string, string>;
  networkNone?: boolean;
  exposedPorts?: CreateSandboxSpec["exposedPorts"];
}

const provider = "docker";
const adapter = "docker";

export const dockerCapabilities: CapabilityMap = {
  sandbox: {
    create: "native",
    exec: "native",
    fileRead: "native",
    fileWrite: "native",
    fileList: "native",
    destroy: "native",
    snapshot: "unsupported",
    restore: "unsupported",
    exposePort: "native",
    networkPolicy: "experimental",
    filesystemPolicy: "emulated",
    secretMounting: "emulated",
    // Emulated at the adapter boundary: exec collects ExecSpec.artifactPaths from the live container
    // with `docker cp` and hashes them, rather than a provider-native artifact store.
    artifacts: "emulated"
  },
  job: {
    run: "native",
    status: "unsupported",
    cancel: "unsupported",
    logs: "unsupported",
    // Unsupported: job.run uses `docker run --rm`, so the container is gone before we can `docker cp`
    // from it and job artifacts are always []. Use sandbox.exec + ExecSpec.artifactPaths to collect
    // artifacts. See docs/artifacts.md.
    artifacts: "unsupported",
    timeout: "native",
    env: "native",
    resources: "experimental"
  },
  service: {
    deploy: "unsupported",
    update: "unsupported",
    delete: "unsupported",
    status: "unsupported",
    logs: "unsupported",
    url: "unsupported"
  },
  edge: {
    deploy: "unsupported",
    rollback: "unsupported",
    routes: "unsupported"
  },
  database: {
    branchCreate: "unsupported",
    branchDelete: "unsupported",
    connectionString: "unsupported"
  },
  preview: {
    create: "unsupported",
    destroy: "unsupported",
    status: "unsupported",
    logs: "unsupported",
    urls: "unsupported"
  },
  machine: {
    create: "unsupported",
    exec: "unsupported",
    start: "unsupported",
    stop: "unsupported",
    destroy: "unsupported"
  }
};

function normalizeCommand(command: string[] | string): string[] {
  return typeof command === "string" ? ["sh", "-lc", command] : command;
}

function policyNotes(context: AdapterContext): string[] {
  const notes: string[] = ["Docker local is not safe for hostile untrusted code unless the host Docker environment is hardened."];
  if (context.policy.network?.mode === "none") {
    notes.push("Docker network policy applied with --network none.");
  }
  if (context.policy.network?.mode === "allowlist") {
    notes.push("Docker adapter cannot enforce host allowlists natively; network allowlist is unsupported/best-effort.");
  }
  if (context.policy.filesystem) {
    notes.push("Filesystem policy is emulated at the Capsule adapter boundary, not enforced by the container runtime.");
  }
  return notes;
}

function envArgs(env?: Record<string, string>): string[] {
  return Object.entries(env ?? {}).flatMap(([key, value]) => ["--env", `${key}=${value}`]);
}

function resourceArgs(resources?: { cpu?: number; memoryMb?: number }): string[] {
  return [...(resources?.memoryMb ? ["--memory", `${resources.memoryMb}m`] : []), ...(resources?.cpu ? ["--cpus", String(resources.cpu)] : [])];
}

function labelArgs(labels?: Record<string, string>): string[] {
  return Object.entries(labels ?? {}).flatMap(([key, value]) => ["--label", `${key}=${value}`]);
}

function assertPort(value: number, label: string): void {
  if (!Number.isInteger(value) || value < 1 || value > 65_535) {
    throw new AdapterExecutionError(`${label} must be an integer between 1 and 65535.`);
  }
}

function publishPortArgs(exposedPorts?: CreateSandboxSpec["exposedPorts"]): string[] {
  return (exposedPorts ?? []).flatMap((port) => {
    assertPort(port.containerPort, "containerPort");
    if (port.hostPort !== undefined) {
      assertPort(port.hostPort, "hostPort");
    }
    const protocol = port.protocol ?? "tcp";
    if (protocol !== "tcp" && protocol !== "udp") {
      throw new AdapterExecutionError("protocol must be tcp or udp.");
    }
    const hostIp = port.hostIp ?? "127.0.0.1";
    const hostPort = port.hostPort ?? "";
    return ["--publish", `${hostIp}:${hostPort}:${port.containerPort}/${protocol}`];
  });
}

export function dockerSandboxCreateArgs(input: DockerSandboxCreateArgsInput): string[] {
  return [
    "create",
    "--name",
    input.name,
    "--workdir",
    input.workdir,
    ...(input.networkNone ? ["--network", "none"] : []),
    ...publishPortArgs(input.exposedPorts),
    ...labelArgs(input.labels),
    ...envArgs(input.env),
    input.image,
    "sh",
    "-lc",
    "mkdir -p /workspace && while :; do sleep 3600; done"
  ];
}

// Copy the requested container paths into a throwaway temp dir with `docker cp`, then hash them with
// the shared filesystem collector. Only works while the container is alive, so this is used for
// sandbox.exec (long-lived container) and not for job.run (which uses `docker run --rm`).
// Each path keeps its location relative to the deepest directory shared by all requested paths, so
// /a/out.txt and /b/out.txt land at a/out.txt and b/out.txt instead of overwriting each other, while a
// single path or paths in one directory keep the plain basename layout.
async function collectSandboxArtifacts(runner: DockerRunner, containerId: string, placements: ArtifactPlacement[]): Promise<Artifact[]> {
  const dir = await mkdtemp(join(tmpdir(), "capsule-docker-artifacts-"));
  try {
    if (hasNestedPlacement(placements)) {
      // A path inside another requested path copies into a tree an earlier copy creates, so the order of
      // copies matters: keep them strictly sequential, and never follow a symbolic link that tree holds.
      for (const placement of placements) {
        await copyArtifact(runner, containerId, placement, await realTargetDirectory(dir, placement));
      }
    } else {
      // Disjoint paths land in disjoint subtrees, so the copies can overlap (PERF-14). It is still one
      // `docker cp` per path with the same arguments; only the waiting overlaps.
      for (const placement of placements) await mkdir(join(dir, placement.targetDir), { recursive: true });
      await copyConcurrently(runner, containerId, dir, placements);
    }
    return collectFileArtifacts(dir).artifacts;
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

/** Most `docker cp` processes run at once for one exec's artifacts. */
export const dockerArtifactCopyConcurrency = 4;

async function copyArtifact(runner: DockerRunner, containerId: string, placement: ArtifactPlacement, target: string): Promise<void> {
  const copied = await runner(["cp", `${containerId}:${placement.path}`, target]);
  if (copied.exitCode !== 0) {
    throw dockerCliError(`docker cp artifact failed for ${placement.path}: ${copied.stderr}`, copied);
  }
}

// Starts copies in request order, at most dockerArtifactCopyConcurrency at a time. After a failure no
// further copy starts; the ones already running finish before the temp dir is removed, and the error of
// the earliest failed path is thrown, the same error the sequential loop raised.
async function copyConcurrently(runner: DockerRunner, containerId: string, dir: string, placements: ArtifactPlacement[]): Promise<void> {
  const failures: Array<{ index: number; error: unknown }> = [];
  let next = 0;
  const worker = async (): Promise<void> => {
    while (failures.length === 0 && next < placements.length) {
      const index = next;
      next += 1;
      const placement = placements[index]!;
      try {
        await copyArtifact(runner, containerId, placement, join(dir, placement.targetDir));
      } catch (error) {
        failures.push({ index, error });
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(dockerArtifactCopyConcurrency, placements.length) }, () => worker()));
  if (failures.length > 0) {
    throw failures.reduce((earliest, failure) => (failure.index < earliest.index ? failure : earliest)).error;
  }
}

// Creates the placement's target directory one component at a time and refuses a component that is not a
// real directory. An earlier copy has written container-controlled entries into this tree, so a component
// can be a symbolic link the container planted (for example /out/logs -> a host directory): mkdir -p and
// docker cp, which resolves a symbolic link in its destination, would follow it and write on the host
// outside the temp dir. Copies here run one at a time and only they write the tree, so nothing changes it
// between this check and the copy. mkdir of an existing symbolic link fails with EEXIST without following it.
async function realTargetDirectory(dir: string, placement: ArtifactPlacement): Promise<string> {
  let current = dir;
  let relative = "";
  for (const part of placement.targetDir.split("/")) {
    if (!part) continue;
    current = join(current, part);
    relative = relative ? `${relative}/${part}` : part;
    try {
      await mkdir(current);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      const existing = await lstat(current);
      if (!existing.isDirectory()) {
        throw new AdapterExecutionError(
          `Docker artifact path ${placement.path} would be copied through ${relative}, which an earlier artifact copy created as ${existing.isSymbolicLink() ? "a symbolic link" : "a non-directory"}; refusing to follow it.`
        );
      }
    }
  }
  return current;
}

// True when one requested path is below another requested path or names the same host path (exact
// duplicates are already rejected). The copies land on the host file system, which can be case- and
// Unicode-normalization-insensitive (macOS, Windows), where /c/out and /c/OUT/logs/run.txt share one tree;
// copying those concurrently would let one copy race a symbolic link written by the other. The key folds
// conservatively: a false match only makes the copies sequential.
function hasNestedPlacement(placements: ArtifactPlacement[]): boolean {
  const paths = new Set(placements.map((placement) => hostPathKey(posix.resolve("/", placement.path))));
  if (paths.size < placements.length) return true;
  for (const path of paths) {
    for (let parent = posix.dirname(path); parent !== "/"; parent = posix.dirname(parent)) {
      if (paths.has(parent)) return true;
    }
  }
  return false;
}

function hostPathKey(path: string): string {
  return path.normalize("NFKC").toLowerCase().toUpperCase().toLowerCase();
}

interface ArtifactPlacement {
  path: string;
  targetDir: string;
}

// Plans every copy before any effect. Container paths resolve against "/" (docker cp treats relative
// container paths as relative to the root). Two requests for the same container path are rejected.
export function artifactPlacements(paths: string[]): ArtifactPlacement[] {
  const resolved = paths.map((path) => ({ path, absolute: posix.resolve("/", path) }));
  const seen = new Set<string>();
  for (const entry of resolved) {
    if (entry.absolute === "/") {
      throw new AdapterExecutionError("Docker artifact path must name a file or directory below the container root.");
    }
    if (seen.has(entry.absolute)) {
      throw new AdapterExecutionError(`Docker artifact path is requested more than once: ${entry.absolute}`);
    }
    seen.add(entry.absolute);
  }
  const parents = resolved.map((entry) => posix.dirname(entry.absolute));
  const root = parents.reduce((common, parent) => commonDirectory(common, parent));
  return resolved.map((entry) => ({ path: entry.path, targetDir: posix.relative(root, posix.dirname(entry.absolute)) }));
}

function commonDirectory(left: string, right: string): string {
  const a = left.split("/").filter(Boolean);
  const b = right.split("/").filter(Boolean);
  let shared = 0;
  while (shared < a.length && shared < b.length && a[shared] === b[shared]) shared += 1;
  return `/${a.slice(0, shared).join("/")}`;
}

// Builds the argv for listing one directory level. A path that find would parse as an expression
// (leading "-", "(" or "!") is anchored with "./" so it can only ever be a starting point.
export function dockerListFilesCommand(path: string): string[] {
  const startingPoint = /^[-(!]/.test(path) ? `./${path}` : path;
  return ["find", startingPoint, "-maxdepth", "1", "-mindepth", "1", "-printf", "%f\\0%p\\0%y\\0%s\\0"];
}

function parseDockerListFiles(stdout: string): FileEntry[] {
  const fields = stdout.split("\0");
  const entries: FileEntry[] = [];
  for (let index = 0; index + 3 < fields.length; index += 4) {
    const [name = "", entryPath = "", kind = "", size = ""] = fields.slice(index, index + 4);
    entries.push({
      name,
      path: entryPath,
      type: kind === "f" ? "file" : kind === "d" ? "directory" : "unknown",
      sizeBytes: Number(size) || undefined
    });
  }
  return entries;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

// Removes a container this create call allocated but could not hand back. The primary error and the
// cleanup outcome stay separate: a failed removal throws CleanupFailureError with the container as a
// residual resource, a successful one throws PartialEffectsError whose cause is the primary error.
async function rollbackCreatedContainer(runner: DockerRunner, locator: ResourceLocator, primaryError: unknown): Promise<never> {
  let cleanupError: unknown;
  try {
    const removed = await runner(["rm", "-f", locator.nativeId], { timeoutMs: 20_000 });
    if (removed.exitCode !== 0 && !isNoSuchContainer(removed.stderr)) {
      cleanupError = dockerCliError(`docker rm failed during create rollback: ${removed.stderr}`, removed);
    }
  } catch (error) {
    cleanupError = error;
  }
  const resources = [locator];
  if (cleanupError !== undefined) {
    const effects: PartialEffects = {
      operation: "sandbox.create",
      outcome: "failed",
      resources,
      primaryError,
      cleanup: { status: "failed", resources, residual: resources, error: cleanupError }
    };
    throw new CleanupFailureError(
      `Docker sandbox cleanup failed after container allocation: ${errorMessage(primaryError)}`,
      { action: "remove-created-container", containerId: locator.nativeId, status: "failed", error: errorMessage(cleanupError) },
      primaryError,
      effects
    );
  }
  throw new PartialEffectsError(`Docker sandbox creation failed after container allocation; the container was removed: ${errorMessage(primaryError)}`, {
    operation: "sandbox.create",
    outcome: "failed",
    resources,
    primaryError,
    cleanup: { status: "succeeded", resources }
  });
}

// Output bounds for docker exec and job.run (CD-BOUNDS). maxBytes defaults to 16 MiB per stream with
// policy.limits.maxStdoutBytes/maxStderrBytes as ceilings. A capture deadline applies only when the
// caller sets bounds.deadlineMs: the command timeout is timeoutMs, and a default capture deadline would
// silently drop output of long, legitimate commands.
function dockerOutputBounds(bounds: CaptureBounds | undefined, policy: AdapterContext["policy"]): DockerOutputBounds {
  const resolved = resolveExecOutputBounds(bounds, policy);
  if (bounds?.deadlineMs !== undefined) return resolved;
  return {
    stdout: { ...resolved.stdout, deadlineMs: Number.MAX_SAFE_INTEGER },
    stderr: { ...resolved.stderr, deadlineMs: Number.MAX_SAFE_INTEGER }
  };
}

function truncationMetadata(truncation: DockerCommandResult["truncation"]): { metadata?: Record<string, unknown> } {
  if (!truncation || (!truncation.stdout.truncated && !truncation.stderr.truncated)) return {};
  return { metadata: { outputTruncation: truncation } };
}

// Redacts captured output. When a stream was cut at the byte cap, the cut can fall inside a secret,
// leaving a prefix that whole-value redaction cannot match, so a trailing secret prefix is redacted too.
// Redacts captured stderr and keeps any note the runner appended after it (the timeout note) outside
// the captured part, so a secret prefix cut by the byte cap is still found at the end of the capture.
function redactCapturedStderr(
  result: DockerCommandResult,
  env: Record<string, string> | undefined,
  policy: AdapterContext["policy"],
  extraNote?: string
): string {
  const note = result.timeoutNote;
  const split = note !== undefined && result.stderr.endsWith(note);
  const captured = split ? result.stderr.slice(0, result.stderr.length - note.length).replace(/\n$/, "") : result.stderr;
  const notes = [...(split ? [note] : []), ...(extraNote === undefined ? [] : [extraNote])];
  const redacted = redactCapturedOutput(captured, result.truncation?.stderr, env, policy);
  return [redacted, ...notes.map((entry) => redactSecrets(entry, env, policy))].filter((part, index) => index > 0 || part.length > 0).join("\n");
}

function redactCapturedOutput(
  text: string,
  truncation: CaptureTruncation | undefined,
  env: Record<string, string> | undefined,
  policy: AdapterContext["policy"]
): string {
  let output = redactSecrets(text, env, policy);
  if (!truncation?.truncated || !policy.secrets?.redactFromLogs || !env) return output;
  for (const key of policy.secrets.allowed ?? []) {
    const secret = env[key];
    if (!secret) continue;
    for (let length = Math.min(secret.length - 1, output.length); length > 0; length -= 1) {
      if (output.endsWith(secret.slice(0, length))) {
        output = `${output.slice(0, output.length - length)}[REDACTED]`;
        break;
      }
    }
  }
  return output;
}

const dockerRunLabelKey = "capsule_docker_run";

interface ReapedJob {
  termination: "removed" | "not-created";
  containers: string[];
  note: string;
}

// runDocker's timeout only kills the local docker CLI. The container keeps running in the daemon, and
// --rm removes it only when it exits on its own. Find it by its run label and remove it with docker
// rm -f, which kills and removes it and exits 0 only once the daemon has done so. If that cannot be
// confirmed the job's outcome is unknown and the container is reported as a residual resource.
async function reapTimedOutJob(
  runner: DockerRunner,
  runLabel: string,
  timedOut: DockerCommandResult,
  env: Record<string, string> | undefined,
  context: AdapterContext
): Promise<ReapedJob> {
  const labelLocator = resourceLocator({ provider, kind: "job-container", nativeId: runLabel, scope: { label: runLabel } });
  const primaryError = providerExecutionError(
    "Docker job timed out; the docker CLI was killed.",
    { category: "retryable", retryable: true },
    { exitCode: timedOut.exitCode, stderr: redactCapturedStderr(timedOut, env, context.policy) }
  );
  const fail = (cleanupError: unknown, residual: ResourceLocator[]): never => {
    throw new CleanupFailureError(
      `Docker job timed out and its container could not be confirmed removed: ${errorMessage(cleanupError)}`,
      { action: "remove-timed-out-job-container", runLabel, status: "failed", error: errorMessage(cleanupError) },
      primaryError,
      {
        operation: "job.run",
        outcome: "unknown",
        resources: residual,
        primaryError,
        cleanup: { status: "failed", resources: residual, residual, error: cleanupError }
      }
    );
  };
  let listed: DockerCommandResult;
  try {
    listed = await runner(["ps", "-a", "-q", "--no-trunc", "--filter", `label=${runLabel}`], { timeoutMs: 20_000 });
  } catch (error) {
    return fail(error, [labelLocator]);
  }
  if (listed.exitCode !== 0) {
    return fail(dockerCliError(`docker ps failed while reaping a timed-out job: ${listed.stderr}`, listed), [labelLocator]);
  }
  const containers = listed.stdout
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  if (containers.length === 0) {
    return { termination: "not-created", containers, note: "No container was created for this job before the timeout." };
  }
  const residual = containers.map((id) => resourceLocator({ provider, kind: "job-container", nativeId: id, scope: { label: runLabel } }));
  let removed: DockerCommandResult;
  try {
    removed = await runner(["rm", "-f", ...containers], { timeoutMs: 20_000 });
  } catch (error) {
    return fail(error, residual);
  }
  if (removed.exitCode !== 0 && !isNoSuchContainer(removed.stderr)) {
    return fail(dockerCliError(`docker rm failed while reaping a timed-out job: ${removed.stderr}`, removed), residual);
  }
  return { termination: "removed", containers, note: `Removed timed-out job container ${containers.join(", ")}.` };
}

async function ensureDocker(checkAvailable: () => Promise<boolean>): Promise<void> {
  if (!(await checkAvailable())) {
    throw providerExecutionError("Docker CLI is not available or the Docker daemon is not reachable.", { category: "retryable", retryable: true });
  }
}

class DockerSandbox implements Sandbox {
  constructor(
    readonly handle: SandboxHandle,
    private readonly context: AdapterContext,
    private readonly runner: DockerRunner
  ) {}

  async exec(spec: ExecSpec): Promise<ExecResult> {
    const startedAt = new Date();
    const policy = this.context.evaluatePolicy({ env: spec.env, timeoutMs: spec.timeoutMs });
    const command = normalizeCommand(spec.command);
    // Plan artifact copies before running the command so an invalid request has no effects.
    const placements = spec.artifactPaths?.length ? artifactPlacements(spec.artifactPaths) : undefined;
    const outputBounds = dockerOutputBounds(spec.bounds, this.context.policy);
    // docker exec only attaches the process stdin with -i. With input the CLI writes it and then
    // closes its stdin, so the process sees EOF (immediately for empty input). Without input stdin is
    // not attached, as before.
    const interactive = spec.input !== undefined ? ["-i"] : [];
    const result = await this.runner(["exec", ...interactive, ...(spec.cwd ? ["--workdir", spec.cwd] : []), ...envArgs(spec.env), this.handle.id, ...command], {
      timeoutMs: spec.timeoutMs,
      input: spec.input,
      outputBounds
    });
    if (result.timedOut) {
      // Killing the docker exec client does not stop the process inside the container, so a timeout
      // proves nothing about the command. Report the outcome as unknown instead of an exit code.
      throw new UnknownOutcomeError(
        `Docker exec timed out after ${spec.timeoutMs}ms; the command may still be running in container ${this.handle.id}.`,
        { operation: "sandbox.exec", resource: resourceLocator({ provider, kind: "sandbox", nativeId: this.handle.id }) },
        providerExecutionError(
          "Docker exec timed out; the docker CLI was killed.",
          { category: "retryable", retryable: true },
          {
            exitCode: result.exitCode,
            stdout: redactCapturedOutput(result.stdout, result.truncation?.stdout, spec.env, this.context.policy),
            stderr: redactCapturedStderr(result, spec.env, this.context.policy),
            ...(result.truncation ? { truncation: result.truncation } : {}),
            ...(result.captureLimit ? { captureLimit: result.captureLimit.message } : {})
          }
        )
      );
    }
    const stdout = redactCapturedOutput(result.stdout, result.truncation?.stdout, spec.env, this.context.policy);
    const stderr = redactCapturedOutput(result.stderr, result.truncation?.stderr, spec.env, this.context.policy);
    const artifacts = placements ? await collectSandboxArtifacts(this.runner, this.handle.id, placements) : [];
    const receipt = this.context.receipts
      ? this.context.createReceipt({
          type: "sandbox.exec",
          capabilityPath: "sandbox.exec",
          startedAt,
          command,
          cwd: spec.cwd,
          exitCode: result.exitCode,
          stdout,
          stderr,
          artifacts,
          policy: { ...policy, notes: [...policy.notes, ...policyNotes(this.context)] },
          resource: { id: this.handle.id, status: "running" },
          ...truncationMetadata(result.truncation)
        })
      : undefined;
    return {
      exitCode: result.exitCode,
      stdout,
      stderr,
      logs: logsFromOutput(stdout, stderr, this.handle.id),
      artifacts,
      receipt,
      ...(result.truncation ? { truncation: result.truncation } : {})
    };
  }

  async writeFile(path: string, data: string | Uint8Array): Promise<void> {
    const dir = await mkdtemp(join(tmpdir(), "capsule-docker-write-"));
    try {
      const local = join(dir, basename(path));
      await writeFile(local, data);
      await this.runner(["exec", this.handle.id, "mkdir", "-p", dirname(path)]);
      const copied = await this.runner(["cp", local, `${this.handle.id}:${path}`]);
      if (copied.exitCode !== 0) {
        throw dockerCliError(`docker cp write failed: ${copied.stderr}`, copied);
      }
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }

  async readFile(path: string): Promise<Uint8Array> {
    const dir = await mkdtemp(join(tmpdir(), "capsule-docker-read-"));
    try {
      const local = join(dir, basename(path));
      const copied = await this.runner(["cp", `${this.handle.id}:${path}`, local]);
      if (copied.exitCode !== 0) {
        throw dockerCliError(`docker cp read failed: ${copied.stderr}`, copied);
      }
      return await readFile(local);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }

  async listFiles(path: string): Promise<FileEntry[]> {
    // The path travels as one argv element to find, never through a shell, so quotes, $(), backticks
    // and newlines stay literal. Fields are NUL-separated because file names may contain tabs or newlines.
    const result = await this.runner(["exec", this.handle.id, ...dockerListFilesCommand(path)]);
    if (result.exitCode !== 0) {
      throw dockerCliError(`docker exec list failed: ${result.stderr}`, result);
    }
    return parseDockerListFiles(result.stdout);
  }

  async destroy(): Promise<void> {
    const startedAt = new Date();
    const removed = await this.runner(["rm", "-f", this.handle.id], { timeoutMs: 20_000 });
    // docker rm -f exits 0 once the container is gone. A container that is already absent is the
    // desired end state, so destroy stays idempotent and records it; any other nonzero exit means the
    // container may still exist, so destroy rejects and writes no deleted receipt.
    const alreadyAbsent = removed.exitCode !== 0 && isNoSuchContainer(removed.stderr);
    if (removed.exitCode !== 0 && !alreadyAbsent) {
      throw dockerCliError(`docker rm failed: ${removed.stderr}`, removed);
    }
    if (this.context.receipts) {
      this.context.createReceipt({
        type: "sandbox.destroy",
        capabilityPath: "sandbox.destroy",
        startedAt,
        policy: { decision: "allowed", applied: this.context.policy, notes: policyNotes(this.context) },
        resource: { id: this.handle.id, status: "deleted" },
        ...(alreadyAbsent ? { metadata: { alreadyAbsent: true } } : {})
      });
    }
  }
}

export function docker(options: DockerAdapterOptions = {}): CapsuleAdapter {
  const runner: DockerRunner = options.runner ?? runDocker;
  const checkAvailable = options.checkAvailable ?? dockerAvailable;
  return {
    name: adapter,
    provider,
    capabilities: dockerCapabilities,
    raw: { cli: "docker" },
    sandbox: {
      create: async (spec: CreateSandboxSpec, context: AdapterContext): Promise<Sandbox> => {
        await ensureDocker(checkAvailable);
        const startedAt = new Date();
        const image = spec.image ?? options.defaultImage ?? "node:22";
        const policy = context.evaluatePolicy({ env: spec.env, timeoutMs: spec.timeoutMs });
        const name = spec.name ?? `capsule-${Date.now()}`;
        const create = await runner(
          dockerSandboxCreateArgs({
            name,
            workdir: spec.cwd ?? "/workspace",
            image,
            env: spec.env,
            labels: { ...(spec.labels ?? {}), ...(capsuleOperationTags({ idempotencyKey: spec.idempotencyKey, capabilityPath: "sandbox.create" }) ?? {}) },
            networkNone: context.policy.network?.mode === "none",
            exposedPorts: spec.exposedPorts
          }),
          { timeoutMs: spec.timeoutMs }
        );
        if (create.timedOut) {
          // The daemon may have created the container after the CLI was killed. Its id is unknown, so it is
          // reported by name and not removed here: the name could also belong to an unrelated container.
          throw new UnknownOutcomeError(
            `docker create timed out after ${spec.timeoutMs}ms; container ${name} may exist.`,
            { operation: "sandbox.create", resource: resourceLocator({ provider, kind: "sandbox", nativeId: name, scope: { name } }) },
            dockerCliError(`docker create timed out: ${create.stderr}`, create)
          );
        }
        if (create.exitCode !== 0) {
          throw dockerCliError(`docker create failed: ${create.stderr}`, create);
        }
        const id = create.stdout.trim();
        const locator = resourceLocator({ provider, kind: "sandbox", nativeId: id, scope: { name } });
        // From here a container exists. Any failure before the handle is returned (start, receipt
        // signing or persistence) removes it, so no live container is left without an owner.
        try {
          const start = await runner(["start", id], { timeoutMs: spec.timeoutMs });
          if (start.exitCode !== 0) {
            throw dockerCliError(`docker start failed: ${start.stderr}`, start);
          }
          const handle: SandboxHandle = {
            id,
            provider,
            createdAt: startedAt.toISOString(),
            metadata: { image, name, exposedPorts: spec.exposedPorts ?? [] }
          };
          if (context.receipts) {
            context.createReceipt({
              type: "sandbox.create",
              capabilityPath: "sandbox.create",
              startedAt,
              image,
              policy: { ...policy, notes: [...policy.notes, ...policyNotes(context)] },
              resource: { id, name, status: "running" }
            });
          }
          return new DockerSandbox(handle, context, runner);
        } catch (error) {
          return await rollbackCreatedContainer(runner, locator, error);
        }
      }
    },
    job: {
      run: async (spec: RunJobSpec, context: AdapterContext) => {
        await ensureDocker(checkAvailable);
        const startedAt = new Date();
        const policy = context.evaluatePolicy({ env: spec.env, timeoutMs: spec.timeoutMs });
        const command = spec.command ? normalizeCommand(spec.command) : [];
        // A per-run label gives the container an identity Capsule can find again even if the CLI is
        // killed before it reports the container id.
        const runLabel = `${dockerRunLabelKey}=${randomUUID()}`;
        const result = await runner(
          [
            "run",
            "--rm",
            ...(context.policy.network?.mode === "none" ? ["--network", "none"] : []),
            "--label",
            runLabel,
            ...labelArgs({ ...(spec.labels ?? {}), ...(capsuleOperationTags({ idempotencyKey: spec.idempotencyKey, capabilityPath: "job.run" }) ?? {}) }),
            ...envArgs(spec.env),
            ...resourceArgs(spec.resources),
            spec.image,
            ...command
          ],
          { timeoutMs: spec.timeoutMs, outputBounds: dockerOutputBounds(undefined, context.policy) }
        );
        const reaped = result.timedOut ? await reapTimedOutJob(runner, runLabel, result, spec.env, context) : undefined;
        const stdout = redactCapturedOutput(result.stdout, result.truncation?.stdout, spec.env, context.policy);
        const stderr = redactCapturedStderr(result, spec.env, context.policy, reaped?.note);
        const receipt = context.receipts
          ? context.createReceipt({
              type: "job.run",
              capabilityPath: "job.run",
              startedAt,
              image: spec.image,
              command,
              exitCode: result.exitCode,
              stdout,
              stderr,
              policy: { ...policy, notes: [...policy.notes, ...policyNotes(context)] },
              resource: { id: spec.name, name: spec.name, status: result.exitCode === 0 ? "succeeded" : "failed" },
              metadata: {
                runLabel,
                ...(reaped ? { timedOut: true, termination: reaped.termination, containers: reaped.containers } : {}),
                ...truncationMetadata(result.truncation).metadata
              }
            })
          : undefined;
        return {
          id: spec.name ?? `docker-job-${Date.now()}`,
          provider,
          status: result.exitCode === 0 ? "succeeded" : "failed",
          result: {
            exitCode: result.exitCode,
            stdout,
            stderr,
            logs: logsFromOutput(stdout, stderr),
            artifacts: [],
            receipt,
            ...(result.truncation ? { truncation: result.truncation } : {})
          },
          receipt
        };
      }
    }
  };
}
