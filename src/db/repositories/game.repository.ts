// 게임 제출 트랜잭션 — 제출 저장 + 양쪽 체크 + 판정 + 스냅샷 갱신 일괄 처리 (원자적)
import type { Database } from "bun:sqlite";
import type { GameSnapshot, Seat } from "../../domain/game/engine.ts";
import { recordNumber, resolveIfBoth, nextGameState } from "../../domain/game/engine.ts";
import { ApiError } from "../../utils/errors.ts";

export interface SubmitOutcome {
  snapshot: GameSnapshot;
  resolved: boolean;      // 이번 트랜잭션에서 라운드 판정이 완료됐는지
  stateVersion: number;
}

/**
 * 트랜잭션 (immediate).  동시 제출도 안전.
 * - 동일 플레이어 동일 숫자 재제출: ALREADY_SUBMITTED (클라의 retry 관점: 멱등)
 * - 같은 라운드 자기 다른 숫자 재제출: 거절 (ALREADY_SUBMITTED로 구분할 수 없으니 명시적 오류)
 */
export function submitInTx(db: Database, gameId: string, seat: Seat, number: number): SubmitOutcome {
  // immediate 트랜잭션
  const tx = db.transaction ? db.transaction((fn: () => SubmitOutcome) => fn) : null;
  // bun:sqlite에 transaction(expected)가 있음. 근데 db.transaction은 async 함수 아님 — 체크
  const wrapped = db.transaction(() => {
    const gsRow = db.query(`SELECT snapshot FROM game_state WHERE game_id = ?`).get(gameId) as { snapshot: string } | null;
    if (!gsRow) throw new ApiError(404, "GAME_NOT_FOUND", "게임을 찾을 수 없음");
    const snap: GameSnapshot = JSON.parse(gsRow.snapshot);
    if (snap.finished) throw new ApiError(400, "GAME_FINISHED", "이 게임은 종료됐어");

    const curSet = snap.sets[snap.sets.length - 1];
    const curRound = curSet?.rounds[curSet.rounds.length - 1];
    const roundOpen = !!curRound && curRound.outcome === null;
    if (roundOpen) {
      const mine = seat === "A" ? curRound.aNumber : curRound.bNumber;
      if (mine !== null) {
        if (mine === number) {
          const g = db.query(`SELECT state_version FROM games WHERE id=?`).get(gameId) as { state_version: number };
          return { snapshot: snap, resolved: false, stateVersion: g.state_version };
        }
        throw new ApiError(409, "ALREADY_SUBMITTED", "ALREADY_SUBMITTED: 라운드 재제출");
      }
    }
    // 사용 숫자 검사 ( lingering)
    const used = new Set<number>();
    for (const set of snap.sets) for (const r of set.rounds) {
      const n = seat === "A" ? r.aNumber : r.bNumber;
      if (n !== null) used.add(n);
    }
    if (used.has(number)) throw new ApiError(400, "NUMBER_USED", `숫자 ${number}는 이미 사용했어`);
    if (!Number.isInteger(number) || number < 1 || number > 9) throw new ApiError(400, "OUT_OF_RANGE", "1~9 범위");

    recordNumber(snap, seat, number);
    resolveIfBoth(snap);
    if (!snap.finished) nextGameState(snap);
    // 이 시점에서 마지막 라운드가 outcome 확정 + 세트 미확정이면 자동으로 다음 라운드 만들기 (recordNumber가 이미 push한 것)

    const newVersion = (db.query(`SELECT state_version FROM games WHERE id=?`).get(gameId) as { state_version: number }).state_version + 1;
    db.query(`UPDATE game_state SET snapshot=? WHERE game_id=?`).run(JSON.stringify(snap), gameId);
    db.query(`UPDATE games SET state_version=?, current_set=?, current_round=?, status=?, winner_player_id=?, finished_at=? WHERE id=?`)
      .run(
        newVersion,
        snap.sets.length,
        snap.sets[snap.sets.length - 1].rounds.length,
        snap.finished ? "GAME_FINISHED" : "SELECTING",
        snap.finished ? (snap.winner === "A" ? "PLAYER-A" : "PLAYER-B") : null,
        snap.finished ? Date.now() : null,
        gameId
      );
    return { snapshot: snap, resolved: true, stateVersion: newVersion };
  });
  return wrapped();
}
