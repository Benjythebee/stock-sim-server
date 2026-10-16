import { describe, expect, test } from "bun:test";
import { Account } from "../../src/engine/account";
import { MessageType } from "../../src/protocol/messages";
import { builtinCatalog, makeGame, makePlayer, runSeconds } from "../helpers";

const wiretap = builtinCatalog.powers.get("wiretap")!;
const burner = builtinCatalog.powers.get("burner-phone")!;

/** Three players and a non-human "street" quoting $1.00 asks and $0.99 bids. */
function arena() {
    const { game } = makeGame({ startingCash: 10_000, openingPrice: 1, houseLiquidity: false });
    const [alice, bob, carol] = ["alice", "bob", "carol"].map((n) => makePlayer(n));
    for (const p of [alice!, bob!, carol!]) game.addPlayer(p.player);
    const street = game.market.add(new Account("street", 10_000_000, 1_000_000, false));
    game.market.limit(street, "sell", 1, 100_000);
    game.market.limit(street, "buy", 0.99, 100_000);
    const buy = (p: typeof alice, qty: number) => {
        expect(game.marketOrder(p!.player, "buy", qty).ok).toBe(true);
        game.flush();
    };
    const heard = (p: typeof alice) => p!.socket.of(MessageType.NOTIFICATION).filter((n) => n.title === "Wiretap").map((n) => n.description);
    return { game, alice: alice!, bob: bob!, carol: carol!, buy, heard };
}

describe("wiretap (mods/powers/wiretap)", () => {
    test("loads from mods/ with its own icon", () => {
        const pub = builtinCatalog.powers.publicOf(wiretap, "X");
        expect(pub).toMatchObject({ id: "wiretap", title: "Wiretap", type: "others", isInstant: false, durationTicks: 20 });
        expect(pub.iconUrl).toBe("/assets/powers/wiretap/headphones.svg");
        expect(builtinCatalog.powers.assets.has(pub.iconUrl!)).toBe(true);
    });

    test("reports rivals' trades once per second, privately, and stops after 20s", () => {
        const { game, alice, bob, carol, buy, heard } = arena();
        game.powers.activate(wiretap, alice.player);
        buy(bob, 60);
        buy(bob, 40);
        buy(carol, 10);
        buy(alice, 5); // her own trades aren't reported
        runSeconds(game, 1);
        expect(heard(alice).at(-1)).toBe("bob bought 100 @ $1.00 · carol bought 10 @ $1.00");
        expect(bob.socket.of(MessageType.NOTIFICATION)).toHaveLength(0);

        runSeconds(game, 19);
        expect(game.powers.activeCount).toBe(0);
        expect(heard(alice).at(-1)).toBe("The line went quiet. You overheard 2 trades.");
        const count = heard(alice).length;
        buy(bob, 10);
        runSeconds(game, 2);
        expect(heard(alice)).toHaveLength(count);
    });
});

describe("burner-phone (mods/powers/burner-phone)", () => {
    test("loads from mods/ with its own icon", () => {
        const pub = builtinCatalog.powers.publicOf(burner, "X");
        expect(pub).toMatchObject({ id: "burner-phone", type: "client", isInstant: false, durationTicks: 45 });
        expect(pub.iconUrl).toBe("/assets/powers/burner-phone/smartphone.svg");
    });

    test("cuts an active wiretap, names the spy and warns them; the line comes back after 45s", () => {
        const { game, alice, bob, carol, buy, heard } = arena();
        game.powers.activate(wiretap, alice.player);
        game.powers.activate(burner, bob.player);
        expect(bob.socket.last(MessageType.NOTIFICATION)!.description).toBe("alice was listening in. Not anymore: your trades are hidden for 45 seconds.");
        expect(alice.socket.last(MessageType.NOTIFICATION)).toMatchObject({
            level: "warning",
            description: "bob switched to a burner phone. You can't see their trades anymore.",
        });

        buy(bob, 50);
        buy(carol, 10);
        runSeconds(game, 1);
        expect(heard(alice).at(-1)).toBe("carol bought 10 @ $1.00");

        runSeconds(game, 44);
        expect(bob.player.tradesConcealed).toBe(false);
        game.powers.activate(wiretap, alice.player);
        buy(bob, 7);
        runSeconds(game, 1);
        expect(heard(alice).at(-1)).toBe("bob bought 7 @ $1.00");
    });

    test("also blocks a Copycat aimed at you, and says so when nobody was listening", () => {
        const { game, alice, bob } = arena();
        game.powers.activate(burner, bob.player);
        expect(bob.socket.last(MessageType.NOTIFICATION)!.description).toBe("Nobody was listening in, and for 45 seconds nobody can.");

        bob.player.account.adjustCash(500_000); // bob leads
        runSeconds(game, 45);
        game.powers.activate(builtinCatalog.powers.get("copycat")!, alice.player);
        game.powers.activate(burner, bob.player);
        expect(bob.socket.last(MessageType.NOTIFICATION)!.description).toStartWith("alice was listening in.");
    });
});
