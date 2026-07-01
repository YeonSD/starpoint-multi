# Starpoint Multi

Self-hosted World Flipper server emulator based on the original [Starpoint](https://github.com/Duosion/starpoint), with experimental multiplayer restoration work.

## Run With Docker

Requirements:

- Ubuntu server reachable from the devices that will connect
- Docker and Docker Compose
- Game CDN files

Setup:

```bash
git clone https://github.com/YeonSD/starpoint-multi.git
cd starpoint-multi
mkdir -p .cdn .database .generated .logs
```

Put the CDN data inside `.cdn`.

Configure the realtime server address that game clients can reach:

```bash
cp .env.example .env
nano .env
```

For local LAN testing, set:

```env
STARPOINT_MULTI_HOST="YOUR_SERVER_LAN_IP"
STARPOINT_PUBLIC_HOST="YOUR_SERVER_LAN_IP:8000"
```

Start:

```bash
docker compose up -d --build
```

Open the admin page:

```text
http://YOUR_SERVER_IP:8000
```

Default login:

```text
admin / admin
```

Change the password from the Dashboard before exposing the server.

## Admin Pages

- Dashboard: select the active gacha table, reset server time, change admin password
- Players: view players, download/upload save JSON, create WireGuard client QR entries
- Rooms: view active multiplayer rooms
- Items: grant items directly to selected players or all players
- Source Code: links to upstream Starpoint and this fork

## Runtime Data

These folders are local runtime state and are not committed:

- `.cdn`: CDN files
- `.database`: SQLite data, admin password hash, WireGuard registry
- `.generated`: generated WireGuard config files
- `.logs`: local HTTP/realtime logs

## Current Networking Status

The Docker stack currently runs the Starpoint HTTP server and the realtime multiplayer server.

WireGuard and DNS replacement for the old mitmproxy workflow are the next deployment step. Until that is completed, QR creation in the Players page is a registry/config generator, not a full VPN server installer.
