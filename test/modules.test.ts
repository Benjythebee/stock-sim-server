import { afterAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { discoverModules, loadModules } from "../src/modules";

const root = mkdtempSync(join(tmpdir(), "mods-"));
afterAll(() => rmSync(root, { recursive: true, force: true }));

function layout() {
    const dir = mkdtempSync(join(root, "case-"));
    writeFileSync(join(dir, "b-single.ts"), "export default 'single';");
    mkdirSync(join(dir, "a-folder"));
    writeFileSync(join(dir, "a-folder", "index.ts"), "export default 'folder';");
    writeFileSync(join(dir, "a-folder", "icon.svg"), "<svg/>");
    mkdirSync(join(dir, "no-index"));
    writeFileSync(join(dir, "no-index", "helper.ts"), "export default 'nope';");
    mkdirSync(join(dir, "_disabled"));
    writeFileSync(join(dir, "_disabled", "index.ts"), "export default 'nope';");
    writeFileSync(join(dir, "_private.ts"), "export default 'nope';");
    writeFileSync(join(dir, "x.test.ts"), "export default 'nope';");
    writeFileSync(join(dir, "notes.md"), "# not a module");
    return dir;
}

describe("module discovery", () => {
    test("finds single files and folder mods with an index, sorted, skipping _/test/non-code", () => {
        const dir = layout();
        const found = discoverModules(dir);
        expect(found.map((m) => [m.name, m.isFolder])).toEqual([
            ["a-folder", true],
            ["b-single.ts", false],
        ]);
        expect(found[0]!.dir).toBe(join(dir, "a-folder"));
        expect(found[0]!.path).toBe(join(dir, "a-folder", "index.ts"));
        expect(found[1]!.dir).toBe(dir);
    });

    test("a missing directory is just empty", () => {
        expect(discoverModules(join(root, "does-not-exist"))).toEqual([]);
    });

    test("loadModules passes each default export with its source", async () => {
        const dir = layout();
        const loaded = await loadModules(dir, (value, source) => `${source.name}=${value}`);
        expect(loaded).toEqual(["a-folder=folder", "b-single.ts=single"]);
    });
});
