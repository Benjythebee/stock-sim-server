import { describe, expect, test } from "bun:test";
import { Rng, weightedSample } from "../../src/engine/rng";

describe("Rng", () => {
    test("same seed, same sequence", () => {
        const a = new Rng(42);
        const b = new Rng(42);
        for (let i = 0; i < 100; i++) expect(a.next()).toBe(b.next());
    });

    test("different seeds diverge", () => {
        expect(new Rng(1).next()).not.toBe(new Rng(2).next());
    });

    test("next() stays in [0, 1) and signed() in [-1, 1)", () => {
        const rng = new Rng(7);
        for (let i = 0; i < 10_000; i++) {
            const u = rng.next();
            expect(u).toBeGreaterThanOrEqual(0);
            expect(u).toBeLessThan(1);
            const s = rng.signed();
            expect(s).toBeGreaterThanOrEqual(-1);
            expect(s).toBeLessThan(1);
        }
    });

    test("int() covers its range uniformly-ish", () => {
        const rng = new Rng(3);
        const counts = [0, 0, 0, 0];
        for (let i = 0; i < 40_000; i++) counts[rng.int(4)]!++;
        for (const c of counts) expect(c).toBeGreaterThan(9_000);
    });

    test("normal() is finite with mean ~0 and sd ~1", () => {
        const rng = new Rng(11);
        let sum = 0;
        let sq = 0;
        const n = 50_000;
        for (let i = 0; i < n; i++) {
            const x = rng.normal();
            expect(Number.isFinite(x)).toBe(true);
            sum += x;
            sq += x * x;
        }
        const mean = sum / n;
        expect(Math.abs(mean)).toBeLessThan(0.03);
        expect(Math.abs(Math.sqrt(sq / n - mean * mean) - 1)).toBeLessThan(0.03);
    });

    test("fork() is deterministic and independent of later parent use", () => {
        const a = new Rng(5).fork(1);
        const parent = new Rng(5);
        const b = parent.fork(1);
        parent.next();
        parent.next();
        for (let i = 0; i < 20; i++) expect(a.next()).toBe(b.next());
        expect(new Rng(5).fork(1).next()).not.toBe(new Rng(5).fork(2).next());
    });

    test("shuffle() is a permutation", () => {
        const items = [1, 2, 3, 4, 5, 6, 7, 8];
        const shuffled = new Rng(9).shuffle([...items]);
        expect([...shuffled].sort()).toEqual(items);
    });
});

describe("weightedSample", () => {
    const items = [
        { id: "never", w: 0 },
        { id: "rare", w: 1 },
        { id: "common", w: 9 },
    ];

    test("never picks zero-weight items and never repeats", () => {
        const rng = new Rng(1);
        for (let i = 0; i < 500; i++) {
            const picks = weightedSample(rng, items, (x) => x.w, 3);
            expect(picks.map((p) => p.id)).not.toContain("never");
            expect(new Set(picks).size).toBe(picks.length);
            expect(picks.length).toBe(2);
        }
    });

    test("respects weights (higher = more common)", () => {
        const rng = new Rng(2);
        let common = 0;
        for (let i = 0; i < 10_000; i++) if (weightedSample(rng, items, (x) => x.w, 1)[0]!.id === "common") common++;
        expect(common / 10_000).toBeGreaterThan(0.85);
        expect(common / 10_000).toBeLessThan(0.95);
    });
});
