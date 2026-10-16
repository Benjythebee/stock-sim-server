import { describe, expect, test } from "bun:test";
import { Account } from "../../src/engine/account";
import { MessageType } from "../../src/protocol/messages";
import { builtinCatalog, makeGame, makePlayer, runSeconds } from "../helpers";

const copycat = builtinCatalog.powers.get("copycat")!;

/** alice (copier), bob (the leader, +$10,000) and carol, with a $1.00 / $0.99 street market. */
function arena() {
    const { game } = makeGame({ startingCash: 10_000, openingPrice: 1, houseLiquidity: false });
    const [alice, bob, carol] = ["alice", "bob", "carol"].map((n) => makePlayer(n));
    for (const p of [alice!, bob!, carol!]) game.addPlayer(p.player);
    bob!.player.account.adjustCash(1_000_000);
    const street = game.market.add(new Account("street", 100_000_000, 1_000_000, false));
    game.market.limit(street, "sell", 1, 500_000);
    game.market.limit(street, "buy", 0.99, 500_000);
    const trade = (p: typeof alice, side: "buy" | "sell", qty: number) => {
        expect(game.marketOrder(p!.player, side, qty).ok).toBe(true);
        game.flush();
    };
    return { game, alice: alice!, bob: bob!, carol: carol!, trade };
}

describe("copycat (mods/powers/copycat)", () => {
    test("loads from mods/ with its own icon", () => {
        const pub = builtinCatalog.powers.publicOf(copycat, "X");
        expect(pub).toMatchObject({ id: "copycat", title: "Copycat", type: "others", isInstant: false, durationTicks: 20 });
        expect(pub.iconUrl).toBe("/assets/powers/copycat/two-shadows.svg");
        expect(builtinCatalog.powers.assets.has(pub.iconUrl!)).toBe(true);
    });

    test("targets the leading rival, warns them, and copies their buys and sells scaled to your size", () => {
        const { game, alice, bob, carol, trade } = arena();
        game.powers.activate(copycat, alice.player);
        expect(bob.socket.last(MessageType.NOTIFICATION)).toMatchObject({ level: "warning", description: "Someone is copying your trades for 20 seconds." });

        trade(carol, "buy", 500); // not the target
        expect(alice.player.account.shares).toBe(0);

        trade(bob, "buy", 2_000); // $2,000 of bob's $20,000 net worth: 10%
        expect(alice.player.account.shares).toBe(1_000); // 10% of alice's $10,000
        trade(bob, "sell", 1_000); // half of bob's shares
        expect(alice.player.account.shares).toBe(500);

        runSeconds(game, 1);
        expect(alice.socket.last(MessageType.NOTIFICATION)!.description).toBe("You bought 1000 (bob bought 2000) · sold 500 (bob sold 1000).");
        expect(alice.player.orders.openCount).toBe(0);

        runSeconds(game, 19);
        expect(game.powers.activeCount).toBe(0);
        trade(bob, "buy", 1_000);
        expect(alice.player.account.shares).toBe(500);
    });

    test("two copycats copying each other don't loop", () => {
        const { game, alice, bob, trade } = arena();
        alice.player.account.adjustCash(2_000_000); // alice now leads for bob's copycat
        game.powers.activate(copycat, bob.player); // bob copies alice
        bob.player.account.adjustCash(2_000_000); // and bob leads for alice's
        game.powers.activate(copycat, alice.player); // alice copies bob

        trade(bob, "buy", 1_000);
        expect(alice.player.account.shares).toBeGreaterThan(0);
        expect(bob.player.account.shares).toBe(1_000); // alice's copy wasn't copied back
    });

    test("with nobody else around it just says so", () => {
        const { game } = makeGame();
        const solo = makePlayer("solo");
        game.addPlayer(solo.player);
        game.powers.activate(copycat, solo.player);
        runSeconds(game, 21);
        expect(solo.socket.of(MessageType.NOTIFICATION).map((n) => n.description)).toEqual(["There's nobody to copy."]);
    });
});
