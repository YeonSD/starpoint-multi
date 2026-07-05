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

Configure the public address used in WireGuard QR codes:

```bash
cp .env.example .env
nano .env
```

Set these values:

```env
STARPOINT_PUBLIC_HOST="YOUR_SERVER_IP_OR_DOMAIN:8000"
STARPOINT_WG_ENDPOINT_HOST="YOUR_SERVER_IP_OR_DOMAIN"
TZ="Asia/Seoul"
```

`TZ` controls the local timezone shown in the admin dashboard and used by Live server time mode.
The default is `Asia/Seoul`; change it only if you want to operate the server in another timezone.

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

In the Players page, create one WireGuard QR per device. After the device enables that VPN profile, launch the game and use guest login. The new account appears in the Players list.

## Admin Pages

- Dashboard: select the active gacha table, choose Fixed or Live server time, change admin password
- Players: view players, download/upload save JSON, create WireGuard client QR entries
- Rooms: view active multiplayer rooms
- Items: grant free lodestar beads (`free_vmoney`) or mana (`free_mana`) to selected players or all players
- Source Code: links to upstream Starpoint and this fork

## Runtime Data

These folders are local runtime state and are not committed:

- `.cdn`: CDN files
- `.database`: SQLite data, admin password hash, WireGuard registry
- `.generated`: generated WireGuard config files
- `.logs`: local HTTP/realtime logs

## Networking

The Docker stack runs:

- Starpoint HTTP/admin server on port `8000`
- realtime multiplayer server on `10.13.13.1:18888` inside WireGuard
- WireGuard on UDP `51820`
- DNS redirection for World Flipper domains through WireGuard

Open inbound TCP `8000` and UDP `51820` on the host firewall/cloud security list.
