# number-duel

Two-player invitation game: exactly nine rounds, using each 1–9 tile once per match. Higher wins except 1 beats 9; equal tiles draw the round. Compare round win totals after round nine. Equal totals finish a DRAW match (our webgame custom policy, not a claimed official rule). A fresh rematch requires both players' consent. Opponent exact numbers remain private; opponent 홀수/짝수 parity appears immediately upon submission and remains in round history. Own tiles, remaining numbers, and round scores are displayed. White 홀수 and black 짝수 tiles include text labels.

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

Legacy compatibility: retain one internal set and submit `setNo=1`; user scores are round wins. Unfinished multi-set snapshots or unfinished matches whose internal set already ended return `LEGACY_GAME_INCOMPATIBLE` and remain preserved for owner review. No automatic reset/conversion occurs. Parent read-only inspection for this correction found 16 active games: six empty and ten with decisive resolved history, with no draw-only history or partially submitted first round. Startup migration creates missing schema objects and adds the nullable first-submitter column without rewriting existing snapshots.

Source backup before this correction: `backups/owner-nine-round-20261009/source-before.tar.gz` (excludes production data, git, dependencies, and prior backups). Production SQLite files are preserved and ignored.

Submission order: round 1 is free; the first server-accepted submission atomically persists `initialFirstSubmitter` in the snapshot and additive SQLite `game_state.initial_first_submitter` column. From round 2, the nearest prior resolved non-DRAW winner submits first. Draws carry that winner across any number of draws; if every resolved round drew, the original first submitter goes first. The other player waits until that required first submission is accepted, then sees parity and may submit. Matching accepted request-ID retries remain successful before turn checks; stale new requests fail without changing state. Both-consent rematches reset this field and free round 1.

Legacy single-set games with decisive history derive order from the nearest decisive winner. Empty games record the first acceptance naturally. Draw-only legacy history without a saved initial submitter is preserved and blocked with `LEGACY_SUBMISSION_ORDER_UNKNOWN` / `MIGRATION_REQUIRED`, requiring owner migration review; no order or history is guessed. Parent read-only inspection found 16 active games: six empty, ten with decisive history, no draw-only or partially submitted first rounds.
