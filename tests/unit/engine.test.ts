import { test, expect } from "bun:test";
import {
  validateMove,
  resolveRound,
  recordNumber,
  resolveIfBoth,
  emptySnapshot,
} from "../../src/domain/game/engine.ts";

for (const [a, b, outcome] of [
  [5, 4, "A"],
  [5, 7, "B"],
  [1, 9, "A"],
  [9, 1, "B"],
] as const) {
  test(`${a} vs ${b} => ${outcome}`, () =>
    expect(resolveRound(a, b)).toBe(outcome));
}
test("equal numbers draw; out of range resolution fails", () => {
  for (let n = 1; n <= 9; n++) expect(resolveRound(n, n)).toBe("DRAW");
  expect(() => resolveRound(0, 1)).toThrow();
  expect(() => resolveRound(5, 10)).toThrow();
});
test("submitted tile cannot change and used tiles cannot be reused next round", () => {
  const snapshot = emptySnapshot();
  recordNumber(snapshot, "A", 3);
  expect(validateMove({ seat: "A", number: 4, snapshot })).toMatchObject({
    ok: false,
    code: "ALREADY_SUBMITTED",
  });
  recordNumber(snapshot, "B", 5);
  resolveIfBoth(snapshot);
  expect(validateMove({ seat: "A", number: 3, snapshot })).toMatchObject({
    ok: false,
    code: "NUMBER_USED",
  });
  recordNumber(snapshot, "B", 6);
  expect(validateMove({ seat: "A", number: 4, snapshot })).toMatchObject({
    ok: true,
    setNo: 1,
    roundNo: 2,
  });
});
