import { describe, expect, test } from "bun:test";
import { Account } from "../../src/engine/account";
import { Market } from "../../src/engine/market";

/** $ → cents */
const c = (dollars: number) => Math.round(dollars * 100);

function setup() {
    const market = new Market(10);
    const alice = market.add(new Account("alice", c(1000), 100, true));
    const bob = market.add(new Account("bob", c(1000), 100, true));
    return { market, alice, bob };
}

function totals(...accounts: Account[]) {
    return {
        cash: accounts.reduce((s, a) => s + a.cash, 0),
        shares: accounts.reduce((s, a) => s + a.shares, 0),
    };
}

describe("Market: validation", () => {
    test("rejects bad quantities and prices", () => {
        const { market, alice } = setup();
        expect(market.limit(alice, "buy", 10, 0)).toEqual({ ok: false, reason: "invalid-quantity" });
        expect(market.limit(alice, "buy", 10, 1.5)).toEqual({ ok: false, reason: "invalid-quantity" });
        expect(market.limit(alice, "buy", 10, -3)).toEqual({ ok: false, reason: "invalid-quantity" });
        expect(market.limit(alice, "buy", 0, 1)).toEqual({ ok: false, reason: "invalid-price" });
        expect(market.limit(alice, "buy", NaN, 1)).toEqual({ ok: false, reason: "invalid-price" });
        expect(market.limit(alice, "buy", 10_000_001, 1)).toEqual({ ok: false, reason: "invalid-price" });
    });

    test("rejects orders it can't fund", () => {
        const { market, alice } = setup();
        expect(market.limit(alice, "buy", 11, 100)).toEqual({ ok: false, reason: "insufficient-cash" });
        expect(market.limit(alice, "sell", 11, 101)).toEqual({ ok: false, reason: "insufficient-shares" });
        expect(market.market(alice, "sell", 101)).toEqual({ ok: false, reason: "insufficient-shares" });
    });

    test("rejects when trading is disabled, and for foreign accounts", () => {
        const { market, alice } = setup();
        alice.tradingLocks = 1;
        expect(market.limit(alice, "buy", 10, 1)).toEqual({ ok: false, reason: "trading-disabled" });
        expect(market.limit(new Account("ghost", 100, 0, true), "buy", 1, 1)).toEqual({ ok: false, reason: "unknown-account" });
    });

    test("market orders need someone on the other side", () => {
        const { market, alice } = setup();
        expect(market.market(alice, "buy", 1)).toEqual({ ok: false, reason: "no-liquidity" });
        expect(market.market(alice, "sell", 1)).toEqual({ ok: false, reason: "no-liquidity" });
    });
});

describe("Market: reservations & settlement", () => {
    test("a resting buy reserves cash; cancel releases it", () => {
        const { market, alice } = setup();
        const r = market.limit(alice, "buy", 9.5, 10);
        expect(r.ok).toBe(true);
        expect(alice.reservedCash).toBe(c(95));
        expect(alice.availableCash).toBe(c(905));
        expect(alice.openOrders.size).toBe(1);
        expect(market.cancel(alice, r.ok ? r.orderId : 0)).toBe(true);
        expect(alice.reservedCash).toBe(0);
        expect(alice.availableCash).toBe(c(1000));
        expect(alice.openOrders.size).toBe(0);
    });

    test("a resting sell reserves shares; cancel releases them", () => {
        const { market, alice } = setup();
        const r = market.limit(alice, "sell", 12, 30);
        expect(alice.availableShares).toBe(70);
        market.cancel(alice, r.ok ? r.orderId : 0);
        expect(alice.availableShares).toBe(100);
    });

    test("onCancel reports every cancelled order with its owner", () => {
        const { market, alice } = setup();
        const seen: [number, string][] = [];
        market.onCancel = (order, account) => seen.push([order.id, account.id]);
        const r = market.limit(alice, "buy", 9, 1);
        market.limit(alice, "buy", 8, 1);
        market.cancel(alice, r.ok ? r.orderId : 0);
        market.cancelAll(alice);
        expect(seen).toEqual([[1, "alice"], [2, "alice"]]);
    });

    test("you can't cancel someone else's order", () => {
        const { market, alice, bob } = setup();
        const r = market.limit(alice, "buy", 9, 1);
        expect(market.cancel(bob, r.ok ? r.orderId : 0)).toBe(false);
        expect(alice.openOrders.size).toBe(1);
    });

    test("limit vs limit settles both sides at the maker price and refunds the taker's improvement", () => {
        const { market, alice, bob } = setup();
        const before = totals(alice, bob);
        market.limit(bob, "sell", 10, 20); // maker
        const r = market.limit(alice, "buy", 11, 20); // taker, willing to pay more
        expect(r).toMatchObject({ ok: true, filled: 20, remaining: 0, avgPriceTicks: 1000 });

        expect(alice.cash).toBe(c(1000 - 200));
        expect(alice.shares).toBe(120);
        expect(alice.reservedCash).toBe(0); // reserved at $11, settled at $10, difference released
        expect(bob.cash).toBe(c(1000 + 200));
        expect(bob.shares).toBe(80);
        expect(bob.reservedShares).toBe(0);
        expect(bob.openOrders.size).toBe(0);
        expect(totals(alice, bob)).toEqual(before);
    });

    test("taker sell into resting bids", () => {
        const { market, alice, bob } = setup();
        market.limit(bob, "buy", 9, 10);
        market.limit(alice, "sell", 8, 4);
        expect(alice.cash).toBe(c(1000 + 36));
        expect(alice.shares).toBe(96);
        expect(bob.cash).toBe(c(1000 - 36));
        expect(bob.reservedCash).toBe(c(54)); // 6 still resting at $9
        expect(bob.shares).toBe(104);
    });

    test("market buy is capped by available cash and never overdraws", () => {
        const market = new Market(10);
        const poor = market.add(new Account("poor", c(25), 0, true));
        const mm = market.add(new Account("mm", 0, 100, false));
        market.limit(mm, "sell", 10, 100);
        const r = market.market(poor, "buy", 10);
        expect(r).toMatchObject({ ok: true, filled: 2, remaining: 8 });
        expect(poor.cash).toBe(c(5));
        expect(poor.shares).toBe(2);
    });

    test("market buy with too little cash for one share is rejected", () => {
        const market = new Market(10);
        const poor = market.add(new Account("poor", c(5), 0, true));
        const mm = market.add(new Account("mm", 0, 100, false));
        market.limit(mm, "sell", 10, 100);
        expect(market.market(poor, "buy", 1)).toEqual({ ok: false, reason: "insufficient-cash" });
    });

    test("market sell releases the unfilled remainder", () => {
        const { market, alice, bob } = setup();
        market.limit(bob, "buy", 9, 3);
        const r = market.market(alice, "sell", 10);
        expect(r).toMatchObject({ ok: true, filled: 3, remaining: 7 });
        expect(alice.reservedShares).toBe(0);
        expect(alice.availableShares).toBe(97);
    });

    test("self-trades are harmless", () => {
        const { market, alice } = setup();
        market.limit(alice, "sell", 10, 5);
        market.limit(alice, "buy", 10, 5);
        expect(alice.cash).toBe(c(1000));
        expect(alice.shares).toBe(100);
        expect(alice.reservedCash).toBe(0);
        expect(alice.reservedShares).toBe(0);
    });

    test("cancelAll filters by side and age", () => {
        const { market, alice } = setup();
        market.now = 0;
        market.limit(alice, "buy", 9, 1);
        market.limit(alice, "sell", 11, 1);
        market.now = 5_000;
        market.limit(alice, "buy", 8, 1);
        expect(market.cancelAll(alice, { side: "sell" })).toBe(1);
        expect(market.cancelAll(alice, { olderThanMs: 1_000 })).toBe(1); // only the old buy
        expect(market.ordersOf(alice).map((o) => o.price)).toEqual([800]);
    });

    test("conservation: random trading never creates or destroys cash or shares", () => {
        const market = new Market(10);
        const accounts = Array.from({ length: 6 }, (_, i) => market.add(new Account(`p${i}`, c(10_000), 500, true)));
        const before = totals(...accounts);
        let seed = 3;
        const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
        for (let i = 0; i < 5_000; i++) {
            const a = accounts[Math.floor(rand() * accounts.length)]!;
            const side = rand() < 0.5 ? "buy" : "sell";
            const roll = rand();
            if (roll < 0.15) market.market(a, side, 1 + Math.floor(rand() * 20));
            else if (roll < 0.3) market.cancelAll(a);
            else market.limit(a, side, 9 + rand() * 2, 1 + Math.floor(rand() * 20));
            for (const acc of accounts) {
                expect(acc.availableCash).toBeGreaterThanOrEqual(0);
                expect(acc.availableShares).toBeGreaterThanOrEqual(0);
                expect(acc.reservedCash).toBeGreaterThanOrEqual(0);
                expect(acc.reservedShares).toBeGreaterThanOrEqual(0);
            }
        }
        expect(totals(...accounts)).toEqual(before);
        // Everything reserved is exactly what's resting on the book.
        let restingCash = 0;
        let restingShares = 0;
        for (const a of accounts)
            for (const o of market.ordersOf(a)) {
                if (o.side === "buy") restingCash += o.price * o.remaining;
                else restingShares += o.remaining;
            }
        expect(accounts.reduce((s, a) => s + a.reservedCash, 0)).toBe(restingCash);
        expect(accounts.reduce((s, a) => s + a.reservedShares, 0)).toBe(restingShares);
        expect(market.tradeCount).toBeGreaterThan(100);
    });
});

describe("Market: price", () => {
    test("opening price until the first trade, then last trade", () => {
        const { market, alice, bob } = setup();
        expect(market.price).toBe(10);
        market.limit(bob, "sell", 10.5, 1);
        market.limit(alice, "buy", 10.5, 1);
        expect(market.price).toBe(10.5);
        expect(market.highTicks).toBe(1050);
    });

    test("mark price is clamped inside the current quotes", () => {
        const { market, alice, bob } = setup();
        market.limit(bob, "sell", 12, 1);
        market.limit(alice, "buy", 11, 1);
        expect(market.price).toBe(11); // opening $10 < best bid $11
        market.cancelAll(alice);
        market.cancelAll(bob);
        market.limit(bob, "sell", 8, 1);
        expect(market.price).toBe(8); // opening $10 > best ask $8
    });

    test("priceDirty / bookDirty track what has been published", () => {
        const { market, alice } = setup();
        market.markPricePublished();
        market.markBookPublished();
        expect(market.priceDirty).toBe(false);
        expect(market.bookDirty).toBe(false);
        market.limit(alice, "buy", 11, 1);
        expect(market.bookDirty).toBe(true);
        expect(market.priceDirty).toBe(true); // mark moved up to the new best bid
    });

    test("P&L is relative to the starting position at the current mark", () => {
        const a = new Account("x", c(100), 10, true);
        expect(a.pnl(c(5))).toBe(0);
        a.cash += c(20);
        expect(a.pnl(c(5))).toBe(c(20));
    });

    test("adjustCash never touches reserved cash", () => {
        const { market, alice } = setup();
        market.limit(alice, "buy", 10, 90); // reserves $900
        expect(alice.adjustCash(-c(500))).toBe(-c(100));
        expect(alice.availableCash).toBe(0);
        expect(alice.adjustCash(c(1))).toBe(c(1));
    });
});
