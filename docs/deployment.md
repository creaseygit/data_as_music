# Deployment

## Infrastructure

- **Hosting:** AWS Lightsail ($7/mo, 1GB) in `us-east-1`
- **Reverse proxy:** Nginx on the instance
- **CDN/DNS/HTTPS:** CloudFlare (handles SSL termination)
- **Domain:** Configured in CloudFlare DNS → Lightsail public IP

## Instance Layout

```
/opt/polymarket_dj/          # git clone of this repo
├── venv/                    # Python virtualenv
├── server.py                # runs on port 8888
├── frontend/                # served by Nginx as /static/
└── deploy/
    ├── nginx.conf           # → /etc/nginx/sites-available/polymarket-dj
    ├── polymarket-dj.service# → /etc/systemd/system/
    └── setup.sh             # one-time provisioning script
```

The app runs as a systemd service under the `ubuntu` user.

## SSH Access

```bash
ssh -i ~/.ssh/lightsail-polymarket-dj.pem ubuntu@3.210.159.215
```

The instance has a GitHub deploy key (`~/.ssh/deploy_key`) configured via `~/.ssh/config`, with the remote set to `git@github.com:creaseygit/polymarket_dj.git` (SSH).

## Deploying Changes

After pushing to GitHub:

```bash
ssh -i ~/.ssh/lightsail-polymarket-dj.pem ubuntu@3.210.159.215 \
  "cd /opt/polymarket_dj && git pull && sudo systemctl restart polymarket-dj"
```

For changes that only affect `frontend/` static files (JS, CSS, HTML), the restart is still needed because `server.py` serves `index.html` directly and discovers tracks at startup.

## Useful Commands

All commands below assume you've SSH'd into the instance (see above), or prefix with the full ssh command.

```bash
# Check if the service is running
sudo systemctl status polymarket-dj

# Tail live logs
sudo journalctl -u polymarket-dj -f

# Restart after config or code changes
sudo systemctl restart polymarket-dj

# Reload Nginx after changing nginx.conf
sudo cp /opt/polymarket_dj/deploy/nginx.conf /etc/nginx/sites-available/polymarket-dj
sudo nginx -t && sudo systemctl reload nginx
```

## First-Time Setup

Run `deploy/setup.sh` on a fresh Ubuntu Lightsail instance. It installs Python 3.12, Nginx, clones the repo, creates the venv, and configures systemd + Nginx.

After setup:
1. Point your domain to the instance's public IP in CloudFlare
2. Update `server_name` in the Nginx config if using a custom domain
3. Ensure the Lightsail firewall allows ports 80 and 443

## CloudFlare

DNS and CDN are managed via CloudFlare. API credentials are stored in `~/.bashrc` environment variables on the local dev machine (see memory reference for zone ID details).

## Notes

- The Lightsail instance is in `us-east-1`, which avoids the Polymarket geo-block (no VPN needed server-side)
- Local development from UAE requires a VPN for Polymarket API access
- Static files get a 1h cache via Nginx (`Cache-Control: public, immutable`), so CloudFlare may serve stale versions briefly after deploy — purge the CloudFlare cache if needed for immediate updates
