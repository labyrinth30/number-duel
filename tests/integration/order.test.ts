import { test, expect } from "bun:test";
import { mkdtempSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { openDb, migrate } from "../../src/db/client.ts";
import { RoomRepository } from "../../src/db/repositories/room.repository.ts";
import { submitInTx } from "../../src/db/repositories/game.repository.ts";
import { rematchInTx } from "../../src/db/repositories/rematch.repository.ts";
import { getPlayerView, type GameSnapshot, type Seat } from "../../src/domain/game/engine.ts";
function fixture() {
  const path = join(mkdtempSync(join(tmpdir(), "duel-order-")), "isolated.sqlite");
  const db = openDb(path); migrate(db);
  const repo = new RoomRepository(db);
  const { room, host } = repo.create(); const { player } = repo.join(room.id);
  const g = repo.createGame(room.id);
  const saved = () => db.query("SELECT snapshot,initial_first_submitter FROM game_state WHERE game_id=?").get(g.id) as {snapshot:string;initial_first_submitter:Seat|null};
  return {path, db, repo, room, host, player, g, saved};
}
for (const first of ["A", "B"] as const) test(`first ${first}, all draws fallback, reload, consent rematch resets`, () => {
  const {db, path, repo, room, g, saved} = fixture();
  const second = first === "A" ? "B" : "A";
  expect(() => submitInTx(db,g.id,first,0)).toThrow();
  expect(saved().initial_first_submitter).toBeNull();
  for (let n=1;n<=9;n++) {
    if (n>1) {
      const before=saved();
      expect(() => submitInTx(db,g.id,second,n)).toThrow("WAITING_FIRST_SUBMISSION");
      expect(saved()).toEqual(before);
    }
    submitInTx(db,g.id,first,n);
    expect(saved().initial_first_submitter).toBe(first);
    const snap = JSON.parse(saved().snapshot) as GameSnapshot;
    expect(getPlayerView(second,snap,n*2-1)).toMatchObject({canSubmit:true,current:{opponentParity:n%2?"odd":"even",myNumber:null}});
    submitInTx(db,g.id,second,n);
    if (n===2) {
      const reopened=openDb(path); migrate(reopened);
      expect(new RoomRepository(reopened).activeGame(room.id)?.snapshot.initialFirstSubmitter).toBe(first);
      expect(getPlayerView(second,new RoomRepository(reopened).activeGame(room.id)!.snapshot,4).canSubmit).toBe(false);
      reopened.close();
    }
  }
  rematchInTx(db,room.id,first);
  expect(repo.activeGame(room.id)?.snapshot.finished).toBe(true);
  rematchInTx(db,room.id,second);
  const fresh=repo.activeGame(room.id)!;
  expect(fresh.snapshot.initialFirstSubmitter).toBeNull();
  expect(getPlayerView("A",fresh.snapshot,0).canSubmit).toBe(true);
  expect(getPlayerView("B",fresh.snapshot,0).canSubmit).toBe(true);
  db.close();
});
test("nearest winner survives multiple draws; order changes B then A; old accepted retry succeeds out of turn", () => {
  const {db,room,host,g,saved}=fixture();
  const id={roomId:room.id,playerId:host.id,setNo:1,roundNo:1,requestId:"accepted"};
  submitInTx(db,g.id,"A",2,id); submitInTx(db,g.id,"B",3);
  for (const n of [4,5]) {
    expect(() => submitInTx(db,g.id,"A",n)).toThrow("WAITING_FIRST_SUBMISSION");
    submitInTx(db,g.id,"B",n); submitInTx(db,g.id,"A",n);
  }
  const before=saved();
  expect(submitInTx(db,g.id,"A",2,id).stateVersion).toBe(6);
  expect(saved()).toEqual(before);
  expect(() => submitInTx(db,g.id,"A",6,{...id,requestId:"stale"})).toThrow("STALE_ROUND");
  submitInTx(db,g.id,"B",1); submitInTx(db,g.id,"A",8);
  expect(() => submitInTx(db,g.id,"B",6)).toThrow("WAITING_FIRST_SUBMISSION");
  submitInTx(db,g.id,"A",6); submitInTx(db,g.id,"B",6);
  expect(getPlayerView("B",JSON.parse(saved().snapshot),10).requiredFirstSeat).toBe("A");
  expect(getPlayerView("B",JSON.parse(saved().snapshot),10).canSubmit).toBe(false);
  db.close();
});
test("simultaneous independent processes serialize first acceptance and required order without lost updates", async () => {
  const {db,path,g,saved}=fixture();
  const launch=(seat:Seat,number:number) => Bun.spawn(["/home/ubuntu/.bun/bin/bun","-e",`import {openDb} from './src/db/client.ts'; import {submitInTx} from './src/db/repositories/game.repository.ts'; const db=openDb(${JSON.stringify(path)}); try {submitInTx(db,${JSON.stringify(g.id)},${JSON.stringify(seat)},${number}); console.log('ACCEPTED');} catch(e) {console.log(e.code ?? e.message);} finally {db.close();}`],{stdout:"pipe",stderr:"pipe"});
  const results=async (workers:ReturnType<typeof launch>[]) => Promise.all(workers.map(async w=> {const out=await new Response(w.stdout).text();expect(await w.exited).toBe(0);expect(await new Response(w.stderr).text()).toBe("");return out.trim();}));
  expect(await results([launch("A",1),launch("B",1)])).toEqual(["ACCEPTED","ACCEPTED"]);
  const first=saved().initial_first_submitter!;
  expect(["A","B"]).toContain(first);
  const second=first==="A"?"B":"A";
  const outputs=await results([launch(second,2),launch(first,2)]);
  expect(outputs[1]).toBe("ACCEPTED");
  expect(["ACCEPTED","WAITING_FIRST_SUBMISSION"]).toContain(outputs[0]);
  if(outputs[0]!=="ACCEPTED") submitInTx(db,g.id,second,2);
  expect(saved().initial_first_submitter).toBe(first);
  expect(JSON.parse(saved().snapshot).sets[0].rounds).toHaveLength(2);
  expect((db.query("SELECT state_version FROM games WHERE id=?").get(g.id) as {state_version:number}).state_version).toBe(4);
  db.close();
});
