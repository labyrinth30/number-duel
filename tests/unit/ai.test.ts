import {test,expect} from 'bun:test';
import {predictOdd,chooseMove,thinkDelay} from '../../src/domain/ai/strategy.ts';
import {emptySnapshot,getPlayerView} from '../../src/domain/game/engine.ts';
test('adaptive parity frequency and conditional repetition/alternation',()=>{
 expect(predictOdd(['odd','odd','odd','odd'])).toBeGreaterThan(.7);
 expect(predictOdd(['even','even','even','even'])).toBeLessThan(.3);
 expect(predictOdd(['odd','even','odd','even','odd','even'])).toBeGreaterThan(.5);
 expect(predictOdd(['even','odd','even','odd','even','odd'])).toBeLessThan(.5);
});
test('seeded choices repeat, explore across seeds, use published parity and enforce turn',()=>{
 const view=getPlayerView('B',emptySnapshot(),0);
 const moves=new Set<number>();
 for(let i=0;i<100;i++) { const seed='seed'+i; expect(chooseMove(view,seed)).toBe(chooseMove(view,seed)); moves.add(chooseMove(view,seed)); expect(thinkDelay(seed,1)).toBeGreaterThanOrEqual(800);expect(thinkDelay(seed,1)).toBeLessThanOrEqual(1500); }
 expect(moves.size).toBeGreaterThan(5);
 let different=0;
 for(let i=0;i<100;i++) {const odd=structuredClone(view),even=structuredClone(view);odd.current!.opponentParity='odd';even.current!.opponentParity='even';if(chooseMove(odd,''+i)!==chooseMove(even,''+i))different++;}
 expect(different).toBeGreaterThan(0);
 expect(()=>chooseMove({...view,canSubmit:false},'seed')).toThrow('AI_OUT_OF_TURN');
});
test('seeded pattern histories drive deterministic adaptive choices',()=>{
 const base=getPlayerView('B',emptySnapshot(),0);
 const withHistory=(history:('odd'|'even')[])=>({...base,roundNo:7,sets:[{setNo:1,winner:null,rounds:history.map((p,i)=>({roundNo:i+1,myNumber:i+1,opponentSubmitted:true,opponentParity:p,outcome:'DRAW' as const}))}],myRemaining:[7,8,9]});
 const repeating=withHistory(['odd','odd','even','odd','odd','odd']);
 const alternating=withHistory(['even','odd','even','odd','even','odd']);
 let changed=0;
 for(let i=0;i<200;i++){const seed='history'+i;const a=chooseMove(repeating,seed),b=chooseMove(alternating,seed);expect(a).toBe(chooseMove(repeating,seed));expect(b).toBe(chooseMove(alternating,seed));if(a!==b)changed++;}
 expect(changed).toBeGreaterThan(0);
});
