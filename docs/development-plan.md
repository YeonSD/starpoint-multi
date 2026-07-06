# Starpoint Multi Development Plan

This document tracks the planned development order for turning Starpoint Multi into a usable private server package.

## Current Handoff Notes

Use this section when another agent or developer continues the work.

Current stable baseline:

- The project is deployed with Docker on the Oracle VM and can serve the admin UI, WireGuard, DNS redirection, HTTP API, and realtime multiplayer stack.
- The game client has not been patched. Do not modify APK, SWF, IL2CPP, or client binaries unless a future task explicitly changes this rule.
- Multiplayer core behavior is partially restored: rooms can be created/joined, ready state works, battles can start, player action sync has worked in live tests, rewards are partially functional, and room return/disband handling has been improved.
- Admin UI currently includes Dashboard, Players, Rooms, Items, and Source Code.
- Direct item grants currently support `free_vmoney` and `free_mana`; direct grants may be negative but clamp balances at zero. Scheduled grants are positive-only.
- `TZ` defaults to `Asia/Seoul` because the expected initial community is Korean. Operators may change it in `.env`.

Important unresolved issue:

- `Live` server time mode currently causes a client login/load failure around 5% with `No.H500`.
- Until this is analyzed, operate the game in `Fixed` mode for normal testing.
- Do not build stamina, daily mission, or mail timestamp logic on top of `Live` mode until the H500 cause is found and fixed.

First debugging target for `Live` mode:

- Compare the last successful HTTP API calls in `Fixed` mode against the failing `Live` mode run.
- Inspect `.database/server-time.json`, `/api/server/timeState`, and the `servertime` values in API responses.
- Identify the exact endpoint that returns an error or malformed payload before `No.H500`.
- Check whether the selected gacha date plus current local time falls outside an expected asset, campaign, banner, shop, agreement, tutorial, or login time range.
- Preserve backwards compatibility with existing saved `fixed`, `live`, and legacy `date_override`/`ticking` server-time files.

Do not do this without evidence:

- Do not rewrite the multiplayer protocol just because a UI state looks wrong.
- Do not add server-side bot AI before proving whether the client already has fallback AI.
- Do not delete or regenerate `.database`, `.generated`, `.cdn`, or player state during feature work.
- Do not commit logs, CDN files, keys, emulator artifacts, or private saves.
- Do not assume mail, stamina, or mission response shapes. Capture real client requests first.

## Guiding Principles

- Keep gameplay changes server-side whenever possible. Do not patch the game client unless there is no practical server-side route.
- Prefer evidence from logs, client behavior, assets, and save data before implementing protocol or API behavior.
- Keep operator-facing features simple enough to run on a small public cloud VM.
- Protect private server state: `.cdn`, `.database`, `.generated`, logs, keys, and local device artifacts must not be committed.

## Phase 1: Server Time Modes

Current status: server time was previously stored as one fixed timestamp. This is useful for selecting an old gacha period, but it does not support stamina recovery, daily missions, or other time-based systems.

Target behavior:

- `Fixed`: freeze the game server at a selected timestamp. This is the default because it is safest for gacha and tutorial compatibility.
- `Live`: use the selected gacha table date with the current server clock time in the configured `TZ` timezone.
- The saved time mode is a core server setting. Future stamina, daily mission, and mail timestamp behavior should branch on `fixed` versus `live`.

Current blocker:

- `Live` mode has been implemented but is not yet safe for gameplay because it currently triggers `No.H500` during client load.
- The next server-time task is investigation, not feature expansion.
- Expected outcome of the investigation: either fix `Live` mode or document why only `Fixed` is supported until a deeper client/API dependency is implemented.

Admin UI:

- Show the current effective game server time.
- Show the active time mode.
- Allow selecting a gacha table and applying it as Fixed or Live time.
- Warn operators that time mode changes can affect gacha, stamina, missions, shops, and login state. Recommend maintenance and client reconnects.

## Phase 2: Item Catalog

Current status: direct grants support `free_vmoney` and `free_mana`, with scheduled grants for all players.

Target behavior:

- Build a local item catalog from assets and CDN data.
- Map item IDs to names, icons, categories, and safe grant rules.
- Display searchable item names and icons in the admin UI.
- Use the catalog as the basis for mail attachments and future reward systems.

Required evidence:

- CDN file layout after extraction.
- Asset JSON tables that reference item names and icon resources.
- Representative save files containing owned items and currencies.

## Phase 3: Mail System Revival

Current status: the in-game mail screen opens, but no server-side mail implementation is active.

Target behavior:

- Store mail records, recipients, attachments, read state, claim state, and expiration.
- Let admins send text-only mail, item mail, or currency mail to one player, selected players, or all players.
- Let clients list mail, claim one mail, and claim all mail from the original in-game UI.

Required evidence:

- HTTP logs for entering the mail tab.
- HTTP logs for claim-all and single-claim actions.
- Expected response structure for empty and non-empty mailboxes.

## Phase 4: Stamina System

Current status: stamina behaves like a mostly fixed or effectively infinite value.

Target behavior:

- Admin setting: infinite stamina or normal stamina.
- Normal mode should support quest cost, natural recovery, recovery items, max stamina by rank, and full recovery on rank-up if the client expects it.

Dependencies:

- Server time modes must be stable first.
- Recovery item IDs and item-use APIs must be mapped.

## Phase 5: Gacha Table UI Improvements

Current status: gacha table selection uses raw IDs and date ranges.

Target behavior:

- Show friendly names, banners, pickup characters/equipment, and applicable dates.
- Avoid relying only on dates because multiple tables can overlap.
- Keep a manual override path for unknown tables.

Required evidence:

- `assets/gacha.json`
- `assets/gacha_campaign.json`
- CDN banner/resource mappings.
- Client screenshots for selected gacha tables when useful.

## Phase 6: Missions

Current status: mission tabs show no active missions.

Target behavior:

- Start with a small daily mission set.
- Track progress and claim rewards through the original mission UI.
- Add admin controls for enabling daily missions and choosing simple rewards.

Dependencies:

- Server time modes.
- Item catalog.
- Reward delivery behavior, preferably through mail or a shared reward helper.

## Phase 7: Distribution Cleanup

Target behavior:

- Public repository contains only required source, deployment files, docs, and templates.
- No CDN data, private keys, saves, logs, local emulator artifacts, or temporary analysis output.
- README focuses on installation and operation:
  - clone
  - create `.cdn`
  - configure `.env`
  - `docker compose up -d`
  - admin login
  - WireGuard QR creation
  - backup, update, and rollback
- Include a clear non-commercial fan-project notice.
- Keep update flow data-safe: `git pull` and `docker compose up -d --build` must not delete `.cdn`, `.database`, or `.generated`.

## Later Phase: Multiplayer Bot Fill

Priority: low. This is a convenience feature after the core multiplayer, reward, mail, stamina, and distribution work is stable.

Observed clue:

- In current multiplayer tests, when a real player disconnects during battle, the remaining client can continue with the disconnected party moving like a bot.
- This suggests that the client already has some fallback behavior for disconnected multiplayer parties.
- The original live game also appeared to fill a room with bot-controlled parties after a matchmaking timeout.

Open question:

- The bot fill may have been initiated by the real multiplayer server after a room timeout.
- Alternatively, the server may only have sent a specific timeout/disconnect/fallback message and the client performed the bot behavior locally.
- We should not implement server-side AI until this distinction is proven.

Recommended future experiment:

- Reintroduce a controlled room matchmaking timeout in a debug branch.
- Add a fake participant to an underfilled room after the timeout.
- Start battle, then either never connect that fake participant or immediately broadcast the same disconnect/bye pattern observed from a real dropped player.
- Check whether the remaining client turns that party into a local bot without server-side movement packets.

Potential implementation path:

- Admin setting: bot fill on/off.
- Admin setting: timeout duration before bot fill.
- Bot party presets selected from safe built-in party data.
- Prefer triggering the client fallback AI over writing a new realtime bot AI on the server.
