import { describe, expect, test } from "bun:test";
import { MessageType } from "../../src/protocol/messages";
import { builtinCatalog, makeGame, makePlayer, runSeconds } from "../helpers";

const fatFinger = builtinCatalog.powers.get("fat-finger")!;

/** A calm market with the house market maker quoting, and two players. */
function arena() {
    const { game } = makeGame({ startingCash: 10_000, openingPrice: 10, marketVolatility: 0.0005 });
    const alice = makePlayer("alice");
    const bob = makePlayer("bob");
    game.addPlayer(alice.player);
    game.addPlayer(bob.player);
    game.model.intrinsic = game.model.guide; // fair value = price, so the bounce is easy to see
    runSeconds(game, 1);
    return { game, alice, bob };
}

describe("fat-finger (mods/powers/fat-finger)", () => {
    test("loads from mods/ as an instant market power with its own icon", () => {
        const pub = builtinCatalog.powers.publicOf(fatFinger, "X");
        expect(pub).toMatchObject({ id: "fat-finger", title: "Fat Finger", type: "market", isInstant: true, rarity: 10 });
        expect(pub.iconUrl).toBe("/assets/powers/fat-finger/button-finger.svg");
        expect(builtinCatalog.powers.assets.has(pub.iconUrl!)).toBe(true);
    });

    test("sweeps the bids, crashes the price 6-10% without touching the fair value, then it bounces back", () => {
        const { game, alice, bob } = arena();
        const before = game.market.price;
        const intrinsic = game.model.intrinsic;
        game.market.limit(bob.player.account, "buy", Math.round(before * 96) / 100, 100); // a resting bid 4% down

        game.powers.activate(fatFinger, alice.player);
        expect(bob.player.account.shares).toBe(100); // filled cheap
        expect(game.model.intrinsic).toBe(intrinsic);
        expect(game.model.guide).toBeLessThan(before * 0.94);
        expect(game.model.guide).toBeGreaterThan(before * 0.9);
        expect(alice.socket.last(MessageType.NOTIFICATION)!.level).toBe("success");
        expect(bob.socket.last(MessageType.NOTIFICATION)).toMatchObject({ level: "warning", title: "Fat Finger" });

        runSeconds(game, 1);
        const low = game.market.price;
        expect(low).toBeLessThan(before * 0.95);
        runSeconds(game, 15);
        expect(game.market.price).toBeGreaterThan(low + (before - low) * 0.5);
    });

    test("still crashes the price on an empty book", () => {
        const { game } = makeGame({ openingPrice: 10, houseLiquidity: false });
        const alice = makePlayer("alice");
        game.addPlayer(alice.player);
        const guide = game.model.guide;
        game.powers.activate(fatFinger, alice.player);
        expect(game.model.guide).toBeLessThan(guide * 0.95);
        expect(alice.socket.last(MessageType.NOTIFICATION)!.description).toContain("slammed the sell button");
    });
});
