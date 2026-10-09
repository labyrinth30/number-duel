// number-duel client game.js
// state sync via /api/rooms/:code/state + WS broadcast → re-fetch
(function () {
  const code = new URL(window.location.href).pathname.split("/").pop();
  if (!code) return;
  const base = new URL(window.location.href).origin;
  let stateView = null;

  async function fetchState() {
    const r = await fetch(`${base}/api/rooms/${code}/state`);
    if (r.status === 401) { window.location.href = "/duel/"; return; }
    if (r.status !== 200) return;
    const j = await r.json();
    render(j);
  }

  async function submit(number) {
    const r = await fetch(`${base}/api/game/submit`, {
      method: "POST", body: new URLSearchParams({ code, number: String(number) }),
    });
    await fetchState();
  }

  function render(j) {
    const el = document.getElementById("game");
    if (!el) return;
    if (!j.view) {
      el.innerHTML = `<div class="cardBox"><h2>로비 · ${code}</h2><a href="/duel/">처음으로</a></div>`;
      return;
    }
    const v = j.view;
    if (j.roomStatus === "FINISHED") { renderResult(v, j.seat); }
    else { renderGame(v, j.seat, j.roomStatus); }
    renderScores(v);
  }
  function renderScores(v) {
    let el = document.getElementById("scores");
    if (!el) { el = document.createElement("div"); el.id = "scores"; document.querySelector(".sideL")?.appendChild(el); }
    el.innerHTML = `<b>내 세트</b> ${v.mySetWins} / <b>상대 세트</b> ${v.opponentSetWins}<br/>
      <b>현재</b> ${v.setNo}세트 ${v.roundNo}라운드<br/>
      <b>남은</b> ${v.myRemaining.join(", ")}<br/><b>사용</b> ${v.myUsed.join(", ")}`;
  }

  function numberButtons(myRemaining, extra) {
    let h = `<ul class="choice-row">`;
    for (const n of myRemaining) h += `<li><button class="n-btn" data-n="${n}" ${extra || ""}>${n}</button></li>`;
    return h + "</ul>";
  }

  function renderGame(v, seat, roomStatus) {
    const el = document.getElementById("game"); if (!el) return;
    const cur = v.current;
    if (!cur) { el.innerHTML = `<div class="cardBox">로딩 중...</div>`; return; }
    const buttons = numberButtons(v.myRemaining);
    let html = `<div class="cardBox">`;
    if (cur.myNumber === null && !cur.opponentSubmitted) {
      html += `<h2>숫자 하나 골라 제출</h2>` + buttons;
    } else if (cur.myNumber !== null && !cur.opponentSubmitted) {
      html += `<div class="waiting">제출했어 (${cur.myNumber}). 상대 대기 중...</div>`;
    } else if (cur.myNumber === null && cur.opponentSubmitted) {
      html += `<div class="waiting">상대가 제출했어. 네 차례야</div>` + buttons;
    }
    html += `</div>`;
    const history = v.sets.map((s) => s.rounds.map((r) => {
      const mySeat = seat;
      if (r.outcome === "DRAW") return r.roundNo + ":무";
      if (!r.outcome) return r.roundNo + ":…";
      if (r.outcome === "A") return mySeat === "A" ? r.roundNo + ":승" : r.roundNo + ":패";
      return mySeat === "B" ? r.roundNo + ":승" : r.roundNo + ":패";
    }).join(" ")).map((t, i) => `<span>세트${i + 1}: ${t}</span>`).join("<br/>");
    if (history) html += `<div class="cardBox fade"><p>${history}</p></div>`;
    el.innerHTML = html;
    el.querySelectorAll(".n-btn").forEach(b => b.addEventListener("click", () => submit(parseInt(b.dataset.n))));
  }

  function renderResult(v, seat) {
    const el = document.getElementById("game"); if (!el) return;
    el.innerHTML = v.winner === seat ? `<div class="result-won fade">🎉 승리</div>` : `<div class="result-lost fade">😢 패배</div>`;
    el.innerHTML += `<div class="cardBox">세트 <b>${v.mySetWins}</b> : <b>${v.opponentSetWins}</b></div>
      <button class="btn" id="rematchBtn">재대결</button>`;
    document.getElementById("rematchBtn")?.addEventListener("click", async () => {
      await fetch(`${base}/api/game/rematch`, { method: "POST", body: new URLSearchParams({ code }) });
      await fetchState();
    });
  }

  // WebSocket 구독 (배포 시 wss, 개발 시 ws 자동)
  let ws = null;
  function retryWs() {
    ws = new WebSocket(`${base.replace(/^http/, "ws")}/ws?roomCode=${encodeURIComponent(code)}`);
    ws.onmessage = (ev) => {
      try {
        const j = JSON.parse(ev.data);
        if (j.type === "game:state" || j.type === "game:submitted" || j.type === "game:round-resolved") fetchState();
      } catch {}
    };
    ws.onclose = () => setTimeout(retryWs, 2000);
  }
  retryWs();
  fetchState();
  setInterval(() => ws?.send(JSON.stringify({ type: "ping" })), 20000);
})();
