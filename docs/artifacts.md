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
import { verifyArtifactHash } from "@capsule/core";

const result = verifyArtifactHash(artifact, bytes);
// { valid: true } | { valid: false, reason: "hash-mismatch", expected, actual } | { valid: false, reason: "missing-hash", actual }
```

## Artifact manifest

`createArtifactManifest(artifacts)` produces a versioned, verifiable manifest, mirroring the evidence
bundle. The digest is a `sha256` over the canonical (key-sorted, `undefined`-dropped) payload, so it is
stable regardless of object key order and changes if any entry is added, removed, or tampered with.

```ts
import { createArtifactManifest, verifyArtifactManifest } from "@capsule/core";

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
import { collectFileArtifacts } from "@capsule/core";

const { artifacts, truncated, truncation } = collectFileArtifacts("./out", { maxFiles: 1000, maxBytes: 64 * 1024 * 1024 });
```

Honest bounds:

- Symlinks (file or directory) are never followed, so collection cannot escape the tree or loop.
- Entries are visited in sorted order for deterministic output.
- `maxFiles` (default 1000) and `maxBytes` (default 64 MiB) bound the walk. On hitting a bound the result
  is `truncated: true` with `truncation` naming the reason and what was collected so far. A single file
  larger than the remaining byte budget is skipped whole, never partially hashed.

## Docker artifact collection

The Docker adapter declares `sandbox.artifacts` and `job.artifacts` as `emulated`: collection happens at
the Capsule adapter boundary, not in a provider-native artifact store.

- `sandbox.exec` collects artifacts. Pass `ExecSpec.artifactPaths` (container paths). After the command
  runs, the adapter copies each path out of the live container with `docker cp` into a throwaway temp dir,
  runs `collectFileArtifacts` over it, and returns the results on `ExecResult.artifacts` (and the receipt's
  `artifactHashes`). A failing `docker cp` surfaces as a provider error.

  ```ts
  const exec = await sandbox.exec({ command: ["sh", "-lc", "make build"], artifactPaths: ["/workspace/dist"] });
  exec.artifacts; // hashed files copied out of /workspace/dist
  ```

- `job.run` returns no artifacts. Docker jobs run with `docker run --rm`, so the container is removed the
  moment the process exits, before any `docker cp` could reach it. Collecting job artifacts would require
  restructuring job execution into a create/start/wait/cp/rm lifecycle; until that exists, job artifacts
  stay `[]`. Use a sandbox with `artifactPaths` when you need artifacts from Docker.
