// views — Hono JSX 서버렌더. layout 및 페이지 컴포넌트.
// HTML escape는 Hono JSX가 자동 처리.
export const title = "number-duel";

export function layout(t: string, body: unknown) {
  return (
    <html lang="ko">
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>{t} · {title}</title>
        <link rel="stylesheet" href="static/css/style.css" />
        <script src="https://unpkg.com/htmx.org@2"></script>
      </head>
      <body>{body}</body>
    </html>
  );
}

export function homeView() {
  return (
    <div class="wrap">
      <h1>number-duel</h1>
      <p class="tag">1~9 숫자 심리전. 9라운드, 2세트 선승.</p>
      <form hx-post="/api/rooms" hx-target="#lobbyOut">
        <input name="nickname" placeholder="닉네임" maxlength="16" required />
        <button type="submit">방 만들기</button>
      </form>
      <div id="lobbyOut"></div>
      <details>
        <summary>규칙</summary>
        <ul>
          <li>각 라운드: 남은 숫자 중 1개 비공개 제출</li>
          <li>큰 숫자 승리, 단 1은 9를 이김</li>
          <li>같은 숫자 무승부, 총 9라운드 = 1세트</li>
          <li>먼저 2세트 선승 시 게임 종료</li>
        </ul>
      </details>
    </div>
  );
}

export function lobbyView(props: { code: string; nicknames: string[] }) {
  return (
    <div class="wrap">
      <h1>로비 · {props.code}</h1>
      <p class="tag">초대 링크: <code>/rooms/{props.code}</code></p>
      <ul>
        {props.nicknames.map((n, i) => <li>{i === 0 ? "A" : "B"}: {n || "대기 중..."}</li>)}
      </ul>
      <a class="btn" href={`/rooms/${props.code}`}>새로고침</a>
    </div>
  );
}

export function gameView(props: { code: string; nicknames: string[] }) {
  return (
    <div id="app">
      <div class="topbar"><span id="ageNow">로딩 중...</span></div>
      <div class="panels">
        <div class="sideL"></div>
        <div class="mainR"><div id="game"></div></div>
      </div>
      <script src="static/js/game.js"></script>
    </div>
  );
}

export function resultView(_props: unknown) {
  return <div class="wrap"><h1>게임 끝</h1><a class="btn" href="/">처음으로</a></div>;
}

export function errorView(msg: string) {
  return <div class="wrap"><h1>오류</h1><p>{msg}</p><a class="btn" href="/">처음으로</a></div>;
}
