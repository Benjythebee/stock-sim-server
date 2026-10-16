import { describe, expect, test } from "bun:test";
import { Account } from "../../src/engine/account";
import { MessageType } from "../../src/protocol/messages";
import { builtinCatalog, makeGame, makePlayer, runSeconds } from "../helpers";

const bulletBill = builtinCatalog.powers.get("bullet-bill")!;

/** alice (caller), bob and carol, with a $1.00 / $0.99 street market. */
function arena() {
    const { game } = makeGame({ startingCash: 10_000, openingPrice: 1, houseLiquidity: false });
    const [alice, bob, carol] = ["alice", "bob", "carol"].map((n) => makePlayer(n));
    for (const p of [alice!, bob!, carol!]) game.addPlayer(p.player);
    const street = game.market.add(new Account("street", 100_000_000, 1_000_000, false));
    game.market.limit(street, "sell", 1, 500_000);
    game.market.limit(street, "buy", 0.99, 500_000);
    return { game, alice: alice!, bob: bob!, carol: carol! };
}

describe("bullet-bill (mods/powers/bullet-bill)", () => {
    test("loads from mods/ with its own icon", () => {
        const pub = builtinCatalog.powers.publicOf(bulletBill, "X");
        expect(pub).toMatchObject({ id: "bullet-bill", title: "Bullet Bill", type: "others" });
        expect(pub.iconUrl).toBe("/assets/powers/bullet-bill/bullet-bill.svg");
        expect(builtinCatalog.powers.assets.has(pub.iconUrl!)).toBe(true);
    });

    test("the leading rival's sell orders are cancelled and half their shares dumped at market", () => {
        const { game, alice, bob, carol } = arena();
        alice.player.account.adjustCash(5_000_000); // the caller can be ahead: only rivals are hit
        bob.player.account.adjustCash(100_000); // bob leads the rivals by $1,000
        expect(game.marketOrder(bob.player, "buy", 1_000).ok).toBe(true);
        game.market.limit(bob.player.account, "sell", 2, 600); // reserves 600 of them

        game.powers.activate(bulletBill, alice.player);
        const account = bob.player.account;
        expect(account.openOrders.size).toBe(0);
        expect(account.shares).toBe(500);
        expect(account.reservedShares).toBe(0);
        expect(bob.player.orders.openCount).toBe(0);
        expect(bob.socket.last(MessageType.NOTIFICATION)).toMatchObject({ level: "warning", title: "Bullet Bill" });
        expect(carol.socket.last(MessageType.NOTIFICATION)!.description).toContain("bob got hit by a Bullet Bill: 500 shares dumped");
        expect(account.tradingDisabled).toBe(false);
        expect(carol.player.account.shares).toBe(0);
    });

    test("an all-cash leader is knocked out for 8 seconds instead", () => {
        const { game, alice, bob } = arena();
        bob.player.account.adjustCash(100_000);
        game.powers.activate(bulletBill, alice.player);
        expect(bob.player.account.tradingDisabled).toBe(true);
        expect(bob.socket.last(MessageType.NOTIFICATION)!.description).toBe("alice hit you with a Bullet Bill! You can't trade for 8 seconds.");
        runSeconds(game, 7);
        expect(bob.player.account.tradingDisabled).toBe(true);
        runSeconds(game, 1);
        expect(bob.player.account.tradingDisabled).toBe(false);
        expect(game.powers.activeCount).toBe(0);
    });

    test("a leader already locked by a DDoS stays locked exactly as long as the DDoS", () => {
        const { game, alice, bob } = arena();
        expect(game.marketOrder(bob.player, "buy", 100).ok).toBe(true);
        bob.player.account.adjustCash(100_000);
        const release = bob.player.lockTrading();
        game.powers.activate(bulletBill, alice.player);
        expect(bob.player.account.shares).toBe(100); // couldn't sell: knocked out instead
        runSeconds(game, 8);
        expect(bob.player.account.tradingDisabled).toBe(true);
        release();
        expect(bob.player.account.tradingDisabled).toBe(false);
    });
});
