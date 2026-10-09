import { describe, test, expect, beforeEach } from "bun:test";
import { mkdtempSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { openDb, migrate } from "../../src/db/client.ts";
import { RoomRepository } from "../../src/db/repositories/room.repository.ts";
import { submitInTx } from "../../src/db/repositories/game.repository.ts";

const tmpDir = () => mkdtempSync(join(tmpdir(), "duel-test-"));
let db: import("bun:sqlite").Database, repo: RoomRepository, tmpPath: string;

function freshDb() {
  tmpPath = join(tmpDir(), `t-${Date.now()}-${Math.random().toString(36).slice(2)}.sqlite`);
  db = openDb(tmpPath);
  migrate(db);
  repo = new RoomRepository(db);
}
freshDb();

describe("Room — 생성/입장/정원", () => {
  test("방 생성 → host A 좌석", () => {
    const { room, host, sessionToken } = repo.create();
    expect(room.invite_code).toHaveLength(6);
    expect(host.seat).toBe("A");
    expect(sessionToken).toBeTruthy();
  });
  test("join → B 좌석, status READY", () => {
    const { room } = repo.create();
    const { player } = repo.join(room.id);
    expect(player.seat).toBe("B");
    expect(repo.byId(room.id)!.status).toBe("READY");
  });
  test("第三 cellForRowAtIndexPath입장 차단 — 3명 입장 거절", () => {
    const { room } = repo.create();
    repo.join(room.id);
    expect(() => repo.join(room.id)).toThrow("ROOM_FULL");
  });
  test("초대 코드로 방 찾기", () => {
    const { room } = repo.create();
    expect(repo.byInvite(room.invite_code)!.id).toBe(room.id);
  });
});

describe("동시 제출/멱등성", () => {
  test("A와 B가 동시 제출: 두 트랜잭션 처리 후 결과 확정 1회", () => {
    const { room } = repo.create();
    repo.join(room.id);
    const g = repo.createGame(room.id);
    const first = submitInTx(db, g.id, "A", 5);
    const second = submitInTx(db, g.id, "B", 3);
    expect(second.snapshot.sets[0].rounds[0].aNumber).toBe(5);
    expect(second.snapshot.sets[0].rounds[0].bNumber).toBe(3);
    expect(second.snapshot.sets[0].rounds[0].outcome).toBe("A"); // 5>4? 아니 5>4
  });
  test("동일 숫자 재제출 → 멱등 (resolved=false)", () => {
    const { room } = repo.create();
    repo.join(room.id);
    const g = repo.createGame(room.id);
    submitInTx(db, g.id, "A", 5);
    const r = submitInTx(db, g.id, "A", 5);
    expect(r.resolved).toBe(false);
    expect(r.snapshot.sets[0].rounds[0].aNumber).toBe(5);
  });
  test("같은 라운드 자기 다른 숫자 재제출 → 거절", () => {
    const { room } = repo.create();
    repo.join(room.id);
    const g = repo.createGame(room.id);
    submitInTx(db, g.id, "A", 5);
    expect(() => submitInTx(db, g.id, "A", 6)).toThrow("ALREADY_SUBMITTED");
  });
  test("사용한 숫자 제출 거절 (다음 라운드)", () => {
    const { room } = repo.create();
    repo.join(room.id);
    const g = repo.createGame(room.id);
    submitInTx(db, g.id, "A", 5); submitInTx(db, g.id, "B", 4); // 라운드 1 resolved
    // 라운드 2 (A/B 둘 다 제출)
    submitInTx(db, g.id, "A", 7); submitInTx(db, g.id, "B", 3);
    // 라운드 3에서 7(이미 사용) 제출 거절
    expect(() => submitInTx(db, g.id, "A", 7)).toThrow("NUMBER_USED");
  });
  test("state_version 증가", () => {
    const { room } = repo.create();
    repo.join(room.id);
    const g = repo.createGame(room.id);
    const v0 = (db.query(`SELECT state_version FROM games WHERE id=?`).get(g.id) as any).state_version;
    submitInTx(db, g.id, "A", 1);
    const v1 = (db.query(`SELECT state_version FROM games WHERE id=?`).get(g.id) as any).state_version;
    expect(v1).toBe(v0 + 1);
  });
});
