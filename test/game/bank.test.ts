import { describe, expect, test } from "bun:test";
import { MessageType } from "../../src/protocol/messages";
import { makeGame, makePlayer, runSeconds } from "../helpers";

/** A one-minute game (300 steps) with one player and the default $5,000 loan at 10%. */
function setup(settings: Parameters<typeof makeGame>[0] = {}) {
    const { game, broadcasts } = makeGame({ gameDuration: 1, houseLiquidity: false, ...settings });
    const { player, socket } = makePlayer();
    game.addPlayer(player);
    return { game, broadcasts, player, socket, account: player.account };
}

describe("Bank", () => {
    test("borrowing adds the loan amount to cash without changing P&L", () => {
        const { game, player, account } = setup();
        const outcome = game.bank.borrow(player);
        expect(outcome).toEqual({ ok: true, principal: 500_000, interest: 50_000, remaining: 500_000 });
        expect(account.availableCash).toBe(1_500_000);
        expect(account.debt).toBe(500_000);
        expect(account.pnl(game.market.markTicks)).toBe(0);
        expect(player.portfolio(game.market.markTicks).loan).toEqual({ principal: 5000, interest: 0, maxInterest: 500, time: game.startClock });
    });

    test("one loan at a time, and none when borrowing is off", () => {
        const { game, player } = setup();
        game.bank.borrow(player);
        expect(game.bank.borrow(player)).toEqual({ ok: false, reason: "already-borrowed" });

        const off = setup({ enableBorrowing: false });
        expect(off.game.bank.borrow(off.player)).toEqual({ ok: false, reason: "borrowing-disabled" });
        expect(off.account.availableCash).toBe(1_000_000);
    });

    test("interest accrues with time and repaying early only pays the part accrued so far", () => {
        const { game, player, account, socket } = setup();
        game.bank.borrow(player);
        runSeconds(game, 15); // a quarter of the game
        expect(account.debt).toBe(512_500);
        expect(account.pnl(game.market.markTicks)).toBe(-12_500);
        expect(socket.last(MessageType.PORTFOLIO_UPDATE)!.value).toMatchObject({ pnl: -125, loan: { principal: 5000, interest: 125, maxInterest: 500 } });

        expect(game.bank.repay(player)).toEqual({ ok: true, principal: 500_000, interest: 12_500, remaining: 0 });
        expect(account.availableCash).toBe(1_000_000 - 12_500);
        expect(account.loan).toBeNull();
        expect(account.debt).toBe(0);
        expect(account.pnl(game.market.markTicks)).toBe(-12_500);
        expect(game.bank.repay(player)).toEqual({ ok: false, reason: "no-loan" });
    });

    test("repaying half settles the interest so far, and only the other half accrues after that", () => {
        const { game, player, account } = setup();
        game.bank.borrow(player);
        runSeconds(game, 15);
        expect(game.bank.repay(player, "half")).toEqual({ ok: true, principal: 250_000, interest: 12_500, remaining: 250_000 });
        expect(account.availableCash).toBe(1_500_000 - 262_500);
        expect(account.debt).toBe(250_000);
        expect(player.portfolio(game.market.markTicks).loan).toMatchObject({ principal: 2500, interest: 0, maxInterest: 187.5 });

        runSeconds(game, 15);
        expect(account.debt).toBe(256_250); // 10% a game on $2,500 for a quarter of it
        runSeconds(game, 30);
        expect(game.ended).toBe(true);
        expect(account.pnl(game.market.markTicks)).toBe(-31_250); // 125 + 187.50, not the full 500
        expect(account.cash).toBe(1_000_000 - 31_250);
    });

    test("halving can go on until nothing is left, and needs the cash for the half plus the interest", () => {
        const { game, player, account } = setup({ loanAmount: 0.05 });
        game.bank.borrow(player);
        expect(game.bank.repay(player, "half")).toMatchObject({ ok: true, principal: 3, remaining: 2 });
        expect(game.bank.repay(player, "half")).toMatchObject({ ok: true, principal: 1, remaining: 1 });
        expect(game.bank.repay(player, "half")).toMatchObject({ ok: true, principal: 1, remaining: 0 });
        expect(account.loan).toBeNull();
        expect(account.debt).toBe(0);

        const broke = setup({ startingCash: 0 });
        broke.game.bank.borrow(broke.player);
        broke.account.adjustCash(-300_000);
        expect(broke.game.bank.repay(broke.player, "half")).toEqual({ ok: false, reason: "insufficient-cash" });
        expect(broke.account.loan!.principal).toBe(500_000);
    });

    test("a loan's term runs to the end of the game: borrowing late, kept to the end, still owes the full interest", () => {
        const { game, player, account } = setup();
        runSeconds(game, 30);
        game.bank.borrow(player);
        runSeconds(game, 15);
        expect(account.debt).toBe(525_000); // half of the remaining term
        runSeconds(game, 15);
        expect(game.ended).toBe(true);
        expect(account.availableCash).toBe(1_000_000 - 50_000);
    });

    test("repaying needs the whole amount in available cash", () => {
        const { game, player, account } = setup({ startingCash: 0 });
        game.bank.borrow(player);
        runSeconds(game, 1);
        account.adjustCash(-100_000); // spent some of it
        expect(game.bank.repay(player)).toEqual({ ok: false, reason: "insufficient-cash" });
        expect(account.loan).not.toBeNull();
    });

    test("unpaid loans are collected with full interest at the end, even into the red", () => {
        const { game, player, account, socket } = setup({ startingCash: 1000 });
        game.bank.borrow(player);
        account.adjustCash(-550_000); // lost it all, and then some
        runSeconds(game, 60);
        expect(game.ended).toBe(true);
        expect(account.loan).toBeNull();
        expect(account.cash).toBe(100_000 + 500_000 - 550_000 - 550_000);
        expect(game.result!.players[0]).toMatchObject({ cash: -5000, loan: null });
        expect(socket.of(MessageType.NOTIFICATION).at(-1)).toMatchObject({ level: "warning", title: "The bank collected your loan" });
    });

    test("collecting at the end leaves P&L where the debt already had it", () => {
        const { game, player, account } = setup();
        game.bank.borrow(player);
        runSeconds(game, 59);
        expect(account.pnl(game.market.markTicks)).toBe(-49_167); // 59 of 60 seconds of interest
        runSeconds(game, 1);
        expect(game.ended).toBe(true);
        expect(account.debt).toBe(0);
        expect(account.pnl(game.market.markTicks)).toBe(-50_000);
        expect(game.result!.players[0]!.pnl).toBe(-500);
    });

    test("a loan can be taken at another rate, e.g. interest-free", () => {
        const { game, player, account } = setup();
        expect(game.bank.borrow(player, 0)).toEqual({ ok: true, principal: 500_000, interest: 0, remaining: 500_000 });
        runSeconds(game, 30);
        expect(account.debt).toBe(500_000);
        expect(account.pnl(game.market.markTicks)).toBe(0);
    });

    test("forgiving interest writes off what accrued and stops it accruing", () => {
        const { game, player, account, socket } = setup();
        expect(game.bank.forgiveInterest(player)).toBeNull();
        game.bank.borrow(player);
        runSeconds(game, 15);
        expect(account.debt).toBe(512_500);
        expect(game.bank.forgiveInterest(player)).toBe(12_500);
        expect(account.debt).toBe(500_000);
        runSeconds(game, 15);
        expect(account.debt).toBe(500_000);
        expect(socket.last(MessageType.PORTFOLIO_UPDATE)!.value).toMatchObject({ pnl: 0, loan: { principal: 5000, interest: 0, maxInterest: 0 } });
        expect(game.bank.repay(player)).toEqual({ ok: true, principal: 500_000, interest: 0, remaining: 0 });
        expect(account.availableCash).toBe(1_000_000);
    });

    test("no loans once the game is over", () => {
        const { game, player } = setup();
        runSeconds(game, 60);
        expect(game.bank.borrow(player)).toEqual({ ok: false, reason: "game-over" });
    });
});
