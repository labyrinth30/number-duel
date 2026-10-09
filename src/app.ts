import { Hono } from "hono";
import { serveStatic } from "hono/bun";
import type { Database } from "bun:sqlite";
import { openDb, migrate } from "./db/client.ts";
import { config } from "./config/env.ts";
import { RoomRepository } from "./db/repositories/room.repository.ts";
import { submitInTx } from "./db/repositories/game.repository.ts";
import { rematchInTx } from "./db/repositories/rematch.repository.ts";
import { ApiError, err, hashToken } from "./utils/errors.ts";
import { getPlayerView } from "./domain/game/engine.ts";
import {
  layout,
  homeView,
  lobbyView,
  gameView,
  errorView,
} from "./views/index.ts";
export function authenticate(db: Database, roomId: string, cookie: string) {
  const repo = new RoomRepository(db);
  for (const part of cookie.split(";")) {
    const [key, ...value] = part.trim().split("=");
    if (
      !["A", "B"].some(
        (seat) =>
          key === `nd_${seat}_${roomId}` ||
          key === `nd_${seat}_${roomId.slice(0, 6)}`,
      )
    )
      continue;
    const p = repo
      .players(roomId)
      .find((p) => p.session_token_hash === hashToken(value.join("=")));
    if (p) return p;
  }
  return null;
}
export function createApp(
  db = openDb(config.dbPath),
  broadcast: (roomId: string) => void = () => {},
) {
  migrate(db);
  const rooms = new RoomRepository(db);
  const app = new Hono();
  const rates = new Map<string, { at: number; n: number }>();
  app.use("*", async (c, next) => {
    c.header("Cache-Control", "no-store");
    c.header("X-Content-Type-Options", "nosniff");
    c.header("Referrer-Policy", "same-origin");
    if (c.req.method === "POST") {
      const origin = c.req.header("origin");
      const u = new URL(c.req.url);
      const expected = `${c.req.header("x-forwarded-proto") === "https" ? "https:" : u.protocol}//${u.host}`;
      if (origin && origin !== expected && origin !== process.env.PUBLIC_ORIGIN)
        throw err("FORBIDDEN");
      if (Number(c.req.header("content-length") ?? 0) > 4096)
        return c.json({ code: "PAYLOAD_TOO_LARGE" }, 413);
      const raw = await c.req.raw.clone().text();
      if (new TextEncoder().encode(raw).length > 4096)
        return c.json({ code: "PAYLOAD_TOO_LARGE" }, 413);
      const key = hashToken(c.req.header("cookie") ?? "anonymous");
      const now = Date.now();
      const r = rates.get(key);
      const entry = r && now - r.at < 60000 ? r : { at: now, n: 0 };
      entry.n++;
      rates.set(key, entry);
      if (rates.size > 10000)
        for (const [k, v] of rates) if (now - v.at > 60000) rates.delete(k);
      if (entry.n > 180) return c.json({ code: "RATE_LIMITED" }, 429);
    }
    await next();
  });
  app.onError((e, c) =>
    c.json(
      { code: e instanceof ApiError ? e.code : "INTERNAL" },
      (e instanceof ApiError ? e.status : 500) as 400,
    ),
  );
  const roomFor = (code: string) => {
    const r = rooms.byInvite(code);
    if (!r) throw err("ROOM_NOT_FOUND");
    return r;
  };
  const member = (roomId: string, cookie: string) => {
    const p = authenticate(db, roomId, cookie);
    if (!p) throw err("UNAUTHORIZED");
    rooms.touch(roomId);
    return p;
  };
  const nick = (v: unknown) => {
    if (typeof v !== "string" || !v.trim() || v.trim().length > 16)
      throw err("BAD_NICKNAME");
    return v.trim();
  };
  function cookie(c: any, roomId: string, seat: string, token: string) {
    const secure =
      process.env.NODE_ENV === "production" ||
      c.req.header("x-forwarded-proto") === "https" ||
      new URL(c.req.url).protocol === "https:";
    c.header(
      "Set-Cookie",
      `nd_${seat}_${roomId}=${token}; Path=/duel/; Max-Age=86400; HttpOnly; SameSite=Lax${secure ? "; Secure" : ""}`,
    );
  }
  app.post("/api/rooms", async (c) => {
    const n = nick((await c.req.parseBody()).nickname);
    const out = db
      .transaction(() => {
        const o = rooms.create();
        rooms.setNickname(o.host.id, n);
        return o;
      })
      .immediate();
    cookie(c, out.room.id, "A", out.sessionToken);
    return c.json({ code: out.room.invite_code }, 201);
  });
  app.post("/api/rooms/:code/join", async (c) => {
    const room = roomFor(c.req.param("code"));
    const n = nick((await c.req.parseBody()).nickname);
    const out = db
      .transaction(() => {
        const o = rooms.join(room.id);
        rooms.setNickname(o.player.id, n);
        return o;
      })
      .immediate();
    cookie(c, room.id, "B", out.sessionToken);
    broadcast(room.id);
    return c.json({ seat: "B" }, 201);
  });
  app.get("/api/rooms/:code/state", (c) => {
    const r = roomFor(c.req.param("code"));
    const p = member(r.id, c.req.header("cookie") ?? "");
    const g = rooms.activeGame(r.id);
    const flags = g
      ? (db
          .query("SELECT rematch_a,rematch_b FROM game_state WHERE game_id=?")
          .get(g.game.id) as { rematch_a: number; rematch_b: number })
      : null;
    return c.json({
      roomStatus: r.status,
      seat: p.seat,
      players: rooms
        .players(r.id)
        .map((p) => ({ seat: p.seat, nickname: p.nickname })),
      gameId: g?.game.id ?? null,
      winnerPlayerId: g?.game.winner_player_id ?? null,
      rematch: flags
        ? {
            mine: !!(p.seat === "A" ? flags.rematch_a : flags.rematch_b),
            opponent: !!(p.seat === "A" ? flags.rematch_b : flags.rematch_a),
          }
        : null,
      view: g ? getPlayerView(p.seat, g.snapshot, g.stateVersion) : null,
    });
  });
  app.post("/api/rooms/:code/start", (c) => {
    const r = roomFor(c.req.param("code"));
    const p = member(r.id, c.req.header("cookie") ?? "");
    if (p.seat !== "A") throw err("NOT_HOST");
    if (r.status !== "READY") throw err("ROOM_NOT_READY");
    const g = rooms.createGame(r.id);
    broadcast(r.id);
    return c.json({ gameId: g.id }, 201);
  });
  app.post("/api/rooms/:code/submit", async (c) => {
    const r = roomFor(c.req.param("code"));
    const p = member(r.id, c.req.header("cookie") ?? "");
    const b = await c.req.parseBody();
    if (
      typeof b.gameId !== "string" ||
      typeof b.requestId !== "string" ||
      !b.requestId ||
      b.requestId.length > 80 ||
      !Number.isInteger(Number(b.setNo)) ||
      !Number.isInteger(Number(b.roundNo))
    )
      throw new ApiError(400, "BAD_PAYLOAD", "BAD_PAYLOAD");
    const o = submitInTx(db, b.gameId, p.seat, Number(b.number), {
      roomId: r.id,
      playerId: p.id,
      setNo: Number(b.setNo),
      roundNo: Number(b.roundNo),
      requestId: b.requestId,
    });
    broadcast(r.id);
    return c.json({ ok: true, stateVersion: o.stateVersion });
  });
  app.post("/api/rooms/:code/rematch", async (c) => {
    const r = roomFor(c.req.param("code"));
    const p = member(r.id, c.req.header("cookie") ?? "");
    const b = await c.req.parseBody();
    const g = rooms.activeGame(r.id);
    if (!g || b.gameId !== g.game.id)
      throw new ApiError(409, "STALE_GAME", "STALE_GAME");
    const o = rematchInTx(db, r.id, p.seat);
    broadcast(r.id);
    return c.json(o);
  });
  app.get("/health", (c) => c.json({ ok: true }));
  app.use(
    "/static/*",
    serveStatic({
      root: "./public",
      rewriteRequestPath: (p) => p.replace("/static", ""),
    }),
  );
  app.get("/", (c) => c.html(layout("number-duel", homeView())));
  app.get("/rooms/:code", (c) => {
    const r = roomFor(c.req.param("code"));
    const ps = rooms.players(r.id);
    const p = authenticate(db, r.id, c.req.header("cookie") ?? "");
    if (p) return c.html(layout("game", gameView(r.invite_code, [])));
    return c.html(
      layout(
        "lobby",
        lobbyView(
          r.invite_code,
          [],
          ps.length < 2,
          ps[0]?.nickname ?? "",
          ps[1]?.nickname ?? null,
          false,
        ),
      ),
    );
  });
  return app;
}
