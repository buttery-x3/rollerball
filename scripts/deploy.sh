#!/usr/bin/env bash
set -Eeuo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")/.."
[[ $(id -un) == flamehorn ]] || { echo 'Run as flamehorn.' >&2; exit 1; }
export PM2_HOME=/home/flamehorn/.pm2
exec 9>"$(git rev-parse --git-path production-deploy.lock)"
flock -n 9 || { echo 'Another deployment is running.' >&2; exit 1; }
[[ $(git branch --show-current) == main ]] || { echo 'Expected branch main.' >&2; exit 1; }
[[ -z $(git status --porcelain) ]] || { echo 'Server checkout has local changes; preserve them first.' >&2; exit 1; }
previous=$(git rev-parse HEAD)
git fetch origin main
target=$(git rev-parse FETCH_HEAD)
git merge-base --is-ancestor "$previous" "$target" || { echo 'main has diverged; stopping.' >&2; exit 1; }

staging=$(mktemp -d)
trap 'rm -rf -- "$staging"' EXIT
git archive "$target" | tar -x -C "$staging"
bash -n "$staging/scripts/deploy.sh"
# Build outside the live tree. Run validation locally or in CI before merging.
(cd "$staging" && npm ci --include=dev && VITE_BASE_PATH=/rollerball npm run build)
test -s "$staging/build/index.html"
[[ -z $(git status --porcelain) && $(git rev-parse HEAD) == "$previous" ]] || {
  echo 'Server checkout changed during validation; stopping.' >&2; exit 1;
}

backup="/home/flamehorn/rollerball-backups/$(date -u +%Y%m%dT%H%M%SZ)-${previous:0:12}-$$"
mkdir -p "$backup"
git archive "$previous" | gzip > "$backup/source.tar.gz"
if [[ -f build/index.html ]]; then
  tar -czf "$backup/build.tar.gz" -C build .
fi
echo "Backup: $backup"

rollback() {
  result=$?
  trap - ERR
  echo "Deployment failed; restoring $previous." >&2
  if git reset --keep "$previous"; then
    if [[ -f "$backup/build.tar.gz" ]]; then
      tar -xzf "$backup/build.tar.gz" -C build
      pm2 startOrReload ecosystem.config.cjs --update-env 9>&- || true
    else
      pm2 delete rollerball 9>&- || true
    fi
  fi
  echo "Inspect the app and backup $backup before retrying." >&2
  exit "$result"
}

git merge --ff-only "$target"
trap rollback ERR
mkdir -p build
# Keep old hashed assets for already-open browser tabs. Publish HTML last.
rsync -a --exclude=index.html "$staging/build/" build/
cp "$staging/build/index.html" build/.index.html.next
mv -f build/.index.html.next build/index.html
pm2 startOrReload ecosystem.config.cjs --update-env 9>&-
healthy=false
for attempt in {1..15}; do
  if curl --fail --silent --show-error --max-time 3 http://127.0.0.1:4006/ -o "$staging/served.html" &&
     cmp -s "$staging/served.html" build/index.html; then
    healthy=true
    break
  fi
  sleep 1
done
[[ "$healthy" == true ]] || { echo 'App health check failed.' >&2; false; }
pm2 save 9>&-
trap - ERR
echo "Deployed $(git rev-parse --short HEAD) to https://buttery.wtf/rollerball/"
