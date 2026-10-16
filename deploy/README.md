# Production: tendiesbrawl.com

```
players ──https──> tendiesbrawl.com          Cloudflare Worker (static assets, UI repo `pnpm run deploy`)
        ──wss────> api.tendiesbrawl.com      Cloudflare edge ──Tunnel──> droplet 127.0.0.1:3000 (this repo)
```

| Piece | Where |
| --- | --- |
| Droplet | DigitalOcean `tendiesbrawl-api`, `syd1` (closest DO region to NZ), `s-1vcpu-1gb` ($6/mo), Ubuntu 24.04, tag `tendiesbrawl` |
| Firewall | DO cloud firewall `tendiesbrawl-ssh-only`: inbound SSH only. The game is reachable only through the tunnel. |
| Tunnel | Cloudflare Tunnel `tendiesbrawl-api` (remotely managed). Ingress `api.tendiesbrawl.com → http://127.0.0.1:3000`, everything else 404. DNS: proxied CNAME `api → <tunnel-id>.cfargotunnel.com`. |
| Server | systemd unit `tendiesbrawl` running `bun run ./src/index.ts` as user `tendies` from `/opt/tendiesbrawl/current` (a symlink to the active release). Env in the unit (`HOST=127.0.0.1`, `PORT=3000`, `CORS_ORIGIN=https://tendiesbrawl.com`); overrides go in `/etc/tendiesbrawl.env`. |
| cloudflared | systemd unit `cloudflared` (installed by `cloudflared service install <token>`), from Cloudflare's apt repo, kept current by unattended-upgrades. |
| UI | Worker `tendiesbrawl`, custom domains `tendiesbrawl.com` + `www.tendiesbrawl.com`; a zone redirect rule sends www → apex (301), so CORS has one origin. |

SSH uses the alias `tendiesbrawl` in `~/.ssh/config` (key `~/.ssh/tendiesbrawl_ed25519`, user root).

## Deploy the server

```bash
bash deploy/deploy.sh
```

Ships the committed `HEAD` (`git archive`, so uncommitted changes are left out), switches the `current` symlink, restarts the service, checks `/api/bots.json`, and keeps the last 5 releases. **A restart drops every running game** (rooms live in memory), so deploy between games.

Roll back: `ssh tendiesbrawl 'ls -t /opt/tendiesbrawl/releases'`, then `ln -sfn <release> /opt/tendiesbrawl/current && systemctl restart tendiesbrawl`.

## Operate

```bash
ssh tendiesbrawl journalctl -u tendiesbrawl -f        # server logs
ssh tendiesbrawl journalctl -u cloudflared -n 50      # tunnel logs
ssh tendiesbrawl systemctl restart tendiesbrawl
curl https://api.tendiesbrawl.com/api/bots.json        # public health check
```

## Rebuild from scratch

1. `doctl compute droplet create … --tag-names tendiesbrawl` (the firewall applies by tag).
2. `ssh <host> 'bash -s' < deploy/provision.sh` installs Bun (pinned, `BUN_VERSION`), cloudflared, swap, the `tendies` user and the unit. It is idempotent.
3. Install the tunnel token without printing it:
   `cf tunnels token get <tunnel-id> | tr -d '"[:space:]' | ssh <host> 'read -r t; cloudflared service install "$t"'`
4. `bash deploy/deploy.sh` (set `DEPLOY_HOST` if the SSH alias differs).
