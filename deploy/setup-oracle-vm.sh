#!/usr/bin/env bash
# One-time setup for a fresh Oracle Cloud Always Free VM (Ubuntu, ARM
# VM.Standard.A1.Flex). Installs Docker + Caddy, builds the bot's image, and
# runs it with a restart policy so it survives crashes and VM reboots.
#
# Run this ON THE VM (via SSH), from the jump-line-bot repo root, after:
#   1. Cloning this repo onto the VM (git clone ... or scp the folder over)
#   2. Copying your real .env onto the VM (scp .env vm:~/jump-line-bot/.env)
#   3. Editing deploy/Caddyfile to your real domain
#   4. Opening ports 80/443 in the Oracle Security List (see README note)
#
# Usage: bash deploy/setup-oracle-vm.sh

set -euo pipefail

if [ ! -f .env ]; then
  echo "Missing .env in the repo root — copy your real one here first (see .env.example)." >&2
  exit 1
fi

echo "== Installing Docker =="
if ! command -v docker &>/dev/null; then
  curl -fsSL https://get.docker.com | sudo sh
  sudo usermod -aG docker "$USER"
fi

echo "== Installing Caddy =="
if ! command -v caddy &>/dev/null; then
  sudo apt-get update -y
  sudo apt-get install -y debian-keyring debian-archive-keyring apt-transport-https curl
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' \
    | sudo gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' \
    | sudo tee /etc/apt/sources.list.d/caddy-stable.list
  sudo apt-get update -y
  sudo apt-get install -y caddy
fi

echo "== Configuring Caddy (reverse proxy + automatic HTTPS) =="
sudo cp deploy/Caddyfile /etc/caddy/Caddyfile
sudo systemctl reload caddy || sudo systemctl restart caddy
sudo systemctl enable caddy

echo "== Building the bot image =="
sudo docker build -t jump-line-bot .

echo "== Starting the bot (restart=always survives reboots/crashes) =="
sudo docker rm -f jump-line-bot 2>/dev/null || true
sudo docker run -d \
  --name jump-line-bot \
  --restart always \
  --env-file .env \
  -p 3000:3000 \
  jump-line-bot

echo
echo "Done. Once DNS for your domain points at this VM's public IP:"
echo "  - Health check: https://your-domain/  ->  should show the bot's OK message"
echo "  - Set the LINE webhook to: https://your-domain/webhook"
echo "  - Set APP_BASE_URL=https://your-domain in .env, then re-run this script"
echo "    (or just: sudo docker restart jump-line-bot after editing .env)"
