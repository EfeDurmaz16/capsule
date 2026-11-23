#!/bin/sh
set -eu

if [ "$#" -ne 5 ]; then
  echo "Usage: sh setup.sh PROJECT ZONE NAME SSH_KEY ARTIFACT_DIRECTORY" >&2
  exit 2
fi

project=$1
zone=$2
name=$3
ssh_key=$4
artifacts=$5
target="fabrictest@$name"
root="$(CDPATH='' cd -- "$(dirname -- "$0")" && pwd)"
test -f "$artifacts/fabric-linux"
test -f "$artifacts/capsule-source.tar.gz"

remote() {
  gcloud compute ssh "$target" --project="$project" --zone="$zone" --ssh-key-file="$ssh_key" --quiet --command="$1" -- -T -o ConnectTimeout=5
}

remaining=45
until remote 'test -f /opt/fabric-runner/bootstrap-ready' >/dev/null 2>&1; do
  remaining=$((remaining - 1))
  if [ "$remaining" -eq 0 ]; then
    echo "Runner bootstrap did not finish. Check the GCE startup script logs." >&2
    exit 1
  fi
  sleep 5
done

gcloud compute scp "$artifacts/fabric-linux" "$artifacts/capsule-source.tar.gz" "$root/install.sh" "$target:." \
  --project="$project" --zone="$zone" --ssh-key-file="$ssh_key" --quiet
remote 'sh "$HOME/install.sh"'
