// app.ts — Hono 앱 (return fetch-compatible)
import { Hono } from "hono";
import { serveStatic } from "hono/bun";
import { openDb, migrate } from "./db/client.ts";
import { config } from "./config/env.ts";
import { RoomRepository } from "./db/repositories/room.repository.ts";
import { submitInTx } from "./db/repositories/game.repository.ts";
import { rematchInTx } from "./db/repositories/rematch.repository.ts";
import { ApiError, err, newInviteCode, hashToken, newSessionToken, newPlayerId, newGameId, newRoundId } from "./utils/errors.ts";
import { emptySnapshot, getPlayerView, getRemainingNumbers, type Seat, type GameSnapshot } from "./domain/game/engine.ts";
import { homeView, lobbyView, gameView, resultView, errorView, layout } from "./views/index.tsx";
import { registerWsGateway } from "./ws/gateway.ts";
import { z } from "zod";

export function createApp() {
  const db = openDb(config.dbPath);
  migrate(db);
  const rooms = new RoomRepository(db);

  const app = new Hono();

  // 닉네임 검증
  function validNickname(raw: unknown): string {
    if (typeof raw !== "string") throw err("BAD_NICKNAME");
    const trimmed = raw.trim();
    if (trimmed.length < 1 || trimmed.length > 16) throw err("BAD_NICKNAME");
    // 태그 제거/이스케이프는 렌더러가 담당. 여기서 특수 문자열 필터
    return trimmed;
  }

  // 세션: 좌석별 쿠키. 한 브라우저에서 A/B 둘 다 플레이 가능 (nd_A_<id6>, nd_B_<id6>)
  function cookieKey(roomId: string, seat: Seat) { return `nd_${seat}_${roomId.slice(0, 6)}`; }
  function sessionFor(c: any, roomId: string, seat?: Seat): { token: string; tokenHash: string } | null {
    const header = c.req.header("Cookie") ?? "";
    const keys = seat ? [cookieKey(roomId, seat)] : (["A", "B"] as Seat[]).map(s => cookieKey(roomId, s));
    for (const part of header.split(";")) {
      const [k, ...rest] = part.trim().split("=");
      if (keys.includes(k)) return { token: rest.join("="), tokenHash: hashToken(rest.join("=")) };
    }
    return null;
  }
  function setSessionCookie(c: any, roomId: string, seat: Seat, token: string) {
    const key = cookieKey(roomId, seat);
    c.header("Set-Cookie", `${key}=${token}; Path=/duel; Max-Age=86400; SameSite=Lax; HttpOnly; Secure`);
  }

  const statePayload = (c: any, roomId: string) => {
    const r = rooms.byId(roomId);
    if (!r) throw err("ROOM_NOT_FOUND");
    const ag = rooms.activeGame(roomId);
    if (ag && ag.snapshot) {
      const seat: Seat = (rooms.byRoomAndSeat(roomId, "A")!.id === ag.winner_player_id ? "A" : "B");
      // 실제로는 플레이어의 seat 필요: 아래에서 전달
      return { room: r, activeGame: ag };
    }
    return { room: r, activeGame: null };
  };

  // ---- REST ----
  app.post("/api/rooms", async (c) => {
    const body = await c.req.parseBody().catch(() => { throw err("BAD_NICKNAME"); });
    const nickname = validNickname(body.nickname);
    const { room, host, sessionToken } = rooms.create();
    rooms.setNickname(host.id, nickname);
    setSessionCookie(c, room.id, "A", sessionToken);
    return c.json({ code: room.invite_code, roomId: room.id, playerId: host.id }, 201, {
      "Cache-Control": "no-store",
    });
  });

  app.post("/api/rooms/:code/join", async (c) => {
    const code = c.req.param("code");
    const room = rooms.byInvite(code);
    if (!room) throw err("ROOM_NOT_FOUND");
    const body = await c.req.parseBody().catch(() => { throw err("BAD_NICKNAME"); });
    const nickname = validNickname(body.nickname);
    const { player, sessionToken } = rooms.join(room.id);
    rooms.setNickname(player.id, nickname);
    setSessionCookie(c, room.id, "B", sessionToken);
    return c.json({ roomId: room.id, playerId: player.id, seat: player.seat }, 201, { "Cache-Control": "no-store" });
  });

  app.get("/api/rooms/:code/state", async (c) => {
    const code = c.req.param("code");
    const room = rooms.byInvite(code);
    if (!room) throw err("ROOM_NOT_FOUND");
    const sess = sessionFor(c, room.id);
    if (!sess) throw err("UNAUTHORIZED");
    const p = rooms.players(room.id).find(x => x.session_token_hash === sess.tokenHash);
    if (!p) throw err("FORBIDDEN");
    const ag = rooms.activeGame(room.id);
    const seat: Seat = p.seat;
    const view = ag && ag.snapshot ? getPlayerView(seat, ag.snapshot as GameSnapshot, ag.stateVersion) : null;
    return c.json({ roomId: room.id, seat, roomStatus: room.status, view }, 200, { "Cache-Control": "no-store" });
  });

  app.post("/api/rooms/:code/start", async (c) => {
    const code = c.req.param("code");
    const room = rooms.byInvite(code);
    if (!room) throw err("ROOM_NOT_FOUND");
    const sess = sessionFor(c, room.id);
    if (!sess) throw err("UNAUTHORIZED");
    const p = rooms.players(room.id).find(x => x.session_token_hash === sess.tokenHash);
    if (!p) throw err("FORBIDDEN");
    if (p.seat !== "A") throw err("NOT_HOST");
    if (rooms.players(room.id).length < 2) throw err("ROOM_NOT_READY");
    const g = rooms.createGame(room.id);
    return c.json({ gameId: g.id }, 201, { "Cache-Control": "no-store" });
  });

  // rest submit endpoint (HTTP fallback; 게임은 WS 권장)
  app.post("/api/game/:gameId/submit", async (c) => {
    const gameId = c.req.param("gameId");
    const body = await c.req.parseBody().catch(() => { throw err("OUT_OF_RANGE"); });
    const number = Number(body.number);
    const g = db.query(`SELECT room_id FROM games WHERE id=?`).get(gameId) as { room_id: string } | null;
    if (!g) throw err("GAME_FINISHED");
    const sess = sessionFor(c, g.room_id, "A");
    const sessB = sessionFor(c, g.room_id, "B");
    const cur = sess ?? sessB;
    if (!cur) throw err("UNAUTHORIZED");
    const p = rooms.players(g.room_id).find(x => x.session_token_hash === cur.tokenHash);
    if (!p) throw err("FORBIDDEN");
    const out = submitInTx(db, gameId, p.seat, number);
    return c.json({ ok: true, resolved: out.resolved, stateVersion: out.stateVersion }, 200, { "Cache-Control": "no-store" });
  });

  // rematch (HTTP)
  app.post("/api/game/rematch", async (c) => {
    const body = await c.req.parseBody().catch(() => { throw err("BAD_NICKNAME"); });
    const code = String(body.code || "");
    const room = rooms.byInvite(code);
    if (!room) throw err("ROOM_NOT_FOUND");
    const sessA = sessionFor(c, room.id, "A");
    const sessB = sessionFor(c, room.id, "B");
    const cur = sessA ?? sessB;
    if (!cur) throw err("UNAUTHORIZED");
    const p = rooms.players(room.id).find(x => x.session_token_hash === cur.tokenHash);
    if (!p) throw err("FORBIDDEN");
    const r = rematchInTx(db, room.id, p.seat);
    return c.json({ ok: true, ...r }, 200, { "Cache-Control": "no-store" });
  });

  app.get("/health", (c) => c.json({ ok: true, ts: Date.now() }));

  app.use("/static/*", serveStatic({ root: "./public" }));

  // ---- pages ----
  app.get("/", (c) => c.html(layout("number-duel", homeView())));
  app.get("/rooms/:code", async (c) => {
    const code = c.req.param("code");
    const room = rooms.byInvite(code);
    if (!room) return c.html(layout("not found", errorView("방을 찾을 수 없음")), 404);
    // 게임 중이면 게임 뷰, 아니면 로비
    const ag = rooms.activeGame(room.id);
    const players = rooms.players(room.id);
    if (ag && ag.snapshot && room.status === "PLAYING") {
      return c.html(layout("game", gameView({ code, nicknames: players.map(p => p.nickname) })));
    }
    if (room.status === "FINISHED") return c.html(layout("result", resultView({})));
    return c.html(layout("lobby", lobbyView({ code, nicknames: players.map(p => p.nickname) })));
  });

  return app;
}
