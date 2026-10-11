# number-duel

2인 초대 대결 게임: 정확히 9라운드, 각 매치마다 1~9 타일을 한 번씩만 사용. 패 배의 큰 숫자가 이기되 1은 9를 이기며, 같은 숫자는 무승부. 9라운드 종료 후 라운드 승수로 승부를 판정하고, 승수가 같으면 무승부(이 웹게임의 자체 정책이며 공식 규칙이 아님). 재대결에는 양쪽 동의가 필요하다. 상대의 정확한 숫자는 노출되지 않고, 제출 즉시 상대의 홀/짝이 공개되어 라운드 기록에 유지된다. 내 타일, 남은 숫자, 라운드 점수가 표시된다. 홀수는 흰색, 짝수는 검정 타일에 각각 라벨이 붙는다.

`/home/ubuntu/.bun/bin/bun`을 사용한다. 개발 기본값은 loopback 포트 3130; 테스트 시에는 격리된 DB와 `PORT=0`을 쓴다. 브라우저 경로는 `/duel/`이며 서버는 nginx가 prefix를 제거한 경로도 모두 받는다.

```sh
/home/ubuntu/.bun/bin/bun run typecheck
/home/ubuntu/.bun/bin/bun test
/home/ubuntu/.bun/bin/bun run build
```

## 테스트

테스트는 임시 또는 인메모리 SQLite DB를 사용한다. 브라우저 E2E는 스스로 loopback 서버를 띄워(OS가 포트 선택) 실제 Chromium으로 두 개의 분리된 컨텍스트로 9라운드 승부와 9라운드 무승부, 양쪽 결과와 동의-재대결을 검증한다. 부분 라운드 도중 같은 디스크 DB와 브라우저 세션을 대상으로 테스트 서버를 stop/restart해 제출 상태와 홀짝 복구를 증명한다. Chromium이 없으면 `bun x playwright install chromium`로 설치. 테스트는 실제 서버나 프로덕션 DB를 쓰지 않는다.

## HTTP/API

엔드포인트: 방 생성 `/api/rooms`, 그 외 join/start/state/submit/rematch는 `/api/rooms/:code/` 하위. submit은 `gameId`, `setNo`, `roundNo`, `requestId`, `number`를 요구한다. rematch는 종료된 `gameId`와 양측 동의가 필요. `/ws?roomCode=...`는 HttpOnly 쿠키로 인증되며, WS 제출도 동일한 신원 필드를 쓴다. URL이나 DTO에 세션 토큰이 노출되지 않는다. WS는 상태 무효화 신호만 보내고 클라이언트는 각자의 private view를 fetch하며, HTTP 폴링이 폴백/복구 경로다.

프로덕션 쿠키는 HttpOnly, Secure, SameSite=Lax, Path=/duel/를 쓴다. SHA256 토큰 해시만 저장된다. `NODE_ENV=production`와 `PUBLIC_ORIGIN=https://labyrinth30.duckdns.org`를 설정하고, 미설정 시 Origin은 요청 host/프로토콜(nginx HTTPS forwarded 포함)으로 검증한다. 서버는 loopback에만 바인딩. 레거시 쿠키 이름은 방 멤버십 토큰 해시 검증을 통과하면 계속 수용하며, 새 쿠키는 전체 방 ID를 쓴다.

## 배포

배포는 부모 검토 후 진행한다. diff와 테스트 근거 리뷰, 출시 직전 일관성 있는 SQLite 백업 후 **number-duel 서비스만** 기존 설정과 설치된 Bun으로 재시작. nginx/systemd 변경이나 타 서비스 재시작 금지. 기존 nginx `/duel/` prefix stripping을 지원한다. 배포 후 공 HTTPS 쿠키 속성, WS 업그레이드, 2브라우저 실게임을 확인할 것. 라이브 HTTPS/프록시 동작은 격리 테스트에서 검증되지 않았다.

## 레거시 호환

레거시 1세트 게임은 내부 set 하나를 유지하고 `setNo=1`로 제출; 유저 점수는 라운드 승수. 미완료 멀티셋 스냅샷이나 내부 set이 이미 끝났으나 매치가 안 끝난 스냅샷은 `LEGACY_GAME_INCOMPATIBLE`을 반환하고 소유자 검토용으로 보존된다. 자동 리셋/변환은 없음.

제출 순서: 라운드 1은 자유 선출이며, 서버가 먼저 받은 제출이 `initialFirstSubmitter`(스냅샷 + SQLite `game_state.initial_first_submitter` 컬럼)에 원자적으로 기록된다. 라운드 2부터는 가장 최근의 무승부가 아닌 승자가 선출하고, 무승부가 몇 라운드가 이어져도 그 승자가 유지되며, 해소된 라운드가 전부 무승부면 최초 선출자가 나간다. 상대는 그 필수 선제출이 받아들여질 때까지 대기 후 홀짝을 보고 제출 가능. 중복 request-ID 재시도는 턴 체크 전에 성공하고, 오래된 신규 요청은 상태 변경 없이 실패. 양측 동의 재대결 시 이 필드가 리셋되고 라운드 1이 자유화된다.

레거시 1세트 게임의 순서는 정확한 기록 승자에서 도출하며, 빈 게임은 첫 수락이 자연 기록된다. 저장된 선출자 없는 무부 기록 전용 레거시 히스토리는 `LEGACY_SUBMISSION_ORDER_UNKNOWN` / `MIGRATION_REQUIRED`로 차단하고 순서나 기록을 추측하지 않는다.

## AI 대결 (고급만)

로비의 **AI 대결 · 고급**은 하나의 난이도(고급)만 제공. 서버 봇이 공개된 홀짝의 빈도/조건부 패턴을 학습하되 정확한 상대 숫자는 보지 않는다. 첫 라운드는 사람 선제출, 이후 일반 승자 선출 규칙을 따른다. 서버의 경량 백그라운드 작업은 저장된 시드와 800~1500ms 제출 딜레이를 사용해 재시작 후에도 미완료 턴을 이어간다. `ai_rooms`, `ai_games`는 기존 플레이어 스키마를 변경하지 않는 추가 테이블이다. 시드와 제출 기한은 API에 노출되지 않는다. 재대결은 사람이 요청하면 봇이 별도로 동의를 기록한다. 게임 내 접힌 규칙 도움말에 AI 설명이 있다.

AI 검증: `bun test tests/unit/ai.test.ts tests/integration/ai.test.ts tests/e2e/ai.test.ts`. 모든 서버 테스트는 임시 DB와 로컬 임시 포트를 사용하며, 검토 스크린샷은 `backups/ai-review/`에 있다.
