# Deployment

## Infrastructure

- **Hosting:** AWS Lightsail (1GB) in `us-east-1`
- **Reverse proxy:** Nginx on the instance
- **CDN/DNS/HTTPS:** CloudFlare (handles SSL termination)
- **Domain:** Configured in CloudFlare DNS → Lightsail public IP

Connection details (IP, SSH key path, CloudFlare credentials) are in `.env` (gitignored).

## Instance Layout

```
/opt/data_as_music/          # git clone of this repo
├── venv/                    # Python virtualenv
├── server.py                # runs on port 8888
├── frontend/                # served by Nginx as /static/
└── deploy/
    ├── nginx.conf           # → /etc/nginx/sites-available/data-as-music
    ├── data-as-music.service# → /etc/systemd/system/
    └── setup.sh             # one-time provisioning script
```

The app runs as a systemd service under the `data-as-music` user.

## Deploying Changes

**Auto-deploy:** Every push to `master` triggers a GitHub Actions workflow (`.github/workflows/deploy.yml`) that SSHes into Lightsail, pulls the latest code, and restarts the service. No manual steps needed.

The workflow uses three GitHub repo secrets: `LIGHTSAIL_IP`, `LIGHTSAIL_USER`, `LIGHTSAIL_SSH_KEY`.

**Manual deploy** (if needed):

```bash
source .env
ssh -i $LIGHTSAIL_KEY $LIGHTSAIL_USER@$LIGHTSAIL_IP \
  "cd $DEPLOY_PATH && git pull && sudo systemctl restart data-as-music"
```

The instance has a GitHub deploy key (`~/.ssh/deploy_key`) configured via `~/.ssh/config` so `git pull` works over SSH.

For changes that only affect `frontend/` static files (JS, CSS, HTML), the restart is still needed because `server.py` serves `index.html` directly and discovers tracks at startup.

## Useful Commands

All commands below assume you've SSH'd into the instance, or prefix with `ssh -i $LIGHTSAIL_KEY $LIGHTSAIL_USER@$LIGHTSAIL_IP`.

```bash
# Check if the service is running
sudo systemctl status data-as-music

# Tail live logs
sudo journalctl -u data-as-music -f

# Restart after config or code changes
sudo systemctl restart data-as-music

# Reload Nginx after changing nginx.conf
sudo cp /opt/data_as_music/deploy/nginx.conf /etc/nginx/sites-available/data-as-music
sudo nginx -t && sudo systemctl reload nginx
```

## First-Time Setup

Run `deploy/setup.sh` on a fresh Ubuntu Lightsail instance. It installs Python 3.12, Nginx, clones the repo, creates the venv, and configures systemd + Nginx.

After setup:
1. Point your domain to the instance's public IP in CloudFlare
2. Update `server_name` in the Nginx config if using a custom domain
3. Ensure the Lightsail firewall allows ports 80 and 443

## Notes

- The Lightsail instance is in `us-east-1`, which avoids the prediction market's geo-block (no VPN needed server-side)
- Local development from UAE requires a VPN for prediction market API access
- Static files get a 1h cache via Nginx (`Cache-Control: public, immutable`), so CloudFlare may serve stale versions briefly after deploy — purge the CloudFlare cache if needed for immediate updates
