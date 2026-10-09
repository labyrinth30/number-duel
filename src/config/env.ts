// DB path/env 설정
export const config = {
  dbPath: process.env.DB_PATH ?? "./data/game.sqlite",
  dbPathAbsolute: () => (process.env.DB_PATH ?? "./data/game.sqlite").startsWith("/") ? (process.env.DB_PATH ?? "./data/game.sqlite") : require("path").join(process.cwd(), process.env.DB_PATH ?? "./data/game.sqlite"),
  port: Number(process.env.PORT ?? 3130),
  bindHost: process.env.BIND_HOST ?? "127.0.0.1",
};
