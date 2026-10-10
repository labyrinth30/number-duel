import {test} from 'bun:test';
import {chromium,expect} from '@playwright/test';
import {mkdtempSync,mkdirSync} from 'fs';import {tmpdir} from 'os';import {join} from 'path';
import {openDb} from '../../src/db/client.ts';
test('AI browser select-confirm, restart pending move, parity, nine rounds, rematch screenshots',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'ai-browser-')),path=join(dir,'scratch.sqlite');
 let proc:ReturnType<typeof Bun.spawn>|undefined;let browser;
 const start=async(port='0')=>{
 proc=Bun.spawn(['/home/ubuntu/.bun/bin/bun','src/index.ts'],{env:{...process.env,DB_PATH:path,PORT:port,BIND_HOST:'127.0.0.1',NODE_ENV:'test',PUBLIC_ORIGIN:''},stdout:'pipe',stderr:'pipe'});
 const reader=(proc.stdout as ReadableStream<Uint8Array>).getReader();const data=await reader.read();reader.releaseLock();
 const actual=/:(\d+)/.exec(new TextDecoder().decode(data.value))?.[1];expect(actual).toBeTruthy();return actual!;
 };
 try {
 const port=await start(),base=`http://127.0.0.1:${port}`;
 browser=await chromium.launch({headless:true});const ctx=await browser.newContext(),outsider=await browser.newContext();const page=await ctx.newPage();const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
 mkdirSync('backups/ai-review',{recursive:true});
 await page.goto(base+'/duel/');
 for(const width of [390,1280]) {await page.setViewportSize({width,height:900});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);await page.screenshot({path:`backups/ai-review/lobby-${width}.png`,fullPage:true});}
 await page.locator('#nick').fill('사람');await page.getByRole('button',{name:'AI 대결 · 고급'}).click();await page.waitForURL('**/rooms/*');const url=page.url(),code=url.split('/').at(-1)!;
 const endpoint=base+`/duel/api/rooms/${code}`;const state=async()=>await(await ctx.request.get(endpoint+'/state')).json();
 expect((await outsider.request.get(endpoint+'/state')).status()).toBe(401);
 expect((await ctx.cookies()).filter(c=>c.name.startsWith('nd_B_'))).toHaveLength(0);
 // Seed only the isolated test DB to reproduce AI-first rounds.
 const db=openDb(path);await page.locator('#startBtn').click();await expect.poll(async()=>!!(await state()).view).toBe(true);
 db.query('UPDATE ai_games SET seed=? WHERE game_id=?').run('repeatable',(await state()).gameId);
 await page.setViewportSize({width:390,height:844});
 await page.locator('[data-n="1"]').click();expect((await state()).view.current.myNumber).toBeNull();
 await page.locator('#confirmBtn').click();await expect.poll(async()=>(await state()).view.current?.myNumber).toBe(1);
 await expect(page.locator('.opponent')).toContainText('AI 제출 대기');await page.screenshot({path:'backups/ai-review/ai-turn-waiting.png',fullPage:true});
 const seedBefore=db.query('SELECT seed FROM ai_games').get();
 proc!.kill();await proc!.exited;await start(port);await page.reload();expect(db.query('SELECT seed FROM ai_games').get()).toEqual(seedBefore);
 await expect.poll(async()=>(await state()).view.roundNo).toBe(2);
 let parityShot=false,waitingShot=false;
 for(let round=2;round<=9;round++) {
 let s=await state();expect(s.view.finished).toBe(false);
 if(!s.view.canSubmit) {
   await expect(page.locator('#confirmBtn')).toBeDisabled();
   if(!waitingShot){await page.screenshot({path:'backups/ai-review/ai-first-waiting.png',fullPage:true});waitingShot=true;}
   await expect.poll(async()=>(await state()).view.canSubmit).toBe(true);
 }
 s=await state();
 if(s.view.current.opponentSubmitted&&!parityShot){await expect(page.locator('#opponentParity')).toContainText(s.view.current.opponentParity==='odd'?'홀수':'짝수');await page.screenshot({path:'backups/ai-review/ai-submitted-parity.png',fullPage:true});parityShot=true;}
 const n=s.view.myRemaining[0];await expect(page.locator(`[data-n="${n}"]`)).toBeEnabled();await page.locator(`[data-n="${n}"]`).click();await page.locator('#confirmBtn').click();
 await expect.poll(async()=>{const s=await state();return s.view.finished?'finished':s.view.roundNo;}).toBe(round===9?'finished':round+1);
 }
 expect(parityShot).toBe(true);expect(waitingShot).toBe(true);await expect(page.locator('#result')).toBeVisible();await page.screenshot({path:'backups/ai-review/result.png',fullPage:true});
 const end=await state();expect(end.view.sets[0].rounds).toHaveLength(9);expect(JSON.stringify(end)).not.toContain('seed');expect(JSON.stringify(end)).not.toContain('bNumber');
 await page.locator('#rematchBtn').click();await expect.poll(async()=>(await state()).gameId).not.toBe(end.gameId);expect((await state()).view.requiredFirstSeat).toBe('A');expect(errors).toEqual([]);db.close();
 console.log('AI browser: real Chromium contexts, no bot cookie, select-confirm, scratch process restart, seed persistence, AI-first waiting, accepted parity, nine-round result, server bot rematch consent');
 }finally{await browser?.close();if(proc){proc.kill();await proc.exited;}}
},90000);
