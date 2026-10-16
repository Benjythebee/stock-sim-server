import { describe, expect, test } from "bun:test";
import { OrderBook } from "../../src/engine/order-book";

describe("OrderBook", () => {
    test("non-crossing limit orders rest on the book", () => {
        const book = new OrderBook();
        const bid = book.limit("a", "buy", 99, 10);
        const ask = book.limit("b", "sell", 101, 5);
        expect(bid.fills).toHaveLength(0);
        expect(bid.remaining).toBe(10);
        expect(bid.orderId).toBeGreaterThan(0);
        expect(ask.orderId).not.toBe(bid.orderId);
        expect(book.bestBid()).toBe(99);
        expect(book.bestAsk()).toBe(101);
        expect(book.size).toBe(2);
        expect(book.lastPrice).toBeNull();
    });

    test("crossing limit trades at the maker's price (taker gets price improvement)", () => {
        const book = new OrderBook();
        book.limit("maker", "sell", 100, 5);
        const r = book.limit("taker", "buy", 105, 5);
        expect(r.fills).toEqual([
            { makerOrderId: 1, makerOwner: "maker", takerOwner: "taker", takerSide: "buy", price: 100, qty: 5, makerDone: true },
        ]);
        expect(r.remaining).toBe(0);
        expect(r.orderId).toBe(0);
        expect(book.size).toBe(0);
        expect(book.lastPrice).toBe(100);
    });

    test("price priority, then time priority", () => {
        const book = new OrderBook();
        book.limit("late-better", "sell", 100, 1, 2);
        book.limit("early", "sell", 101, 1, 0);
        book.limit("late", "sell", 101, 1, 1);
        const r = book.limit("taker", "buy", 101, 3);
        expect(r.fills.map((f) => f.makerOwner)).toEqual(["late-better", "early", "late"]);
        expect(r.fills.map((f) => f.price)).toEqual([100, 101, 101]);
    });

    test("partial fill leaves the maker resting with reduced size", () => {
        const book = new OrderBook();
        const maker = book.limit("m", "buy", 50, 10);
        const r = book.limit("t", "sell", 50, 4);
        expect(r.fills[0]).toMatchObject({ qty: 4, makerDone: false });
        expect(book.get(maker.orderId)!.remaining).toBe(6);
        expect(book.depth()[1]).toEqual([[50, 6]]);
    });

    test("taker remainder rests after sweeping the book", () => {
        const book = new OrderBook();
        book.limit("m1", "sell", 100, 2);
        book.limit("m2", "sell", 102, 2);
        const r = book.limit("t", "buy", 101, 5);
        expect(r.filled).toBe(2);
        expect(r.remaining).toBe(3);
        expect(book.bestBid()).toBe(101);
        expect(book.bestAsk()).toBe(102);
    });

    test("market order sweeps levels and reports what it could not fill", () => {
        const book = new OrderBook();
        book.limit("m1", "sell", 100, 2);
        book.limit("m2", "sell", 105, 3);
        const r = book.market("t", "buy", 10);
        expect(r.filled).toBe(5);
        expect(r.remaining).toBe(5);
        expect(r.orderId).toBe(0);
        expect(book.bestAsk()).toBeNull();
        expect(book.size).toBe(0);
    });

    test("market buy respects a budget", () => {
        const book = new OrderBook();
        book.limit("m1", "sell", 100, 3); // 300
        book.limit("m2", "sell", 200, 3); // 600
        const r = book.market("t", "buy", 10, 550);
        // 3 @ 100 = 300, then floor(250 / 200) = 1 @ 200
        expect(r.fills.map((f) => [f.price, f.qty])).toEqual([
            [100, 3],
            [200, 1],
        ]);
        expect(book.depth()[0]).toEqual([[200, 2]]);
    });

    test("market buy with a budget too small for one share fills nothing", () => {
        const book = new OrderBook();
        book.limit("m", "sell", 100, 3);
        const r = book.market("t", "buy", 1, 99);
        expect(r.filled).toBe(0);
        expect(book.depth()[0]).toEqual([[100, 3]]);
    });

    test("cancel removes the order and its empty level", () => {
        const book = new OrderBook();
        const a = book.limit("a", "buy", 99, 5);
        const b = book.limit("b", "buy", 99, 7);
        expect(book.cancel(a.orderId)).toMatchObject({ cancelledQty: 5 });
        expect(book.depth()[1]).toEqual([[99, 7]]);
        expect(book.cancel(a.orderId)).toBeNull();
        book.cancel(b.orderId);
        expect(book.bestBid()).toBeNull();
        expect(book.size).toBe(0);
    });

    test("cancelled orders are skipped when matching", () => {
        const book = new OrderBook();
        const first = book.limit("first", "sell", 100, 5);
        book.limit("second", "sell", 100, 5);
        book.cancel(first.orderId);
        const r = book.limit("t", "buy", 100, 5);
        expect(r.fills.map((f) => f.makerOwner)).toEqual(["second"]);
    });

    test("depth aggregates per level, best first, capped", () => {
        const book = new OrderBook();
        book.limit("a", "buy", 97, 1);
        book.limit("b", "buy", 99, 2);
        book.limit("c", "buy", 99, 3);
        book.limit("d", "buy", 98, 4);
        book.limit("e", "sell", 103, 1);
        book.limit("f", "sell", 101, 1);
        const [asks, bids] = book.depth(2);
        expect(bids).toEqual([
            [99, 5],
            [98, 4],
        ]);
        expect(asks).toEqual([
            [101, 1],
            [103, 1],
        ]);
    });

    test("version bumps on every liquidity change, not on no-ops", () => {
        const book = new OrderBook();
        const v0 = book.version;
        const o = book.limit("a", "buy", 99, 1);
        expect(book.version).toBeGreaterThan(v0);
        const v1 = book.version;
        book.market("b", "buy", 1); // no asks: nothing changes
        expect(book.version).toBe(v1);
        book.cancel(o.orderId);
        expect(book.version).toBeGreaterThan(v1);
    });

    test("stress: thousands of random orders keep the book consistent", () => {
        const book = new OrderBook();
        let seed = 1;
        const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
        const live: number[] = [];
        for (let i = 0; i < 20_000; i++) {
            const r = rand();
            if (r < 0.1 && live.length) {
                book.cancel(live.splice(Math.floor(rand() * live.length), 1)[0]!);
            } else if (r < 0.2) {
                book.market("m", rand() < 0.5 ? "buy" : "sell", 1 + Math.floor(rand() * 20));
            } else {
                const res = book.limit(`o${i}`, rand() < 0.5 ? "buy" : "sell", 90 + Math.floor(rand() * 20), 1 + Math.floor(rand() * 10));
                if (res.orderId) live.push(res.orderId);
            }
            const bid = book.bestBid();
            const ask = book.bestAsk();
            if (bid !== null && ask !== null) expect(bid).toBeLessThan(ask);
        }
        // Depth totals equal the sum of live orders' remaining quantity.
        const [asks, bids] = book.depth(1000);
        const depthTotal = [...asks, ...bids].reduce((s, [, q]) => s + q, 0);
        let liveTotal = 0;
        for (const id of live) liveTotal += book.get(id)?.remaining ?? 0;
        expect(depthTotal).toBe(liveTotal);
    });
});
