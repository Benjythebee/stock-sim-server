import { describe, expect, test } from "bun:test";
import { MessageType } from "../../src/protocol/messages";
import { builtinCatalog, catalogWith, makeGame, makePlayer } from "../helpers";

const dividend = builtinCatalog.powers.get("special-dividend")!;

describe("special-dividend (mods/powers/special-dividend)", () => {
    test("loads from mods/ as an instant power with its own icon", () => {
        const pub = builtinCatalog.powers.publicOf(dividend, "X");
        expect(pub).toMatchObject({ id: "special-dividend", type: "all", isInstant: true });
        expect(pub.iconUrl).toBe("/assets/powers/special-dividend/receive-money.svg");
        expect(builtinCatalog.powers.assets.has(pub.iconUrl!)).toBe(true);
    });

    test("pays every shareholder 3% of the price per share, players and bots", () => {
        const { game } = makeGame({ startingCash: 10_000, openingPrice: 10, bots: 2, houseLiquidity: false }, catalogWith());
        const alice = makePlayer("alice");
        const bob = makePlayer("bob");
        const carol = makePlayer("carol");
        for (const p of [alice, bob, carol]) game.addPlayer(p.player);
        bob.player.account.adjustShares(100);
        carol.player.account.adjustShares(10);
        const bot = game.bots[0]!;
        const botCash = bot.account.cash;
        expect(game.market.markTicks).toBe(1000);

        game.powers.activate(dividend, alice.player); // $0.30 a share
        expect(alice.player.account.cash).toBe(1_000_000);
        expect(bob.player.account.cash).toBe(1_000_000 + 3_000);
        expect(carol.player.account.cash).toBe(1_000_000 + 300);
        expect(bot.account.cash).toBe(botCash + bot.account.shares * 30);

        expect(alice.socket.last(MessageType.NOTIFICATION)).toMatchObject({
            level: "success",
            description: "You declared a $0.30 dividend per share. You hold no shares, so you got nothing.",
        });
        expect(bob.socket.last(MessageType.NOTIFICATION)!.description).toBe("alice declared a $0.30 dividend per share. You received $30.00 on 100 shares.");
    });

    test("shares locked in sell orders count too", () => {
        const { game } = makeGame({ startingCash: 10_000, openingPrice: 10, houseLiquidity: false });
        const alice = makePlayer("alice");
        game.addPlayer(alice.player);
        alice.player.account.adjustShares(100);
        game.market.limit(alice.player.account, "sell", 20, 100);
        game.powers.activate(dividend, alice.player);
        expect(alice.player.account.cash).toBe(1_000_000 + 3_000);
    });
});
