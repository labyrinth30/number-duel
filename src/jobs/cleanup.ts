// lifecycle cleanup — 24h 이상 inactive 방 삭제 (호출 방식: cron/systemd timer에서)
import type { Database } from "bun:sqlite";

export function cleanupStaleRooms(db: Database, olderThanMs = 24 * 60 * 60 * 1000): number {
  const cutoff = Date.now() - olderThanMs;
  const rooms = db.query(`SELECT id FROM rooms WHERE updated_at < ?`).all(cutoff) as { id: string }[];
  for (const r of rooms) {
    db.query(`DELETE FROM rooms WHERE id=?`).run(r.id); // FK cascade: players, games, rounds, game_state
  }
  return rooms.length;
}
