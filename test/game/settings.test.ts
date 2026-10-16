import { describe, expect, test } from "bun:test";
import { applySettingsUpdate, DEFAULT_SETTINGS } from "../../src/game/settings";

const apply = (update: Record<string, unknown>) => applySettingsUpdate(DEFAULT_SETTINGS, update, ["MomentumBot", "RandomBot"]);

describe("applySettingsUpdate", () => {
    test("returns a copy and ignores unknown keys", () => {
        const next = apply({ nope: 1, __proto__: { evil: true } });
        expect(next).toEqual({ ...DEFAULT_SETTINGS });
        expect(next).not.toBe(DEFAULT_SETTINGS);
    });

    test("market volatility arrives as a percentage and is stored as a fraction", () => {
        expect(apply({ marketVolatility: 5 }).marketVolatility).toBeCloseTo(0.05);
        expect(apply({ marketVolatility: 1000 }).marketVolatility).toBeCloseTo(0.5);
        expect(apply({ marketVolatility: -1 }).marketVolatility).toBeCloseTo(0.0001);
        expect(apply({ marketVolatility: NaN }).marketVolatility).toBe(DEFAULT_SETTINGS.marketVolatility);
    });

    test("clamps numbers and accepts numeric strings", () => {
        expect(apply({ bots: 999 }).bots).toBe(50);
        expect(apply({ bots: -4 }).bots).toBe(0);
        expect(apply({ bots: "7" }).bots).toBe(7);
        expect(apply({ gameDuration: 0 }).gameDuration).toBe(1);
        expect(apply({ gameDuration: 600 }).gameDuration).toBe(60);
        expect(apply({ openingPrice: 0 }).openingPrice).toBe(0.01);
        expect(apply({ openingPrice: 12.345 }).openingPrice).toBe(12.35);
        expect(apply({ startingCash: 5e12 }).startingCash).toBe(999_999_999);
        expect(apply({ startingCash: "" }).startingCash).toBe(DEFAULT_SETTINGS.startingCash);
        expect(apply({ seed: -1 }).seed).toBe(4294967295);
    });

    test("booleans must be booleans", () => {
        expect(apply({ enableRandomNews: false }).enableRandomNews).toBe(false);
        expect(apply({ enableRandomNews: "false" }).enableRandomNews).toBe(true);
        expect(apply({ houseLiquidity: false }).houseLiquidity).toBe(false);
        expect(DEFAULT_SETTINGS.revealPrices).toBe(false);
        expect(apply({ revealPrices: true }).revealPrices).toBe(true);
        expect(apply({ revealPrices: 1 }).revealPrices).toBe(false);
        expect(DEFAULT_SETTINGS.disableLimitOrders).toBe(false);
        expect(apply({ disableLimitOrders: true }).disableLimitOrders).toBe(true);
        expect(apply({ disableLimitOrders: "true" }).disableLimitOrders).toBe(false);
        expect(DEFAULT_SETTINGS.disableRandomWalk).toBe(false);
        expect(apply({ disableRandomWalk: true }).disableRandomWalk).toBe(true);
        expect(apply({ disableRandomWalk: 1 }).disableRandomWalk).toBe(false);
    });

    test("ticker is sanitized", () => {
        expect(apply({ ticketName: "tsla" }).ticketName).toBe("TSLA");
        expect(apply({ ticketName: "<script>BRK.B" }).ticketName).toBe("SCRIPTBR");
        expect(apply({ ticketName: "!!!" }).ticketName).toBe(DEFAULT_SETTINGS.ticketName);
    });

    test("bot selection keeps only known, unique ids", () => {
        expect(apply({ botSelection: ["RandomBot", "Nope", 5, "RandomBot"] }).botSelection).toEqual(["RandomBot"]);
        expect(apply({ botSelection: "RandomBot" }).botSelection).toBeUndefined();
    });
});
