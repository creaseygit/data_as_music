#!/bin/bash
# Provisioning script for The Polymarket DJ
# Run on a fresh Ubuntu instance (Lightsail or EC2) in us-east-1
set -euo pipefail

echo "=== Installing system packages ==="
sudo apt update
sudo apt install -y python3.12 python3.12-venv nginx git

echo "=== Creating service user ==="
sudo useradd --system --shell /usr/sbin/nologin --home-dir /opt/polymarket_dj polymarket-dj || true

echo "=== Cloning repository ==="
sudo mkdir -p /opt/polymarket_dj
sudo chown polymarket-dj:polymarket-dj /opt/polymarket_dj
sudo -u polymarket-dj git clone https://github.com/creaseygit/polymarket_dj.git /opt/polymarket_dj

echo "=== Setting up Python venv ==="
cd /opt/polymarket_dj
sudo -u polymarket-dj python3.12 -m venv venv
sudo -u polymarket-dj venv/bin/pip install -r requirements.txt

echo "=== Configuring Nginx ==="
sudo cp deploy/nginx.conf /etc/nginx/sites-available/polymarket-dj
sudo ln -sf /etc/nginx/sites-available/polymarket-dj /etc/nginx/sites-enabled/
sudo rm -f /etc/nginx/sites-enabled/default
sudo nginx -t
sudo systemctl restart nginx

echo "=== Installing systemd service ==="
sudo cp deploy/polymarket-dj.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable polymarket-dj
sudo systemctl start polymarket-dj

echo "=== Done ==="
echo "Check status: sudo systemctl status polymarket-dj"
echo "View logs: sudo journalctl -u polymarket-dj -f"
echo ""
echo "Next steps:"
echo "  1. Point your domain to this instance's public IP in CloudFlare"
echo "  2. Update server_name in /etc/nginx/sites-available/polymarket-dj"
echo "  3. Ensure Lightsail firewall allows ports 80 and 443"
