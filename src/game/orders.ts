import { toDollars } from "../engine/money";
import type { Side } from "../engine/order-book";
import type { OrderInfo, OrderStatus } from "../protocol/messages";

/** Finished orders kept per player. Older ones are dropped. */
export const ORDER_HISTORY_LIMIT = 100;

class OrderRecord {
    filled = 0;
    /** Sum of price * qty over all fills, in ticks (for the average price). */
    notional = 0;
    status: OrderStatus = "open";
    updated: number;

    constructor(
        readonly id: number,
        /** Resting order id on the book, 0 when nothing rests. */
        public bookId: number,
        readonly side: Side,
        /** Limit price in ticks, null for market orders. */
        readonly limitTicks: number | null,
        readonly quantity: number,
        readonly time: number,
    ) {
        this.updated = time;
    }

    toInfo(): OrderInfo {
        return {
            id: this.id,
            action: this.side === "buy" ? "BUY" : "SELL",
            orderType: this.limitTicks === null ? "MARKET" : "LIMIT",
            price: this.limitTicks === null ? null : toDollars(this.limitTicks),
            quantity: this.quantity,
            filled: this.filled,
            avgPrice: this.filled > 0 ? toDollars(Math.round(this.notional / this.filled)) : null,
            status: this.status,
            time: this.time,
            updated: this.updated,
        };
    }
}

/** What an accepted order did right away (from Market.limit / Market.market). */
export interface PlacedOrder {
    orderId: number;
    filled: number;
    remaining: number;
    avgPriceTicks: number | null;
}

/**
 * One human player's orders in the current game: resting limit orders ("current orders") and a
 * capped history of finished ones. The game reports placements, fills and cancels; changes pile
 * up here and Game.flush() sends them as one ORDER_UPDATE, so a burst costs one message.
 */
export class OrderJournal {
    /** Open orders keyed by book order id. */
    private readonly open = new Map<number, OrderRecord>();
    private readonly history: OrderRecord[] = [];
    private readonly changed = new Set<OrderRecord>();
    private resetPending = true;
    private nextId = 1;

    get openCount(): number {
        return this.open.size;
    }

    placed(side: Side, limitTicks: number | null, quantity: number, outcome: PlacedOrder, now: number): OrderInfo {
        const record = new OrderRecord(this.nextId++, outcome.orderId, side, limitTicks, quantity, now);
        record.filled = outcome.filled;
        record.notional = (outcome.avgPriceTicks ?? 0) * outcome.filled;
        if (outcome.orderId) {
            this.open.set(outcome.orderId, record);
        } else {
            record.status = outcome.filled >= quantity ? "filled" : "partial";
            this.archive(record);
        }
        this.changed.add(record);
        return record.toInfo();
    }

    /** A resting order traded (as the maker). */
    filled(bookId: number, priceTicks: number, qty: number, done: boolean, now: number): void {
        const record = this.open.get(bookId);
        if (!record) return;
        record.filled += qty;
        record.notional += priceTicks * qty;
        record.updated = now;
        if (done) {
            record.status = "filled";
            this.close(record);
        }
        this.changed.add(record);
    }

    cancelled(bookId: number, now: number): void {
        const record = this.open.get(bookId);
        if (!record) return;
        record.status = "cancelled";
        record.updated = now;
        this.close(record);
        this.changed.add(record);
    }

    /** Book id of an open order, by its OrderInfo id. */
    bookIdOf(id: number): number | null {
        for (const record of this.open.values()) if (record.id === id) return record.bookId;
        return null;
    }

    /** Open orders, oldest first. */
    openOrders(): OrderInfo[] {
        return [...this.open.values()].map((r) => r.toInfo());
    }

    /** Finished orders, newest first. */
    pastOrders(): OrderInfo[] {
        const out: OrderInfo[] = [];
        for (let i = this.history.length - 1; i >= 0; i--) out.push(this.history[i]!.toInfo());
        return out;
    }

    /** Make the next update a full snapshot (for a (re)joining client). */
    requestReset(): void {
        this.resetPending = true;
    }

    /** Pending changes since the last call, or null if there are none. */
    takeUpdate(): { orders: OrderInfo[]; reset: boolean } | null {
        if (this.resetPending) {
            this.resetPending = false;
            this.changed.clear();
            return { orders: [...this.openOrders(), ...this.pastOrders()], reset: true };
        }
        if (this.changed.size === 0) return null;
        const orders: OrderInfo[] = [];
        for (const record of this.changed) orders.push(record.toInfo());
        this.changed.clear();
        return { orders, reset: false };
    }

    private close(record: OrderRecord): void {
        this.open.delete(record.bookId);
        record.bookId = 0;
        this.archive(record);
    }

    private archive(record: OrderRecord): void {
        this.history.push(record);
        if (this.history.length > ORDER_HISTORY_LIMIT) this.history.shift();
    }
}
