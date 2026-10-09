// number-duel 서버 시작점 — Hono + @hono/bun upgradeWebSocket
import { Hono } from "hono";
import { createApp } from "./app.ts";
import { config } from "./config/env.ts";
import { makeWsHandlers, type WsData } from "./ws/gateway.ts";
import { openDb, migrate } from "./db/client.ts";
import { submitInTx } from "./db/repositories/game.repository.ts";
import { ApiError } from "./utils/errors.ts";
import { z } from "zod";
import { upgradeWebSocket, websocket } from "@hono/bun";

const db = openDb(config.dbPath);
migrate(db);
const wsGateway = makeWsHandlers(db);

const submitSchema = z.object({
  gameId: z.string().min(8),
  number: z.number().int().min(1).max(9),
  requestId: z.string().optional(),
});

function handleWsMessage(rawWs: any, auth: WsData, text: string) {
  let msg: any;
  try { msg = JSON.parse(text); } catch { rawWs.send(JSON.stringify({ type: "game:error", code: "BAD_JSON" })); return; }
  const t = msg?.type;
  if (t === "ping") { rawWs.send(JSON.stringify({ type: "pong", ts: Date.now() })); return; }
  if (t === "game:submit") {
    const parsed = submitSchema.safeParse(msg.payload);
    if (!parsed.success) { rawWs.send(JSON.stringify({ type: "game:error", code: "BAD_PAYLOAD" })); return; }
    try {
      const out = submitInTx(db, parsed.data.gameId, auth.seat, parsed.data.number);
      wsGateway.broadcast(auth.roomId, { type: "game:state", stateVersion: out.stateVersion, resolved: out.resolved });
    } catch (e: unknown) {
      const code = e instanceof ApiError ? e.code : "INTERNAL";
      rawWs.send(JSON.stringify({ type: "game:error", code, message: e instanceof Error ? e.message : "unknown" }));
    }
    return;
  }
  rawWs.send(JSON.stringify({ type: "game:error", code: "UNKNOWN_TYPE" }));
}

const app = createApp();
const wsApp = new Hono();
wsApp.get("/ws", upgradeWebSocket((c) => {
  const roomCode = c.req.query("roomCode");
  const token = c.req.query("token");
  if (!roomCode || !token) return { onOpen() {}, onMessage(_ws: any, _ev: any) {}, onClose(_ws: any) {} } as any;
  const auth = wsGateway.authenticate({ roomCode, token });
  if (!auth) return { onOpen() {}, onMessage(_ws: any, _ev: any) {}, onClose(_ws: any) {} } as any;
  return {
    onOpen(_ev: Event, ctx: any) { if (ctx?.raw) wsGateway.add(ctx.raw, auth); else wsGateway.add(_ev, auth); },
    onMessage(ev: MessageEvent, ctx: any) { const text = typeof ev.data === "string" ? ev.data : String(ev.data); handleWsMessage(ctx.raw ?? ctx, auth, text); },
    onClose(_ev: CloseEvent, ctx: any) { if (ctx?.raw) wsGateway.remove(ctx.raw, auth); },
  };
}));
app.route("/", wsApp);

const server = Bun.serve({
  port: config.port,
  hostname: config.bindHost,
  fetch: app.fetch,
  websocket,
});

console.log(`number-duel listening on ${config.bindHost}:${config.port}`);
console.log(`ws:  /ws?roomCode=<code>&token=<token>`);
