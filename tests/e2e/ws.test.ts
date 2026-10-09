// ws e2e — Bun WebSocket client로 서버와 연결해 submit 실측
import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { config } from "../../src/config/env.ts";

const BASE = "http://" + (process.env.TEST_HOST ?? "127.0.0.1") + ":" + config.port;

describe("WebSocket flow e2e", () => {
  test("connect → submit → broadcast observed", async () => {
    // 방 생성 (host는 쿠키로 sessionToken 받음). 여기서는 ws 토큰을 쿼리로 전달하므로 responses에서 파싱.
    const res = await fetch(`${BASE}/api/rooms`, { method: "POST", body: new URLSearchParams({ nickname: "wsA" }) });
    expect(res.status).toBe(201);
    const ck = res.headers.get("set-cookie") || "";
    const hostToken = /nd_A_[^=]+=([^;]+)/.exec(ck)?.[1] || "";
    const j = await res.json() as { code: string };

    const res2 = await fetch(`${BASE}/api/rooms/${j.code}/join`, { method: "POST", body: new URLSearchParams({ nickname: "wsB" }) });
    expect(res2.status).toBe(201);
    const ck2 = res2.headers.get("set-cookie") || "";
    const guestToken = /nd_B_[^=]+=([^;]+)/.exec(ck2)?.[1] || "";

    // WS 연결 (Bun WebSocket client)
    const url = `ws://127.0.0.1:${config.port}/ws?roomCode=${j.code}&token=${hostToken}`;
    const wsA = new WebSocket(url);
    await new Promise<void>((ok, bad) => { wsA.onopen = () => ok(); wsA.onerror = () => bad(new Error("ws open fail")); setTimeout(() => bad(new Error("timeout")), 3000); });
    const received: any[] = [];
    wsA.onmessage = (ev) => { try { received.push(JSON.parse(String(ev.data))); } catch {} };
    const wsB = new WebSocket(`ws://127.0.0.1:${config.port}/ws?roomCode=${j.code}&token=${guestToken}`);
    await new Promise<void>((ok, bad) => { wsB.onopen = () => ok(); wsB.onerror = () => bad(new Error("ws open fail")); setTimeout(() => bad(new Error("timeout")), 3000); });

    // 시작
    // room id는 create 응답에 roomId로 내려옴
    const cc = res.headers.get("set-cookie") || "";
    const cookieKey = /nd_A_([^=]+)=/.exec(cc)?.[1] ?? "";
    const startRes = await fetch(`${BASE}/api/rooms/${j.code}/start`, { method: "POST", headers: { Cookie: `nd_A_${cookieKey}=${hostToken}` } });
    expect(startRes.status).toBe(201);
    const game = await startRes.json() as { gameId: string };

    // A submit (5)
    const sendAndWait = (ws: WebSocket, payload: object) => new Promise<void>((resolve) => {
      ws.send(JSON.stringify(payload));
      setTimeout(resolve, 300);
    });
    await sendAndWait(wsA, { type: "game:submit", payload: { gameId: game.gameId, number: 5, requestId: "r1" } });
    await sendAndWait(wsB, { type: "game:submit", payload: { gameId: game.gameId, number: 3, requestId: "r2" } });
    await new Promise((ok) => setTimeout(ok, 500));

    // A가 5를 제출, B가 3을 제출 → A 승리 (broadcast broadcast 관점: state event)
    expect(received.length).toBeGreaterThan(0);
    const stateMsg = received.find(m => m.type === "game:state");
    expect(stateMsg).toBeTruthy();
    wsA.close(); wsB.close();
  }, 12000);
});
