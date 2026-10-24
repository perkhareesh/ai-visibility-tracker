type Level = "debug" | "info" | "warn" | "error";

/** Structured JSON logs. Never pass secrets or full AI payloads here. */
export function log(level: Level, msg: string, fields: Record<string, unknown> = {}) {
  if (process.env.NODE_ENV === "test" && level !== "error" && !process.env.LOG_IN_TESTS) return;
  const line = JSON.stringify({ ts: new Date().toISOString(), level, msg, ...fields });
  if (level === "error" || level === "warn") console.error(line);
  else console.log(line);
}
