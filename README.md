# number-duel

1:1 숫자 심리전 웹게임 (1~9, 9라운드, 2세트 선승). 자세한 규칙은 [RULES.md](RULES.md).

## 실행 (개발)

```sh
bun install
bun src/index.ts       # PORT=3130, BIND_HOST=127.0.0.1, DB_PATH 데이터 경로
bun test               # 테스트 (27개)
```

## 구조

```
src/
  app.ts                 # Hono 앱 (REST + WS route view mount)
  index.ts               # Bun.serve (WS websocket handler)
  config/env.ts          # 환경변수
  db/
    client.ts            # SQLite open + WAL + schema
    repositories/        # Room / Game repo
  domain/game/
    engine.ts            # 순수 게임 로직 (DB/HTTP/WS 미의존)
  views/index.tsx        # Hono JSX 서버렌더
  utils/errors.ts        # ApiError + 에러코드
  ws/gateway.ts          # WS registry (room → sockets)
public/
  css/style.css
  js/game.js             # 클라이언트 (WS 구독 + state render)
deploy/
  number-duel.service    # systemd 유닛
  nginx-duel.conf        # nginx 서브패스 /duel/ 예시
data/
  game.sqlite            # DB (배포 시 절대경로 권장)
tests/
  unit/                  # 엔진 로직
  integration/           # DB/트랜잭션/정원
  e2e/                   # WebSocket 전체 흐름 (실측)
```

## API

- `POST /api/rooms` — 방 생성 (닉네임)
- `POST /api/rooms/:code/join` — 게스트 입장 (B 좌석)
- `GET  /api/rooms/:code/state` — 플레이어 관점 상태
- `POST /api/rooms/:code/start` — 호스트 게임 시작
- `GET  /ws?roomCode=<code>&token=<token>` — WebSocket upgrade

## WebSocket 메시지
- 클라 → 서버: `game:submit`, `game:sync`, `ping`
- 서버 → 클라: `game:state` (stateVersion), `game:error`, `pong`

## 배포 (lokal 검증 후 실제 재시작은 유저 승인 요망)

1. 백업: `sudo cp /etc/nginx/sites-available/apple-game /etc/nginx/sites-available/apple-game.bak.$(date +%s)`
2. depoly/nginx-duel.conf 블록을 /etc/nginx/sites-available/apple-game의 server{}에 추가
3. `sudo nginx -t && sudo systemctl reload nginx`
4. systemd: `sudo cp deploy/number-duel.service /etc/systemd/system/ && sudo systemctl daemon-reload && sudo systemctl enable --now number-duel`
5. 롤백: 백업 restores + `sudo systemctl disable --now number-duel`

## 백업

```sh
# SQLite는 WAL 모드라 안전한 파일 복사:
sqlite3 /home/ubuntu/number-duel/data/game.sqlite ".backup /tmp/game-backup.sqlite"
```

## 남은 이슈

- game.js의 rematch endpoint는 부분 구현 (server side는 아직 미완성)
- /duel/ws 경로의 실제 origin 검증에 Origin header 체크는 gateway.authenticate 후에 별도 verify 필요 (Phase 5에서 아직 부분)
- 방 만료 cleanup job (24h) 미구현
