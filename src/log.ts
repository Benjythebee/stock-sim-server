/**
 * Minimal leveled logger. Hot paths must not log at info/debug unconditionally: console output
 * is synchronous and was the single biggest cost in the old server under load.
 *
 * LOG_LEVEL = debug | info | warn | error | silent (default: info, or warn under `bun test`).
 */
const LEVELS = { debug: 10, info: 20, warn: 30, error: 40, silent: 100 } as const;
type Level = keyof typeof LEVELS;

const envLevel = (process.env.LOG_LEVEL ?? (process.env.NODE_ENV === "test" ? "warn" : "info")) as Level;
let threshold: number = LEVELS[envLevel] ?? LEVELS.info;

export const log = {
    get debugEnabled() {
        return threshold <= LEVELS.debug;
    },
    setLevel(level: Level) {
        threshold = LEVELS[level];
    },
    debug(...args: unknown[]) {
        if (threshold <= LEVELS.debug) console.debug("[debug]", ...args);
    },
    info(...args: unknown[]) {
        if (threshold <= LEVELS.info) console.info("[info]", ...args);
    },
    warn(...args: unknown[]) {
        if (threshold <= LEVELS.warn) console.warn("[warn]", ...args);
    },
    error(...args: unknown[]) {
        if (threshold <= LEVELS.error) console.error("[error]", ...args);
    },
};
