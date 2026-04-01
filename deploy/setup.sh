#!/bin/bash
# Provisioning script for Data as Music (dam.fm)
# Run on a fresh Ubuntu instance (Lightsail or EC2) in us-east-1
set -euo pipefail

echo "=== Installing system packages ==="
sudo apt update
sudo apt install -y python3.12 python3.12-venv nginx git

echo "=== Creating service user ==="
sudo useradd --system --shell /usr/sbin/nologin --home-dir /opt/data_as_music data-as-music || true

echo "=== Cloning repository ==="
sudo mkdir -p /opt/data_as_music
sudo chown data-as-music:data-as-music /opt/data_as_music
sudo -u data-as-music git clone https://github.com/creaseygit/data_as_music.git /opt/data_as_music

echo "=== Setting up Python venv ==="
cd /opt/data_as_music
sudo -u data-as-music python3.12 -m venv venv
sudo -u data-as-music venv/bin/pip install -r requirements.txt

echo "=== Configuring Nginx ==="
sudo cp deploy/nginx.conf /etc/nginx/sites-available/data-as-music
sudo ln -sf /etc/nginx/sites-available/data-as-music /etc/nginx/sites-enabled/
sudo rm -f /etc/nginx/sites-enabled/default
sudo nginx -t
sudo systemctl restart nginx

echo "=== Installing systemd service ==="
sudo cp deploy/data-as-music.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable data-as-music
sudo systemctl start data-as-music

echo "=== Done ==="
echo "Check status: sudo systemctl status data-as-music"
echo "View logs: sudo journalctl -u data-as-music -f"
echo ""
echo "Next steps:"
echo "  1. Point your domain to this instance's public IP in CloudFlare"
echo "  2. Update server_name in /etc/nginx/sites-available/data-as-music"
echo "  3. Ensure Lightsail firewall allows ports 80 and 443"
