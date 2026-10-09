// websocket-gateway — Bun.serve upgrade 기반 (Hono가 아닌 Bun 레이어)
// WS 인증 방식: 쿠키의 방별 토큰과 roomCode 매칭 → 연결 승인
export interface WsRegistry {
  track(roomId: string, ws: unknown): void;
  untrack(roomId: string, ws: unknown): void;
  broadcast(roomId: string, msg: unknown): void;
}
