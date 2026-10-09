import { describe, test, expect } from "bun:test";
import { mkdtempSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { openDb, migrate } from "../../src/db/client.ts";
import { RoomRepository } from "../../src/db/repositories/room.repository.ts";
import { submitInTx } from "../../src/db/repositories/game.repository.ts";
import { rematchInTx } from "../../src/db/repositories/rematch.repository.ts";

function freshDb() {
  const tmpPath = join(mkdtempSync(join(tmpdir(), "duel-rm-")), `r.sqlite`);
  const db = openDb(tmpPath);
  migrate(db);
  return { db, repo: new RoomRepository(db) };
}

describe("rematch", () => {
  test("한쪽만 동의 → 아직 미완", () => {
    const { db, repo } = freshDb();
    const { room } = repo.create();
    repo.join(room.id);
    const g = repo.createGame(room.id);
    for (let n = 1; n <= 9; n++) {
      submitInTx(db, g.id, "A", n);
      submitInTx(db, g.id, "B", n);
    }
    const r = rematchInTx(db, room.id, "A");
    expect(r.completed).toBe(false);
  });
  test("양쪽 동의 → 새 게임 GAME_FINISHED 기존 + 새 SELECTING", () => {
    const { db, repo } = freshDb();
    const { room } = repo.create();
    repo.join(room.id);
    const g = repo.createGame(room.id);
    for (let n = 1; n <= 9; n++) {
      submitInTx(db, g.id, "A", n);
      submitInTx(db, g.id, "B", n === 1 ? 9 : n - 1);
    }
    rematchInTx(db, room.id, "A");
    const r = rematchInTx(db, room.id, "B");
    expect(r.completed).toBe(true);
    // 새 게임 확인
    const ag = repo.activeGame(room.id) as any;
    expect(ag.game.game_no).toBe(2);
    expect(ag.snapshot.finished).toBe(false);
  });
  test("진행 중 게임에 rematch 거절", () => {
    const { db, repo } = freshDb();
    const { room } = repo.create();
    repo.join(room.id);
    const g = repo.createGame(room.id);
    expect(() => rematchInTx(db, room.id, "A")).toThrow("GAME_IN_PROGRESS");
  });
});
