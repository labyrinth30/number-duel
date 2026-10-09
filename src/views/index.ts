// views — HTML template strings (Hono JSX 쓰지 않고 명시적 string의 형태)
// 모든 사용자 입력 값은 escapeHtml을 거침.

export function esc(s: string): string {
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

export const APP_NAME = "number-duel";

export function layout(title: string, body: string): string {
  return `<!doctype html><html lang="ko"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)} · ${APP_NAME}</title>
<link rel="stylesheet" href="/duel/static/css/style.css">
<script src="https://unpkg.com/htmx.org@2"></script>
</head><body>${body}</body></html>`;
}

export function homeView(): string {
  return `<div class="wrap">
  <h1>🎯 ${APP_NAME}</h1>
  <p class="tag">1~9 숫자 심리전. 총 9라운드, 2세트 선승.</p>
  <form id="mkroom">
    <input name="nickname" id="nick" placeholder="닉네임 (1~16자)" maxlength="16" required style="width:60%;padding:10px;border-radius:10px;border:1px solid #2a2d35;background:#17191f;color:#e8e6e0;">
    <button class="btn" type="submit">방 만들기</button>
  </form>
  <div id="lobbyOut" style="margin-top:1.4em;"></div>
  <details style="margin-top:2em;">
    <summary>규칙</summary>
    <ul>
      <li>각 라운드: 남은 숫자 중 1개 하나만 제출</li>
      <li>큰 숫자 승리, 예외적으로 1은 9를 이김</li>
      <li>동일 숫자는 무승부, 9라운드 = 1세트</li>
      <li>먼저 2세트 선승 시 게임 종료</li>
    </ul>
  </details>
  <script>
    document.getElementById('mkroom').addEventListener('submit', async (e) => {
      e.preventDefault();
      const nick = document.getElementById('nick').value.trim();
      if (!nick) return;
      const r = await fetch('/api/rooms', { method: 'POST', body: new URLSearchParams({ nickname: nick }) });
      const j = await r.json();
      if (j.code) window.location.href = '/rooms/' + j.code;
      else alert('오류: ' + (j.message || 'unknown'));
    });
  </script>
</div>`;
}

export function lobbyView(code: string, nicknames: string[]): string {
  const list = nicknames.map((n, i) => `<li>${i === 0 ? "A(호스트)" : "B"}: ${esc(n)}</li>`).join("");
  return `<div class="wrap">
  <h1>로비 · ${esc(code)}</h1>
  <p class="tag">초대 링크: <code>share=/rooms/${esc(code)}</code></p>
  <ul>${list}</ul>
  <a class="btn" href="/rooms/${esc(code)}">새로고침</a>
</div>`;
}

export function gameView(code: string, nicknames: string[]): string {
  return `<div id="app" class="wrap">
  <div class="topbar"><span class="ageBig" id="statusLine"></span></div>
  <div class="panels">
    <div class="sideL" id="sidebar"></div>
    <div class="mainR"><div id="game"></div></div>
  </div>
  <script src="/duel/static/js/game.js"></script>
</div>`;
}

export function resultView(code: string): string {
  return `<div class="wrap"><h1>게임 끝</h1><a class="btn" href="/duel/">처음으로</a></div>`;
}

export function errorView(msg: string): string {
  return `<div class="wrap"><h1>오류</h1><p>${esc(msg)}</p><a class="btn" href="/duel/">처음으로</a></div>`;
}
