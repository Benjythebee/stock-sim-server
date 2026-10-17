import { describe, expect, test } from "bun:test";
import { MessageType } from "../../src/protocol/messages";
import { builtinCatalog, makeGame, makePlayer, runSeconds } from "../helpers";

const power = builtinCatalog.powers.get("too-big-to-fail")!;

/** A one-minute game with two players and the default $5,000 loan at 10%. */
function arena(settings: Parameters<typeof makeGame>[0] = {}) {
    const { game } = makeGame({ gameDuration: 1, startingCash: 10_000, houseLiquidity: false, ...settings });
    const a = makePlayer("alice");
    const b = makePlayer("bob");
    game.addPlayer(a.player);
    game.addPlayer(b.player);
    return { game, a, b };
}

describe("too-big-to-fail (mods/powers/too-big-to-fail)", () => {
    test("loads from mods/ with its own icon, as a rare inventory power", () => {
        const pub = builtinCatalog.powers.publicOf(power, "X");
        expect(pub).toMatchObject({ id: "too-big-to-fail", title: "Too Big to Fail", type: "client", isInstant: false, durationTicks: 0 });
        expect(pub.iconUrl).toBe("/assets/powers/too-big-to-fail/bank.svg");
        expect(builtinCatalog.powers.assets.has(pub.iconUrl!)).toBe(true);
        const others = builtinCatalog.powers.offerable().filter((d) => d.id !== power.id);
        expect(Math.min(...others.map((d) => d.weight))).toBeGreaterThanOrEqual(power.weight); // among the rarest
    });

    test("only offered when the room has borrowing on", () => {
        expect(power.available!(arena().game)).toBe(true);
        expect(power.available!(arena({ enableBorrowing: false }).game)).toBe(false);
    });

    test("without a loan: borrows the loan amount at 0%, and the end of the game collects just the principal", () => {
        const { game, a, b } = arena();
        game.powers.activate(power, a.player);
        const account = a.player.account;
        expect(account.availableCash).toBe(1_500_000);
        expect(account.loan!.maxInterest).toBe(0);
        expect(a.socket.last(MessageType.NOTIFICATION)).toMatchObject({ level: "success", description: expect.stringContaining("$5,000.00 at 0% interest") });
        expect(b.socket.of(MessageType.NOTIFICATION)).toHaveLength(0);

        runSeconds(game, 60);
        expect(game.ended).toBe(true);
        expect(account.loan).toBeNull();
        expect(account.cash).toBe(1_000_000);
    });

    test("with a loan: writes off the interest so far and makes the rest interest-free", () => {
        const { game, a } = arena();
        const account = a.player.account;
        game.bank.borrow(a.player);
        runSeconds(game, 30); // half the term: $250 accrued
        expect(account.debt).toBe(525_000);

        game.powers.activate(power, a.player);
        expect(account.availableCash).toBe(1_500_000); // no second loan
        expect(account.debt).toBe(500_000);
        expect(a.socket.last(MessageType.NOTIFICATION)!.description).toBe(
            "Your $5,000.00 loan is now interest-free, and the bank wrote off the $250.00 of interest it had built up.",
        );
        runSeconds(game, 30);
        expect(account.cash).toBe(1_000_000);
    });

    test("a loan taken from the bank after repaying pays the normal rate again", () => {
        const { game, a } = arena();
        game.powers.activate(power, a.player);
        expect(game.bank.repay(a.player).ok).toBe(true);
        expect(game.bank.borrow(a.player)).toMatchObject({ ok: true, interest: 50_000 });
    });
});
