// Repository: rooms, players, games, rounds, game_state
import type { Database } from "bun:sqlite";
import {
  newRoomId,
  newInviteCode,
  newSessionToken,
  hashToken,
  newPlayerId,
  ApiError,
} from "../../utils/errors.ts";
import {
  isIncompatibleLegacy,
  emptySnapshot,
  type GameSnapshot,
} from "../../domain/game/engine.ts";

export interface RoomRow {
  id: string;
  invite_code: string;
  status: string;
  created_at: number;
  updated_at: number;
  expires_at: number;
}
export interface PlayerRow {
  id: string;
  room_id: string;
  nickname: string;
  seat: "A" | "B";
  session_token_hash: string;
  created_at: number;
}
export interface GameRow {
  id: string;
  room_id: string;
  game_no: number;
  status: string;
  current_set: number;
  current_round: number;
  state_version: number;
  winner_player_id: string | null;
  created_at: number;
  finished_at: number | null;
}
export interface RoundRow {
  id: string;
  game_id: string;
  set_no: number;
  round_no: number;
  player_a_number: number | null;
  player_b_number: number | null;
  winner_seat: "A" | "B" | "DRAW" | null;
  resolved_at: number | null;
}

const EXPIRE_MS = 24 * 60 * 60 * 1000; // 24h

export class RoomRepository {
  constructor(private db: Database) {}

  create(): { room: RoomRow; host: PlayerRow; sessionToken: string } {
    const now = Date.now();
    const roomId = newRoomId();
    let inviteCode = "";
    for (let i = 0; i < 8; i++) {
      inviteCode = newInviteCode(6);
      const dup = this.db
        .query("SELECT id FROM rooms WHERE invite_code=?")
        .get(inviteCode);
      if (!dup) break;
    }
    if (!inviteCode)
      throw new ApiError(500, "CODE_EXHAUSTED", "초대 코드 중복 재시도 실패");
    this.db
      .query(
        `INSERT INTO rooms (id, invite_code, status, created_at, updated_at, expires_at) VALUES (?,?,?,?,?,?)`,
      )
      .run(roomId, inviteCode, "WAITING", now, now, now + EXPIRE_MS);
    const token = newSessionToken();
    this.db
      .query(
        `INSERT INTO players (id, room_id, nickname, seat, session_token_hash, created_at) VALUES (?,?,?,?,?,?)`,
      )
      .run(newPlayerId(), roomId, "Host", "A", hashToken(token), now);
    return {
      room: this.byId(roomId)!,
      host: this.byRoomAndSeat(roomId, "A")!,
      sessionToken: token,
    };
  }

  isAI(roomId: string): boolean {
    return !!this.db.query("SELECT 1 FROM ai_rooms WHERE room_id=?").get(roomId);
  }
  addAI(roomId: string): void {
    this.db.query("INSERT INTO ai_rooms VALUES (?, 'HARD')").run(roomId);
    this.db.query("INSERT INTO players VALUES (?,?,?,?,?,?)").run(newPlayerId(), roomId, "패턴 봇", "B", "bot:" + crypto.randomUUID(), Date.now());
    this.updateStatus(roomId, "READY");
  }
  byInvite(code: string): RoomRow | null {
    return this.db
      .query(`SELECT * FROM rooms WHERE invite_code = ?`)
      .get(code) as RoomRow | null;
  }
  byId(id: string): RoomRow | null {
    return this.db
      .query(`SELECT * FROM rooms WHERE id = ?`)
      .get(id) as RoomRow | null;
  }
  updateStatus(id: string, status: string): void {
    this.db
      .query(`UPDATE rooms SET status=?, updated_at=? WHERE id=?`)
      .run(status, Date.now(), id);
  }
  touch(id: string): void {
    this.db
      .query(`UPDATE rooms SET updated_at=? WHERE id=?`)
      .run(Date.now(), id);
  }

  players(roomId: string): PlayerRow[] {
    return this.db
      .query(`SELECT * FROM players WHERE room_id = ? ORDER BY seat`)
      .all(roomId) as PlayerRow[];
  }
  byRoomAndSeat(roomId: string, seat: "A" | "B"): PlayerRow | null {
    return this.db
      .query(`SELECT * FROM players WHERE room_id=? AND seat=?`)
      .get(roomId, seat) as PlayerRow | null;
  }
  byTokenHash(tokenHash: string): { player: PlayerRow; room: RoomRow } | null {
    const p = this.db
      .query(`SELECT * FROM players WHERE session_token_hash=?`)
      .get(tokenHash) as PlayerRow | null;
    if (!p) return null;
    const room = this.byId(p.room_id);
    if (!room) return null;
    return { player: p, room };
  }
  join(roomId: string): { player: PlayerRow; sessionToken: string } {
    const existing = this.players(roomId);
    if (existing.length >= 2)
      throw new ApiError(409, "ROOM_FULL", "ROOM_FULL: 방이 가득 참");
    const token = newSessionToken();
    this.db
      .query(
        `INSERT INTO players (id, room_id, nickname, seat, session_token_hash, created_at) VALUES (?,?,?,?,?,?)`,
      )
      .run(newPlayerId(), roomId, "Guest", "B", hashToken(token), Date.now());
    this.db
      .query(`UPDATE rooms SET status='READY', updated_at=? WHERE id=?`)
      .run(Date.now(), roomId);
    return { player: this.byRoomAndSeat(roomId, "B")!, sessionToken: token };
  }
  setNickname(playerId: string, nickname: string): void {
    this.db
      .query(`UPDATE players SET nickname=? WHERE id=?`)
      .run(nickname, playerId);
  }

  activeGame(
    roomId: string,
  ): { game: GameRow; snapshot: GameSnapshot; stateVersion: number } | null {
    const g = this.db
      .query(
        `SELECT * FROM games WHERE room_id=? ORDER BY game_no DESC LIMIT 1`,
      )
      .get(roomId) as GameRow | null;
    if (!g) return null;
    const gs = this.db
      .query(
        `SELECT snapshot, initial_first_submitter, rematch_a, rematch_b FROM game_state WHERE game_id=?`,
      )
      .get(g.id) as {
      snapshot: string;
      initial_first_submitter: "A" | "B" | null;
      rematch_a: number;
      rematch_b: number;
    } | null;
    const snap = gs ? JSON.parse(gs.snapshot) : null;
    if (snap) snap.initialFirstSubmitter ??= gs?.initial_first_submitter ?? null;
    if (snap && isIncompatibleLegacy(snap))
      throw new ApiError(
        409,
        "LEGACY_GAME_INCOMPATIBLE",
        "LEGACY_GAME_INCOMPATIBLE",
      );
    return { game: g, snapshot: snap, stateVersion: g.state_version } as any;
  }
  createGame(roomId: string): GameRow {
    return this.db
      .transaction(() => {
        // 방당 최대 하나 활성 (부분 인덱스 보장)
        const existing = this.db
          .query(
            `SELECT id FROM games WHERE room_id=? AND status IN ('SELECTING','RESOLVING','SET_FINISHED') LIMIT 1`,
          )
          .get(roomId);
        if (existing)
          throw new ApiError(
            409,
            "GAME_ALREADY_ACTIVE",
            "활성 게임이 이미 있음",
          );
        const now = Date.now();
        const maxNo =
          (
            this.db
              .query(`SELECT MAX(game_no) m FROM games WHERE room_id=?`)
              .get(roomId) as { m: number | null }
          ).m ?? 0;
        const id = crypto.randomUUID();
        this.db
          .query(
            `INSERT INTO games (id, room_id, game_no, status, created_at) VALUES (?,?,?,?,?)`,
          )
          .run(id, roomId, maxNo + 1, "SELECTING", now);
        this.db
          .query(
            `REPLACE INTO game_state (game_id, snapshot, rematch_a, rematch_b) VALUES (?,?,0,0)`,
          )
          .run(id, JSON.stringify({...emptySnapshot(), ...(this.isAI(roomId) ? {humanFirst:true} : {})}));
        if (this.isAI(roomId)) this.db.query("INSERT INTO ai_games (game_id,seed) VALUES (?,?)").run(id, crypto.randomUUID());
        this.db
          .query(`UPDATE rooms SET status='PLAYING' , updated_at=? WHERE id=?`)
          .run(now, roomId);
        return this.db
          .query(`SELECT * FROM games WHERE id=?`)
          .get(id) as GameRow;
      })
      .immediate();
  }
}
