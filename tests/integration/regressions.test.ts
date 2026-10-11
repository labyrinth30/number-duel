import { test, expect } from "bun:test";
import { openDb, migrate } from "../../src/db/client.ts";
import { RoomRepository } from "../../src/db/repositories/room.repository.ts";
import { submitInTx } from "../../src/db/repositories/game.repository.ts";
import { cleanupStaleRooms } from "../../src/jobs/cleanup.ts";
import { getPlayerView } from "../../src/domain/game/engine.ts";
import { createApp } from "../../src/app.ts";
function fixture() {
  const db = openDb(":memory:");
  migrate(db);
  const repo = new RoomRepository(db);
  const { room, host } = repo.create();
  repo.join(room.id);
  const g = repo.createGame(room.id);
  return { db, repo, room, host, g };
}
test("nine tied rounds finish a draw with no winner player and no extra set", () => {
  const { db, g } = fixture();
  for (let n = 1; n <= 9; n++) {
    submitInTx(db, g.id, "A", n);
    submitInTx(db, g.id, "B", n);
  }
  const snap = JSON.parse(
    (
      db.query("SELECT snapshot FROM game_state WHERE game_id=?").get(g.id) as {
        snapshot: string;
      }
    ).snapshot,
  );
  const v = getPlayerView("A", snap, 18);
  expect(v.finished).toBe(true);
  expect(v.winner).toBeNull();
  expect(v.myRoundWins).toBe(0);
  expect(v.opponentRoundWins).toBe(0);
  expect(v.sets).toHaveLength(1);
  expect(v.myRemaining).toEqual([]);
  const game = db
    .query("SELECT status,winner_player_id FROM games WHERE id=?")
    .get(g.id) as { status: string; winner_player_id: string | null };
  expect(game.status).toBe("GAME_FINISHED");
  expect(game.winner_player_id).toBeNull();
  db.close();
});
test("stale cleanup preserves active matches and removes abandoned waiting rooms", () => {
  const { db, repo, room } = fixture();
  const waiting = repo.create().room;
  db.query("UPDATE rooms SET updated_at=0").run();
  expect(cleanupStaleRooms(db)).toBe(1);
  expect(repo.byId(room.id)).toBeTruthy();
  expect(repo.byId(waiting.id)).toBeNull();
  db.close();
});
test("request identity rejects delayed different retry and conflicting request IDs", () => {
  const { db, g, room, host } = fixture();
  const identity = {
    roomId: room.id,
    playerId: host.id,
    setNo: 1,
    roundNo: 1,
    requestId: "one",
  };
  submitInTx(db, g.id, "A", 1, identity);
  submitInTx(db, g.id, "B", 2);
  expect(submitInTx(db, g.id, "A", 1, identity).stateVersion).toBe(2);
  expect(() =>
    submitInTx(db, g.id, "A", 3, { ...identity, requestId: "delayed" }),
  ).toThrow("STALE_ROUND");
  expect(() => submitInTx(db, g.id, "A", 3, identity)).toThrow(
    "REQUEST_CONFLICT",
  );
  db.close();
});
test("production cookies are secure, hashed in DB; bounded bodies; errors do not leak internals", async () => {
  const db = openDb(":memory:");
  const previous = process.env.NODE_ENV;
  process.env.NODE_ENV = "production";
  try {
    const app = createApp(db);
    const r = await app.request("https://example.test/api/rooms", {
      method: "POST",
      body: new URLSearchParams({ nickname: "host" }),
    });
    const ck = r.headers.get("set-cookie")!;
    for (const attr of ["HttpOnly", "Secure", "SameSite=Lax", "Path=/duel/"])
      expect(ck).toContain(attr);
    const token = ck.split(";")[0].split("=")[1];
    const hash = (
      db.query("SELECT session_token_hash FROM players").get() as {
        session_token_hash: string;
      }
    ).session_token_hash;
    expect(hash).toHaveLength(64);
    expect(hash).not.toBe(token);
    expect(await r.text()).not.toContain(token);
    const large = await app.request("https://example.test/api/rooms", {
      method: "POST",
      body: "x".repeat(5000),
    });
    expect(large.status).toBe(413);
    const unauth = await app.request(
      "https://example.test/api/rooms/INVALID/state",
    );
    expect(await unauth.json()).toEqual({ code: "ROOM_NOT_FOUND" });
  } finally {
    process.env.NODE_ENV = previous;
    db.close();
  }
});

test("HTTP Origin, authorization, cache policy and rate limits", async () => {
  const { db, room, host, g } = fixture();
  const app = createApp(db);
  const url = `http://local.test/api/rooms/${room.invite_code}`;
  expect((await app.request(url + "/state")).status).toBe(401);
  const badOrigin = await app.request("http://local.test/api/rooms", {
    method: "POST",
    headers: { origin: "https://evil.invalid" },
    body: new URLSearchParams({ nickname: "x" }),
  });
  expect(badOrigin.status).toBe(403);
  const noStore = await app.request(url + "/state");
  expect(noStore.headers.get("cache-control")).toBe("no-store");
  for (let n = 0; n < 180; n++) {
    const response = await app.request("http://local.test/api/rooms", {
      method: "POST",
      body: new URLSearchParams({ nickname: "" }),
    });
    expect(response.status).toBe(400);
  }
  const limited = await app.request("http://local.test/api/rooms", {
    method: "POST",
    body: new URLSearchParams({ nickname: "" }),
  });
  expect(limited.status).toBe(429);
  expect(await limited.json()).toEqual({ code: "RATE_LIMITED" });
  const foreignRoom = new RoomRepository(db).create().room;
  expect(() =>
    submitInTx(db, g.id, "A", 1, {
      roomId: foreignRoom.id,
      playerId: host.id,
      setNo: 1,
      roundNo: 1,
      requestId: "foreign",
    }),
  ).toThrow("FORBIDDEN");
  db.close();
});
