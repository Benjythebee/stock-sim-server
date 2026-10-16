import { existsSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

/** Where a loaded module came from. `dir` is the base for the mod's own files (e.g. its icon). */
export interface ModuleSource {
    /** Absolute path of the module file. */
    path: string;
    /** The mod's folder: the folder itself for folder mods, the containing directory for single files. */
    dir: string;
    /** File or folder name, for error messages. */
    name: string;
    /** True for `<name>/index.ts` folder mods. */
    isFolder: boolean;
}

const MODULE_FILE = /\.(ts|js)$/;
const skip = (name: string) => name.startsWith("_") || name.startsWith(".") || name.includes(".test.") || name.endsWith(".d.ts");

/** Find the mods in `dir`: `<name>.ts` files and `<name>/index.ts` folders, sorted by name. */
export function discoverModules(dir: string): ModuleSource[] {
    if (!existsSync(dir)) return [];
    const found: ModuleSource[] = [];
    for (const name of readdirSync(dir).sort()) {
        if (skip(name)) continue;
        const full = join(dir, name);
        if (statSync(full).isDirectory()) {
            const index = ["index.ts", "index.js"].map((f) => join(full, f)).find(existsSync);
            if (index) found.push({ path: index, dir: full, name, isFolder: true });
        } else if (MODULE_FILE.test(name)) {
            found.push({ path: full, dir, name, isFolder: false });
        }
    }
    return found;
}

/**
 * Load every mod in `dir` (non-recursive) and validate its default export.
 *
 * A mod is either a single file (`volatility-storm.ts`) or a folder with an `index.ts`
 * (`siphon/index.ts` + `siphon/icon.svg` + ...), so a mod can ship its own assets.
 * Names starting with `_` or `.`, and `*.test.*` files, are skipped. A missing `dir` is fine.
 *
 * This is how powers and bots become drop-in "mods": add a file or folder, restart, done.
 */
export async function loadModules<T>(dir: string, accept: (value: unknown, source: ModuleSource) => T): Promise<T[]> {
    const out: T[] = [];
    for (const source of discoverModules(dir)) {
        const mod = await import(source.path);
        out.push(accept(mod.default, source));
    }
    return out;
}
