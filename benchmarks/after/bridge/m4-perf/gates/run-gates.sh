#!/bin/bash
# Runs Capsule's CI gates serially on /tmp/capsule-wt/m4 on Node 22 and logs each with its exit code and load.
# No timing: bench:bounds is left to the performance phase; nothing builds or pulls a Docker image.
export PATH="$HOME/.nvm/versions/node/v22.23.2/bin:$PATH"
cd /tmp/capsule-wt/m4
OUT=$1
: > $OUT/summary.txt
git rev-parse HEAD > $OUT/commit.txt
echo "node $(node -v) pnpm $(pnpm -v); load at start: $(sysctl -n vm.loadavg)" >> $OUT/summary.txt
run() { name=$1; shift; start=$(date +%s); "$@" > $OUT/$name.log 2>&1; rc=$?; end=$(date +%s); echo "$name: exit $rc ($((end-start)) s) load $(sysctl -n vm.loadavg)" >> $OUT/summary.txt; }
run install pnpm install --frozen-lockfile --offline
run gap pnpm capsule:gap:check
run format pnpm format:check
run typecheck pnpm typecheck
run test pnpm test
run build pnpm build
run release-audit pnpm release:audit
run docs-api pnpm docs:api:check
run package-exports pnpm test:package-exports
run pack-smoke-compatible pnpm release:pack-smoke:compatible
echo DONE >> $OUT/summary.txt
