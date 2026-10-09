(() => {
  const code = location.pathname.split("/").filter(Boolean).at(-1);
  const base = "/duel";
  const el = document.getElementById("game");
  let state,
    ws,
    busy = false,
    expired = false;
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
      ? `<span class="parity ${value}">${value === "odd" ? "홀수 ODD · 파랑" : "짝수 EVEN · 노랑"}</span>`
      : "미제출";

  async function action(path, body) {
    if (busy || expired) return;
    busy = true;
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
    }
  }

  async function sync() {
    if (expired) return;
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
      state = await response.json();
      render();
    } catch {
      document.getElementById("statusLine").textContent = "재연결 중…";
    }
  }

  function render() {
    const view = state.view;
    document.getElementById("statusLine").textContent =
      ws?.readyState === 1 ? "실시간 연결" : "HTTP 동기화";
    if (!view) {
      el.innerHTML = `<h2>로비 · ${escape(code)}</h2>
        <p>${state.players.map((player) => escape(player.nickname)).join(" / ")}</p>
        <p>초대 링크: <a id="invite" href="${escape(location.pathname)}">${escape(location.href)}</a></p>
        ${state.seat === "A" && state.players.length === 2 ? '<button id="startBtn">게임 시작</button>' : "<p>상대 대기 중…</p>"}`;
      document
        .getElementById("startBtn")
        ?.addEventListener("click", () => action("start", {}));
      return;
    }
    document.getElementById("sidebar").textContent =
      `라운드 승수 · 나 ${view.myRoundWins} : 상대 ${view.opponentRoundWins} · ${view.roundNo}/9 라운드`;
    const remaining = `<p id="remaining">남은 숫자: ${view.myRemaining.join(", ") || "없음"}</p>`;
    const history = `<ol id="history">${view.sets
      .flatMap((set) => set.rounds)
      .map(
        (round) =>
          `<li>${round.roundNo}라운드 · 내 숫자 ${round.myNumber ?? "미제출"} · 상대 ${parity(round.opponentParity)} · ${round.outcome === null ? "진행 중" : round.outcome === "DRAW" ? "무승부" : round.outcome === state.seat ? "승리" : "패배"}</li>`,
      )
      .join("")}</ol>`;
    if (view.finished) {
      el.innerHTML = `<h2 id="result">${view.winner === null ? "무승부 DRAW" : view.winner === state.seat ? "🎉 승리" : "😢 패배"}</h2>
        <p>라운드 승수 ${view.myRoundWins} : ${view.opponentRoundWins}</p>${remaining}
        <button id="rematchBtn" ${state.rematch.mine ? "disabled" : ""}>${state.rematch.mine ? "재대결 동의 · 상대 대기" : "재대결"}</button>${history}`;
      document.getElementById("rematchBtn").onclick = () =>
        action("rematch", { gameId: state.gameId });
      return;
    }
    const current = view.current;
    el.innerHTML = `<h2>숫자 하나 골라 제출</h2>${remaining}
      ${
        current.myNumber !== null
          ? `<p>제출했어 (${current.myNumber}). 상대 대기 중...</p>`
          : view.myRemaining
              .map(
                (number) =>
                  `<button class="n-btn ${number % 2 ? "odd" : "even"}" data-n="${number}">${number} · ${number % 2 ? "홀수 ODD" : "짝수 EVEN"}</button>`,
              )
              .join("")
      }
      <p id="opponentParity">상대: ${parity(current.opponentParity)}</p>${history}`;
    el.querySelectorAll(".n-btn").forEach((button) => {
      button.onclick = () =>
        action("submit", {
          gameId: state.gameId,
          setNo: String(view.setNo),
          roundNo: String(view.roundNo),
          requestId: crypto.randomUUID(),
          number: button.dataset.n,
        });
    });
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
