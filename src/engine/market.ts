import { Account } from "./account";
import { MAX_ORDER_QTY, MAX_PRICE_TICKS, MIN_PRICE_TICKS, toDollars, toTicks } from "./money";
import { OrderBook, type Fill, type Order, type Side } from "./order-book";

export type OrderRejection =
    | "trading-disabled"
    | "invalid-quantity"
    | "invalid-price"
    | "insufficient-cash"
    | "insufficient-shares"
    | "no-liquidity"
    | "unknown-account";

export type OrderOutcome =
    | { ok: true; orderId: number; filled: number; remaining: number; avgPriceTicks: number | null }
    | { ok: false; reason: OrderRejection };

export type TradeListener = (fill: Fill, taker: Account, maker: Account) => void;
export type CancelListener = (order: Order, account: Account) => void;

/**
 * The exchange: an order book plus the accounts trading on it. It validates orders, reserves
 * funds, and settles every fill against both accounts, so cash and shares are always conserved.
 * Pure and synchronous (no I/O or timers), which makes it easy to unit-test and benchmark.
 */
export class Market {
    readonly book = new OrderBook();
    private readonly accounts = new Map<string, Account>();
    readonly openingTicks: number;

    /** Current game time in ms. Stamped on resting orders so stale quotes can be expired. */
    now = 0;

    // Session statistics
    volumeTicks = 0;
    tradedQty = 0;
    tradeCount = 0;
    highTicks: number;
    lowTicks: number;

    private publishedMark = -1;
    private publishedBookVersion = -1;

    /**
     * True: the mark follows the live quotes between trades (see `markTicks`). False: the mark is
     * the last trade only, so the price stays flat until someone actually trades.
     */
    markToQuotes = true;

    onTrade: TradeListener | null = null;
    /** Called for every cancelled resting order, whoever cancelled it (player, bot, power). */
    onCancel: CancelListener | null = null;

    constructor(openingPriceDollars: number) {
        this.openingTicks = Math.max(MIN_PRICE_TICKS, toTicks(openingPriceDollars));
        this.highTicks = this.openingTicks;
        this.lowTicks = this.openingTicks;
    }

    add(account: Account): Account {
        this.accounts.set(account.id, account);
        return account;
    }

    account(id: string): Account | undefined {
        return this.accounts.get(id);
    }

    /** Last trade price in ticks (opening price before the first trade). */
    get lastTradeTicks(): number {
        return this.book.lastPrice ?? this.openingTicks;
    }

    /**
     * Mark price in ticks: the last trade, clamped inside the current best bid/ask. When nobody
     * trades for a while it still follows the live quotes, so the chart and P&L never go stale.
     * With `markToQuotes` off it's just the last trade.
     */
    get markTicks(): number {
        let mark = this.lastTradeTicks;
        if (!this.markToQuotes) return mark;
        const bid = this.book.bestBid();
        const ask = this.book.bestAsk();
        if (bid !== null && mark < bid) mark = bid;
        if (ask !== null && mark > ask) mark = ask;
        return mark;
    }

    /** Mark price in dollars. This is "the price" everywhere in the game. */
    get price(): number {
        return toDollars(this.markTicks);
    }

    /** True when the mark price changed since the last `markPricePublished()`. */
    get priceDirty(): boolean {
        return this.markTicks !== this.publishedMark;
    }

    markPricePublished(): void {
        this.publishedMark = this.markTicks;
    }

    get bookDirty(): boolean {
        return this.book.version !== this.publishedBookVersion;
    }

    markBookPublished(): void {
        this.publishedBookVersion = this.book.version;
    }

    limit(account: Account, side: Side, priceDollars: number, qty: number): OrderOutcome {
        const rejected = this.precheck(account, qty);
        if (rejected) return rejected;
        if (!Number.isFinite(priceDollars)) return { ok: false, reason: "invalid-price" };
        const price = toTicks(priceDollars);
        if (price < MIN_PRICE_TICKS || price > MAX_PRICE_TICKS) return { ok: false, reason: "invalid-price" };

        if (side === "buy") {
            const cost = price * qty;
            if (account.availableCash < cost) return { ok: false, reason: "insufficient-cash" };
            account.reservedCash += cost;
        } else {
            if (account.availableShares < qty) return { ok: false, reason: "insufficient-shares" };
            account.reservedShares += qty;
        }
        account.dirty = true;

        const result = this.book.limit(account.id, side, price, qty, this.now);
        const avg = this.settle(result.fills, account, side === "buy" ? price : null);
        if (result.orderId) account.openOrders.add(result.orderId);
        return { ok: true, orderId: result.orderId, filled: result.filled, remaining: result.remaining, avgPriceTicks: avg };
    }

    market(account: Account, side: Side, qty: number): OrderOutcome {
        const rejected = this.precheck(account, qty);
        if (rejected) return rejected;

        if (side === "buy") {
            if (this.book.bestAsk() === null) return { ok: false, reason: "no-liquidity" };
            const result = this.book.market(account.id, "buy", qty, account.availableCash);
            if (result.filled === 0) return { ok: false, reason: "insufficient-cash" };
            const avg = this.settle(result.fills, account, null);
            return { ok: true, orderId: 0, filled: result.filled, remaining: result.remaining, avgPriceTicks: avg };
        }

        if (account.availableShares < qty) return { ok: false, reason: "insufficient-shares" };
        if (this.book.bestBid() === null) return { ok: false, reason: "no-liquidity" };
        account.reservedShares += qty;
        const result = this.book.market(account.id, "sell", qty);
        const avg = this.settle(result.fills, account, null);
        account.reservedShares -= result.remaining; // release what couldn't be sold
        account.dirty = true;
        return { ok: true, orderId: 0, filled: result.filled, remaining: result.remaining, avgPriceTicks: avg };
    }

    cancel(account: Account, orderId: number): boolean {
        const order = this.book.get(orderId);
        if (!order || order.owner !== account.id) return false;
        const cancelled = this.book.cancel(orderId);
        if (!cancelled) return false;
        if (order.side === "buy") account.reservedCash -= order.price * cancelled.cancelledQty;
        else account.reservedShares -= cancelled.cancelledQty;
        account.openOrders.delete(orderId);
        account.dirty = true;
        this.onCancel?.(order, account);
        return true;
    }

    /** Cancel an account's open orders, optionally only one side and/or only those older than `olderThanMs`. */
    cancelAll(account: Account, filter: { side?: Side; olderThanMs?: number } = {}): number {
        let count = 0;
        for (const id of [...account.openOrders]) {
            const order = this.book.get(id);
            if (!order) {
                account.openOrders.delete(id);
                continue;
            }
            if (filter.side && order.side !== filter.side) continue;
            if (filter.olderThanMs !== undefined && this.now - order.time < filter.olderThanMs) continue;
            if (this.cancel(account, id)) count++;
        }
        return count;
    }

    ordersOf(account: Account, side?: Side): Order[] {
        const out: Order[] = [];
        for (const id of account.openOrders) {
            const order = this.book.get(id);
            if (order && (!side || order.side === side)) out.push(order);
        }
        return out;
    }

    private precheck(account: Account, qty: number): OrderOutcome | null {
        if (this.accounts.get(account.id) !== account) return { ok: false, reason: "unknown-account" };
        if (account.tradingDisabled) return { ok: false, reason: "trading-disabled" };
        if (!Number.isInteger(qty) || qty <= 0 || qty > MAX_ORDER_QTY) return { ok: false, reason: "invalid-quantity" };
        return null;
    }

    /**
     * Apply fills to both sides. `takerLimit` is the taker's buy limit (whose cash was reserved
     * at that price); null when the taker didn't reserve cash (sells, market buys).
     * Returns the taker's average execution price in ticks.
     */
    private settle(fills: Fill[], taker: Account, takerLimit: number | null): number | null {
        if (fills.length === 0) return null;
        let notional = 0;
        let qtyTotal = 0;
        for (const fill of fills) {
            const maker = this.accounts.get(fill.makerOwner);
            if (!maker) throw new Error(`fill against unknown account ${fill.makerOwner}`);
            const cost = fill.price * fill.qty;
            if (fill.takerSide === "buy") {
                taker.cash -= cost;
                taker.shares += fill.qty;
                if (takerLimit !== null) taker.reservedCash -= takerLimit * fill.qty;
                maker.cash += cost;
                maker.shares -= fill.qty;
                maker.reservedShares -= fill.qty;
            } else {
                taker.cash += cost;
                taker.shares -= fill.qty;
                taker.reservedShares -= fill.qty;
                maker.cash -= cost;
                maker.shares += fill.qty;
                maker.reservedCash -= cost;
            }
            if (fill.makerDone) maker.openOrders.delete(fill.makerOrderId);
            maker.dirty = true;
            taker.dirty = true;

            notional += cost;
            qtyTotal += fill.qty;
            this.volumeTicks += cost;
            this.tradedQty += fill.qty;
            this.tradeCount++;
            if (fill.price > this.highTicks) this.highTicks = fill.price;
            if (fill.price < this.lowTicks) this.lowTicks = fill.price;
            this.onTrade?.(fill, taker, maker);
        }
        return Math.round(notional / qtyTotal);
    }
}
