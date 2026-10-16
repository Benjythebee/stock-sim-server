import { describe, expect, test } from "bun:test";
import { FOLLOW_UPS, NEWS_CATALOG } from "../../src/news/catalog";
import { MessageType, type NewsMessage } from "../../src/protocol/messages";
import { makeGame, makePlayer, runSeconds } from "../helpers";

const headline = (prefix: string) => {
    const news = NEWS_CATALOG.find((n) => typeof n.title === "function" ? n.title({ ticker: "X" }).includes(prefix) : n.title.includes(prefix));
    if (!news) throw new Error(`no headline matching "${prefix}"`);
    return news;
};

/** A calm market with the house quoting and two players. */
function arena() {
    const { game, broadcasts } = makeGame({ startingCash: 10_000, openingPrice: 10, marketVolatility: 0.0005 });
    const alice = makePlayer("alice");
    const bob = makePlayer("bob");
    game.addPlayer(alice.player);
    game.addPlayer(bob.player);
    game.model.intrinsic = game.model.guide;
    runSeconds(game, 1);
    const titles = () => broadcasts.filter((m): m is NewsMessage => m.type === MessageType.NEWS).map((m) => m.title);
    return { game, broadcasts, alice, bob, titles };
}

describe("news catalog", () => {
    test("CEO live-tweeting multiplies volatility by 2.5 for 20s, without moving the fair value", () => {
        const { game } = arena();
        const base = game.model.volatility;
        const intrinsic = game.model.intrinsic;
        game.news.publish(headline("Live-Tweets"));
        expect(game.model.volatility).toBeCloseTo(base * 2.5);
        expect(game.model.intrinsic).toBe(intrinsic);
        runSeconds(game, 20);
        expect(game.model.volatility).toBeCloseTo(base);
    });

    test("overlapping publications of the same headline each release their own effect", () => {
        const { game } = arena();
        const base = game.model.volatility;
        game.news.publish(headline("Long Weekend"));
        runSeconds(game, 10);
        game.news.publish(headline("Long Weekend"));
        expect(game.model.volatility).toBeCloseTo(base * 0.4 * 0.4);
        runSeconds(game, 20); // first one over
        expect(game.model.volatility).toBeCloseTo(base * 0.4);
        runSeconds(game, 10);
        expect(game.model.volatility).toBeCloseTo(base);
    });

    test("exchange outage locks every player for 6s while the price keeps moving", () => {
        const { game, alice, bob } = arena();
        const guide = game.model.guide;
        game.news.publish(headline("Servers Down"));
        expect(alice.player.account.tradingDisabled).toBe(true);
        expect(bob.player.account.tradingDisabled).toBe(true);
        expect(alice.socket.last(MessageType.CLIENT_STATE)!.tradingDisabled).toBe(true);
        runSeconds(game, 5);
        expect(bob.player.account.tradingDisabled).toBe(true);
        expect(Math.abs(game.model.guide / guide - 1)).toBeGreaterThan(0.02); // reopens on a gap
        runSeconds(game, 1);
        expect(alice.player.account.tradingDisabled).toBe(false);
        expect(bob.player.account.tradingDisabled).toBe(false);
    });

    test("short seller report: the price undershoots the new fair value, then recovers toward it", () => {
        const { game } = arena();
        const intrinsic = game.model.intrinsic;
        game.news.publish(headline("Short Seller"));
        expect(game.model.intrinsic).toBeCloseTo(intrinsic * 0.92);
        runSeconds(game, 2);
        const bottom = game.model.guide;
        expect(bottom).toBeLessThan(intrinsic * 0.92 * 0.95);
        runSeconds(game, 30);
        expect(game.model.guide).toBeGreaterThan(bottom);
    });

    test("going viral pumps the price above fair value, then the bubble pops", () => {
        const { game, titles } = arena();
        const intrinsic = game.model.intrinsic;
        game.news.publish(headline("Goes Viral"));
        runSeconds(game, 19);
        const top = game.model.guide;
        expect(top).toBeGreaterThan(intrinsic * 1.15);
        expect(game.model.intrinsic).toBe(intrinsic);
        runSeconds(game, 1);
        expect(titles().at(-1)).toBe("The Bubble Pops");
        runSeconds(game, 2);
        expect(game.model.guide).toBeLessThan(top * 0.85);
    });

    test("analyst upgrade lifts the fair value 10%, and the retraction undoes it exactly", () => {
        const { game, titles } = arena();
        const intrinsic = game.model.intrinsic;
        game.news.publish(headline("Strong Buy"));
        expect(game.model.intrinsic).toBeCloseTo(intrinsic * 1.1);
        runSeconds(game, 20);
        expect(titles().at(-1)).toBe(`Correction: Analyst Meant a Different $${game.settings.ticketName}`);
        expect(game.model.intrinsic).toBeCloseTo(intrinsic);
    });

    test("share buyback lifts resting offers every second", () => {
        const { game, bob } = arena();
        bob.player.account.adjustShares(100);
        game.news.publish(headline("Buyback"));
        // An offer half a percent above the market, inside the 1% the buyback is willing to pay.
        const ask = Math.round(game.market.price * 100.5) / 100;
        expect(game.market.limit(bob.player.account, "sell", ask, 100).ok).toBe(true);
        runSeconds(game, 1);
        expect(bob.player.account.shares).toBe(0);
        expect(bob.player.account.cash).toBe(1_000_000 + Math.round(ask * 100) * 100);
    });

    test("takeover bid lifts the fair value, then resolves either way", () => {
        const outcomes = new Set<string>();
        for (let seed = 1; seed <= 20 && outcomes.size < 2; seed++) {
            const { game, broadcasts } = makeGame({ seed });
            const intrinsic = game.model.intrinsic;
            game.news.publish(headline("Rival Bids"));
            expect(game.model.intrinsic).toBeCloseTo(intrinsic * 1.12);
            runSeconds(game, 25);
            const last = broadcasts.filter((m): m is NewsMessage => m.type === MessageType.NEWS).at(-1)!;
            outcomes.add(last.title);
            const expected = last.title === "Takeover Approved" ? 1.12 * 1.05 : 1.12 * 0.85;
            expect(game.model.intrinsic).toBeCloseTo(intrinsic * expected);
        }
        expect(outcomes).toEqual(new Set(["Takeover Approved", "Regulators Block the Takeover"]));
    });

    test("an unclaimed briefcase opens a bonus briefcase for everyone", () => {
        const { game, alice, bob } = arena();
        game.news.publish(headline("Unclaimed Briefcase"));
        expect(alice.socket.last(MessageType.POWER_OFFERS)!.offers.length).toBeGreaterThan(0);
        expect(bob.socket.last(MessageType.POWER_OFFERS)!.offers.length).toBeGreaterThan(0);
    });

    test("follow-ups are not drawn at random", () => {
        for (const followUp of Object.values(FOLLOW_UPS)) expect(NEWS_CATALOG).not.toContain(followUp);
    });
});
