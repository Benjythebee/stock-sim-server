import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import pkg from "../package.json";

/**
 * The mod API version: what mods can rely on, server-side (the power/bot/news APIs) and client-side
 * (the presentations the UI can play). Bump it whenever mods gain something new, and record it
 * below. Mods declare the version they need with `apiVersion`; the UI shows which version it
 * supports and warns when the server's is newer.
 *
 *   1  powers, bots and news as of the v2 rewrite
 *   2  ctx.present(): the "wheel" presentation (POWER_PRESENT)
 *   3  definePower `available(game)`; bank loans through ctx.game.bank (borrow at a custom rate, forgiveInterest)
 */
export const MOD_API_VERSION = 3;

/** The server's own version (package.json). */
export const SERVER_VERSION: string = pkg.version;

/**
 * The deployed commit: the REVISION file deploy/deploy.sh writes into each release, else the
 * local git HEAD, else "dev".
 */
export const SERVER_REVISION: string = readRevision();

function readRevision(): string {
    const root = join(import.meta.dir, "..");
    const file = join(root, "REVISION");
    if (existsSync(file)) return readFileSync(file, "utf8").trim() || "dev";
    try {
        const git = Bun.spawnSync(["git", "rev-parse", "--short", "HEAD"], { cwd: root, stderr: "ignore" });
        const sha = git.stdout.toString().trim();
        if (git.exitCode === 0 && sha) return sha;
    } catch {
        // no git: fall through
    }
    return "dev";
}

/** Body of GET /api/version.json. */
export const versionInfo = () => ({ version: SERVER_VERSION, revision: SERVER_REVISION, modApi: MOD_API_VERSION });
