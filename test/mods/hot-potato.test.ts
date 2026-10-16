import { describe, expect, test } from "bun:test";
import { Account } from "../../src/engine/account";
import type { Player } from "../../src/game/player";
import { MessageType } from "../../src/protocol/messages";
import { builtinCatalog, makeGame, makePlayer, runSeconds } from "../helpers";

const potato = builtinCatalog.powers.get("hot-potato")!;

/** alice (thrower) and bob, $10,000 each, with a $1.00 / $0.99 street market to trade against. */
function arena() {
    const { game } = makeGame({ startingCash: 10_000, openingPrice: 1, houseLiquidity: false });
    const alice = makePlayer("alice");
    const bob = makePlayer("bob");
    game.addPlayer(alice.player);
    game.addPlayer(bob.player);
    const street = game.market.add(new Account("street", 100_000_000, 1_000_000, false));
    game.market.limit(street, "sell", 1, 500_000);
    game.market.limit(street, "buy", 0.99, 500_000);
    const effect = () => game.powers.activeEffects().find((e) => e.powerId === "hot-potato")?.state as { holder: Player | null; fuse: number; elapsed: number } | undefined;
    return { game, alice, bob, effect };
}

describe("hot-potato (mods/powers/hot-potato)", () => {
    test("loads from mods/ with its own icon", () => {
        const pub = builtinCatalog.powers.publicOf(potato, "X");
        expect(pub).toMatchObject({ id: "hot-potato", title: "Hot Potato", type: "others", isInstant: false });
        expect(pub.iconUrl).toBe("/assets/powers/hot-potato/time-bomb.svg");
        expect(builtinCatalog.powers.assets.has(pub.iconUrl!)).toBe(true);
    });

    test("lands on a rival and blows up 10% of their net worth when the hidden fuse runs out", () => {
        const { game, alice, bob, effect } = arena();
        game.powers.activate(potato, alice.player);
        expect(effect()!.holder).toBe(bob.player);
        expect(effect()!.fuse).toBeGreaterThanOrEqual(15);
        expect(effect()!.fuse).toBeLessThanOrEqual(25);
        expect(bob.socket.last(MessageType.NOTIFICATION)).toMatchObject({ level: "warning", title: "Hot Potato" });

        runSeconds(game, effect()!.fuse);
        expect(bob.player.account.cash).toBe(900_000);
        expect(alice.player.account.cash).toBe(1_000_000);
        expect(bob.socket.last(MessageType.NOTIFICATION)!.description).toBe("BOOM! The potato blew up in your hands. You lost $1,000.00.");
        expect(alice.socket.last(MessageType.NOTIFICATION)!.description).toContain("BOOM! The potato blew up on bob after 0 passes");

        runSeconds(game, 30);
        expect(game.powers.activeCount).toBe(0);
        expect(bob.player.account.cash).toBe(900_000); // only blows once
    });

    test("trading passes it on, and it can come back to the thrower", () => {
        const { game, alice, bob, effect } = arena();
        game.powers.activate(potato, alice.player);
        runSeconds(game, 1);
        expect(effect()!.holder).toBe(bob.player); // holding still keeps it

        expect(game.marketOrder(bob.player, "buy", 10).ok).toBe(true);
        runSeconds(game, 1);
        expect(effect()!.holder).toBe(alice.player);
        expect(alice.socket.last(MessageType.NOTIFICATION)!.description).toContain("You're holding the hot potato!");
        expect(bob.socket.last(MessageType.NOTIFICATION)!.description).toBe("alice is holding the hot potato.");

        runSeconds(game, effect()!.fuse - effect()!.elapsed);
        expect(alice.player.account.cash).toBe(900_000);
        expect(bob.player.account.cash).toBe(1_000_000 - 1_000); // just the 10 shares bought
    });

    test("cash hidden in orders isn't safe: the blast cancels them, then takes shares", () => {
        const { game, alice, bob, effect } = arena();
        expect(game.marketOrder(bob.player, "buy", 5_000).ok).toBe(true); // $5,000 cash + 5,000 shares
        game.market.limit(bob.player.account, "buy", 0.5, 10_000); // locks all $5,000 left
        game.powers.activate(potato, alice.player);
        runSeconds(game, effect()!.fuse);

        // Net worth at $1.00 = $10,000: the blast takes $1,000 of the freed cash.
        const account = bob.player.account;
        expect(account.openOrders.size).toBe(0);
        expect(account.reservedCash).toBe(0);
        expect(account.cash).toBe(400_000);
        expect(account.shares).toBe(5_000);
    });

    test("with nobody else around it just says so", () => {
        const { game } = makeGame();
        const solo = makePlayer("solo");
        game.addPlayer(solo.player);
        game.powers.activate(potato, solo.player);
        runSeconds(game, 30);
        expect(solo.player.account.cash).toBe(1_000_000);
        expect(solo.socket.of(MessageType.NOTIFICATION).map((n) => n.description)).toEqual(["There's nobody to throw it at."]);
    });
});
