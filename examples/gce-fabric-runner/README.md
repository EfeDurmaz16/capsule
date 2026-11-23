# Fabric runner on Compute Engine

This example provisions a short-lived Debian 12 x86 runner using Capsule's Compute Engine machine adapter. Fabric submits jobs to the host over SSH. The Capsule bridge worker still executes jobs in Vercel Sandbox.

Build the core and GCE packages. Supply the Linux x86-64 Fabric executable as `fabric-linux` and a Capsule source archive at the intended bridge-worker revision as `capsule-source.tar.gz`. Use a dedicated SSH key and an authenticated Google Cloud CLI with access to the project, zone and network.

```sh
pnpm --filter @capsule-sdk/core build
pnpm --filter @capsule-sdk/gce build

node examples/gce-fabric-runner/runner.mjs create "$PROJECT" "$ZONE" "$NAME" "$SSH_KEY.pub"
sh examples/gce-fabric-runner/setup.sh "$PROJECT" "$ZONE" "$NAME" "$SSH_KEY" "$ARTIFACT_DIRECTORY"
```

Use a distinct instance name for each test. Retrying `create` with the same project, zone and name reuses the request ID. The VM and its boot disk have a two-hour lifetime.

Connect over SSH as `fabrictest` and authorize Codex once on the runner with `PATH=/opt/fabric-runner/node/bin:$PATH codex login --device-auth`. Deliver the Vercel project OIDC token over SSH to `~/.fabric-vercel-env` with mode 600, as `VERCEL_OIDC_TOKEN=<value>`. The test service uses this file at startup. Refresh the token and restart the service before another run if the token has expired.

Start `fabric-codex-runner.service` under systemd and submit with Fabric's existing `codex-runner submit` command over SSH. Retrieve the result and thread before destroying the runner.

```sh
node examples/gce-fabric-runner/runner.mjs status "$PROJECT" "$ZONE" "$NAME"
node examples/gce-fabric-runner/runner.mjs destroy "$PROJECT" "$ZONE" "$NAME"
```
