// ws gateway — Bun.serve websocket upgrade + roomCode/session 인증 + broadcast
import type { Database } from "bun:sqlite";
import { hashToken } from "../utils/errors.ts";

export interface WsData { roomId: string; playerId: string; seat: "A" | "B" }

export function makeWsHandlers(db: Database) {
  const conns = new Map<string, Set<any>>();
  return {
    /** handshake 직후 인증. 실패 시 null */
    authenticate(data: { roomCode: string; token: string }): WsData | null {
      const hash = hashToken(data.token);
      const room = db.query(`SELECT id FROM rooms WHERE invite_code=?`).get(data.roomCode) as { id: string } | undefined;
      if (!room) return null;
      const p = db.query(`SELECT id, room_id, seat FROM players WHERE session_token_hash=?`).get(hash) as { id: string; room_id: string; seat: "A" | "B" } | undefined;
      if (!p || p.room_id !== room.id) return null;
      return { roomId: room.id, playerId: p.id, seat: p.seat };
    },
    add(ws: any, d: WsData) {
      let set = conns.get(d.roomId);
      if (!set) { set = new Set(); conns.set(d.roomId, set); }
      set.add(ws);
    },
    remove(ws: any, d: WsData) {
      conns.get(d.roomId)?.delete(ws);
      if (conns.get(d.roomId)?.size === 0) conns.delete(d.roomId);
    },
    broadcast(roomId: string, msg: unknown) {
      for (const ws of (conns.get(roomId) ?? [])) {
        try { ws.send(JSON.stringify(msg)); } catch { /* dead conn */ }
      }
    },
    count(): number { let n = 0; for (const s of conns.values()) n += s.size; return n; },
  };
}
