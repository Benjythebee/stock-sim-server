/**
 * Single-instrument limit order book with price-time priority.
 *
 * - Prices are integer ticks (cents), quantities are integer shares.
 * - Makers always trade at their resting price (takers get price improvement).
 * - The book knows nothing about cash. It reports fills and lets the caller settle them
 *   (see game/market.ts).
 *
 * Performance notes: every price level is a FIFO array with a moving head (O(1) pops), and
 * each side keeps a sorted array of level keys with the best price at the END, so taking the
 * best level or removing an exhausted best level is O(1). Inserting a brand-new price level is
 * a binary search plus a splice, which is cheap for the few hundred levels a game ever has.
 */

export type Side = "buy" | "sell";

export interface Order {
    readonly id: number;
    readonly owner: string;
    readonly side: Side;
    /** Limit price in ticks. */
    readonly price: number;
    readonly originalQty: number;
    remaining: number;
    /** Caller-supplied timestamp (game time), used by bots to expire stale quotes. */
    readonly time: number;
}

export interface Fill {
    readonly makerOrderId: number;
    readonly makerOwner: string;
    readonly takerOwner: string;
    readonly takerSide: Side;
    /** Execution price in ticks (always the maker's price). */
    readonly price: number;
    readonly qty: number;
    /** True when this fill exhausted the maker order and removed it from the book. */
    readonly makerDone: boolean;
}

export interface MatchResult {
    /** Id of the resting remainder (limit orders only, 0 if nothing rests). */
    orderId: number;
    fills: Fill[];
    filled: number;
    /** Limit: quantity left resting on the book. Market: quantity that could not be filled. */
    remaining: number;
}

export type DepthLevel = [price: number, qty: number];

class Level {
    queue: Order[] = [];
    head = 0;
    /** Total remaining quantity at this level. */
    qty = 0;
    /** Number of live (non-cancelled, non-filled) orders. */
    live = 0;
    constructor(readonly price: number) {}

    compact(): void {
        if (this.head > 32 && this.head * 2 > this.queue.length) {
            this.queue = this.queue.slice(this.head);
            this.head = 0;
        }
    }
}

class BookSide {
    /** Sort keys ascending. key = price for bids, -price for asks, so the best level is last. */
    private keys: number[] = [];
    private levels = new Map<number, Level>();

    constructor(private readonly isBid: boolean) {}

    get levelCount(): number {
        return this.keys.length;
    }

    private key(price: number): number {
        return this.isBid ? price : -price;
    }

    best(): Level | undefined {
        const k = this.keys[this.keys.length - 1];
        return k === undefined ? undefined : this.levels.get(this.isBid ? k : -k);
    }

    level(price: number): Level | undefined {
        return this.levels.get(price);
    }

    getOrCreate(price: number): Level {
        let level = this.levels.get(price);
        if (level) return level;
        level = new Level(price);
        this.levels.set(price, level);
        const k = this.key(price);
        let lo = 0;
        let hi = this.keys.length;
        while (lo < hi) {
            const mid = (lo + hi) >>> 1;
            if (this.keys[mid]! < k) lo = mid + 1;
            else hi = mid;
        }
        this.keys.splice(lo, 0, k);
        return level;
    }

    remove(level: Level): void {
        this.levels.delete(level.price);
        const k = this.key(level.price);
        const lastIndex = this.keys.length - 1;
        if (this.keys[lastIndex] === k) {
            this.keys.pop();
            return;
        }
        let lo = 0;
        let hi = lastIndex;
        while (lo < hi) {
            const mid = (lo + hi) >>> 1;
            if (this.keys[mid]! < k) lo = mid + 1;
            else hi = mid;
        }
        if (this.keys[lo] === k) this.keys.splice(lo, 1);
    }

    depth(maxLevels: number): DepthLevel[] {
        const out: DepthLevel[] = [];
        for (let i = this.keys.length - 1; i >= 0 && out.length < maxLevels; i--) {
            const k = this.keys[i]!;
            const level = this.levels.get(this.isBid ? k : -k)!;
            out.push([level.price, level.qty]);
        }
        return out;
    }

    clear(): void {
        this.keys = [];
        this.levels.clear();
    }
}

export class OrderBook {
    private readonly bids = new BookSide(true);
    private readonly asks = new BookSide(false);
    private readonly orders = new Map<number, Order>();
    private nextOrderId = 1;

    /** Last execution price in ticks, null until the first trade. */
    lastPrice: number | null = null;
    /** Bumped on every change to resting liquidity. Cheap dirty-check for depth broadcasts. */
    version = 0;

    get size(): number {
        return this.orders.size;
    }

    bestBid(): number | null {
        return this.bids.best()?.price ?? null;
    }

    bestAsk(): number | null {
        return this.asks.best()?.price ?? null;
    }

    get(orderId: number): Order | undefined {
        return this.orders.get(orderId);
    }

    /** Total resting quantity at a price on one side. */
    qtyAt(side: Side, price: number): number {
        return (side === "buy" ? this.bids : this.asks).level(price)?.qty ?? 0;
    }

    /**
     * Limit order: match against the opposite side up to `price`, then rest the remainder.
     */
    limit(owner: string, side: Side, price: number, qty: number, time = 0): MatchResult {
        const fills: Fill[] = [];
        const filled = this.match(owner, side, qty, price, null, fills);
        const remaining = qty - filled;
        let orderId = 0;
        if (remaining > 0) {
            orderId = this.nextOrderId++;
            const order: Order = { id: orderId, owner, side, price, originalQty: qty, remaining, time };
            const level = (side === "buy" ? this.bids : this.asks).getOrCreate(price);
            level.queue.push(order);
            level.qty += remaining;
            level.live++;
            this.orders.set(orderId, order);
            this.version++;
        }
        return { orderId, fills, filled, remaining };
    }

    /**
     * Market order (immediate-or-cancel): take liquidity until `qty` is filled or the book runs
     * dry. For buys, `budgetTicks` caps the total spend so the caller can never overdraw.
     */
    market(owner: string, side: Side, qty: number, budgetTicks: number | null = null): MatchResult {
        const fills: Fill[] = [];
        const filled = this.match(owner, side, qty, null, side === "buy" ? budgetTicks : null, fills);
        return { orderId: 0, fills, filled, remaining: qty - filled };
    }

    /** Cancel a resting order. Returns the order and the quantity that was still open. */
    cancel(orderId: number): { order: Order; cancelledQty: number } | null {
        const order = this.orders.get(orderId);
        if (!order) return null;
        const side = order.side === "buy" ? this.bids : this.asks;
        const level = side.level(order.price);
        const cancelledQty = order.remaining;
        this.orders.delete(orderId);
        order.remaining = 0;
        if (level) {
            level.qty -= cancelledQty;
            level.live--;
            if (level.live === 0) side.remove(level);
            else level.compact();
        }
        this.version++;
        return { order, cancelledQty };
    }

    /** Aggregated depth, best price first: [asks, bids], each [priceTicks, qty][]. */
    depth(maxLevels = 50): [asks: DepthLevel[], bids: DepthLevel[]] {
        return [this.asks.depth(maxLevels), this.bids.depth(maxLevels)];
    }

    clear(): void {
        this.bids.clear();
        this.asks.clear();
        this.orders.clear();
        this.version++;
    }

    private match(
        takerOwner: string,
        side: Side,
        qty: number,
        limitPrice: number | null,
        budget: number | null,
        fills: Fill[],
    ): number {
        const book = side === "buy" ? this.asks : this.bids;
        let remaining = qty;
        let spent = 0;

        outer: while (remaining > 0) {
            const level = book.best();
            if (!level) break;
            if (limitPrice !== null && (side === "buy" ? level.price > limitPrice : level.price < limitPrice)) break;

            while (remaining > 0 && level.head < level.queue.length) {
                const maker = level.queue[level.head]!;
                if (maker.remaining === 0) {
                    level.head++;
                    continue;
                }
                let q = remaining < maker.remaining ? remaining : maker.remaining;
                if (budget !== null) {
                    const affordable = Math.floor((budget - spent) / level.price);
                    if (affordable <= 0) {
                        this.settleLevel(book, level);
                        break outer;
                    }
                    if (affordable < q) q = affordable;
                }
                maker.remaining -= q;
                level.qty -= q;
                remaining -= q;
                spent += q * level.price;
                const makerDone = maker.remaining === 0;
                if (makerDone) {
                    level.head++;
                    level.live--;
                    this.orders.delete(maker.id);
                }
                fills.push({
                    makerOrderId: maker.id,
                    makerOwner: maker.owner,
                    takerOwner,
                    takerSide: side,
                    price: level.price,
                    qty: q,
                    makerDone,
                });
                this.lastPrice = level.price;
            }
            this.settleLevel(book, level);
        }

        if (remaining !== qty) this.version++;
        return qty - remaining;
    }

    private settleLevel(book: BookSide, level: Level): void {
        if (level.live === 0) book.remove(level);
        else level.compact();
    }
}
