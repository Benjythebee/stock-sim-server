import { describe, expect, test } from "bun:test";
import { MAX_VOLATILITY, PriceModel } from "../../src/engine/price-model";
import { Rng } from "../../src/engine/rng";

const make = (seed = 1, overrides = {}) =>
    new PriceModel({ initialPrice: 10, drift: 0, volatility: 0.05, meanReversion: 0.03, ...overrides }, new Rng(seed));

describe("PriceModel", () => {
    test("is deterministic for a seed", () => {
        const a = make(5);
        const b = make(5);
        for (let i = 0; i < 200; i++) {
            a.step();
            b.step();
        }
        expect(a.guide).toBe(b.guide);
        expect(a.intrinsic).toBe(b.intrinsic);
    });

    test("prices stay positive and finite", () => {
        const m = make(2, { volatility: 0.5 });
        for (let i = 0; i < 5_000; i++) {
            m.step();
            expect(m.guide).toBeGreaterThanOrEqual(0.01);
            expect(Number.isFinite(m.guide)).toBe(true);
        }
    });

    test("intrinsic starts near the opening price and is never below 20% of it", () => {
        for (let seed = 0; seed < 200; seed++) expect(make(seed).intrinsic).toBeGreaterThanOrEqual(2);
    });

    test("mean reversion pulls the guide toward intrinsic", () => {
        const m = make(3, { volatility: 0.001 });
        m.intrinsic = 20;
        for (let i = 0; i < 400; i++) m.step();
        expect(Math.abs(m.guide - 20)).toBeLessThan(1);
    });

    test("history records every step (bounded)", () => {
        const m = make(1, { historySize: 16 });
        for (let i = 0; i < 100; i++) m.step();
        expect(m.history.length).toBe(16);
        expect(m.history.last()).toBe(m.guide);
    });

    test("volatility boosts stack and release in any order", () => {
        const m = make();
        const releaseA = m.boostVolatility(2);
        const releaseB = m.boostVolatility(3);
        expect(m.volatility).toBeCloseTo(0.3);
        releaseA();
        expect(m.volatility).toBeCloseTo(0.15);
        releaseA(); // idempotent
        expect(m.volatility).toBeCloseTo(0.15);
        releaseB();
        expect(m.volatility).toBeCloseTo(0.05);
    });

    test("volatility is capped", () => {
        const m = make();
        m.boostVolatility(1000);
        expect(m.volatility).toBe(MAX_VOLATILITY);
    });

    test("shock adds drift for a number of steps then expires", () => {
        const m = make(4, { volatility: 0, meanReversion: 0 });
        const start = m.guide;
        m.applyShock(0.1, 3);
        expect(m.isShockActive).toBe(true);
        for (let i = 0; i < 3; i++) m.step();
        expect(m.isShockActive).toBe(false);
        expect(m.guide).toBeCloseTo(start * Math.exp(0.3), 6);
        m.step();
        expect(m.guide).toBeCloseTo(start * Math.exp(0.3), 6);
    });

    test("shockIntrinsic and driftIntrinsic move fair value", () => {
        const m = make();
        m.intrinsic = 10;
        m.shockIntrinsic(0.1);
        expect(m.intrinsic).toBeCloseTo(11);
        m.shockIntrinsic(-5);
        expect(m.intrinsic).toBe(0.01);
        m.intrinsic = 10;
        m.driftIntrinsic(0.05);
        expect([9.5, 10.5].some((v) => Math.abs(m.intrinsic - v) < 1e-9)).toBe(true);
    });

    test("absorbTrade moves the guide by weight", () => {
        const m = make();
        m.guide = 10;
        m.absorbTrade(12, 0.5);
        expect(m.guide).toBe(11);
    });
});
