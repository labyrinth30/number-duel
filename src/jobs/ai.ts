import type { Database } from 'bun:sqlite';
import { RoomRepository } from '../db/repositories/room.repository.ts';
import { submitInTx } from '../db/repositories/game.repository.ts';
import { rematchInTx } from '../db/repositories/rematch.repository.ts';
import { getPlayerView } from '../domain/game/engine.ts';
import { chooseMove, thinkDelay } from '../domain/ai/strategy.ts';

// Each tick rechecks the current game and legal turn inside an immediate transaction.
// Persisted deadlines survive process interruption, and concurrent workers serialize.
export function tickAI(db: Database, broadcast: (roomId:string)=>void, now = Date.now()) {
  const rooms = new RoomRepository(db);
  const rows = db.query(`SELECT a.*,g.room_id FROM ai_games a JOIN games g ON g.id=a.game_id
    WHERE g.id=(SELECT id FROM games WHERE room_id=g.room_id ORDER BY game_no DESC LIMIT 1)`)
    .all() as {game_id:string;seed:string;pending_round:number|null;due_at:number|null;room_id:string}[];
  for (const row of rows) {
    let changed = false;
    db.transaction(() => {
      const active = rooms.activeGame(row.room_id);
      if (!active || active.game.id !== row.game_id) return;
      if (active.snapshot.finished) {
        const flags = db.query('SELECT rematch_a,rematch_b FROM game_state WHERE game_id=?').get(row.game_id) as {rematch_a:number;rematch_b:number};
        if (flags.rematch_a && !flags.rematch_b) { rematchInTx(db,row.room_id,'B'); changed = true; }
        return;
      }
      const view = getPlayerView('B', active.snapshot, active.stateVersion);
      if (!view.canSubmit) {
        db.query('UPDATE ai_games SET pending_round=NULL,due_at=NULL WHERE game_id=?').run(row.game_id);
        return;
      }
      const pending = db.query('SELECT pending_round,due_at FROM ai_games WHERE game_id=?').get(row.game_id) as {pending_round:number|null;due_at:number|null};
      if (pending.pending_round !== view.roundNo || pending.due_at === null) {
        db.query('UPDATE ai_games SET pending_round=?,due_at=? WHERE game_id=?').run(view.roundNo,now + thinkDelay(row.seed,view.roundNo),row.game_id);
        return;
      }
      if (now < pending.due_at) return;
      submitInTx(db,row.game_id,'B',chooseMove(view,row.seed));
      db.query('UPDATE ai_games SET pending_round=NULL,due_at=NULL WHERE game_id=?').run(row.game_id);
      changed = true;
    }).immediate();
    if (changed) broadcast(row.room_id);
  }
}
