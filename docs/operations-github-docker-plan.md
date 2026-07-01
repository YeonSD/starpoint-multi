# Starpoint Operations Plan

## Repository Hygiene

- Keep source, docs, scripts, and deployment templates in Git.
- Do not commit local runtime state:
  - `.cdn/`
  - `.database/`
  - `.generated/`
  - `.logs/`
  - `.analysis/`
  - `.mitmproxy*/`
  - `.env`
  - `node_modules/`
  - `out/`
- Use `.env.example` as the committed deployment template.
- Before publishing, review experimental scripts and docs so that only reusable analysis remains.

## Admin Access

- Default first login is `admin / admin`.
- Once the admin password is changed, the password hash is stored in `.database/admin.json`.
- The management UI and `/api/*` admin routes require Basic Auth.
- Game API routes under `/latest/api`, `/openapi`, and `/infodesk` remain accessible to clients.
- Change the default password before exposing port 8000 outside localhost or the VPN.

## Target Runtime Model

The long-term target is a single Starpoint deployment that replaces the current multi-mitm test setup:

1. Starpoint HTTP API and CDN patch serving.
2. Starpoint realtime multiplayer server on port 18888.
3. WireGuard server for player devices.
4. DNS redirection for World Flipper domains through the VPN.
5. Admin UI for:
   - player list
   - WireGuard peer creation
   - QR code display/download
   - active multiplayer room list
   - future gacha table selection
   - future item/mail grant workflows

## Docker Goal

Package the service as Docker Compose with persistent volumes:

- `starpoint-data` -> `/app/.database`
- `starpoint-cdn` -> `/app/.cdn`
- `starpoint-generated` -> `/app/.generated`
- `wireguard-config` -> WireGuard container config

The compose stack should expose only the necessary public ports:

- WireGuard UDP port
- Starpoint HTTP port, preferably restricted to VPN/admin access
- Realtime multiplayer port, reachable by WireGuard clients

## Deployment Target

Initial public test target:

- Oracle Ubuntu server: `217.142.253.31`
- Deployment should happen only after local Docker and WireGuard user provisioning work reliably.
- If SSH key handling is not suitable for Codex, the operator can run the documented deployment commands manually.
