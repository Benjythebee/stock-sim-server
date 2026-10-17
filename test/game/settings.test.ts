import { describe, expect, test } from "bun:test";
import { applySettingsUpdate, DEFAULT_SETTINGS } from "../../src/game/settings";

const apply = (update: Record<string, unknown>) => applySettingsUpdate(DEFAULT_SETTINGS, update, ["MomentumBot", "RandomBot"], ["free-cash", "ddos"]);

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
        expect(DEFAULT_SETTINGS.enablePowers).toBe(true);
        expect(apply({ enablePowers: false }).enablePowers).toBe(false);
        expect(apply({ enablePowers: 0 }).enablePowers).toBe(true);
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

    test("disabled powers keep only known, unique ids", () => {
        expect(DEFAULT_SETTINGS.disabledPowers).toEqual([]);
        expect(apply({ disabledPowers: ["ddos", "nope", 3, "ddos"] }).disabledPowers).toEqual(["ddos"]);
        expect(apply({ disabledPowers: "ddos" }).disabledPowers).toEqual([]);
    });

    test("bank loans: on by default, $5,000 at 10%, amounts clamped", () => {
        expect(DEFAULT_SETTINGS).toMatchObject({ enableBorrowing: true, loanAmount: 5000, loanInterestPercent: 10 });
        expect(apply({ enableBorrowing: false }).enableBorrowing).toBe(false);
        expect(apply({ enableBorrowing: "no" }).enableBorrowing).toBe(true);
        expect(apply({ loanAmount: "2500.556" }).loanAmount).toBe(2500.56);
        expect(apply({ loanAmount: 0 }).loanAmount).toBe(1);
        expect(apply({ loanAmount: 1e12 }).loanAmount).toBe(999_999_999);
        expect(apply({ loanInterestPercent: 25 }).loanInterestPercent).toBe(25);
        expect(apply({ loanInterestPercent: -5 }).loanInterestPercent).toBe(0);
        expect(apply({ loanInterestPercent: 5000 }).loanInterestPercent).toBe(1000);
    });
});
