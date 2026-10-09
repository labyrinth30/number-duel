import { test, expect } from "bun:test";
import {
  emptySnapshot,
  recordNumber,
  resolveIfBoth,
  getPlayerView,
  validateMove,
} from "../../src/domain/game/engine.ts";

for (const draw of [false, true]) {
  test(`nine rounds finish one match: ${draw ? "equal score draw" : "A wins"}`, () => {
    const snapshot = emptySnapshot();
    for (let n = 1; n <= 9; n++) {
      expect(validateMove({ seat: "A", number: n, snapshot }).ok).toBe(true);
      recordNumber(snapshot, "A", n);
      recordNumber(snapshot, "B", draw ? n : n === 1 ? 9 : n - 1);
      resolveIfBoth(snapshot);
      expect(snapshot.finished).toBe(n === 9);
    }
    expect(snapshot.sets).toHaveLength(1);
    expect(snapshot.winner).toBe(draw ? null : "A");
    const view = getPlayerView("A", snapshot, 18);
    expect(view.myRoundWins).toBe(draw ? 0 : 9);
    expect(view.opponentRoundWins).toBe(0);
    expect(view.myRemaining).toEqual([]);
    expect(validateMove({ seat: "A", number: 1, snapshot }).ok).toBe(false);
  });
}

test("opponent parity appears before own submission and survives JSON reload and resolution without exact numbers", () => {
  const snapshot = emptySnapshot();
  recordNumber(snapshot, "B", 8);
  let view = getPlayerView("A", snapshot, 1);
  expect(view.current?.myNumber).toBeNull();
  expect(view.current?.opponentSubmitted).toBe(true);
  expect(view.current?.opponentParity).toBe("even");
  recordNumber(snapshot, "A", 3);
  resolveIfBoth(snapshot);
  view = getPlayerView("A", JSON.parse(JSON.stringify(snapshot)), 2);
  expect(view.sets[0].rounds[0]).toEqual({
    roundNo: 1,
    myNumber: 3,
    opponentSubmitted: true,
    opponentParity: "even",
    outcome: "B",
  });
  for (const key of [
    "aNumber",
    "bNumber",
    "opponentNumber",
    "mySetWins",
    "opponentSetWins",
  ])
    expect(JSON.stringify(view)).not.toContain(key);
});

test("equal nonzero scores also finish a DRAW, and B can win", () => {
  for (const draw of [true, false]) {
    const snapshot = emptySnapshot();
    const opponent = draw
      ? [2, 1, 4, 3, 6, 5, 8, 7, 9]
      : [1, 2, 3, 4, 5, 6, 7, 8, 9];
    const own = draw
      ? [1, 2, 3, 4, 5, 6, 7, 8, 9]
      : [9, 1, 2, 3, 4, 5, 6, 7, 8];
    for (let i = 0; i < 9; i++) {
      recordNumber(snapshot, "A", own[i]);
      recordNumber(snapshot, "B", opponent[i]);
      resolveIfBoth(snapshot);
    }
    expect(snapshot.finished).toBe(true);
    expect(snapshot.winner).toBe(draw ? null : "B");
    const view = getPlayerView("A", snapshot, 18);
    expect(view.myRoundWins).toBe(draw ? 4 : 0);
    expect(view.opponentRoundWins).toBe(draw ? 4 : 9);
  }
});
