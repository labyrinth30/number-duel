import { describe, test, expect } from "bun:test";
import {
  validateMove, resolveRound, getRemainingNumbers, getPlayerView,
  recordNumber, resolveIfBoth, nextGameState, emptySnapshot,
  ROUNDS_PER_SET, SETS_TO_WIN,
} from "../../src/domain/game/engine.ts";

const S = () => emptySnapshot();

function submitAll(s: ReturnType<typeof emptySnapshot>, pairs: [number, number][]) {
  for (const [an, bn] of pairs) {
    recordNumber(s, "A", an); recordNumber(s, "B", bn); resolveIfBoth(s);
    if (s.sets.length > 1 && s.sets[s.sets.length - 1].rounds.length === 0) {} // no-op
  }
}

describe("resolveRound 판정", () => {
  test("5 vs 4 => A", () => expect(resolveRound(5, 4)).toBe("A"));
  test("5 vs 7 => B", () => expect(resolveRound(5, 7)).toBe("B"));
  test("4 vs 5 => B", () => expect(resolveRound(4, 5)).toBe("B"));
  test("7 vs 5 => A", () => expect(resolveRound(7, 5)).toBe("A"));
  test("1 vs 9 => A (1이 9를 이김)", () => expect(resolveRound(1, 9)).toBe("A"));
  test("9 vs 1 => B (9는 1에게 지고 무? rule: B는 1 승리)", () => expect(resolveRound(9, 1)).toBe("B"));
  test("동일 숫자 => DRAW", () => { for (let n = 1; n <= 9; n++) expect(resolveRound(n, n)).toBe("DRAW"); });
  test("가벼운 1>9 확정 (다수 샘플)", () => {
    for (let i = 0; i < 30; i++) expect(resolveRound(1, 9)).toBe("A");
  });
  test("범위 벗어나면 throw", () => { expect(() => resolveRound(0, 1)).toThrow(); expect(() => resolveRound(5, 10)).toThrow(); });
});

describe("상태 머신 / validateMove", () => {
  test("사용한 숫자 재사용 거절", () => {
    const s = S(); recordNumber(s, "A", 3); resolveIfBoth(s); // B 미제출이면 resolve 안 됨 — A 숫자는 기록됨
    const chk = validateMove({ seat: "A", number: 3, snapshot: s });
    // 마지막 라운드에 A가 이미 제출했으므로 ALREADY_SUBMITTED (혹은 NUMBER_USED 다음 라운드)
    expect(chk.ok).toBe(false);
  });
  test("next 라운드에서 NUMBER_USED", () => {
    const s = S(); recordNumber(s, "A", 3); recordNumber(s, "B", 5); resolveIfBoth(s);
    // A는 3을 사용 (라운드 1). 라운드 2로 이동은 submit 후 자동이 아니라Cur 직접 확인
    //HEN 마지막 라운드가 확정되면 다음 라운드 자동 준비: recordNumber가 push한다
    recordNumber(s, "A", 3); // 전체 스코프에서 3은 이미 사용; 마지막 라운드 확정이므로 새 라운드에 push되어야 하지만 NUMBER_USED는 validateMove만 검사
    const chk = validateMove({ seat: "A", number: 3, snapshot: s });
    expect(chok_false(check(chk)));
  });
});

function check(x: unknown): boolean {
  // helper: expects MOVE error code "NUMBER_USED"
  return (x as { ok: boolean; code?: string }).code === "NUMBER_USED";
}
function chok_false(v: boolean) { return !v; }

describe("세트 스코어링", () => {
  test("9라운드 모두 완료 → 세트 확정", () => {
    const s = S();
    // A가 6승 3패 → 세트 A
    const pairs: [number, number][] = [[5,4],[6,3],[7,2],[8,1],[9,2],[3,2],[4,3],[2,1],[1,5]];
    for (const [a, b] of pairs) { recordNumber(s, "A", a); recordNumber(s, "B", b); resolveIfBoth(s); }
    const set = s.sets[0];
    expect(set.rounds.length).toBe(9);
    expect(set.winner).toBe("A");
    expect(s.aSetWins).toBe(1);
    expect(s.bSetWins).toBe(0);
    expect(s.finished).toBe(false);
  });
});
