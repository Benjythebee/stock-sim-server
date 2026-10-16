import { describe, expect, test } from "bun:test";
import { Account } from "../../src/engine/account";
import { MessageType } from "../../src/protocol/messages";
import { builtinCatalog, makeGame, makePlayer, runSeconds } from "../helpers";

const loanShark = builtinCatalog.powers.get("loan-shark")!;

/** alice ($10,000) with a $1.00 / $0.99 street market. */
function arena(settings: Parameters<typeof makeGame>[0] = {}) {
    const { game } = makeGame({ startingCash: 10_000, openingPrice: 1, houseLiquidity: false, ...settings });
    const alice = makePlayer("alice");
    game.addPlayer(alice.player);
    const street = game.market.add(new Account("street", 100_000_000, 1_000_000, false));
    game.market.limit(street, "sell", 1, 500_000);
    game.market.limit(street, "buy", 0.99, 500_000);
    return { game, alice };
}

describe("loan-shark (mods/powers/loan-shark)", () => {
    test("loads from mods/ with its own icon", () => {
        const pub = builtinCatalog.powers.publicOf(loanShark, "X");
        expect(pub).toMatchObject({ id: "loan-shark", title: "Loan Shark", type: "client", isInstant: false, durationTicks: 30 });
        expect(pub.iconUrl).toBe("/assets/powers/loan-shark/shark-jaws.svg");
        expect(builtinCatalog.powers.assets.has(pub.iconUrl!)).toBe(true);
    });

    test("lends the starting cash and collects it plus 5% after 30 seconds, with a warning", () => {
        const { game, alice } = arena();
        game.powers.activate(loanShark, alice.player);
        expect(alice.player.account.cash).toBe(2_000_000);

        runSeconds(game, 25);
        expect(alice.socket.last(MessageType.NOTIFICATION)!.description).toBe("The shark collects $10,500.00 in 5 seconds. Have the cash ready!");
        runSeconds(game, 5);
        expect(alice.player.account.cash).toBe(950_000);
        expect(alice.socket.last(MessageType.NOTIFICATION)!.description).toBe("The shark collected $10,500.00. Pleasure doing business.");
        expect(game.powers.activeCount).toBe(0);
    });

    test("when you're short it cancels your orders and sells your shares at market", () => {
        const { game, alice } = arena();
        game.powers.activate(loanShark, alice.player);
        expect(game.marketOrder(alice.player, "buy", 15_000).ok).toBe(true); // $15,000 of $20,000
        game.market.limit(alice.player.account, "buy", 0.5, 10_000); // locks the last $5,000

        runSeconds(game, 30);
        const account = alice.player.account;
        expect(account.openOrders.size).toBe(0);
        // Owes $10,500: $5,000 cash, then 5,556 shares sold at $0.99 ($5,500.44), the change kept.
        expect(account.shares).toBe(15_000 - 5_556);
        expect(account.cash).toBe(44);
        expect(alice.socket.last(MessageType.NOTIFICATION)).toMatchObject({ level: "warning", title: "Loan Shark" });
        expect(alice.socket.last(MessageType.NOTIFICATION)!.description).toContain("sold 5556 of your shares");
    });

    test("with trading locked it repossesses the shares instead", () => {
        const { game, alice } = arena();
        game.powers.activate(loanShark, alice.player);
        expect(game.marketOrder(alice.player, "buy", 20_000).ok).toBe(true);
        alice.player.lockTrading();
        runSeconds(game, 30);
        expect(alice.player.account.shares).toBe(20_000 - 10_500); // $10,500 at the $1.00 mark
        expect(alice.player.account.cash).toBe(0);
    });

    test("collects at the final bell when the game ends before the loan is due", () => {
        const { game, alice } = arena({ gameDuration: 0.5 }); // 30 seconds
        runSeconds(game, 10);
        game.powers.activate(loanShark, alice.player);
        runSeconds(game, 20);
        expect(game.ended).toBe(true);
        expect(alice.player.account.cash).toBe(950_000);
        expect(game.result!.players[0]!.cash).toBe(9_500);
    });
});
