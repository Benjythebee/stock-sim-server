import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadPowerRegistry, powerProblems, PowerRegistry, toPublicPower } from "../../src/powers/registry";
import { definePower } from "../../src/powers/types";
import { builtinCatalog } from "../helpers";

const valid = definePower({ id: "test-power", title: "T", description: "D", weight: 1, onActivate() {} });

describe("power registry", () => {
    test("every built-in power is valid and has a unique id", () => {
        const all = builtinCatalog.powers.all();
        expect(all.length).toBeGreaterThanOrEqual(6);
        for (const def of all) expect(powerProblems(def)).toEqual([]);
        expect(new Set(all.map((d) => d.id)).size).toBe(all.length);
    });

    test("validation catches common mistakes", () => {
        expect(powerProblems({ ...valid, id: "Bad Id" })).toContain("id must be kebab-case");
        expect(powerProblems({ ...valid, weight: -1 })).toContain("weight must be a number >= 0");
        expect(powerProblems({ ...valid, onExpire() {} })).toContain("onTick/onExpire never run when durationSeconds is 0");
        expect(powerProblems({ ...valid, durationSeconds: 1.5 })).toContain("durationSeconds must be an integer >= 0");
        expect(powerProblems({ ...valid, onActivate: undefined })).toContain("a power needs at least one hook");
        expect(powerProblems({ ...valid, type: "everyone" as never })).toHaveLength(1);
        expect(() => new PowerRegistry([valid, valid])).toThrow(/duplicate/);
    });

    test("public format matches what the UI expects", () => {
        const pub = toPublicPower(
            definePower({
                id: "x",
                title: ({ ticker }) => `Pump $${ticker}`,
                description: "d",
                weight: 3,
                instant: true,
                icon: "present",
                type: "client",
                onActivate() {},
            }),
            "TSLA",
        );
        expect(pub).toEqual({
            id: "x",
            title: "Pump $TSLA",
            description: "d",
            type: "client",
            iconSlug: "present",
            isInstant: true,
            rarity: 3,
            price: undefined,
            durationTicks: 0,
        });
        expect(toPublicPower(valid, "X")).toMatchObject({ type: "market", iconSlug: "default", isInstant: false });
    });

    test("offerable() excludes weight 0", () => {
        const reg = new PowerRegistry([valid, { ...valid, id: "hidden", weight: 0 }]);
        expect(reg.offerable().map((d) => d.id)).toEqual(["test-power"]);
        expect(reg.publicList("X")).toHaveLength(2);
    });

    test("mod directories are discovered and validated", async () => {
        const dir = mkdtempSync(join(tmpdir(), "power-mods-"));
        try {
            const typesPath = join(import.meta.dir, "../../src/powers/types.ts").replaceAll("\\", "/");
            writeFileSync(
                join(dir, "free-money.ts"),
                `import { definePower } from "${typesPath}";
                 export default definePower({ id: "free-money", title: "Free", description: "d", weight: 1, instant: true, onActivate(ctx) { ctx.giveCash(ctx.player, 5); } });`,
            );
            writeFileSync(join(dir, "_ignored.ts"), `export default 42;`);
            const reg = await loadPowerRegistry([dir]);
            expect(reg.get("free-money")).toBeDefined();
            expect(reg.get("volatility-storm")).toBeDefined();

            writeFileSync(join(dir, "broken.ts"), `export default { id: "Broken" };`);
            expect(loadPowerRegistry([dir])).rejects.toThrow(/broken\.ts/);
        } finally {
            rmSync(dir, { recursive: true, force: true });
        }
    });
});
