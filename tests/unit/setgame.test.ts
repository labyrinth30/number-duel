import { describe, test, expect } from "bun:test";
import { recordNumber, resolveIfBoth, nextGameState, emptySnapshot, getPlayerView, getRemainingNumbers, type GameSnapshot } from "../../src/domain/game/engine.ts";

const A_WIN: [number, number][] = [[9,8],[8,7],[7,6],[6,5],[5,4],[4,3],[3,2]]; // A 승리
const B_WIN: [number, number][] = [[7,8],[6,7],[5,6],[4,5],[3,4],[2,3]]; // B 승리
const DRAW: [number, number][] = [[1,1],[3,3]]; // 무승부

/** a승 b패 d무 9라운드 시뮬레이션 (a+b+d == 9 요구) */
function doSet(s: GameSnapshot, aTarget: number, bTarget: number, dTarget: number): void {
  const seq: number[] = [];
  for (let i = 0; i < aTarget; i++) seq.push(0);
  for (let i = 0; i < bTarget; i++) seq.push(1);
  for (let i = 0; i < dTarget; i++) seq.push(2);
  let ia = 0, ib = 0, idr = 0;
  for (const kind of seq) {
    const pair = kind === 0 ? A_WIN[ia++] : kind === 1 ? B_WIN[ib++] : DRAW[idr++];
    recordNumber(s, "A", pair[0]); recordNumber(s, "B", pair[1]);
    resolveIfBoth(s); nextGameState(s);
  }
}

describe("세트/게임 종료", () => {
  test("A 세트승 1 + B 세트승 1 → 게임 진행 중 / A 재승 시 게임 종료", () => {
    const s = emptySnapshot();
    doSet(s, 5, 3, 1); // 5-3-1 = 9라운드, A 승
    expect(s.aSetWins).toBe(1); expect(s.bSetWins).toBe(0); expect(s.finished).toBe(false);
    doSet(s, 3, 5, 1); // 3-5-1 = 9라운드, B 승
    expect(s.aSetWins).toBe(1); expect(s.bSetWins).toBe(1); expect(s.finished).toBe(false);
    doSet(s, 5, 3, 1); // A 승 → 2세트 선승
    expect(s.finished).toBe(true); expect(s.winner).toBe("A");
  });

  test("세트 무승부 → 세트승 미반영", () => {
    const s = emptySnapshot();
    doSet(s, 4, 4, 1);
    expect(s.sets[0].winner).toBe("DRAW");
    expect(s.aSetWins).toBe(0); expect(s.bSetWins).toBe(0);
    expect(s.finished).toBe(false);
  });

  test("getPlayerView: 상대 숫자 미노출 (뷰 레벨)", () => {
    const s = emptySnapshot();
    recordNumber(s, "A", 7); recordNumber(s, "B", 3); resolveIfBoth(s);
    const a = getPlayerView("A", s, 1);
    const b = getPlayerView("B", s, 1);
    expect(a.sets[0].rounds[0].myNumber).toBe(7);
    expect(b.sets[0].rounds[0].myNumber).toBe(3);
    expect(a.sets[0].rounds[0].outcome).toBe("A");
    expect(b.sets[0].rounds[0].outcome).toBe("A");
    expect(a.sets[0].rounds[0].opponentSubmitted).toBe(true);
    expect(getRemainingNumbers("A", s)).not.toContain(7);
    expect(getRemainingNumbers("B", s)).not.toContain(3);
  });

  test("myUsed는 확정·미확정 라운드 자기 숫자 전부", () => {
    const s = emptySnapshot();
    recordNumber(s, "A", 5); // 상대 미제출 — 미확정
    const v = getPlayerView("A", s, 1);
    expect(v.myUsed).toContain(5);
    expect(v.current?.myNumber).toBe(5);
    expect(v.current?.opponentSubmitted).toBe(false);
  });

  test("세트 확정 시 다음 세트 이미 생성, 게임 종료 시 미생성", () => {
    const s = emptySnapshot();
    doSet(s, 5, 3, 1);
    expect(s.sets.length).toBe(2);
    expect(s.sets[1].setNo).toBe(2);
    const e = emptySnapshot();
    e.aSetWins = 2; e.finished = true; e.winner = "A";
    expect(nextGameState(e).sets.length).toBe(1);
  });
});
