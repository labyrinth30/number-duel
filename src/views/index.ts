// views — HTML template strings (Hono JSX 쓰지 않고 명시적 string의 형태)
// 모든 사용자 입력 값은 escapeHtml을 거침.

export function esc(s: string): string {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export const APP_NAME = "number-duel";

export function layout(title: string, body: string): string {
  return `<!doctype html><html lang="ko"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)} · ${APP_NAME}</title>
<link rel="stylesheet" href="/duel/static/css/style.css">

</head><body>${body}</body></html>`;
}

export function homeView(): string {
  return `<div class="wrap">
  <h1>NUMBER DUEL</h1>
  <p class="tag">1~9 숫자 심리전. 한 게임은 정확히 9라운드.</p>
  <form id="mkroom">
    <input name="nickname" id="nick" placeholder="닉네임 (1~16자)" maxlength="16" required >
    <button class="btn" type="submit">방 만들기</button>
  </form>
  <div id="lobbyOut" style="margin-top:1.4em;"></div>
  <details style="margin-top:2em;">
    <summary>규칙 ?</summary>
    <ul>
      <li>각 라운드: 남은 숫자 중 1개 하나만 제출</li>
      <li>큰 숫자 승리, 예외적으로 1은 9를 이김</li>
      <li>동일 숫자는 라운드 무승부. 숫자 1~9는 게임당 한 번씩 사용</li>
      <li>9라운드 후 라운드 승수가 높은 사람이 승리. 같으면 게임 무승부 (이 웹게임의 자체 정책)</li>
    </ul>
  </details>
  <script>
    document.getElementById('mkroom').addEventListener('submit', async (e) => {
      e.preventDefault();
      const nick = document.getElementById('nick').value.trim();
      if (!nick) return;
      const r = await fetch('/duel/api/rooms', { method: 'POST', body: new URLSearchParams({ nickname: nick }) });
      const j = await r.json();
      if (j.code) { window.location.href = '/duel/rooms/' + j.code; return; }
      else alert('오류: ' + (j.message || 'unknown'));
    });
  </script>
</div>`;
}

export function lobbyView(
  code: string,
  nicknames: string[],
  joinable: boolean,
  hostNick: string,
  guestNick: string | null,
  isHost: boolean,
): string {
  const list =
    `<li>A(호스트): ${esc(hostNick)}</li>` +
    (guestNick ? `<li>B: ${esc(guestNick)}</li>` : `<li>B: 대기 중...</li>`);
  const joinForm = joinable
    ? `
  <form id="joinForm">
    <input name="nickname" id="joinNick" placeholder="닉네임" maxlength="16" required >
    <button class="btn" type="submit">입장</button>
  </form>
  <script>
    document.getElementById('joinForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      const nick = document.getElementById('joinNick').value.trim();
      if (!nick) return;
      const r = await fetch('/duel/api/rooms/${esc(code)}/join', { method: 'POST', body: new URLSearchParams({ nickname: nick }) });
      const j = await r.json();
      if (j.seat) window.location.reload();
      else alert('오류: ' + (j.message || 'unknown'));
    });
  </script>`
    : "";
  const invite = guestNick
    ? `<p class="tag">초대 링크: <code>?room=${esc(code)}</code></p>`
    : "";
  const startBtn =
    isHost && guestNick
      ? `<button class="btn" id="startBtn" style="margin-top:1em;">게임 시작</button>
  <script>
    document.getElementById('startBtn').addEventListener('click', async () => {
      const r = await fetch('/duel/api/rooms/${esc(code)}/start', { method: 'POST' });
      const j = await r.json();
      if (j.gameId) window.location.reload();
      else alert('오류: ' + (j.message || 'unknown'));
    });
  </script>`
      : "";
  return `<div class="wrap">
  <h1>로비 · ${esc(code)}</h1>
  <ul>${list}</ul>
  ${invite}
  ${joinForm}
  ${startBtn}
  <a class="btn" href="/duel/rooms/${esc(code)}" style="margin-top:1.2em;display:block;">새로고침</a>
</div>`;
}

export function gameView(code: string, nicknames: string[]): string {
  return `<main id="app" class="wrap board">
  <header class="topbar"><a href="/duel/" class="brand">NUMBER DUEL</a><details id="rules"><summary>규칙 ?</summary><div class="rules-content"><strong>9개의 숫자, 9라운드</strong><p>1~9를 한 번씩 사용합니다. 큰 숫자가 승리하지만 1은 9를 이깁니다. 같은 숫자는 무승부입니다.</p><p>상대 숫자는 비공개이며 홀짝만 공개됩니다. 9라운드 승수가 같으면 게임 무승부. 재대결은 두 사람 모두 동의해야 합니다.</p></div></details></header>
  <span id="statusLine" class="connection" role="status"></span>
  <div id="game"></div>
  <script src="/duel/static/js/game.js"></script>
</main>`;
}

export function resultView(code: string): string {
  return `<div class="wrap"><h1>게임 끝</h1><a class="btn" href="/duel/">처음으로</a></div>`;
}

export function errorView(msg: string): string {
  return `<div class="wrap"><h1>오류</h1><p>${esc(msg)}</p><a class="btn" href="/duel/">처음으로</a></div>`;
}
