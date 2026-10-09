import { test } from "bun:test";
import { mkdtempSync, mkdirSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { chromium, expect } from "@playwright/test";
test("isolated HTTP/WS security and two-browser full match, rematch, reload", async () => {
  const dir = mkdtempSync(join(tmpdir(), "number-duel-e2e-"));
  let proc: ReturnType<typeof Bun.spawn>;
  let browser;
  const start = async (port = "0") => {
    proc = Bun.spawn(["/home/ubuntu/.bun/bin/bun", "src/index.ts"], {
      env: {
        ...process.env,
        DB_PATH: join(dir, "test.sqlite"),
        PORT: port,
        BIND_HOST: "127.0.0.1",
        NODE_ENV: "test",
        PUBLIC_ORIGIN: "",
      },
      stdout: "pipe",
      stderr: "pipe",
    });
    const reader = (proc.stdout as ReadableStream<Uint8Array>).getReader();
    const first = await reader.read();
    const actualPort = /:(\d+)/.exec(
      new TextDecoder().decode(first.value),
    )?.[1];
    expect(actualPort).toBeTruthy();
    reader.releaseLock();
    return actualPort!;
  };
  try {
    const port = await start();
    const base = `http://127.0.0.1:${port}`;
    // Empty PUBLIC_ORIGIN must use the local origin in isolated tests.
    browser = await chromium.launch({ headless: true });
    const a = await browser.newContext(),
      b = await browser.newContext();
    const pa = await a.newPage(),
      pb = await b.newPage();
    const errors: string[] = [];
    pa.on("pageerror", (e) => errors.push(e.message));
    pb.on("pageerror", (e) => errors.push(e.message));
    let wsCount = 0;
    pa.on("websocket", () => wsCount++);
    await pa.goto(base + "/duel/");
    await pa.locator("#nick").fill("<host>");
    await pa.locator("#mkroom button").click();
    await pa.waitForURL("**/rooms/*");
    const roomUrl = pa.url(),
      code = roomUrl.split("/").at(-1)!;
    await pb.goto(roomUrl);
    expect(await pb.locator("body").textContent()).toContain("<host>");
    expect(await pb.locator("host").count()).toBe(0);
    await pb.locator("#joinNick").fill("guest");
    await pb.locator("#joinForm button").click();
    await pa.locator("#startBtn").click();
    await pa.locator('[data-n="1"]').waitFor();
    await pb.locator('[data-n="1"]').waitFor();
    await expect(pa.locator("#rules")).not.toHaveAttribute("open", "");
    await expect(pa.locator("#confirmBtn")).toBeDisabled();
    let submitPosts = 0;
    pa.on("request", (req) => { if (req.method() === "POST" && req.url().endsWith("/submit")) submitPosts++; });
    await pa.locator('[data-n="3"]').click();
    await pa.locator('[data-n="2"]').click();
    await pa.waitForTimeout(1800);
    await expect(pa.locator('[data-n="2"]')).toHaveAttribute("aria-pressed", "true");
    expect(submitPosts).toBe(0);
    const selectConfirm = async (page: typeof pa, number: number) => {
      await expect(page.locator(`[data-n="${number}"]`)).toBeEnabled();
      await page.locator(`[data-n="${number}"]`).click();
      const before = page === pa ? submitPosts : null;
      await page.locator("#confirmBtn").evaluate((button: HTMLButtonElement) => { button.click(); button.click(); });
      if (before !== null) await expect.poll(() => submitPosts).toBe(before + 1);
    };
    const state = async (ctx: typeof a) =>
      await (
        await ctx.request.get(base + `/duel/api/rooms/${code}/state`)
      ).json();
    let initial = await state(a);
    expect(initial.view.current.myNumber).toBeNull();
    expect(initial.view.roundNo).toBe(1);
    for (const origin of [undefined, "https://evil.invalid", "null"]) {
      const headers: Record<string, string> = {
        Upgrade: "websocket",
        Connection: "Upgrade",
        "Sec-WebSocket-Key": "dGhlIHNhbXBsZSBub25jZQ==",
        "Sec-WebSocket-Version": "13",
      };
      if (origin) headers.Origin = origin;
      const res = await fetch(base + `/duel/ws?roomCode=${code}`, { headers });
      expect(res.status).toBe(403);
    }
    const cookieHeader = (await a.cookies())
      .map((cookie) => `${cookie.name}=${cookie.value}`)
      .join("; ");
    const upgradeHeaders = {
      Upgrade: "websocket",
      Connection: "Upgrade",
      "Sec-WebSocket-Key": "dGhlIHNhbXBsZSBub25jZQ==",
      "Sec-WebSocket-Version": "13",
      Origin: base,
    };
    expect(
      (
        await fetch(base + `/duel/ws?roomCode=${code}`, {
          headers: upgradeHeaders,
        })
      ).status,
    ).toBe(401);
    expect(
      (
        await fetch(base + `/duel/ws?roomCode=${code}&token=forbidden`, {
          headers: { ...upgradeHeaders, Cookie: cookieHeader },
        })
      ).status,
    ).toBe(400);
    const wsClose = async (oversize: boolean) =>
      await pa.evaluate(
        async ({ code, oversize }) =>
          await new Promise<number>((resolve, reject) => {
            const socket = new WebSocket(
              location.origin.replace("http", "ws") +
                "/duel/ws?roomCode=" +
                code,
            );
            socket.onopen = () => {
              if (oversize) socket.send("x".repeat(5000));
              else
                for (let i = 0; i < 181; i++)
                  socket.send(JSON.stringify({ type: "ping" }));
            };
            socket.onclose = (event) => resolve(event.code);
            setTimeout(() => {
              socket.close();
              reject(new Error("WS limit timeout"));
            }, 5000);
          }),
        { code, oversize },
      );
    expect(await wsClose(false)).toBe(1008);
    // Bun may terminate oversize frames without a close frame (browser code 1006).
    expect([1006, 1009]).toContain(await wsClose(true));
    const foreign = await a.request.post(base + "/duel/api/rooms", {
      form: { nickname: "other" },
    });
    const other = await foreign.json();
    await a.request.post(base + `/duel/api/rooms/${other.code}/join`, {
      form: { nickname: "otherB" },
    });
    const fg = await (
      await a.request.post(base + `/duel/api/rooms/${other.code}/start`)
    ).json();
    const cross = await a.request.post(
      base + `/duel/api/rooms/${code}/submit`,
      {
        form: {
          gameId: fg.gameId,
          number: "1",
          setNo: "1",
          roundNo: "1",
          requestId: "cross",
        },
      },
    );
    expect(cross.status()).toBe(403);
    const wsCross = await pa.evaluate(
      async ({ code, gameId }) =>
        await new Promise<string>((ok, bad) => {
          const w = new WebSocket(
            location.origin.replace("http", "ws") + "/duel/ws?roomCode=" + code,
          );
          w.onopen = () =>
            w.send(
              JSON.stringify({
                type: "game:submit",
                payload: {
                  gameId,
                  number: 1,
                  setNo: 1,
                  roundNo: 1,
                  requestId: "ws-cross",
                },
              }),
            );
          w.onmessage = (e) => {
            const m = JSON.parse(e.data);
            if (m.type === "game:error") {
              w.close();
              ok(m.code);
            }
          };
          setTimeout(() => {
            w.close();
            bad(new Error("WS cross-room timeout"));
          }, 5000);
        }),
      { code, gameId: fg.gameId },
    );
    expect(wsCross).toBe("FORBIDDEN");

    // Real authenticated WS submit, then a delayed retry after resolution.
    const move = {
      gameId: initial.gameId,
      number: 1,
      setNo: 1,
      roundNo: 1,
      requestId: "ws-first",
    };
    await pa.evaluate(
      async ({ code, move }) => {
        await new Promise<void>((ok, bad) => {
          const w = new WebSocket(
            location.origin.replace("http", "ws") + "/duel/ws?roomCode=" + code,
          );
          w.onopen = () =>
            w.send(JSON.stringify({ type: "game:submit", payload: move }));
          w.onmessage = (e) => {
            if (JSON.parse(e.data).type === "game:state")
              fetch("/duel/api/rooms/" + code + "/state")
                .then((r) => r.json())
                .then((s) => {
                  if (s.view.current.myNumber === 1) {
                    w.close();
                    ok();
                  }
                });
          };
          w.onerror = () => bad(new Error("WS failed"));
          setTimeout(() => bad(new Error("WS timeout")), 5000);
        });
      },
      { code, move },
    );
    await expect
      .poll(async () => (await state(a)).view.current.myNumber)
      .toBe(1);
    const aa = [1, 2, 3, 4, 5, 6, 7, 8, 9],
      bb = [9, 1, 2, 3, 4, 5, 6, 7, 8];
    // The other browser sees parity while its own tile remains unsubmitted.
    await expect
      .poll(async () => (await state(b)).view.current.opponentParity)
      .toBe("odd");
    expect((await state(b)).view.current.myNumber).toBeNull();
    await expect(pb.locator("#opponentParity")).toContainText("홀수");
    // Stop the actual test server and reopen the same on-disk DB on the same port.
    proc!.kill();
    await proc!.exited;
    await start(port);
    await pa.reload();
    await pb.reload();
    expect((await state(a)).view.current.myNumber).toBe(1);
    expect((await state(b)).view.current.opponentParity).toBe("odd");
    await expect(pb.locator("#opponentParity")).toContainText("홀수");
    for (let r = 1; r <= 9; r++) {
      if (r !== 1) await selectConfirm(pa, aa[r - 1]!);
      await selectConfirm(pb, bb[r - 1]!);
      await expect
        .poll(async () => {
          const s = await state(a);
          return s.view.finished ? "finished" : String(s.view.roundNo);
        })
        .toBe(r === 9 ? "finished" : String(r + 1));
      if (r < 9) {
        await expect(pa.locator(`[data-n="${r}"]`)).toBeDisabled();
        await expect(pa.locator("#confirmBtn")).toBeDisabled();
        await expect(pa.locator(".n-btn[aria-pressed=\"true\"]")).toHaveCount(0);
      }
      await expect(pa.locator("#lastResult")).toContainText(`${r}라운드`);
      if (r === 2) {
        await pa.reload();
        await expect(pa.locator("#lastResult")).toContainText("2라운드 · 승리");
        await pa.locator('[data-n="3"]').click();
        await expect(pa.locator('#history [data-round="1"]')).toContainText("홀수");
        await expect(pa.locator('#history [data-round="2"]')).toContainText("홀수");
        expect(await pa.locator('#history [data-round="1"] .history-number').textContent()).toBe("1");
        expect(await pa.locator('#history [data-round="2"] .history-number').textContent()).toBe("2");
        expect(await pa.locator(".opponent").textContent()).not.toMatch(/[1-9]/);
        await expect(pa.locator("#history li")).toHaveCount(9);
        await expect(pa.locator("#history .opponent-slot")).toHaveCount(9);
        await expect(pa.locator("#history .own-slot")).toHaveCount(9);
        await expect(pa.locator("#history .opponent-slot .history-number")).toHaveCount(0);
        mkdirSync("backups/ui-review", { recursive: true });
        for (const width of [360, 390, 1280]) {
          await pa.setViewportSize({width, height: width === 1280 ? 900 : 844});
          expect(await pa.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
          await pa.evaluate(() => scrollTo(0, 0));
          for (const box of await pa.locator(".n-btn:not(:disabled), #confirmBtn, #rules summary").evaluateAll((elements) => elements.map((el) => ({width:el.getBoundingClientRect().width,height:el.getBoundingClientRect().height})))) {
            expect(box.width).toBeGreaterThanOrEqual(44);
            expect(box.height).toBeGreaterThanOrEqual(44);
          }
          await expect(pa.locator("#confirmBtn")).toBeEnabled();
          const geometry = await pa.evaluate(() => {
            const confirm = document.getElementById("confirmBtn")!.getBoundingClientRect();
            const selection = document.querySelector(".selection")!.getBoundingClientRect();
            const history = document.querySelector(".history-section")!.getBoundingClientRect();
            return {top: confirm.top, bottom: confirm.bottom, height: innerHeight, selectionBottom: selection.bottom, historyTop: history.top};
          });
          expect(geometry.top).toBeGreaterThanOrEqual(0);
          expect(geometry.bottom).toBeLessThanOrEqual(geometry.height);
          expect(geometry.selectionBottom).toBeLessThan(geometry.historyTop);
          await expect(pa.locator("#history .active-round")).toHaveCount(1);
          await expect(pa.locator("#history .active-round")).toContainText("선택됨·미제출");
          await expect(pa.locator("#lastResult")).toContainText("직전 결과");
          expect(await pa.locator(".scores div").allTextContents()).toEqual(["상대0", "나2"]);
          await expect(pa.locator("#history .empty .history-number").first()).toHaveText("?");
          await expect(pa.locator("#history .opponent-slot .empty").first()).toContainText("?");
          await pa.screenshot({path: `backups/ui-review/round-3-${width}.png`});
          await pa.screenshot({path: `backups/ui-review/round-3-${width}-full.png`, fullPage: true});
        }
      }
      if (r === 1) {
        const retry = await a.request.post(
          base + `/duel/api/rooms/${code}/submit`,
          {
            form: Object.fromEntries(
              Object.entries(move).map(([k, v]) => [k, String(v)]),
            ),
          },
        );
        expect(retry.status()).toBe(200);
        expect((await state(a)).view.roundNo).toBe(2);
        await pa.reload();
        await pb.reload();
        expect((await state(b)).view.sets[0].rounds[0].opponentParity).toBe(
          "odd",
        );
        await expect(pb.locator("#history")).toContainText("홀수");
      }
    }
    await pa.locator("#result").waitFor();
    await pb.locator("#result").waitFor();
    expect(await pa.locator("#result").textContent()).toContain("승리");
    expect(await pb.locator("#result").textContent()).toContain("패배");
    await pa.setViewportSize({width:1280,height:900});
    await pa.evaluate(() => scrollTo(0, 0));
    await pa.screenshot({path: "backups/ui-review/match-result-1280.png"});
    await pa.setViewportSize({width:390,height:844});
    await pa.screenshot({path: "backups/ui-review/match-result-390.png"});
    await pa.screenshot({path: "backups/ui-review/match-result-390-full.png",fullPage:true});
    const end = await state(a);
    expect(end.roomStatus).toBe("FINISHED");
    expect(end.winnerPlayerId).toBeTruthy();
    const dto = JSON.stringify(end);
    for (const key of [
      "session_token",
      "snapshot",
      "aNumber",
      "bNumber",
      "player_b_number",
    ])
      expect(dto).not.toContain(key);
    await pa.reload();
    await pa.locator("#rematchBtn").click();
    await expect.poll(async () => (await state(a)).rematch.mine).toBe(true);
    expect((await state(a)).gameId).toBe(initial.gameId);
    expect((await state(a)).view.finished).toBe(true);
    await pb.locator("#rematchBtn").click();
    await expect
      .poll(async () => (await state(a)).gameId)
      .not.toBe(initial.gameId);
    await pa.locator('[data-n="1"]').waitFor();
    await pb.reload();
    await pb.locator('[data-n="1"]').waitFor();
    await expect(pa.locator("#confirmBtn")).toBeDisabled();
    await expect(pa.locator('[data-n="1"]')).toBeEnabled();
    await expect(pa.locator("#lastResult")).toContainText("첫 라운드");
    // Full equal-score draw match uses the same 1..9 sequence, over HTTP fallback.
    await b.routeWebSocket("**/duel/ws*", (ws) => ws.close());
    await pb.reload();
    const drawGameId = (await state(a)).gameId;
    for (let n = 1; n <= 9; n++) {
      await selectConfirm(pa, n);
      await expect
        .poll(async () => (await state(b)).view.current.opponentParity)
        .toBe(n % 2 ? "odd" : "even");
      await expect(pb.locator("#opponentParity")).toContainText(
        n % 2 ? "홀수" : "짝수",
      );
      await expect(pb.locator("body")).not.toContainText(/\b(?:ODD|EVEN)\b/i);
      await expect(pb.locator(`#history [data-round="${n}"] .opponent-slot small`)).toHaveText(n % 2 ? "홀수" : "짝수");
      await selectConfirm(pb, n);
      await expect
        .poll(async () => {
          const s = await state(a);
          return s.view.finished ? "finished" : String(s.view.roundNo);
        })
        .toBe(n === 9 ? "finished" : String(n + 1));
    }
    await expect(pa.locator("#result")).toContainText("DRAW");
    await expect(pb.locator("#result")).toContainText("DRAW");
    const draw = await state(a);
    expect(draw.view.winner).toBeNull();
    expect(draw.winnerPlayerId).toBeNull();
    expect(draw.view.myRoundWins).toBe(0);
    expect(draw.view.opponentRoundWins).toBe(0);
    await pa.reload();
    await pb.reload();
    await expect(pb.locator("#history li")).toHaveCount(9);
    await pa.locator("#rematchBtn").click();
    await expect.poll(async () => (await state(a)).rematch.mine).toBe(true);
    expect((await state(a)).gameId).toBe(drawGameId);
    await pb.locator("#rematchBtn").click();
    await expect.poll(async () => (await state(a)).gameId).not.toBe(drawGameId);
    await selectConfirm(pb, 3);
    await expect
      .poll(async () => (await state(b)).view.current.myNumber)
      .toBe(3);
    const unauth = await browser.newContext();
    const pu = await unauth.newPage();
    await pu.goto(roomUrl);
    const response = await unauth.request.get(
      base + `/duel/api/rooms/${code}/state`,
    );
    expect(response.status()).toBe(401);
    await a.clearCookies();
    await expect
      .poll(async () => await pa.locator("#game").textContent())
      .toContain("세션이 만료");
    await pa.reload();
    expect(await pa.locator("body").textContent()).not.toContain(
      "숫자 하나 골라 제출",
    );
    expect(errors).toEqual([]);
    expect(wsCount).toBeGreaterThan(1);
    console.log(
      "E2E: two contexts; 9-round win + 9-round draw; actual process restart with same sessions and partial parity; WS submit; origin rejection; cross-room rejection; retry; results; consent rematch; reload/reconnect; HTTP fallback; no page errors",
    );
  } finally {
    await browser?.close();
    proc!.kill();
    await proc!.exited;
  }
}, 120000);
