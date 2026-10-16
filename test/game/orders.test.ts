import { describe, expect, test } from "bun:test";
import { ORDER_HISTORY_LIMIT, OrderJournal } from "../../src/game/orders";

const rest = (orderId: number, filled = 0, avgPriceTicks: number | null = null) => ({ orderId, filled, remaining: 10 - filled, avgPriceTicks });

describe("OrderJournal", () => {
    test("the first update is a full (empty) reset, then nothing until something changes", () => {
        const j = new OrderJournal();
        expect(j.takeUpdate()).toEqual({ orders: [], reset: true });
        expect(j.takeUpdate()).toBeNull();
    });

    test("a resting limit order is open; maker fills accumulate and finish it", () => {
        const j = new OrderJournal();
        j.takeUpdate();
        const info = j.placed("buy", 950, 10, rest(7, 2, 940), 1000);
        expect(info).toMatchObject({ action: "BUY", orderType: "LIMIT", price: 9.5, quantity: 10, filled: 2, avgPrice: 9.4, status: "open", time: 1000 });
        expect(j.openCount).toBe(1);

        j.filled(7, 950, 3, false, 1200);
        j.filled(7, 950, 5, true, 1400);
        const update = j.takeUpdate()!;
        expect(update.reset).toBe(false);
        expect(update.orders).toHaveLength(1); // one entry per changed order, however many events
        expect(update.orders[0]).toMatchObject({ filled: 10, status: "filled", updated: 1400 });
        expect(update.orders[0]!.avgPrice).toBeCloseTo((2 * 9.4 + 8 * 9.5) / 10, 2);
        expect(j.openCount).toBe(0);
        expect(j.pastOrders()).toHaveLength(1);
    });

    test("market orders go straight to history: filled, or partial when the book ran dry", () => {
        const j = new OrderJournal();
        j.placed("sell", null, 10, { orderId: 0, filled: 10, remaining: 0, avgPriceTicks: 1000 }, 0);
        j.placed("buy", null, 10, { orderId: 0, filled: 4, remaining: 6, avgPriceTicks: 1010 }, 0);
        expect(j.openOrders()).toEqual([]);
        expect(j.pastOrders().map((o) => [o.orderType, o.status, o.price])).toEqual([
            ["MARKET", "partial", null],
            ["MARKET", "filled", null],
        ]);
    });

    test("a fully filled limit order never rests", () => {
        const j = new OrderJournal();
        j.placed("buy", 1000, 10, { orderId: 0, filled: 10, remaining: 0, avgPriceTicks: 990 }, 0);
        expect(j.pastOrders()[0]).toMatchObject({ orderType: "LIMIT", status: "filled", avgPrice: 9.9 });
    });

    test("cancel moves an order to history; ids map back to book ids only while open", () => {
        const j = new OrderJournal();
        const info = j.placed("sell", 1100, 10, rest(3), 0);
        expect(j.bookIdOf(info.id)).toBe(3);
        j.cancelled(3, 500);
        expect(j.bookIdOf(info.id)).toBeNull();
        expect(j.pastOrders()[0]).toMatchObject({ status: "cancelled", filled: 0, avgPrice: null, updated: 500 });
        j.cancelled(3, 600); // unknown/closed: ignored
        j.filled(3, 1100, 1, true, 600);
        expect(j.pastOrders()).toHaveLength(1);
    });

    test("history is capped (oldest dropped) and the reset lists open first, then newest history", () => {
        const j = new OrderJournal();
        for (let i = 0; i < ORDER_HISTORY_LIMIT + 5; i++) j.placed("buy", null, 1, { orderId: 0, filled: 1, remaining: 0, avgPriceTicks: 100 }, i);
        j.placed("buy", 90, 10, rest(1), 999);
        expect(j.pastOrders()).toHaveLength(ORDER_HISTORY_LIMIT);
        j.requestReset();
        const { orders, reset } = j.takeUpdate()!;
        expect(reset).toBe(true);
        expect(orders).toHaveLength(ORDER_HISTORY_LIMIT + 1);
        expect(orders[0]!.status).toBe("open");
        expect(orders[1]!.time).toBe(ORDER_HISTORY_LIMIT + 4);
        expect(orders.at(-1)!.time).toBe(5);
    });
});
