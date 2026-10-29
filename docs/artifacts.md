# Artifacts

An `Artifact` is a named file produced by a run: a build output, a report, a log dump. Capsule treats
artifacts as content-addressed evidence. Each carries a `sha256` over its bytes so a receipt or manifest
can prove what was produced without storing the bytes themselves.

```ts
interface Artifact {
  name: string;
  path?: string;
  contentType?: string;
  sizeBytes?: number;
  sha256?: string;
  url?: string;
}
```

## Hash verification

`verifyArtifactHash(artifact, content)` recomputes `sha256(content)` and compares it against the hash the
artifact claims. A missing claimed hash returns `{ valid: false, reason: "missing-hash" }` rather than
passing, so "no hash" is never mistaken for "trusted".

```ts
import { verifyArtifactHash } from "@capsule-sdk/core";

const result = verifyArtifactHash(artifact, bytes);
// { valid: true } | { valid: false, reason: "hash-mismatch", expected, actual } | { valid: false, reason: "missing-hash", actual }
```

## Artifact manifest

`createArtifactManifest(artifacts)` produces a versioned, verifiable manifest, mirroring the evidence
bundle. The digest is a `sha256` over the canonical (key-sorted, `undefined`-dropped) payload, so it is
stable regardless of object key order and changes if any entry is added, removed, or tampered with.

```ts
import { createArtifactManifest, verifyArtifactManifest } from "@capsule-sdk/core";

const manifest = createArtifactManifest(artifacts);
// { schema: "capsule.artifact.manifest.v1", createdAt, entries: [...], digest: { algorithm: "sha256", value } }

verifyArtifactManifest(manifest); // { valid: true } | { valid: false, reason: "digest-mismatch", expectedDigest, actualDigest }
```

`createdAt` is part of the digest, so a manifest is bound to when it was built. Pass a fixed `createdAt`
to make digests reproducible in tests.

## Filesystem collector

`collectFileArtifacts(dir, options?)` walks a directory with `node:fs`, hashes each regular file, and
returns `Artifact[]` with posix-style relative paths.

```ts
import { collectFileArtifacts } from "@capsule-sdk/core";

const { artifacts, truncated, truncation } = collectFileArtifacts("./out", { maxFiles: 1000, maxBytes: 64 * 1024 * 1024 });
```

Honest bounds:

- Symlinks (file or directory) are never followed, so collection cannot escape the tree or loop.
- Entries are visited in sorted order for deterministic output.
- `maxFiles` (default 1000) and `maxBytes` (default 64 MiB) bound the walk. On hitting a bound the result
  is `truncated: true` with `truncation` naming the reason and what was collected so far. A single file
  larger than the remaining byte budget is skipped whole, never partially hashed.

## Docker artifact collection

The Docker adapter declares `sandbox.artifacts` as `emulated`: collection happens at the Capsule adapter
boundary, not in a provider-native artifact store. `job.artifacts` is declared `unsupported` (see below).

- `sandbox.exec` collects artifacts. Pass `ExecSpec.artifactPaths` (container paths). After the command
  runs, the adapter copies each path out of the live container with `docker cp` into a throwaway temp dir,
  runs `collectFileArtifacts` over it, and returns the results on `ExecResult.artifacts` (and the receipt's
  `artifactHashes`). A failing `docker cp` surfaces as a provider error.

  ```ts
  const exec = await sandbox.exec({ command: ["sh", "-lc", "make build"], artifactPaths: ["/workspace/dist"] });
  exec.artifacts; // hashed files copied out of /workspace/dist
  ```

- Copies keep their location relative to the deepest directory shared by all requested paths. A single
  path, or paths in one directory, keep the plain basename layout; `/a/out.txt` and `/b/out.txt` land at
  `a/out.txt` and `b/out.txt` instead of overwriting each other. A path requested twice, or the container
  root itself, is rejected before any `docker cp`.

- Each path is one `docker cp` call. Paths where none lies inside another are copied up to four at a time;
  when one requested path is inside another, or two paths could name one host path on a case- or
  Unicode-insensitive file system (`/c/out` and `/c/OUT/x`), the copies run one after another in request
  order. Before each of those copies every directory on the way to its destination is checked: if an earlier
  copy put a symbolic link or a file there (the container can plant `/out/logs -> /host/dir`), the exec
  rejects instead of letting `mkdir -p` or `docker cp` follow it and write on the host. After a
  failed copy no further copy starts, the running ones finish, and the error of the earliest failed path is
  raised. Copying through one tar stream was measured and not used: it needs `tar` in the container, runs
  as the container user and extracts a container-controlled archive on the host, so it cannot match
  `docker cp` exactly.

- `job.run` returns no artifacts. Docker jobs run with `docker run --rm`, so the container is removed the
  moment the process exits, before any `docker cp` could reach it. Collecting job artifacts would require
  restructuring job execution into a create/start/wait/cp/rm lifecycle; until that exists, job artifacts
  stay `[]` and the capability is declared `unsupported`. Use a sandbox with `artifactPaths` when you need
  artifacts from Docker.

## Other sandbox providers

E2B, Daytona and Modal declare `sandbox.artifacts` as `unsupported`. They do not copy `artifactPaths`, so
their `ExecResult.artifacts` stays `[]`; check `capsule.supports("sandbox.artifacts")` before relying on
artifacts.
