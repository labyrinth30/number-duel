(() => {
  const code = location.pathname.split("/").filter(Boolean).at(-1);
  const base = "/duel";
  const el = document.getElementById("game");
  let state,
    ws,
    busy = false,
    expired = false,
    selected = null,
    selectionKey = null,
    syncSequence = 0;
  const escape = (value) =>
    String(value).replace(
      /[&<>"']/g,
      (char) =>
        ({
          "&": "&amp;",
          "<": "&lt;",
          ">": "&gt;",
          '"': "&quot;",
          "'": "&#39;",
        })[char],
    );
  const parity = (value) =>
    value
      ? `<span class="parity ${value}">${value === "odd" ? "홀수" : "짝수"}</span>`
      : '<span class="parity unknown">? · 미제출</span>';

  async function action(path, body) {
    if (busy || expired) return;
    busy = true;
    render();
    try {
      const response = await fetch(`${base}/api/rooms/${code}/${path}`, {
        method: "POST",
        body: new URLSearchParams(body),
      });
      if (!response.ok) {
        const error = await response.json();
        document.getElementById("statusLine").textContent = error.code;
      }
      await sync();
    } catch {
      document.getElementById("statusLine").textContent =
        "연결을 확인해 주세요";
    } finally {
      busy = false;
      if (state) render();
    }
  }

  async function sync() {
    if (expired) return;
    const sequence = ++syncSequence;
    try {
      const response = await fetch(`${base}/api/rooms/${code}/state`);
      if (response.status === 401) {
        expired = true;
        ws?.close();
        el.innerHTML =
          '<p>세션이 만료되었거나 이 방의 참가자가 아닙니다.</p><a href="/duel/">처음으로</a>';
        return;
      }
      if (!response.ok) {
        const error = await response.json();
        if (error.code === "LEGACY_GAME_INCOMPATIBLE") {
          el.innerHTML =
            "<p>이전 여러 세트 게임은 새 규칙과 호환되지 않아 보존되었습니다. 운영자 확인이 필요합니다.</p>";
        }
        return;
      }
      const next = await response.json();
      if (sequence !== syncSequence) return;
      state = next;
      render();
    } catch {
      document.getElementById("statusLine").textContent = "재연결 중…";
    }
  }

  function render() {
    const focused = document.activeElement;
    const focusNumber = focused?.dataset?.n;
    const focusId = focused?.id;
    const view = state.view;
    el.className = state.seat === "A" ? "team-red" : "team-cyan";
    document.getElementById("statusLine").textContent =
      ws?.readyState === 1 ? "실시간 연결" : "HTTP 동기화";
    if (!view) {
      el.innerHTML = `<h2>로비 · ${escape(code)}</h2>
        <p>${state.players.map((player) => escape(player.nickname)).join(" / ")}</p>
        <p>초대 링크: <a id="invite" href="${escape(location.pathname)}">${escape(location.href)}</a></p>
        ${state.seat === "A" && state.players.length === 2 ? '<button class="btn" id="startBtn">게임 시작</button>' : "<p>상대 대기 중…</p>"}`;
      document
        .getElementById("startBtn")
        ?.addEventListener("click", () => action("start", {}));
      return;
    }
    const key = `${state.gameId}:${view.roundNo}`;
    const current = view.current;
    if (selectionKey !== key || view.finished || current?.myNumber !== null) selected = null;
    selectionKey = key;
    if (selected !== null && !view.myRemaining.includes(selected)) selected = null;
    const rounds = view.sets.flatMap((set) => set.rounds);
    const outcome = (value) => value === "DRAW" ? ["draw", "무승부 DRAW"] : value === state.seat ? ["won", "승리 WIN"] : ["lost", "패배 LOSS"];
    const last = rounds.filter((round) => round.outcome !== null).at(-1);
    const result = last ? outcome(last.outcome) : null;
    const history = `<section class="history-section" aria-label="라운드 순서 경기장"><div class="tray-heading"><h2>라운드 경기장</h2><span>상대 홀짝 ↑ · 내 숫자 ↓</span></div><ol id="history">${Array.from({length: 9}, (_, i) => {
      const round = rounds.find((r) => r.roundNo === i + 1);
      const active = !view.finished && view.roundNo === i + 1;
      const own = round?.myNumber ?? (active ? current.myNumber ?? selected : null);
      const other = round?.opponentParity ?? (active ? current.opponentParity : null);
      const badge = round?.outcome != null ? outcome(round.outcome) : null;
      return `<li data-round="${i + 1}" class="history-cell ${active ? "active-round" : ""}" aria-label="${i + 1}라운드"><span class="round-label">R${i + 1}</span><div class="tile-slot opponent-slot"><span class="record-tile ${other ?? "empty"}"><span class="history-parity">${other ? (other === "odd" ? "홀" : "짝") : "?"}</span>${other ? "" : "<small>비공개</small>"}</span></div><span class="badge ${badge?.[0] ?? "pending"}"><i class="led" aria-hidden="true"></i>${badge ? badge[1].split(" ")[0] : active ? "진행" : "대기"}</span><div class="tile-slot own-slot"><span class="record-tile ${own != null ? (own % 2 ? "odd" : "even") : "empty"}"><strong class="history-number">${own ?? "?"}</strong><small>${own != null ? (round?.myNumber != null || current?.myNumber != null && active ? "✓ 제출" : "선택됨·<br>미제출") : "미제출"}</small></span></div></li>`;
    }).join("")}</ol><p class="legend">홀수 = 흰 타일 · 짝수 = 검은 타일 · 칸은 라운드 순서</p></section>`;
    const scores = `<div class="round-heading">ROUND <strong>${view.roundNo}</strong> / 9</div><div class="scores"><div>상대<strong>${view.opponentRoundWins}</strong></div><span>라운드 승수</span><div>나<strong>${view.myRoundWins}</strong></div></div>`;
    const lastResult = `<div id="lastResult" class="last-result ${result?.[0] ?? "pending"}" role="status" aria-live="polite">${result ? `직전 결과 · ${last.roundNo}라운드 · ${result[1]}` : "첫 라운드를 시작해 주세요"}</div>`;
    if (view.finished) {
      const match = view.winner === null ? ["draw", "무승부 DRAW"] : outcome(view.winner);
      el.innerHTML = `${scores}<section class="match-result ${match[0]}"><p>최종 결과</p><h1 id="result" role="status" aria-live="polite">${match[1]}</h1><p>9라운드 완료</p></section>${lastResult}<button class="btn confirm" id="rematchBtn" ${state.rematch.mine || busy ? "disabled" : ""}>${state.rematch.mine ? "재대결 동의 완료 · 상대 대기" : "재대결 동의"}</button>${history}`;
      document.getElementById("rematchBtn").onclick = () => action("rematch", { gameId: state.gameId });
      return;
    }
    const submitted = current.myNumber !== null;
    const waiting = !view.canSubmit && !submitted;
    const waitText = view.turnStatus === "MIGRATION_REQUIRED" ? "첫 제출 기록이 없어 운영자 확인이 필요합니다. 기록은 보존됩니다." : rounds.some((round) => round.outcome === "A" || round.outcome === "B") ? "직전 승자의 선제출을 기다리는 중입니다. 무승부는 이전 순서를 유지합니다." : "첫 라운드의 첫 제출자가 먼저 제출할 때까지 기다려 주세요.";
    el.innerHTML = `${scores}<section class="arena" aria-label="현재 라운드"><div class="opponent"><span class="player-label">상대</span><div id="opponentParity" class="arena-value">${parity(current.opponentParity)}</div><p>${current.opponentParity ? "✓ 제출 완료" : "숫자 선택 중 · 미제출"}</p></div><span class="versus">VS</span><div class="self"><span class="player-label">나</span><div class="arena-value own-value">${submitted ? current.myNumber : selected ?? "?"}</div><p>${submitted ? "✓ 제출 완료 · 상대 대기" : selected !== null ? "선택됨·미제출" : "숫자를 선택해 주세요"}</p></div></section>${lastResult}${waiting ? `<p id="turnWaiting" role="status">${waitText}</p>` : ""}<section class="selection"><h2>내 숫자 선택</h2><div class="number-grid">${Array.from({length:9},(_, i) => {
      const number = i + 1, used = !view.myRemaining.includes(number);
      return `<button class="n-btn ${number % 2 ? "odd" : "even"} ${selected === number ? "selected" : ""}" data-n="${number}" aria-pressed="${selected === number}" aria-label="${number}${used ? ' 사용 완료' : ' 선택'}" ${used || submitted || waiting || busy ? "disabled" : ""}><strong>${number}</strong><span>${used ? "사용 완료" : number % 2 ? "홀수" : "짝수"}</span></button>`;
    }).join("")}</div><button id="confirmBtn" class="btn confirm" ${selected === null || submitted || waiting || busy ? "disabled" : ""}>${waiting ? "선제출 대기 중" : busy ? "제출 중…" : submitted ? "제출 완료 · 상대 대기" : selected !== null ? `${selected} 제출 확정` : "숫자 선택 후 제출 확정"}</button></section>${history}<details class="help"><summary>선택 도움말 ?</summary><p>숫자를 고른 뒤 제출 확정을 누르세요. 확정 전에는 바꿀 수 있습니다. 사용한 숫자는 다시 선택할 수 없습니다.</p></details>`;
    el.querySelectorAll(".n-btn").forEach((button) => {
      button.onclick = () => {
        if (busy || submitted || waiting || !view.myRemaining.includes(Number(button.dataset.n))) return;
        selected = Number(button.dataset.n);
        render();
        el.querySelector(`[data-n="${selected}"]`)?.focus();
      };
    });
    const restoreFocus = focusNumber ? el.querySelector(`[data-n="${focusNumber}"]`) : focusId ? document.getElementById(focusId) : null;
    if (restoreFocus && !restoreFocus.disabled) restoreFocus.focus({ preventScroll: true });
    document.getElementById("confirmBtn").onclick = () => {
      if (selected === null || submitted || waiting || busy) return;
      action("submit", { gameId: state.gameId, setNo: String(view.setNo), roundNo: String(view.roundNo), requestId: crypto.randomUUID(), number: String(selected) });
    };
  }

  function connect() {
    if (expired) return;
    ws = new WebSocket(
      `${location.origin.replace(/^http/, "ws")}/duel/ws?roomCode=${encodeURIComponent(code)}`,
    );
    ws.onopen = sync;
    ws.onmessage = (event) => {
      try {
        if (JSON.parse(event.data).type === "game:state") sync();
      } catch {}
    };
    ws.onclose = () => {
      if (!expired) setTimeout(connect, 1500);
    };
    ws.onerror = () => ws.close();
  }
  connect();
  sync();
  setInterval(sync, 1500);
})();
