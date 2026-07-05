# Starpoint Multi Development Plan

This document tracks the planned development order for turning Starpoint Multi into a usable private server package.

## Guiding Principles

- Keep gameplay changes server-side whenever possible. Do not patch the game client unless there is no practical server-side route.
- Prefer evidence from logs, client behavior, assets, and save data before implementing protocol or API behavior.
- Keep operator-facing features simple enough to run on a small public cloud VM.
- Protect private server state: `.cdn`, `.database`, `.generated`, logs, keys, and local device artifacts must not be committed.

## Phase 1: Server Time Modes

Current status: server time was previously stored as one fixed timestamp. This is useful for selecting an old gacha period, but it does not support stamina recovery, daily missions, or other time-based systems.

Target behavior:

- `Real time`: use the host clock.
- `Fixed time`: freeze the game server at a selected timestamp.
- `Ticking offset`: start from a selected old timestamp and continue advancing with real elapsed time.
- `Date override`: use an old calendar date while keeping the current real clock time.

Admin UI:

- Show the current effective game server time.
- Show the active time mode.
- Allow selecting a gacha table and applying it as fixed, ticking, or date-only time.
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

