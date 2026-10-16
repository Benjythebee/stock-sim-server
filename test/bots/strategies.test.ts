import { describe, expect, test } from "bun:test";
import { BotRegistry, validateBotDefinition } from "../../src/bots/registry";
import { quotePair, ceilCents, floorCents, momentum } from "../../src/bots/helpers";
import { defineBot } from "../../src/bots/types";
import { RingBuffer } from "../../src/engine/ring-buffer";
import { builtinCatalog, catalogWith, makeGame } from "../helpers";

const ids = builtinCatalog.bots.enabledIds();

describe("bot registry", () => {
    test("built-in strategies load with the ids the admin UI uses", () => {
        expect(ids).toEqual(
            expect.arrayContaining(["LiquidityBot", "MomentumBot", "MeanReversionBot", "InformedBot", "PartiallyInformedBot", "RandomBot", "SpreadTradingBot"]),
        );
    });

    test("validation", () => {
        expect(() => validateBotDefinition({ id: "1bad", name: "x", description: "", enabled: true, create() {} }, "f.ts")).toThrow(/identifier/);
        expect(() => validateBotDefinition(undefined, "f.ts")).toThrow(/defineBot/);
        const ok = defineBot({ id: "Ok", name: "Ok", description: "", enabled: false, create: () => ({ decide() {} }) });
        expect(() => new BotRegistry([ok, ok])).toThrow(/duplicate/);
        expect(new BotRegistry([ok]).enabled()).toEqual([]);
    });
});

describe("bot helpers", () => {
    test("cent rounding", () => {
        expect(floorCents(1.239)).toBe(1.23);
        expect(ceilCents(1.231)).toBe(1.24);
        expect(floorCents(0.001)).toBe(0.01);
        expect(ceilCents(1.23)).toBe(1.23);
    });

    test("quotePair is always at least one cent wide", () => {
        for (const mid of [0.01, 0.05, 1, 3.33, 100]) {
            const { bid, ask } = quotePair(mid, 0.0001);
            expect(ask).toBeGreaterThan(bid);
            expect(bid).toBeLessThanOrEqual(mid + 1e-9);
        }
    });

    test("momentum", () => {
        const rb = new RingBuffer(10);
        [1, 1, 1.1].forEach((v) => rb.push(v));
        expect(momentum(rb, 2)).toBeCloseTo(0.1);
        expect(momentum(rb, 5)).toBeNull();
    });
});

describe("each strategy, alone with the house market maker", () => {
    for (const id of ids) {
        test(`${id}: trades for 2 minutes without overdrawing or throwing`, () => {
            const { game } = makeGame({ bots: 3, botSelection: [id], gameDuration: 2, houseLiquidity: true }, catalogWith());
            expect(game.bots.map((b) => b.type)).toEqual(["HouseMarketMaker", id, id, id]);
            while (!game.ended) {
                game.advance();
                for (const b of game.bots) {
                    expect(b.account.availableCash).toBeGreaterThanOrEqual(0);
                    expect(b.account.availableShares).toBeGreaterThanOrEqual(0);
                }
            }
            expect(game.bots.every((b) => b["failures"] === 0)).toBe(true);
            expect(game.market.tradeCount).toBeGreaterThan(0);
        });
    }
});

describe("market as a whole", () => {
    test("default mix keeps a two-sided book that tracks the guide price", () => {
        const { game } = makeGame({ bots: 10, gameDuration: 3, seed: 1 }, catalogWith());
        let gap = 0;
        let oneSided = 0;
        while (!game.ended) {
            game.advance();
            gap += Math.abs(game.market.price / game.model.guide - 1);
            if (game.market.book.bestBid() === null || game.market.book.bestAsk() === null) oneSided++;
        }
        expect(gap / game.step).toBeLessThan(0.06);
        expect(oneSided / game.step).toBeLessThan(0.01);
    });

    test("a game is reproducible from its seed", () => {
        const run = () => {
            const { game } = makeGame({ bots: 8, gameDuration: 1, seed: 1234 }, catalogWith());
            while (!game.ended) game.advance();
            return [game.market.tradeCount, game.market.volumeTicks, game.market.markTicks];
        };
        expect(run()).toEqual(run());
    });
});
