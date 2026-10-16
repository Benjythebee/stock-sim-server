import { Glob } from "bun";
import { basename, join } from "node:path";

/**
 * Load every `*.ts` / `*.js` module in `dir` (non-recursive, sorted by file name for determinism)
 * and validate its default export. Files starting with `_` and `*.test.*` files are skipped.
 *
 * This is how powers and bots become drop-in "mods": add a file to the folder, restart, done.
 */
export async function loadModules<T>(dir: string, accept: (value: unknown, file: string) => T): Promise<T[]> {
    const glob = new Glob("*.{ts,js}");
    const files: string[] = [];
    for await (const file of glob.scan({ cwd: dir, onlyFiles: true })) {
        const name = basename(file);
        if (name.startsWith("_") || name.includes(".test.") || name.endsWith(".d.ts")) continue;
        files.push(file);
    }
    files.sort();
    const out: T[] = [];
    for (const file of files) {
        const mod = await import(join(dir, file));
        out.push(accept(mod.default, file));
    }
    return out;
}
