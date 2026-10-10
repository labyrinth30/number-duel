import {test,expect} from 'bun:test';
import {mkdtempSync} from 'fs';import {tmpdir} from 'os';import {join} from 'path';
import {openDb,migrate} from '../../src/db/client.ts';
import {RoomRepository} from '../../src/db/repositories/room.repository.ts';
import {submitInTx} from '../../src/db/repositories/game.repository.ts';
import {rematchInTx} from '../../src/db/repositories/rematch.repository.ts';
import {tickAI} from '../../src/jobs/ai.ts';
import {getPlayerView} from '../../src/domain/game/engine.ts';
import {authenticate} from '../../src/app.ts';
test('AI legal turns, persisted seed/deadline/partial round, atomic worker retries, nine rounds and consent',()=>{
 const path=join(mkdtempSync(join(tmpdir(),'ai-duel-')),'scratch.sqlite');
 let db=openDb(path);migrate(db);let repo=new RoomRepository(db);
 const {room}=repo.create();repo.addAI(room.id);const game=repo.createGame(room.id);
 db.query('UPDATE ai_games SET seed=? WHERE game_id=?').run('repeatable',game.id);
 let now=1000;let broadcasts=0;const tick=()=>tickAI(db,()=>broadcasts++,now);
 const active=()=>repo.activeGame(room.id)!;
 const human=()=>getPlayerView('A',active().snapshot,active().stateVersion);
 tick();now+=2000;tick();expect(active().stateVersion).toBe(0);
 expect(()=>submitInTx(db,game.id,'B',1)).toThrow('WAITING_FIRST_SUBMISSION');
 const bot=repo.byRoomAndSeat(room.id,'B')!;expect(authenticate(db,room.id,`nd_B_${room.id}=anything`)).toBeNull();expect(bot.session_token_hash.startsWith('bot:')).toBe(true);
 let sawAILead=false;
 for(let r=1;r<=9;r++) {
   let v=human();expect(v.finished).toBe(false);expect(v.roundNo).toBe(r);
   if(!v.canSubmit) { sawAILead=true; const before=active().stateVersion;expect(v.current!.opponentParity).toBeNull();expect(()=>submitInTx(db,game.id,'A',v.myRemaining[0]!)).toThrow('WAITING_FIRST_SUBMISSION');tick();expect(active().stateVersion).toBe(before);now+=1600;tick();expect(human().current!.opponentParity).not.toBeNull(); }
   v=human();submitInTx(db,game.id,'A',v.myRemaining[0]!);
   if(r===1) {
     expect(human().current!.opponentParity).toBeNull();tick();
     const pending=db.query('SELECT * FROM ai_games WHERE game_id=?').get(game.id);
     db.close();db=openDb(path);migrate(db);repo=new RoomRepository(db);
     expect(db.query('SELECT * FROM ai_games WHERE game_id=?').get(game.id)).toEqual(pending);
     expect(human().current!.myNumber).toBe(1);expect(human().current!.opponentParity).toBeNull();
   }
   tick();now+=1600;tick();tick();
   expect(active().snapshot.finished).toBe(r===9);
 }
 expect(sawAILead).toBe(true);expect(active().snapshot.sets[0]!.rounds).toHaveLength(9);
 expect(active().stateVersion).toBe(18);expect(broadcasts).toBe(9);
 expect(JSON.stringify(human())).not.toContain('bNumber');
 expect(rematchInTx(db,room.id,'A').completed).toBe(false);expect(active().game.id).toBe(game.id);
 tick();expect(active().game.id).not.toBe(game.id);expect(active().snapshot.humanFirst).toBe(true);
 expect(db.query('SELECT seed FROM ai_games WHERE game_id=?').get(active().game.id)).toBeTruthy();db.close();
});
test('AI creation accepts HARD only and creates no bot cookie',async()=>{
 const {createApp}=await import('../../src/app.ts');
 const db=openDb(join(mkdtempSync(join(tmpdir(),'ai-mode-')),'scratch.sqlite'));const app=createApp(db);
 for(const difficulty of ['EASY','MEDIUM','', 'hard']) {
 const response=await app.request('/api/rooms',{method:'POST',body:new URLSearchParams({nickname:'human',mode:'AI',difficulty})});
 expect(response.status).toBe(400);expect((await response.json()).code).toBe('BAD_DIFFICULTY');
 }
 expect((db.query('SELECT count(*) n FROM rooms').get() as {n:number}).n).toBe(0);
 const accepted=await app.request('/api/rooms',{method:'POST',body:new URLSearchParams({nickname:'human',mode:'AI',difficulty:'HARD'})});
 expect(accepted.status).toBe(201);expect(accepted.headers.get('set-cookie')).toContain('nd_A_');expect(accepted.headers.get('set-cookie')).not.toContain('nd_B_');db.close();
});
test('independent AI workers serialize one accepted submission',async()=>{
 const path=join(mkdtempSync(join(tmpdir(),'ai-workers-')),'scratch.sqlite');const db=openDb(path);migrate(db);const repo=new RoomRepository(db);const {room}=repo.create();repo.addAI(room.id);const g=repo.createGame(room.id);submitInTx(db,g.id,'A',1);tickAI(db,()=>{},1000);
 const launch=()=>Bun.spawn(['/home/ubuntu/.bun/bin/bun','-e',`import {openDb} from './src/db/client.ts'; import {tickAI} from './src/jobs/ai.ts'; const db=openDb(${JSON.stringify(path)});tickAI(db,()=>{},3000);db.close();`],{stdout:'pipe',stderr:'pipe'});
 const workers=[launch(),launch()];for(const w of workers){expect(await w.exited).toBe(0);expect(await new Response(w.stderr).text()).toBe('');}
 expect(repo.activeGame(room.id)!.stateVersion).toBe(2);expect(repo.activeGame(room.id)!.snapshot.sets[0]!.rounds).toHaveLength(1);db.close();
});
