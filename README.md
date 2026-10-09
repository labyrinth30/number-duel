# number-duel

Two-player invitation game: exactly nine rounds, using each 1–9 tile once per match. Higher wins except 1 beats 9; equal tiles draw the round. Compare round win totals after round nine. Equal totals finish a DRAW match (our webgame custom policy, not a claimed official rule). A fresh rematch requires both players' consent. Opponent exact numbers remain private; opponent 홀수/짝수 parity appears immediately upon submission and remains in round history. Own tiles, remaining numbers, and round scores are displayed. Blue 홀수 and yellow 짝수 tiles include text labels.

Use `/home/ubuntu/.bun/bin/bun`. Development defaults to loopback port 3130; use an isolated DB and `PORT=0` when testing. Browser paths use `/duel/`; the server accepts both prefixed requests and nginx's stripped paths.

```sh
/home/ubuntu/.bun/bin/bun run typecheck
/home/ubuntu/.bun/bin/bun test
/home/ubuntu/.bun/bin/bun run build
```

Tests create temporary or in-memory SQLite databases. Browser E2E starts its own loopback server on an OS-selected port, runs real Chromium with two separate contexts through a nine-round win and a nine-round draw, both results and consent rematches. It stops and restarts the test server against the same on-disk database and browser sessions during a partial round, proving saved submission and parity recovery. Install Chromium with `bun x playwright install chromium` if absent. No production server or database is used by tests.

HTTP endpoints: create `/api/rooms`, join/start/state/submit/rematch under `/api/rooms/:code/`. Submit requires `gameId`, `setNo`, `roundNo`, `requestId`, and `number`. Rematch requires the finished `gameId`; both players consent. `/ws?roomCode=...` authenticates through HttpOnly cookies. WS submissions use the same identity fields. There are no session tokens in URLs or DTOs. WS sends state invalidations; clients fetch their private view. HTTP polling supplies fallback and recovery.

Production cookies use HttpOnly, Secure, SameSite=Lax, Path=/duel/. Only SHA256 token hashes are stored. Set `NODE_ENV=production` and `PUBLIC_ORIGIN=https://labyrinth30.duckdns.org`; when unset, Origin is checked against request host/protocol, including nginx's HTTPS forwarded protocol. Keep binding to loopback. Legacy cookie names remain accepted after validating the token hash against room membership; new cookies use the full room ID.

Source and consistent SQLite backups are under ignored `backups/20261009T112913Z/`. Database/WAL/SHM are removed from the git index only; their files remain in place. Existing production data has not been migrated or modified by this work; additive schema migration occurs on application startup.

Deployment is deferred to parent review. Review the diff and test evidence, take another consistent SQLite backup immediately before rollout, then restart **only number-duel** using the existing service setup and installed Bun. Do not change nginx/systemd or restart other services. The existing nginx `/duel/` prefix stripping is supported. Confirm public HTTPS cookie attributes, WS upgrade, and two-browser gameplay after deployment. Live HTTPS/proxy behavior was not exercised during isolated tests. No commit or push has been made.

Legacy compatibility: retain one internal set and submit `setNo=1`; user scores are round wins. Unfinished multi-set snapshots or unfinished matches whose internal set already ended return `LEGACY_GAME_INCOMPATIBLE` and remain preserved for owner review. No automatic reset/conversion occurs. Read-only inspection on 2026-10-09 found 11 SELECTING snapshots, all one internal set: three with zero rounds, eight with one round, none with a completed set. No incompatible snapshots were found in that inspection. Startup migration only creates missing schema objects.

Source backup before this correction: `backups/owner-nine-round-20261009/source-before.tar.gz` (excludes production data, git, dependencies, and prior backups). Production SQLite files are preserved and ignored.
