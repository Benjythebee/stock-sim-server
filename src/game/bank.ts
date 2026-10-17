import { Loan } from "../engine/loan";
import { formatCents, toTicks } from "../engine/money";
import type { LoanRepayPortion } from "../protocol/messages";
import type { Game } from "./game";
import type { Player } from "./player";

export type LoanRejection = "borrowing-disabled" | "already-borrowed" | "game-over" | "no-loan" | "insufficient-cash";

export type BankOutcome = { ok: true; principal: number; interest: number; remaining: number } | { ok: false; reason: LoanRejection };

/**
 * Lends players `settings.loanAmount`, one loan at a time. A loan's interest accrues linearly from
 * when it's taken to the end of the game (see Loan), and whatever is still owed when the game ends
 * is collected from cash, even if that leaves the player in the red. The debt counts against the
 * player's equity the whole time, so borrowing never inflates P&L; only the interest moves it.
 * Amounts in the outcomes are cents.
 */
export class Bank {
    constructor(private readonly game: Game) {}

    /** The step the game ends on: every loan's term runs to it. */
    private get endStep(): number {
        return this.game.durationSteps;
    }

    borrow(player: Player): BankOutcome {
        const { settings } = this.game;
        if (!settings.enableBorrowing) return { ok: false, reason: "borrowing-disabled" };
        if (this.game.ended || this.game.step >= this.endStep) return { ok: false, reason: "game-over" };
        const account = player.account;
        if (account.loan) return { ok: false, reason: "already-borrowed" };

        const principal = toTicks(settings.loanAmount);
        account.loan = new Loan(principal, settings.loanInterestPercent / 100, this.game.step, this.endStep, this.game.stepClock);
        account.debt = principal;
        account.adjustCash(principal);
        return { ok: true, principal, interest: account.loan.maxInterest, remaining: principal };
    }

    /**
     * Repay the whole loan, or half of what's left of it, plus the interest accrued so far, from
     * available cash (refused unless it covers it all). After a half repayment only the rest
     * accrues interest. `remaining` in the outcome is the principal still owed.
     */
    repay(player: Player, portion: LoanRepayPortion = "all"): BankOutcome {
        const account = player.account;
        const loan = account.loan;
        if (!loan) return { ok: false, reason: "no-loan" };
        const step = this.game.step;
        const principal = portion === "half" ? Math.ceil(loan.principal / 2) : loan.principal;
        const due = principal + loan.interestAt(step);
        if (account.availableCash < due) return { ok: false, reason: "insufficient-cash" };
        const interest = loan.payDown(principal, step);
        account.adjustCash(-due);
        if (loan.principal === 0) account.loan = null;
        account.debt = account.loan ? loan.owedAt(step) : 0;
        return { ok: true, principal, interest, remaining: loan.principal };
    }

    /** Bring every borrower's debt up to date (once per game second, so their P&L ticks down). */
    accrue(players: Iterable<Player>): void {
        const step = this.game.step;
        for (const { account } of players) {
            if (!account.loan) continue;
            const debt = account.loan.owedAt(step);
            if (debt === account.debt) continue;
            account.debt = debt;
            account.dirty = true;
        }
    }

    /**
     * End of game: collect every outstanding loan with its full interest. Taken straight from cash,
     * which may go negative. Equity doesn't change (the debt was already counted against it).
     */
    collectAll(players: Iterable<Player>): void {
        for (const player of players) {
            const account = player.account;
            const loan = account.loan;
            if (!loan) continue;
            const owed = loan.owedAt(this.endStep);
            account.cash -= owed;
            account.loan = null;
            account.debt = 0;
            account.dirty = true;
            const short = account.cash < 0;
            this.game.notify([player], {
                level: short ? "warning" : "info",
                title: "The bank collected your loan",
                description:
                    `You still owed ${formatCents(loan.principal)} plus ${formatCents(owed - loan.principal)} interest.` +
                    (short ? ` That leaves you ${formatCents(-account.cash)} in the red.` : ""),
            });
        }
    }
}
