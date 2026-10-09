// lifecycle cleanup — 24h 이상 inactive 방 삭제 (호출 방식: cron/systemd timer에서)
import type { Database } from "bun:sqlite";

export function cleanupStaleRooms(db: Database, olderThanMs = 24 * 60 * 60 * 1000): number {
  const cutoff = Date.now() - olderThanMs;
  const rooms = db.query(`SELECT id FROM rooms WHERE updated_at < ? AND status != 'PLAYING' AND NOT EXISTS (SELECT 1 FROM games WHERE games.room_id=rooms.id AND games.status != 'GAME_FINISHED')`).all(cutoff) as { id: string }[];
  for (const r of rooms) {
    db.query(`DELETE FROM rooms WHERE id=?`).run(r.id); // FK cascade: players, games, rounds, game_state
  }
  return rooms.length;
}
