/**
 * Leveled logger. Everything is prefixed with [sshxl-aa] for console
 * filtering. Debug-level logs are always written — userscript consoles are
 * cheap and this project's debugging happens in the field.
 */

type Level = "debug" | "info" | "warn" | "error";

const PREFIX = "[sshxl-aa]";
const order: Record<Level, number> = { debug: 0, info: 1, warn: 2, error: 3 };

let minLevel: Level = "debug";

export function setLogLevel(level: Level): void {
  minLevel = level;
}

function emit(level: Level, message: string, ...details: unknown[]): void {
  if (order[level] < order[minLevel]) return;
  const line = `${PREFIX} ${message}`;
  if (level === "error") console.error(line, ...details);
  else if (level === "warn") console.warn(line, ...details);
  else if (level === "info") console.info(line, ...details);
  else console.debug(line, ...details);
}

export const log = {
  debug: (message: string, ...details: unknown[]): void => emit("debug", message, ...details),
  info: (message: string, ...details: unknown[]): void => emit("info", message, ...details),
  warn: (message: string, ...details: unknown[]): void => emit("warn", message, ...details),
  error: (message: string, ...details: unknown[]): void => emit("error", message, ...details),
};
