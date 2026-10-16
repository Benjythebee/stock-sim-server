#!/usr/bin/env bash
# One-time (idempotent) setup of a fresh Ubuntu 24.04 droplet. Run as root on the droplet:
#   ssh tendiesbrawl 'bash -s' < deploy/provision.sh
# Installs Bun, cloudflared, a 1 GB swap file, the `tendies` service user and the systemd unit.
# The tunnel token is installed separately (see deploy/README.md).
set -euo pipefail

BUN_VERSION="${BUN_VERSION:-1.3.0}"
APP_DIR=/opt/tendiesbrawl

export DEBIAN_FRONTEND=noninteractive
cloud-init status --wait >/dev/null 2>&1 || true

apt-get update -q
apt-get install -yq unzip curl ca-certificates unattended-upgrades

# Swap: a 1 GB box has no swap by default, and apt or a burst of rooms shouldn't OOM-kill the server.
if ! swapon --show | grep -q /swapfile; then
    fallocate -l 1G /swapfile
    chmod 600 /swapfile
    mkswap /swapfile
    swapon /swapfile
    grep -q '^/swapfile' /etc/fstab || echo '/swapfile none swap sw 0 0' >> /etc/fstab
fi

# Bun, pinned, installed system-wide as /usr/local/bin/bun.
if ! /usr/local/bin/bun --version 2>/dev/null | grep -qx "$BUN_VERSION"; then
    curl -fsSL https://bun.sh/install | BUN_INSTALL=/usr/local bash -s "bun-v$BUN_VERSION"
fi

# cloudflared from Cloudflare's apt repo (so unattended-upgrades keeps it current).
if ! command -v cloudflared >/dev/null; then
    mkdir -p --mode=0755 /usr/share/keyrings
    curl -fsSL https://pkg.cloudflare.com/cloudflare-main.gpg -o /usr/share/keyrings/cloudflare-main.gpg
    echo "deb [signed-by=/usr/share/keyrings/cloudflare-main.gpg] https://pkg.cloudflare.com/cloudflared any main" \
        > /etc/apt/sources.list.d/cloudflared.list
    apt-get update -q
    apt-get install -yq cloudflared
fi
grep -q 'pkg.cloudflare.com' /etc/apt/apt.conf.d/51tendiesbrawl-upgrades 2>/dev/null ||
    echo 'Unattended-Upgrade::Origins-Pattern { "site=pkg.cloudflare.com"; };' > /etc/apt/apt.conf.d/51tendiesbrawl-upgrades

id tendies >/dev/null 2>&1 || useradd --system --home-dir "$APP_DIR" --shell /usr/sbin/nologin tendies
mkdir -p "$APP_DIR/releases"

install -m 0644 /dev/stdin /etc/systemd/system/tendiesbrawl.service <<'UNIT'
[Unit]
Description=Tendies Brawl game server
After=network-online.target
Wants=network-online.target

[Service]
User=tendies
WorkingDirectory=/opt/tendiesbrawl/current
ExecStart=/usr/local/bin/bun run ./src/index.ts
EnvironmentFile=-/etc/tendiesbrawl.env
Environment=NODE_ENV=production
Environment=HOST=127.0.0.1
Environment=PORT=3000
Environment=CORS_ORIGIN=https://tendiesbrawl.com
# No writable home, so don't let Bun try to write its transpiler cache.
Environment=BUN_RUNTIME_TRANSPILER_CACHE_PATH=0
Restart=always
RestartSec=2
NoNewPrivileges=true
ProtectSystem=strict
ProtectHome=true
PrivateTmp=true

[Install]
WantedBy=multi-user.target
UNIT

systemctl daemon-reload
systemctl enable tendiesbrawl.service >/dev/null
echo "provisioned: bun $(/usr/local/bin/bun --version), $(cloudflared --version)"
