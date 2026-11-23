#!/bin/sh
set -eu
export PATH="/opt/fabric-runner/node/bin:$PATH"
test -f /opt/fabric-runner/bootstrap-ready
sudo install -m 0755 "$HOME/fabric-linux" /usr/local/bin/fabric
mkdir -p "$HOME/capsule"
tar -xzf "$HOME/capsule-source.tar.gz" -C "$HOME/capsule"
cd "$HOME/capsule"
npm exec --yes --package=pnpm@10.32.1 -- pnpm install --frozen-lockfile --filter '@capsule-sdk/bridge-worker...'
npm exec --yes --package=pnpm@10.32.1 -- pnpm --filter '@capsule-sdk/bridge-worker...' build
test -f packages/bridge-worker/dist/bin.js
sudo tee /etc/systemd/system/fabric-codex-runner.service >/dev/null <<'UNIT'
[Unit]
Description=Fabric Codex runner
After=network-online.target
Wants=network-online.target

[Service]
User=fabrictest
WorkingDirectory=/home/fabrictest
Environment=HOME=/home/fabrictest
Environment=PATH=/opt/fabric-runner/node/bin:/usr/local/bin:/usr/bin:/bin
EnvironmentFile=/home/fabrictest/.fabric-vercel-env
ExecStart=/usr/local/bin/fabric codex-runner serve --worker /home/fabrictest/capsule/packages/bridge-worker/dist/bin.js
Restart=on-failure
RestartSec=5

[Install]
WantedBy=multi-user.target
UNIT
sudo systemctl daemon-reload
fabric codex-runner --help
codex --version
