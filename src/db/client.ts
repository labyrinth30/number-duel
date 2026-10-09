import { Database } from "bun:sqlite";
import { mkdirSync } from "fs";
import { dirname } from "path";

export function openDb(dbPath: string): Database {
  mkdirSync(dirname(dbPath), { recursive: true });
  const db = new Database(dbPath);
  db.exec("PRAGMA journal_mode=WAL;");
  db.exec("PRAGMA foreign_keys=ON;");
  db.exec("PRAGMA busy_timeout=5000;");
  return db;
}

export function migrate(db: Database): void {
  db.exec(`
  CREATE TABLE IF NOT EXISTS rooms (
    id TEXT PRIMARY KEY,
    invite_code TEXT UNIQUE NOT NULL,
    status TEXT NOT NULL, -- WAITING|READY|PLAYING|FINISHED
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    expires_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS players (
    id TEXT PRIMARY KEY,
    room_id TEXT NOT NULL,
    nickname TEXT NOT NULL,
    seat TEXT NOT NULL CHECK(seat IN ('A','B')),
    session_token_hash TEXT UNIQUE NOT NULL,
    created_at INTEGER NOT NULL,
    UNIQUE(room_id, seat),
    FOREIGN KEY(room_id) REFERENCES rooms(id) ON DELETE CASCADE
  );
  CREATE TABLE IF NOT EXISTS games (
    id TEXT PRIMARY KEY,
    room_id TEXT NOT NULL,
    game_no INTEGER NOT NULL,
    status TEXT NOT NULL, -- SELECTING|RESOLVING|SET_FINISHED|GAME_FINISHED
    current_set INTEGER NOT NULL DEFAULT 1,
    current_round INTEGER NOT NULL DEFAULT 1,
    state_version INTEGER NOT NULL DEFAULT 0,
    winner_player_id TEXT,
    created_at INTEGER NOT NULL,
    finished_at INTEGER,
    UNIQUE(room_id, game_no),
    FOREIGN KEY(room_id) REFERENCES rooms(id) ON DELETE CASCADE
  );
  CREATE TABLE IF NOT EXISTS rounds (
    id TEXT PRIMARY KEY,
    game_id TEXT NOT NULL,
    set_no INTEGER NOT NULL,
    round_no INTEGER NOT NULL,
    player_a_number INTEGER CHECK(player_a_number BETWEEN 1 AND 9),
    player_b_number INTEGER CHECK(player_b_number BETWEEN 1 AND 9),
    winner_seat TEXT CHECK(winner_seat IN ('A','B','DRAW')),
    resolved_at INTEGER,
    UNIQUE(game_id, set_no, round_no),
    FOREIGN KEY(game_id) REFERENCES games(id) ON DELETE CASCADE
  );
  CREATE TABLE IF NOT EXISTS game_state (
    game_id TEXT PRIMARY KEY,
    snapshot TEXT NOT NULL,   -- GameSnapshot JSON
    rematch_a INTEGER NOT NULL DEFAULT 0,
    rematch_b INTEGER NOT NULL DEFAULT 0,
    FOREIGN KEY(game_id) REFERENCES games(id) ON DELETE CASCADE
  );
  CREATE TABLE IF NOT EXISTS submissions (
    game_id TEXT NOT NULL REFERENCES games(id) ON DELETE CASCADE,
    seat TEXT NOT NULL, request_id TEXT NOT NULL, set_no INTEGER NOT NULL,
    round_no INTEGER NOT NULL, number INTEGER NOT NULL,
    PRIMARY KEY(game_id, seat, request_id)
  );
  -- 활성 게임은 방당 최대 하나
  CREATE UNIQUE INDEX IF NOT EXISTS idx_active_game_per_room
    ON games(room_id) WHERE status IN ('SELECTING','RESOLVING','SET_FINISHED');
  CREATE INDEX IF NOT EXISTS idx_rooms_expires ON rooms(expires_at);
  CREATE INDEX IF NOT EXISTS idx_rounds_game ON rounds(game_id);
  CREATE INDEX IF NOT EXISTS idx_players_room ON players(room_id);
  `);
  const columns = db.query("PRAGMA table_info(game_state)").all() as { name: string }[];
  if (!columns.some((column) => column.name === "initial_first_submitter"))
    db.exec("ALTER TABLE game_state ADD COLUMN initial_first_submitter TEXT CHECK(initial_first_submitter IN ('A','B'))");
}
