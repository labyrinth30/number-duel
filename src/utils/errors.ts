// utils/errors.ts — ApiError/err(), 토큰 해시, 초대 코드, ID 헬퍼
import { createHash, randomBytes, randomUUID } from "crypto";

export class ApiError extends Error {
  status: number; code: string;
  constructor(status: number, code: string, message: string) {
    super(`${code}: ${message}`);
    this.status = status; this.code = code;
  }
}

const E = {
  BAD_NICKNAME:      [400, "BAD_NICKNAME", "닉네임은 1~16자 문자열이어야 함"],
  ROOM_NOT_FOUND:    [404, "ROOM_NOT_FOUND", "방을 찾을 수 없음"],
  ROOM_FULL:         [409, "ROOM_FULL", "방이 가득 참"],
  UNAUTHORIZED:      [401, "UNAUTHORIZED", "인증 실패"],
  FORBIDDEN:         [403, "FORBIDDEN", "권한 없음"],
  GAME_FINISHED:     [400, "GAME_FINISHED", "게임 종료"],
  ALREADY_SUBMITTED: [409, "ALREADY_SUBMITTED", "이미 제출함"],
  NUMBER_USED:       [400, "NUMBER_USED", "사용한 숫자"],
  OUT_OF_RANGE:      [400, "OUT_OF_RANGE", "1~9 범위"],
  NOT_HOST:          [403, "NOT_HOST", "호스트가 아님"],
  ROOM_NOT_READY:    [400, "ROOM_NOT_READY", "두 플레이어 모두 입장해야 함"],
  WS_BAD_ORIGIN:     [403, "WS_BAD_ORIGIN", "Origin 검증 실패"],
  WS_INVALID_SESSION:[401, "WS_INVALID_SESSION", "WS 세션 인증 실패"],
} as const satisfies Record<string, [number, string, string]>;

export function err(key: keyof typeof E, overrideMsg?: string): ApiError {
  const [status, code, msg] = E[key];
  return new ApiError(status, code, overrideMsg ?? msg);
}

export function hashToken(token: string): string { return createHash("sha256").update(token).digest("hex"); }
export const newSessionToken = (): string => randomBytes(32).toString("base64url");

const CODE_ALPHA = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
export const newRoomId = (): string => randomUUID();
export const newGameId = (): string => randomUUID();
export const newRoundId = (): string => randomUUID();
export const newPlayerId = (): string => randomUUID();
export function newInviteCode(len = 6): string {
  const bytes = randomBytes(len);
  let out = "";
  for (let i = 0; i < len; i++) out += CODE_ALPHA[bytes[i] % CODE_ALPHA.length];
  return out;
}
