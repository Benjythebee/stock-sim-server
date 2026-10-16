import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { log } from "../../src/log";
import { loadPowerRegistry, MISSING_ICON, powerProblems, PowerRegistry, toPublicPower } from "../../src/powers/registry";
import { definePower } from "../../src/powers/types";
import { MOD_API_VERSION } from "../../src/version";
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

    test("a power that needs a newer mod API is refused with a clear error", () => {
        expect(powerProblems({ ...valid, apiVersion: MOD_API_VERSION })).toEqual([]);
        expect(powerProblems({ ...valid, apiVersion: 0 })).toContain("apiVersion must be an integer >= 1");
        expect(powerProblems({ ...valid, apiVersion: MOD_API_VERSION + 1 })).toEqual([
            `needs mod API v${MOD_API_VERSION + 1}, but this server only has v${MOD_API_VERSION}: update the server`,
        ]);
        expect(() => new PowerRegistry([{ ...valid, apiVersion: 99 }])).toThrow(/needs mod API v99/);
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
            await expect(loadPowerRegistry([dir])).rejects.toThrow(/broken\.ts/);
        } finally {
            rmSync(dir, { recursive: true, force: true });
        }
    });

    test("a folder mod can ship its own icon, served under /assets/powers/<id>/", async () => {
        const dir = mkdtempSync(join(tmpdir(), "power-mods-"));
        try {
            const typesPath = join(import.meta.dir, "../../src/powers/types.ts").replaceAll("\\", "/");
            mkdirSync(join(dir, "pickpocket", "art"), { recursive: true });
            writeFileSync(join(dir, "pickpocket", "art", "hand icon.svg"), "<svg/>");
            writeFileSync(
                join(dir, "pickpocket", "index.ts"),
                `import { definePower } from "${typesPath}";
                 export default definePower({ id: "pickpocket", title: "P", description: "d", weight: 1, icon: "art/hand icon.svg",
                   iconCredit: { author: "Someone" }, onActivate() {} });`,
            );
            const reg = await loadPowerRegistry([dir]);
            const pub = reg.publicOf(reg.get("pickpocket")!, "X");
            expect(pub.iconUrl).toBe("/assets/powers/pickpocket/art/hand%20icon.svg");
            expect(pub.iconCredit).toEqual({ author: "Someone" });
            expect(reg.assets.get(pub.iconUrl!)).toBe(join(dir, "pickpocket", "art", "hand icon.svg"));
        } finally {
            rmSync(dir, { recursive: true, force: true });
        }
    });

    test("a missing or out-of-folder icon file falls back to the missing icon instead of failing", () => {
        const dir = mkdtempSync(join(tmpdir(), "power-mods-"));
        writeFileSync(join(tmpdir(), "outside.svg"), "<svg/>");
        log.setLevel("silent");
        try {
            const reg = new PowerRegistry([
                { definition: { ...valid, id: "gone", icon: "nope.svg" }, dir },
                { definition: { ...valid, id: "escape", icon: "../outside.svg" }, dir },
                { definition: { ...valid, id: "absolute", icon: join(tmpdir(), "outside.svg") }, dir },
                { definition: { ...valid, id: "no-dir", icon: "icon.png" } },
                { definition: { ...valid, id: "slug", icon: "stop" }, dir },
            ]);
            for (const id of ["gone", "escape", "absolute", "no-dir"]) {
                expect(reg.publicOf(reg.get(id)!, "X")).toMatchObject({ iconSlug: MISSING_ICON });
                expect(reg.publicOf(reg.get(id)!, "X").iconUrl).toBeUndefined();
            }
            expect(reg.publicOf(reg.get("slug")!, "X")).toMatchObject({ iconSlug: "stop" });
            expect(reg.assets.size).toBe(0);
        } finally {
            log.setLevel("warn");
            rmSync(dir, { recursive: true, force: true });
        }
    });
});
