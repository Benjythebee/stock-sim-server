#!/usr/bin/env bash
# Ship the committed HEAD to the droplet and restart the server. Run from the repo root:
#   bash deploy/deploy.sh            # SSH host alias defaults to `tendiesbrawl`
#   DEPLOY_HOST=root@1.2.3.4 bash deploy/deploy.sh
# Uncommitted changes are NOT deployed (it uses `git archive HEAD`). Keeps the last 5 releases.
set -euo pipefail

HOST="${DEPLOY_HOST:-tendiesbrawl}"
SHA="$(git rev-parse --short HEAD)"
RELEASE="$(date -u +%Y%m%d%H%M%S)-$SHA"

if [ -n "$(git status --porcelain --untracked-files=no)" ]; then
    echo "warning: you have uncommitted changes; deploying HEAD ($SHA) without them" >&2
fi

echo "deploying $SHA to $HOST as $RELEASE"
git archive --format=tar HEAD | ssh "$HOST" "
    set -euo pipefail
    dir=/opt/tendiesbrawl/releases/$RELEASE
    mkdir -p \$dir && tar -x -C \$dir
    ln -sfn \$dir /opt/tendiesbrawl/current
    systemctl restart tendiesbrawl
    sleep 2
    systemctl is-active --quiet tendiesbrawl || { journalctl -u tendiesbrawl -n 30 --no-pager; exit 1; }
    curl -fsS -o /dev/null http://127.0.0.1:3000/api/bots.json
    ls -1dt /opt/tendiesbrawl/releases/* | tail -n +6 | xargs -r rm -rf
    journalctl -u tendiesbrawl -n 3 --no-pager -o cat
"
echo "deployed $SHA"
