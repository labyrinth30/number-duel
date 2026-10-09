# number-duel rules

Each room has two players. A match is exactly **nine rounds**, with one tile of each number 1–9 per player. Each tile can be used once per match.

Each round, players submit one remaining tile. Higher numbers win, except **1 beats 9**. Equal numbers draw the round and add no round win to either score. After the ninth round, the player with more round wins wins the match. Equal totals finish the match as **DRAW** with `finished=true`, `winner=null`, and no winner player ID. This match tie policy is **our webgame custom policy**, not a claimed official rule.

There are no additional sets or automatic tie breakers. A fresh rematch starts only after both players consent, with new tiles and zero round scores.

Own numbers, remaining tiles, round outcomes, and round win totals are visible. Opponent exact numbers remain private before and after results. Once the opponent submits, their parity (`odd` or `even`) becomes visible immediately, even before your submission. Until then parity is null. Historical parity survives resolution, refresh, reconnect, and process restart. White tiles are labeled **홀수** and black tiles **짝수**; information never relies on color alone.

Submissions are atomic and validated against membership, game, internal set 1, round, request ID, and remaining tiles. Matching retries return success without replaying a move; conflicting or stale requests are rejected.

The database retains one internal set container for compatibility, but it never creates extra sets. Unfinished legacy snapshots with multiple sets or an already completed internal set are preserved and blocked with `LEGACY_GAME_INCOMPATIBLE`, pending owner review; they are never silently reset or converted. Compatible single-set partial matches continue with their saved tiles.

Submission order: round 1 is free; the first server-accepted submission atomically persists `initialFirstSubmitter` in the snapshot and additive SQLite `game_state.initial_first_submitter` column. From round 2, the nearest prior resolved non-DRAW winner submits first. Draws carry that winner across any number of draws; if every resolved round drew, the original first submitter goes first. The other player waits until that required first submission is accepted, then sees parity and may submit. Matching accepted request-ID retries remain successful before turn checks; stale new requests fail without changing state. Both-consent rematches reset this field and free round 1.

Legacy single-set games with decisive history derive order from the nearest decisive winner. Empty games record the first acceptance naturally. Draw-only legacy history without a saved initial submitter is preserved and blocked with `LEGACY_SUBMISSION_ORDER_UNKNOWN` / `MIGRATION_REQUIRED`, requiring owner migration review; no order or history is guessed. Parent read-only inspection found 16 active games: six empty, ten with decisive history, no draw-only or partially submitted first rounds.
