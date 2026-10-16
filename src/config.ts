import { join } from "node:path";

/** Community / custom content lives here (repo root `mods/`), separate from the built-ins in src/. */
export const MODS_DIR = join(import.meta.dir, "..", "mods");
export const DEFAULT_MOD_DIRS = {
    powerModDirs: [join(MODS_DIR, "powers")],
    botModDirs: [join(MODS_DIR, "bots")],
};

const int = (name: string, fallback: number) => {
    const v = Number(process.env[name]);
    return Number.isFinite(v) && process.env[name] !== "" ? v : fallback;
};

export interface ServerConfig {
    port: number;
    hostname: string;
    /** Access-Control-Allow-Origin for the JSON API. */
    corsOrigin: string;
    /** How long a disconnected player keeps their seat. */
    reconnectGraceMs: number;
    /** Orders per second per player (sustained) and burst size. */
    orderRate: number;
    orderBurst: number;
    /** Max delay between a player's order and the resulting price/depth broadcast. */
    flushMs: number;
    /** Directories of power / bot mods loaded on top of the built-ins: `mods/` plus POWER_MODS_DIR / BOT_MODS_DIR. */
    powerModDirs: string[];
    botModDirs: string[];
}

const dirs = (v: string | undefined) => (v ? v.split(/[;,]/).map((s) => s.trim()).filter(Boolean) : []);

export function loadConfig(): ServerConfig {
    return {
        port: int("PORT", 3000),
        hostname: process.env.HOST ?? "localhost",
        corsOrigin: process.env.CORS_ORIGIN ?? "*",
        reconnectGraceMs: int("RECONNECT_GRACE_MS", 60_000),
        orderRate: int("ORDER_RATE", 20),
        orderBurst: int("ORDER_BURST", 40),
        flushMs: int("FLUSH_MS", 50),
        powerModDirs: [...DEFAULT_MOD_DIRS.powerModDirs, ...dirs(process.env.POWER_MODS_DIR)],
        botModDirs: [...DEFAULT_MOD_DIRS.botModDirs, ...dirs(process.env.BOT_MODS_DIR)],
    };
}
