# number-duel rules

Each room has two players. A match is exactly **nine rounds**, with one tile of each number 1–9 per player. Each tile can be used once per match.

Each round, players submit one remaining tile. Higher numbers win, except **1 beats 9**. Equal numbers draw the round and add no round win to either score. After the ninth round, the player with more round wins wins the match. Equal totals finish the match as **DRAW** with `finished=true`, `winner=null`, and no winner player ID. This match tie policy is **our webgame custom policy**, not a claimed official rule.

There are no additional sets or automatic tie breakers. A fresh rematch starts only after both players consent, with new tiles and zero round scores.

Own numbers, remaining tiles, round outcomes, and round win totals are visible. Opponent exact numbers remain private before and after results. Once the opponent submits, their parity (`odd` or `even`) becomes visible immediately, even before your submission. Until then parity is null. Historical parity survives resolution, refresh, reconnect, and process restart. White tiles are labeled **홀수** and black tiles **짝수**; information never relies on color alone.

Submissions are atomic and validated against membership, game, internal set 1, round, request ID, and remaining tiles. Matching retries return success without replaying a move; conflicting or stale requests are rejected.

The database retains one internal set container for compatibility, but it never creates extra sets. Unfinished legacy snapshots with multiple sets or an already completed internal set are preserved and blocked with `LEGACY_GAME_INCOMPATIBLE`, pending owner review; they are never silently reset or converted. Compatible single-set partial matches continue with their saved tiles.

Submission order: round 1 is free; the first server-accepted submission atomically persists `initialFirstSubmitter` in the snapshot and additive SQLite `game_state.initial_first_submitter` column. From round 2, the nearest prior resolved non-DRAW winner submits first. Draws carry that winner across any number of draws; if every resolved round drew, the original first submitter goes first. The other player waits until that required first submission is accepted, then sees parity and may submit. Matching accepted request-ID retries remain successful before turn checks; stale new requests fail without changing state. Both-consent rematches reset this field and free round 1.

Legacy single-set games with decisive history derive order from the nearest decisive winner. Empty games record the first acceptance naturally. Draw-only legacy history without a saved initial submitter is preserved and blocked with `LEGACY_SUBMISSION_ORDER_UNKNOWN` / `MIGRATION_REQUIRED`, requiring owner migration review; no order or history is guessed. Parent read-only inspection found 16 active games: six empty, ten with decisive history, no draw-only or partially submitted first rounds.

## AI 대결 · 딱 하나 난이도 (고급)

고급만 제공합니다. 사람은 A, 패턴 봇은 서버의 B이며 봇 쿠키는 없습니다. 첫 라운드는 사람이 먼저 제출하고, 이후 승자 선제출 및 무승부 순서 유지 규칙은 두 사람 대결과 같습니다. 봇은 합법적으로 공개된 홀짝의 빈도와 직전 홀짝에 따른 조건부 패턴을 예측하고 약간의 탐색을 섞습니다. 정확한 상대 숫자는 전략에 전달하지 않습니다. 결정과 800~1500ms 지연은 저장된 비공개 시드로 재현됩니다. 서버는 지연 후 현재 턴을 다시 검사해 원자적으로 제출합니다. 9라운드를 모두 진행하며 같은 승수는 무승부입니다. 재대결은 사람의 요청과 서버 봇의 동의가 모두 기록된 뒤 시작합니다.
