// 终端 기능 심화: applyRematch transaction — 양쪽 동의 → 새 게임
import type { Database } from "bun:sqlite";
import { emptySnapshot, type GameSnapshot } from "../../domain/game/engine.ts";
import { ApiError } from "../../utils/errors.ts";

/** 리매치 합의 플래그를 game_state에 기록. 둘 다 동의하면 새 게임을 게임 no+1로 생성하고 스냅샷 리셋, 현재 게임 GAME_FINISHED로 */
export function rematchInTx(db: Database, roomId: string, seat: "A" | "B"): { completed: boolean } {
  const wrapped = db.transaction(() => {
    const ag = db.query(`SELECT * FROM games WHERE room_id=? AND status IN ('SELECTING','RESOLVING','SET_FINISHED') ORDER BY game_no DESC LIMIT 1`).get(roomId) as { id: string; game_no: number; status: string } | null;
    if (!ag) throw new ApiError(404, "GAME_NOT_FOUND", "게임이 없음");
    const st = db.query(`SELECT snapshot, rematch_a, rematch_b FROM game_state WHERE game_id=?`).get(ag.id) as { snapshot: string; rematch_a: number; rematch_b: number } | null;
    if (!st) throw new ApiError(500, "NO_GAME_STATE", "corrupt");
    const snap: GameSnapshot = JSON.parse(st.snapshot);
    if (!snap.finished) throw new ApiError(409, "GAME_IN_PROGRESS", "아직 진행 중");
    const a = seat === "A" ? 1 : st.rematch_a;
    const b = seat === "B" ? 1 : st.rematch_b;
    db.query(`UPDATE game_state SET rematch_a=?, rematch_b=? WHERE game_id=?`).run(a, b, ag.id);
    if (a === 1 && b === 1) {
      // 새 게임
      db.query(`UPDATE games SET status='GAME_FINISHED', finished_at=? WHERE id=?`).run(Date.now(), ag.id);
      const now = Date.now();
      const nextId = crypto.randomUUID();
      const nextNo = ag.game_no + 1;
      db.query(`INSERT INTO games (id, room_id, game_no, status, created_at) VALUES (?,?,?,?,?)`)
        .run(nextId, roomId, nextNo, "SELECTING", now);
      db.query(`REPLACE INTO game_state (game_id, snapshot, rematch_a, rematch_b) VALUES (?,?,0,0)`)
        .run(nextId, JSON.stringify(emptySnapshot()));
      // rooms.status는 PLAYING에서 그대로 두고 게임 내 진행으로 판단
      return { completed: true };
    }
    return { completed: false };
  });
  return wrapped();
}
