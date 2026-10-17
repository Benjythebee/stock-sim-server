import type { Loan } from "./loan";

/**
 * Cash and share holdings of one trading participant (player or bot). All amounts in cents.
 *
 * Placing an order reserves what it could cost (cash for buys at the limit price, shares for
 * sells). Fills convert the reservation into the actual trade; cancels release it. So
 * `available*` is always what the participant can still commit.
 */
export class Account {
    cash: number;
    reservedCash = 0;
    shares: number;
    reservedShares = 0;
    readonly initialCash: number;
    readonly initialShares: number;

    /** Open order ids on the book belonging to this account. */
    readonly openOrders = new Set<number>();

    /** Active "trading disabled" effects. Counted so overlapping effects stack correctly. */
    tradingLocks = 0;

    /** Active "no market impact" effects (Dark Pool). While > 0, this account's taker trades don't move the guide price. */
    impactShields = 0;

    /** The outstanding bank loan, if any. */
    loan: Loan | null = null;
    /** What the loan costs to repay right now (principal + accrued interest). Counted against equity. */
    debt = 0;

    /** Set on any change; the game loop sends portfolio updates for dirty accounts and clears it. */
    dirty = true;

    constructor(
        readonly id: string,
        cashCents: number,
        shares: number,
        /** Bots are excluded from player-facing effects and from human market impact. */
        readonly isHuman: boolean,
    ) {
        this.cash = cashCents;
        this.shares = shares;
        this.initialCash = cashCents;
        this.initialShares = shares;
    }

    get availableCash(): number {
        return this.cash - this.reservedCash;
    }

    get availableShares(): number {
        return this.shares - this.reservedShares;
    }

    get tradingDisabled(): boolean {
        return this.tradingLocks > 0;
    }

    /** Mark-to-market value in cents, net of debt (so borrowing alone doesn't change it). */
    equity(markTicks: number): number {
        return this.cash + this.shares * markTicks - this.debt;
    }

    /** Profit/loss in cents versus the starting position valued at the same mark. */
    pnl(markTicks: number): number {
        return this.equity(markTicks) - (this.initialCash + this.initialShares * markTicks);
    }

    /** Add (or, with a negative amount, remove) cash. Never takes reserved cash. */
    adjustCash(cents: number): number {
        // Available cash can be negative once the bank has collected an unpaid loan at the end.
        const applied = Math.max(cents, -Math.max(0, this.availableCash));
        this.cash += applied;
        this.dirty = true;
        return applied;
    }

    /** Add (or remove) shares. Never takes reserved shares. */
    adjustShares(qty: number): number {
        const applied = Math.max(qty, -this.availableShares);
        this.shares += applied;
        this.dirty = true;
        return applied;
    }
}
