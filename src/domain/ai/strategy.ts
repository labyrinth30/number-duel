import { resolveRound, type Parity, type PlayerView } from '../game/engine.ts';
// Stateless keyed RNG: retries/restarts produce the same decision, without exposing the seed.
export function random(seed: string, key: string): number {
  let h = 2166136261;
  for (const c of seed + ':' + key) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
  h ^= h >>> 16; h = Math.imul(h, 0x7feb352d); h ^= h >>> 15;
  return (h >>> 0) / 4294967296;
}
export function predictOdd(history: Parity[]): number {
  const odd = history.filter(p => p === 'odd').length;
  const frequency = (odd + 1) / (history.length + 2);
  const last = history.at(-1);
  let transitions = 0, nextOdd = 0;
  for (let i = 1; i < history.length; i++) if (history[i - 1] === last) {
    transitions++; if (history[i] === 'odd') nextOdd++;
  }
  const weight = transitions / (transitions + 3);
  return frequency * (1 - weight) + ((nextOdd + 1) / (transitions + 2)) * weight;
}
export function chooseMove(view: PlayerView, seed: string): number {
  if (!view.canSubmit || !view.myRemaining.length) throw new Error('AI_OUT_OF_TURN');
  const rounds = view.sets.flatMap(s => s.rounds);
  const history = rounds.filter(r => r.outcome !== null).map(r => r.opponentParity!).filter(Boolean);
  const observed = view.current?.opponentParity;
  let pOdd = observed ? (observed === 'odd' ? 1 : 0) : predictOdd(history);
  // Only published parity is known: never remove an opponent's exact numbers.
  const oddsLeft = 5 - history.filter(p => p === 'odd').length;
  const evensLeft = 4 - history.filter(p => p === 'even').length;
  if (!observed) pOdd = oddsLeft === 0 ? 0 : evensLeft === 0 ? 1 : pOdd;
  const key = `move:${view.roundNo}`;
  if (random(seed, key + ':explore') < .12)
    return view.myRemaining[Math.floor(random(seed, key + ':pick') * view.myRemaining.length)]!;
  const scored = view.myRemaining.map(n => {
    let value = 0;
    for (let opponent = 1; opponent <= 9; opponent++) {
      const odd = opponent % 2 === 1;
      if ((odd ? oddsLeft : evensLeft) <= 0) continue;
      const weight = odd ? pOdd / 5 : (1 - pOdd) / 4;
      const outcome = resolveRound(n, opponent);
      value += weight * (outcome === 'A' ? 1 : outcome === 'DRAW' ? .2 : 0);
    }
    // Save valuable tiles early; seeded jitter avoids a fixed, exploitable ordering.
    value -= .025 * n * (9 - view.roundNo) / 8;
    value += .22 * random(seed, key + ':' + n);
    return {n, value};
  });
  return scored.sort((a,b) => b.value - a.value)[0]!.n;
}
export const thinkDelay = (seed: string, round: number) => 800 + Math.floor(random(seed, `delay:${round}`) * 701);
