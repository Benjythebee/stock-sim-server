import { describe, expect, test } from "bun:test";
import { MessageType } from "../../src/protocol/messages";
import { builtinCatalog, makeGame, makePlayer, runSeconds } from "../helpers";

const influencer = builtinCatalog.powers.get("influencer")!;

/** A calm market with the house quoting around a guide that sits on the fair value. */
function arena() {
    const { game } = makeGame({ startingCash: 10_000, openingPrice: 10, marketVolatility: 0.0005 });
    const alice = makePlayer("alice");
    const bob = makePlayer("bob");
    game.addPlayer(alice.player);
    game.addPlayer(bob.player);
    game.model.intrinsic = game.model.guide;
    runSeconds(game, 1);
    const trade = (side: "buy" | "sell", qty: number) => {
        expect(game.marketOrder(alice.player, side, qty).ok).toBe(true);
        game.flush();
    };
    return { game, alice, bob, trade };
}

describe("influencer (mods/powers/influencer)", () => {
    test("loads from mods/ with its own icon", () => {
        const pub = builtinCatalog.powers.publicOf(influencer, "X");
        expect(pub).toMatchObject({ id: "influencer", title: "Influencer", type: "market", isInstant: false, durationTicks: 20 });
        expect(pub.iconUrl).toBe("/assets/powers/influencer/megaphone.svg");
        expect(builtinCatalog.powers.assets.has(pub.iconUrl!)).toBe(true);
    });

    test("the herd follows your buys and sells, pushing the guide ~2% your way, at most every 3 seconds", () => {
        const { game, alice, bob, trade } = arena();
        game.powers.activate(influencer, alice.player);
        expect(bob.socket.last(MessageType.NOTIFICATION)).toMatchObject({ level: "warning", title: "Influencer" });

        const start = game.market.price;
        trade("buy", 10);
        expect(game.model.guide).toBeGreaterThan(start * 1.015);
        expect(alice.socket.last(MessageType.NOTIFICATION)!.description).toStartWith("Your followers bought right after you");

        // Cooling down: the next trade isn't followed.
        const guide = game.model.guide;
        trade("buy", 10);
        expect(game.model.guide).toBeLessThanOrEqual(guide); // only your own (small) impact

        runSeconds(game, 3);
        const top = game.model.guide;
        trade("sell", 20);
        expect(game.model.guide).toBeLessThan(top * 0.985);
        expect(alice.socket.last(MessageType.NOTIFICATION)!.description).toStartWith("Your followers sold right after you");
    });

    test("the fair value doesn't move, and the herd stops when the stream ends", () => {
        const { game, alice, trade } = arena();
        const intrinsic = game.model.intrinsic;
        game.powers.activate(influencer, alice.player);
        trade("buy", 10);
        expect(game.model.intrinsic).toBe(intrinsic);

        runSeconds(game, 20);
        expect(game.powers.activeCount).toBe(0);
        expect(alice.socket.last(MessageType.NOTIFICATION)!.description).toBe("Your stream ended. Your followers moved the market 1 time.");
        const guide = game.model.guide;
        trade("buy", 10);
        expect(game.model.guide).toBeLessThan(guide * 1.01);
    });
});
