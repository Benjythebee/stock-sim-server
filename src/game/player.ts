import { Account } from "../engine/account";
import { toDollars } from "../engine/money";
import { MessageType, type Portfolio, type ServerMessage } from "../protocol/messages";
import { OrderJournal } from "./orders";

/** The slice of a WebSocket the game needs. Lets tests use fake sockets. */
export interface Connection {
    send(data: string): unknown;
    close(code?: number, reason?: string): void;
}

/** Token bucket: `capacity` burst, refilled at `perSecond`. */
export class RateLimiter {
    private tokens: number;
    private last = performance.now();

    constructor(
        private readonly capacity: number,
        private readonly perSecond: number,
    ) {
        this.tokens = capacity;
    }

    take(): boolean {
        const now = performance.now();
        this.tokens = Math.min(this.capacity, this.tokens + ((now - this.last) / 1000) * this.perSecond);
        this.last = now;
        if (this.tokens < 1) return false;
        this.tokens -= 1;
        return true;
    }
}

/**
 * A human player. Survives disconnects (for a grace period) so a refresh resumes the same seat.
 * The `account` and `orders` are replaced whenever the lobby rebuilds the game.
 */
export class Player {
    connection: Connection | null = null;
    disconnectedAt: number | null = null;
    removalTimer: ReturnType<typeof setTimeout> | null = null;
    account: Account;
    orders = new OrderJournal();
    rateLimitedNotified = 0;
    /**
     * The seat's resume secret, sent only to this player (ID message) and returned as `prevSessionData`.
     * Separate from `id`, which is internal and must never be what resumes a seat.
     */
    readonly resumeToken = crypto.randomUUID();
    /** Active "hide my trades" effects (Burner Phone). Counted so overlapping effects stack. */
    private concealment = 0;

    constructor(
        readonly id: string,
        public name: string,
        readonly orderLimiter: RateLimiter,
    ) {
        this.account = new Account(id, 0, 0, true);
    }

    get connected(): boolean {
        return this.connection !== null;
    }

    send(message: ServerMessage): void {
        this.connection?.send(JSON.stringify(message));
    }

    sendRaw(data: string): void {
        this.connection?.send(data);
    }

    portfolio(markTicks: number): Portfolio {
        return portfolioOf(this.account, markTicks);
    }

    /**
     * Disable trading until the returned function is called. Effects stack: trading resumes only
     * when every lock is released. Releasing twice is a no-op.
     */
    lockTrading(): () => void {
        const account = this.account;
        account.tradingLocks++;
        if (account.tradingLocks === 1) this.sendTradingState();
        let released = false;
        return () => {
            if (released) return;
            released = true;
            account.tradingLocks--;
            if (account.tradingLocks === 0 && account === this.account) this.sendTradingState();
        };
    }

    /**
     * Stop this player's trades from moving the guide price until the returned function is
     * called. Stacks like lockTrading. Releasing twice is a no-op.
     */
    hideMarketImpact(): () => void {
        const account = this.account;
        account.impactShields++;
        let released = false;
        return () => {
            if (released) return;
            released = true;
            account.impactShields--;
        };
    }

    /** True while this player's trades are hidden from surveillance powers (Game.onPlayerTrade). */
    get tradesConcealed(): boolean {
        return this.concealment > 0;
    }

    /**
     * Hide this player's trades from Game.onPlayerTrade listeners (Wiretap, Copycat) until the
     * returned function is called. Stacks like lockTrading. Releasing twice is a no-op.
     */
    concealTrades(): () => void {
        this.concealment++;
        let released = false;
        return () => {
            if (released) return;
            released = true;
            this.concealment--;
        };
    }

    sendTradingState(): void {
        this.send({ type: MessageType.CLIENT_STATE, tradingDisabled: this.account.tradingDisabled });
    }
}

export function portfolioOf(account: Account, markTicks: number): Portfolio {
    return {
        cash: toDollars(account.availableCash),
        shares: account.availableShares,
        pnl: toDollars(account.pnl(markTicks)),
        reservedCash: toDollars(account.reservedCash),
        reservedShares: account.reservedShares,
        loan: account.loan
            ? {
                  principal: toDollars(account.loan.principal),
                  interest: toDollars(account.debt - account.loan.principal),
                  maxInterest: toDollars(account.loan.maxInterest),
                  time: account.loan.takenAt,
              }
            : null,
    };
}
