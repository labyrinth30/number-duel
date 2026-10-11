import type { Database } from "bun:sqlite";
import {
  recordNumber,
  resolveIfBoth,
  validateMove,
  currentRoundNo,
  currentSetNo,
  type GameSnapshot,
  type Seat,
} from "../../domain/game/engine.ts";
import { ApiError } from "../../utils/errors.ts";
export interface SubmitOutcome {
  snapshot: GameSnapshot;
  resolved: boolean;
  stateVersion: number;
}
export interface MoveIdentity {
  setNo: number;
  roundNo: number;
  requestId: string;
  roomId: string;
  playerId: string;
}
export function submitInTx(
  db: Database,
  gameId: string,
  seat: Seat,
  number: number,
  identity?: MoveIdentity,
): SubmitOutcome {
  return db
    .transaction(() => {
      const g = db.query("SELECT * FROM games WHERE id=?").get(gameId) as {
        room_id: string;
        state_version: number;
        status: string;
      } | null;
      if (!g) throw new ApiError(404, "GAME_NOT_FOUND", "GAME_NOT_FOUND");
      if (identity) {
        const p = db
          .query("SELECT id FROM players WHERE id=? AND room_id=? AND seat=?")
          .get(identity.playerId, identity.roomId, seat);
        if (!p || g.room_id !== identity.roomId)
          throw new ApiError(403, "FORBIDDEN", "FORBIDDEN");
      }
      const row = db
        .query("SELECT snapshot, initial_first_submitter FROM game_state WHERE game_id=?")
        .get(gameId) as { snapshot: string; initial_first_submitter: Seat | null };
      const snap: GameSnapshot = JSON.parse(row.snapshot);
      snap.initialFirstSubmitter ??= row.initial_first_submitter;
      if (identity) {
        const prior = db
          .query(
            "SELECT * FROM submissions WHERE game_id=? AND seat=? AND request_id=?",
          )
          .get(gameId, seat, identity.requestId) as {
          number: number;
          set_no: number;
          round_no: number;
        } | null;
        if (prior) {
          if (
            prior.number !== number ||
            prior.set_no !== identity.setNo ||
            prior.round_no !== identity.roundNo
          )
            throw new ApiError(409, "REQUEST_CONFLICT", "REQUEST_CONFLICT");
          return {
            snapshot: snap,
            resolved: false,
            stateVersion: g.state_version,
          };
        }
        if (
          identity.setNo !== currentSetNo(snap) ||
          identity.roundNo !== currentRoundNo(snap)
        )
          throw new ApiError(409, "STALE_ROUND", "STALE_ROUND");
      }
      const last = snap.sets.at(-1)?.rounds.at(-1);
      if (
        last?.outcome === null &&
        (seat === "A" ? last.aNumber : last.bNumber) === number
      )
        return {
          snapshot: snap,
          resolved: false,
          stateVersion: g.state_version,
        };
      const check = validateMove({ seat, number, snapshot: snap });
      if (!check.ok) throw new ApiError(409, check.code, check.code);
      recordNumber(snap, seat, number);
      resolveIfBoth(snap);
      const resolved = snap.sets.at(-1)!.rounds.at(-1)!.outcome !== null;
      if (identity)
        db.query("INSERT INTO submissions VALUES (?,?,?,?,?,?)").run(
          gameId,
          seat,
          identity.requestId,
          identity.setNo,
          identity.roundNo,
          number,
        );
      const version = g.state_version + 1;
      const winner = snap.winner
        ? (
            db
              .query("SELECT id FROM players WHERE room_id=? AND seat=?")
              .get(g.room_id, snap.winner) as { id: string }
          ).id
        : null;
      db.query("UPDATE game_state SET snapshot=?,initial_first_submitter=? WHERE game_id=?").run(
        JSON.stringify(snap),
        snap.initialFirstSubmitter ?? null,
        gameId,
      );
      db.query(
        "UPDATE games SET state_version=?,current_set=?,current_round=?,status=?,winner_player_id=?,finished_at=? WHERE id=?",
      ).run(
        version,
        currentSetNo(snap),
        currentRoundNo(snap),
        snap.finished ? "GAME_FINISHED" : "SELECTING",
        winner,
        snap.finished ? Date.now() : null,
        gameId,
      );
      db.query("UPDATE rooms SET status=?,updated_at=? WHERE id=?").run(
        snap.finished ? "FINISHED" : "PLAYING",
        Date.now(),
        g.room_id,
      );
      return { snapshot: snap, resolved, stateVersion: version };
    })
    .immediate();
}
