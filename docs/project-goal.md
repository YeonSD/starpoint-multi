# Project Goal

This fork targets a non-commercial research restoration of World Flipper co-op play on top of Starpoint.

## Final Deployment Target

The intended end state is not only local single-machine or LAN testing. The target deployment is:

- Starpoint running on a small public cloud instance, such as Oracle Cloud Free Tier with about 1 vCPU and 1 GB RAM.
- Users connect through a private WireGuard network distributed by QR code or equivalent peer configuration.
- World Flipper clients route DNS/API/realtime traffic through that VPN path to the hosted Starpoint instance.
- Co-op should work for multiple invited users connected to the same WireGuard overlay network, even when they are not physically on the same LAN.

This means multiplayer implementation should avoid assumptions that only work on localhost or a single Windows host.

## Current Priority

Before implementing realtime co-op logic, keep the environment stable and evidence-driven:

- Preserve a known-good Starpoint database and client state before multiplayer tests.
- Capture HTTP request/response flows for `multi_battle_quest/*` and failed routes.
- Capture whether the client opens a realtime connection, especially around port `18888`.
- Only move to APK, IL2CPP, Ghidra, or Frida analysis after the Starpoint/API-side behavior has been verified from logs and packets.

## Multiplayer Design Implications

Future server work should account for:

- Binding services to an address reachable over WireGuard, not only `127.0.0.1`.
- Configurable advertised host/port values returned to the client.
- Low-memory operation suitable for a 1 GB cloud instance.
- Clear separation between HTTP API emulation and the realtime multiplayer server.
- Logs that can be collected on a headless Linux VPS.
