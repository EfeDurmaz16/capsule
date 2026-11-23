#!/bin/sh
set -eu
export DEBIAN_FRONTEND=noninteractive
apt-get -qq update
apt-get -qq install -y ca-certificates curl git lsof xz-utils
node_version=22.22.2
archive="node-v${node_version}-linux-x64.tar.xz"
download="$(mktemp -d)"
trap 'rm -rf "$download"' EXIT
cd "$download"
curl -fsSLO "https://nodejs.org/dist/v${node_version}/$archive"
curl -fsSLO "https://nodejs.org/dist/v${node_version}/SHASUMS256.txt"
grep "  $archive\$" SHASUMS256.txt | sha256sum -c -
mkdir -p /opt/fabric-runner/node
tar -xJf "$archive" --strip-components=1 -C /opt/fabric-runner/node
export PATH="/opt/fabric-runner/node/bin:$PATH"
npm install --global --prefix /opt/fabric-runner/node @openai/codex@0.163.0
install -d -m 0755 /opt/fabric-runner
touch /opt/fabric-runner/bootstrap-ready
