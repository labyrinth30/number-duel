// ============================================
// number-duel 게임 엔진 — 순수 함수 집합
// HTTP / WebSocket / DB 에 의존하지 않음.
// 규칙 상세는 RULES.md.
// ============================================

export type Seat = "A" | "B";
export type RoundOutcome = Seat | "DRAW";

export interface RoundState {
  roundNo: number;
  aNumber: number | null;
  bNumber: number | null;
  outcome: RoundOutcome | null; // 확정 시만
}
export interface SetState {
  setNo: number;
  rounds: RoundState[];
  winner: Seat | "DRAW" | null;
  aScore: number; // 세트 내 라운드 승수
  bScore: number;
}
export interface GameSnapshot {
  sets: SetState[];
  finished: boolean;
  winner: Seat | null;
}

// ---------------- 기본 정책 ----------------
export const ROUNDS_PER_GAME = 9;

export const NUM_MIN = 1;
export const NUM_MAX = 9;

// ---------------- validateMove ----------------
export interface MoveInput {
  seat: Seat;
  number: number;
  snapshot: GameSnapshot;
}
export interface MoveCheck {
  ok: true;
  setNo: number;
  roundNo: number;
}
export interface MoveError {
  ok: false;
  code: string;
  message: string;
}

/**
 * 제출 가능 여부 검사. 오류 코드:
 * - GAME_FINISHED / ALREADY_SUBMITTED / NUMBER_USED / OUT_OF_RANGE
 */
export function validateMove(input: MoveInput): MoveCheck | MoveError {
  const { seat, number, snapshot } = input;
  if (snapshot.finished)
    return {
      ok: false,
      code: "GAME_FINISHED",
      message: "이 게임은 이미 종료됐어.",
    };
  const curSet = currentSet(snapshot);
  if (!curSet)
    return {
      ok: false,
      code: "GAME_FINISHED",
      message: "이 게임은 이미 종료됐어.",
    };
  const last = curSet.rounds.at(-1);
  const open = last?.outcome === null ? last : null;
  const roundNo = open ? open.roundNo : curSet.rounds.length + 1;
  if (open && (seat === "A" ? open.aNumber : open.bNumber) !== null)
    return {
      ok: false,
      code: "ALREADY_SUBMITTED",
      message: "ALREADY_SUBMITTED",
    };
  if (!getRemainingNumbers(seat, snapshot).includes(number))
    return { ok: false, code: "NUMBER_USED", message: "NUMBER_USED" };
  if (!Number.isInteger(number) || number < NUM_MIN || number > NUM_MAX) {
    return {
      ok: false,
      code: "OUT_OF_RANGE",
      message: "숫자는 1부터 9까지야.",
    };
  }
  return { ok: true, setNo: curSet.setNo, roundNo };
}

// ---------------- resolveRound ----------------
/**
 * 두 숫자로 라운드 승패 계산.
 * 규칙: 큰 숫자 승리 / 1 > 9 예외 / 동일 DRAW
 * (純 판정, 상태 변형 없음)
 */
export function resolveRound(aNumber: number, bNumber: number): RoundOutcome {
  if (!Number.isInteger(aNumber) || aNumber < NUM_MIN || aNumber > NUM_MAX)
    throw new Error(`INVALID_A:${aNumber}`);
  if (!Number.isInteger(bNumber) || bNumber < NUM_MIN || bNumber > NUM_MAX)
    throw new Error(`INVALID_B:${bNumber}`);
  if (aNumber === bNumber) return "DRAW";
  if (aNumber === NUM_MIN && bNumber === NUM_MAX) return "A"; // 1 > 9
  if (bNumber === NUM_MIN && aNumber === NUM_MAX) return "B"; // 9 < 1
  return aNumber > bNumber ? "A" : "B";
}

// ---------------- getRemainingNumbers ----------------
export function getRemainingNumbers(
  seat: Seat,
  snapshot: GameSnapshot,
): number[] {
  const used = new Set<number>();
  for (const set of snapshot.sets.slice(-1)) {
    for (const r of set.rounds) {
      const n = seat === "A" ? r.aNumber : r.bNumber;
      if (n !== null) used.add(n);
    }
  }
  const out: number[] = [];
  for (let n = NUM_MIN; n <= NUM_MAX; n++) if (!used.has(n)) out.push(n);
  return out;
}

// ---------------- 상태 조작 (트랜잭션에서 호출) ----------------
/** 어떤 세트 진행 중? (마지막 세트) */
function currentSet(snapshot: GameSnapshot): SetState | null {
  if (snapshot.finished) return null;
  const s = snapshot.sets[snapshot.sets.length - 1];
  return s && !s.winner ? s : null;
}

function makeSet(setNo: number): SetState {
  return { setNo, rounds: [], winner: null, aScore: 0, bScore: 0 };
}

export function emptySnapshot(): GameSnapshot {
  return {
    sets: [makeSet(1)],
    finished: false,
    winner: null,
  };
}

export function currentRoundNo(snapshot: GameSnapshot): number {
  const set = currentSet(snapshot);
  return set
    ? set.rounds.at(-1)?.outcome === null
      ? set.rounds.length
      : set.rounds.length + 1
    : 0;
}
export function currentSetNo(snapshot: GameSnapshot): number {
  const set = currentSet(snapshot);
  return set ? set.setNo : snapshot.sets.length;
}

/**
 * 숫자를 상태에 기록. 이미 resolution 확정된 상황이면 오류.
 * (提交 확정 전 저장단계 — 트랜잭션 내부에서 물리고 resolveIfBoth가 다음 단계)
 */
export function recordNumber(
  snapshot: GameSnapshot,
  seat: Seat,
  number: number,
): void {
  const set = currentSet(snapshot);
  if (!set) throw new Error("CANNOT_RECORD_SET_FINISHED");
  let round = set.rounds[set.rounds.length - 1];
  if (
    !round ||
    round.outcome !== null ||
    (round.aNumber !== null && round.bNumber !== null)
  ) {
    round = {
      roundNo: set.rounds.length + 1,
      aNumber: null,
      bNumber: null,
      outcome: null,
    };
    set.rounds.push(round);
  }
  const field = seat === "A" ? "aNumber" : "bNumber";
  if (round[field] !== null) throw new Error("ALREADY_SUBMITTED");
  round[field] = number;
}

/**
 * 양쪽 제출 완료 시 즉시 판정. 마지막 라운드 outcome을 채움.
 * The single internal set stores the match round scores.
 * Nine rounds finish the match; equal round scores are our webgame draw policy.
 */
export function resolveIfBoth(snapshot: GameSnapshot): void {
  const set = currentSet(snapshot);
  if (!set) return;
  const last = set.rounds[set.rounds.length - 1];
  if (!last || last.aNumber === null || last.bNumber === null) return;
  if (last.outcome !== null) return; // 이미 확정
  last.outcome = resolveRound(last.aNumber, last.bNumber);
  if (last.outcome === "A") set.aScore++;
  else if (last.outcome === "B") set.bScore++;
  // Finish once all nine rounds resolve.
  if (set.rounds.length >= ROUNDS_PER_GAME) {
    if (set.aScore > set.bScore) set.winner = "A";
    else if (set.bScore > set.aScore) set.winner = "B";
    else set.winner = "DRAW";
    snapshot.finished = true;
    snapshot.winner = set.winner === "DRAW" ? null : set.winner;
  }
}

/** Unfinished legacy multi-set games require owner review; never rewrite them. */
export function isIncompatibleLegacy(snapshot: GameSnapshot): boolean {
  return (
    !snapshot.finished &&
    (snapshot.sets.length !== 1 ||
      snapshot.sets[0]?.setNo !== 1 ||
      (snapshot.sets[0]?.rounds.length >= ROUNDS_PER_GAME &&
        snapshot.sets[0]?.rounds.at(-1)?.outcome !== null) ||
      !!snapshot.sets[0]?.winner)
  );
}

export type Parity = "odd" | "even";
function parity(number: number | null): Parity | null {
  return number === null ? null : number % 2 ? "odd" : "even";
}

// ---------------- View DTO ----------------
/**
 * 플레이어 전용 View. 상대 숫자는 절대 포함하지 않음.
 * (확정된 라운드의 outcome만 공개)
 */
export interface RoundView {
  roundNo: number;
  myNumber: number | null;
  opponentSubmitted: boolean;
  opponentParity: Parity | null;
  outcome: RoundOutcome | null; // 확정만 공개
}
export interface SetView {
  setNo: number;
  rounds: RoundView[];
  winner: Seat | "DRAW" | null;
}
export interface PlayerView {
  stateVersion: number;
  finished: boolean;
  winner: Seat | null;
  myRoundWins: number;
  opponentRoundWins: number;
  setNo: number;
  roundNo: number;
  myRemaining: number[];
  myUsed: number[];
  current: {
    myNumber: number | null;
    opponentSubmitted: boolean;
    opponentParity: Parity | null;
    awaitingBoth: boolean;
  } | null;
  sets: SetView[];
}

export function getPlayerView(
  seat: Seat,
  snapshot: GameSnapshot,
  stateVersion: number,
): PlayerView {
  const me: Seat = seat,
    opp: Seat = seat === "A" ? "B" : "A";
  const meField = me === "A" ? "aNumber" : "bNumber";
  const oppField = opp === "A" ? "aNumber" : "bNumber";

  const sets: SetView[] = snapshot.sets.map((s) => {
    const rounds: RoundView[] = s.rounds.map((r) => ({
      roundNo: r.roundNo,
      myNumber: r[meField],
      opponentSubmitted: r[oppField] !== null,
      opponentParity: parity(r[oppField]),
      outcome: r.outcome,
    }));
    return {
      setNo: s.setNo,
      rounds,
      winner: s.winner,
    };
  });

  const cur = snapshot.sets[snapshot.sets.length - 1];
  const liveSet = cur && !cur.winner ? cur : null;
  const last = liveSet?.rounds.at(-1);
  const liveRound = last?.outcome === null ? last : null;
  const current = liveRound
    ? {
        myNumber: liveRound[meField],
        opponentSubmitted: liveRound[oppField] !== null,
        opponentParity: parity(liveRound[oppField]),
        awaitingBoth:
          liveRound.aNumber !== null && liveRound.bNumber !== null
            ? false
            : liveRound.aNumber === null || liveRound.bNumber === null,
      }
    : liveSet
      ? {
          myNumber: null,
          opponentSubmitted: false,
          opponentParity: null,
          awaitingBoth: true,
        }
      : null;

  return {
    stateVersion,
    finished: snapshot.finished,
    winner: snapshot.winner,
    myRoundWins: cur ? (seat === "A" ? cur.aScore : cur.bScore) : 0,
    opponentRoundWins: cur ? (seat === "A" ? cur.bScore : cur.aScore) : 0,
    setNo: liveSet ? liveSet.setNo : cur ? cur.setNo : 0,
    roundNo: snapshot.finished
      ? (cur?.rounds.length ?? 0)
      : currentRoundNo(snapshot),
    myRemaining: getRemainingNumbers(seat, snapshot),
    myUsed: Array.from(
      new Set(
        snapshot.sets
          .slice(-1)
          .flatMap((s) => s.rounds.map((r) => r[meField]))
          .filter((n) => n !== null) as number[],
      ),
    ),
    current,
    sets,
  };
}

// ---------------- test helpers ----------------
export const __internals = { currentSet, makeSet };
