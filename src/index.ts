import { tickAI } from "./jobs/ai.ts";
import { createApp, authenticate } from "./app.ts";
import { config } from "./config/env.ts";
import { openDb, migrate } from "./db/client.ts";
import { RoomRepository } from "./db/repositories/room.repository.ts";
import { submitInTx } from "./db/repositories/game.repository.ts";
import { ApiError } from "./utils/errors.ts";
import { cleanupStaleRooms } from "./jobs/cleanup.ts";
import type { ServerWebSocket } from "bun";
interface Data {
  roomId: string;
  playerId: string;
  seat: "A" | "B";
  count: number;
  at: number;
}
const db = openDb(config.dbPath);
migrate(db);
const rooms = new RoomRepository(db);
const sockets = new Set<ServerWebSocket<Data>>();
function broadcast(roomId: string) {
  for (const ws of sockets)
    if (ws.data.roomId === roomId)
      ws.send(JSON.stringify({ type: "game:state" }));
}
const app = createApp(db, broadcast);
const server = Bun.serve<Data>({
  hostname: config.bindHost,
  port: config.port,
  maxRequestBodySize: 4096,
  async fetch(req, server) {
    const url = new URL(req.url);
    if (url.pathname.startsWith("/duel/")) url.pathname = url.pathname.slice(5);
    if (url.pathname === "/ws") {
      const origin = req.headers.get("origin");
      if (
        !origin ||
        origin !==
          (process.env.PUBLIC_ORIGIN ||
            `${req.headers.get("x-forwarded-proto") === "https" ? "https:" : url.protocol}//${url.host}`)
      )
        return Response.json({ code: "WS_BAD_ORIGIN" }, { status: 403 });
      if (url.searchParams.has("token"))
        return Response.json({ code: "BAD_PAYLOAD" }, { status: 400 });
      const room = rooms.byInvite(url.searchParams.get("roomCode") ?? "");
      const p = room
        ? authenticate(db, room.id, req.headers.get("cookie") ?? "")
        : null;
      if (!p || !room)
        return Response.json({ code: "UNAUTHORIZED" }, { status: 401 });
      if (
        server.upgrade(req, {
          data: {
            roomId: room.id,
            playerId: p.id,
            seat: p.seat,
            count: 0,
            at: Date.now(),
          },
        })
      )
        return;
      return Response.json({ code: "BAD_UPGRADE" }, { status: 400 });
    }
    return app.fetch(new Request(url, req));
  },
  websocket: {
    maxPayloadLength: 4096,
    open(ws) {
      sockets.add(ws);
      ws.send(JSON.stringify({ type: "game:state" }));
    },
    close(ws) {
      sockets.delete(ws);
    },
    message(ws, raw) {
      const now = Date.now();
      if (now - ws.data.at > 60000) {
        ws.data.at = now;
        ws.data.count = 0;
      }
      if (++ws.data.count > 180) {
        ws.close(1008, "RATE_LIMITED");
        return;
      }
      try {
        const msg = JSON.parse(String(raw));
        if (msg.type === "ping") {
          ws.send(JSON.stringify({ type: "pong" }));
          return;
        }
        if (msg.type === "game:sync") {
          ws.send(JSON.stringify({ type: "game:state" }));
          return;
        }
        if (msg.type !== "game:submit")
          throw new ApiError(400, "BAD_PAYLOAD", "BAD_PAYLOAD");
        const b = msg.payload;
        if (
          !b ||
          typeof b.gameId !== "string" ||
          typeof b.requestId !== "string" ||
          !b.requestId ||
          b.requestId.length > 80 ||
          !Number.isInteger(b.setNo) ||
          !Number.isInteger(b.roundNo) ||
          !Number.isInteger(b.number)
        )
          throw new ApiError(400, "BAD_PAYLOAD", "BAD_PAYLOAD");
        submitInTx(db, b.gameId, ws.data.seat, b.number, {
          ...ws.data,
          setNo: b.setNo,
          roundNo: b.roundNo,
          requestId: b.requestId,
        });
        broadcast(ws.data.roomId);
      } catch (e) {
        ws.send(
          JSON.stringify({
            type: "game:error",
            code: e instanceof ApiError ? e.code : "BAD_PAYLOAD",
          }),
        );
      }
    },
  },
});
setInterval(() => {
  try { tickAI(db, broadcast); } catch (e) { console.error("AI task failed", e instanceof ApiError ? e.code : "INTERNAL"); }
}, 50).unref();
setInterval(() => {
  try {
    cleanupStaleRooms(db);
  } catch {}
}, 3600000).unref();
console.log(`number-duel listening on ${config.bindHost}:${server.port}`);
