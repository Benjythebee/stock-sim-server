import { describe, expect, test } from "bun:test";
import { MessageType } from "../../src/protocol/messages";
import { builtinCatalog, makeGame, makePlayer, runSeconds } from "../helpers";

const pump = builtinCatalog.powers.get("pump-and-dump")!;

/** A calm market with the house quoting around a guide that sits on the fair value. */
function arena() {
    const { game, broadcasts } = makeGame({ startingCash: 10_000, openingPrice: 10, marketVolatility: 0.0005 });
    const alice = makePlayer("alice");
    const bob = makePlayer("bob");
    game.addPlayer(alice.player);
    game.addPlayer(bob.player);
    game.model.intrinsic = game.model.guide;
    runSeconds(game, 1);
    return { game, broadcasts, alice, bob };
}

describe("pump-and-dump (mods/powers/pump-and-dump)", () => {
    test("loads from mods/ with its own icon", () => {
        const pub = builtinCatalog.powers.publicOf(pump, "X");
        expect(pub).toMatchObject({ id: "pump-and-dump", title: "Pump and Dump", type: "market", isInstant: false, durationTicks: 15 });
        expect(pub.iconUrl).toBe("/assets/powers/pump-and-dump/rocket-flight.svg");
        expect(builtinCatalog.powers.assets.has(pub.iconUrl!)).toBe(true);
    });

    test("pumps ~10% for 10 seconds, warns only the initiator, then crashes below the start; the fair value never moves", () => {
        const { game, broadcasts, alice, bob } = arena();
        const start = game.market.price;
        const intrinsic = game.model.intrinsic;
        game.powers.activate(pump, alice.player);
        expect(broadcasts.some((m) => m.type === MessageType.NEWS && m.title === "$AAPL to the moon?")).toBe(true);

        runSeconds(game, 8);
        expect(alice.socket.last(MessageType.NOTIFICATION)!.description).toBe("Your promoters dump in 2 seconds!");
        expect(bob.socket.of(MessageType.NOTIFICATION).length).toBe(0); // rivals only see the hype
        runSeconds(game, 2);
        const top = game.market.price;
        expect(top).toBeGreaterThan(start * 1.08);

        runSeconds(game, 4);
        expect(game.market.price).toBeLessThan(start);
        expect(game.model.intrinsic).toBe(intrinsic);

        runSeconds(game, 1);
        expect(game.powers.activeCount).toBe(0);
        expect(alice.socket.last(MessageType.NOTIFICATION)!.description).toStartWith(`Your scheme ran $${start.toFixed(2)} → $${top.toFixed(2)}`);

        // Afterwards the price recovers toward the fair value (which only the periodic drift moves).
        runSeconds(game, 30);
        expect(Math.abs(game.market.price - game.model.intrinsic) / game.model.intrinsic).toBeLessThan(0.03);
    });
});
