#!/usr/bin/env sh
set -eu

cd "$(dirname "$0")/.."

mkdir -p .cdn .database .generated .logs

if [ ! -f .env ]; then
    cp .env.example .env
    echo "Created .env from .env.example. Edit .env before sharing WireGuard QR codes."
fi

docker compose build starpoint realtime wireguard

# nginx, starpoint, and realtime share the wireguard container network namespace.
# Recreate them together so updates cannot leave old containers attached to a
# removed wireguard namespace.
docker compose up -d --force-recreate wireguard nginx starpoint realtime
