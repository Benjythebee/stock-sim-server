import { describe, expect, test } from "bun:test";
import { MessageType, type ServerMessage } from "../../src/protocol/messages";
import { catalogWith, makeGame, makePlayer, runSeconds } from "../helpers";

const ofType = <T extends MessageType>(msgs: ServerMessage[], t: T) => msgs.filter((m) => m.type === t) as Extract<ServerMessage, { type: T }>[];

describe("Game", () => {
    test("clock: one CLOCK per game second, in epoch ms", () => {
        const { game, broadcasts } = makeGame();
        runSeconds(game, 3);
        const clocks = ofType(broadcasts, MessageType.CLOCK);
        expect(clocks.map((c) => c.value)).toEqual([1, 2, 3].map((s) => game.startClock + s * 1000));
        expect(clocks.at(-1)!.timeLeft).toBe((300 - 3) * 1000);
    });

    test("hidden prices are never sent unless revealPrices is on", () => {
        const hidden = makeGame();
        runSeconds(hidden.game, 3);
        expect(ofType(hidden.broadcasts, MessageType.DEBUG_PRICES)).toHaveLength(0);

        const revealed = makeGame({ revealPrices: true });
        runSeconds(revealed.game, 3);
        const debug = ofType(revealed.broadcasts, MessageType.DEBUG_PRICES);
        expect(debug).toHaveLength(3);
        expect(debug.at(-1)!.intrinsicValue).toBe(revealed.game.model.intrinsicValue);
    });

    test("ends after gameDuration with a conclusion, and stops advancing", () => {
        const { game, broadcasts } = makeGame({ gameDuration: 1 });
        const { player } = makePlayer();
        game.addPlayer(player);
        runSeconds(game, 61);
        expect(game.ended).toBe(true);
        expect(game.step).toBe(300);
        const conclusion = ofType(broadcasts, MessageType.GAME_CONCLUSION);
        expect(conclusion).toHaveLength(1);
        expect(conclusion[0]!.players).toEqual([expect.objectContaining({ name: "alice", cash: 10_000, shares: 0, pnl: 0 })]);
        expect(conclusion[0]!.bots).toEqual([]); // the house is not listed
    });

    test("players start with starting cash and can trade against the house", () => {
        const { game } = makeGame({ startingCash: 5_000, openingPrice: 10 });
        const { player, socket } = makePlayer();
        game.addPlayer(player);
        game.advance(); // house quotes
        const outcome = game.placeOrder(player, { type: MessageType.STOCK_ACTION, action: "BUY", orderType: "MARKET", quantity: 10, price: 0 });
        expect(outcome).toMatchObject({ ok: true, filled: 10 });
        game.flush();
        const update = socket.last(MessageType.PORTFOLIO_UPDATE)!;
        expect(update.value.shares).toBe(10);
        expect(update.value.cash).toBeLessThan(5_000);
        expect(update.value.cash).toBeGreaterThan(5_000 - 10 * 12);
    });

    test("flush sends nothing when nothing changed", () => {
        const { game, broadcasts } = makeGame();
        game.advance();
        game.flush();
        const count = broadcasts.length;
        game.flush();
        expect(broadcasts.length).toBe(count);
    });

    test("at most one depth and one price broadcast per step, however many orders", () => {
        const { game, broadcasts } = makeGame({ openingPrice: 10 });
        const players = Array.from({ length: 5 }, (_, i) => makePlayer(`p${i}`).player);
        players.forEach((p) => game.addPlayer(p));
        game.advance();
        broadcasts.length = 0;
        for (let i = 0; i < 200; i++) {
            const p = players[i % players.length]!;
            game.placeOrder(p, { type: MessageType.STOCK_ACTION, action: i % 2 ? "BUY" : "SELL", orderType: "LIMIT", quantity: 1, price: 9 + (i % 20) / 10 });
        }
        game.advance();
        expect(ofType(broadcasts, MessageType.ORDER_BOOK_UPDATE)).toHaveLength(1);
        expect(ofType(broadcasts, MessageType.STOCK_MOVEMENT).length).toBeLessThanOrEqual(1);
    });

    test("big human trades move the guide price (market impact)", () => {
        const { game } = makeGame({ openingPrice: 10, startingCash: 100_000 });
        const { player } = makePlayer();
        game.addPlayer(player);
        game.advance();
        const before = game.model.guide;
        game.placeOrder(player, { type: MessageType.STOCK_ACTION, action: "BUY", orderType: "MARKET", quantity: 2_000, price: 0 });
        expect(game.model.guide).toBeGreaterThan(before);
    });

    test("depth is in dollars, asks first, best first, capped", () => {
        const { game } = makeGame({ openingPrice: 10 });
        game.advance();
        const [asks, bids] = game.depth();
        expect(asks.length).toBeGreaterThan(0);
        expect(bids.length).toBeGreaterThan(0);
        expect(asks[0]![0]).toBeGreaterThan(bids[0]![0]);
        expect(asks[0]![0]).toBeLessThan(asks.at(-1)![0]);
        expect(asks[0]![0]).toBeCloseTo(game.model.guide, 0);
    });

    test("depthMessageJson is cached per book version", () => {
        const { game } = makeGame();
        game.advance();
        const a = game.depthMessageJson();
        expect(game.depthMessageJson()).toBe(a);
        game.advance();
        expect(game.depthMessageJson()).not.toBe(a);
    });

    test("removing a player cancels their resting orders", () => {
        const { game } = makeGame({ houseLiquidity: false, openingPrice: 10 });
        const { player } = makePlayer();
        game.addPlayer(player);
        game.placeOrder(player, { type: MessageType.STOCK_ACTION, action: "BUY", orderType: "LIMIT", quantity: 5, price: 9 });
        expect(game.market.book.size).toBe(1);
        game.removePlayer(player);
        expect(game.market.book.size).toBe(0);
        expect(game.players()).toEqual([]);
    });

    test("players' orders are tracked: open while resting, history once filled or cancelled", () => {
        const { game } = makeGame({ houseLiquidity: false, openingPrice: 10 });
        const alice = makePlayer("alice");
        const bob = makePlayer("bob");
        game.addPlayer(alice.player);
        game.addPlayer(bob.player);
        bob.player.account.shares = 100; // something to sell
        game.flush();
        expect(alice.socket.last(MessageType.ORDER_UPDATE)).toEqual({ type: MessageType.ORDER_UPDATE, orders: [], reset: true });

        game.placeOrder(alice.player, { type: MessageType.STOCK_ACTION, action: "BUY", orderType: "LIMIT", quantity: 10, price: 9.5 });
        game.placeOrder(bob.player, { type: MessageType.STOCK_ACTION, action: "SELL", orderType: "MARKET", quantity: 4, price: 0 });
        game.flush();
        const resting = alice.socket.last(MessageType.ORDER_UPDATE)!;
        expect(resting.reset).toBe(false);
        expect(resting.orders).toEqual([
            expect.objectContaining({ action: "BUY", orderType: "LIMIT", price: 9.5, quantity: 10, filled: 4, avgPrice: 9.5, status: "open", time: game.stepClock }),
        ]);
        expect(bob.socket.last(MessageType.ORDER_UPDATE)!.orders).toEqual([
            expect.objectContaining({ action: "SELL", orderType: "MARKET", price: null, filled: 4, avgPrice: 9.5, status: "filled" }),
        ]);

        expect(game.cancelOrder(alice.player, resting.orders[0]!.id)).toBe(1);
        expect(game.cancelOrder(alice.player, resting.orders[0]!.id)).toBe(0); // already gone
        game.flush();
        expect(alice.socket.last(MessageType.ORDER_UPDATE)!.orders).toEqual([expect.objectContaining({ status: "cancelled", filled: 4 })]);
        expect(alice.player.orders.openCount).toBe(0);
        game.flush();
        expect(alice.socket.of(MessageType.ORDER_UPDATE)).toHaveLength(3); // nothing new, nothing sent
    });

    test("ORDER_CANCEL_ALL cancels every open order; cancels by anyone else (powers, removal) are recorded too", () => {
        const { game } = makeGame({ houseLiquidity: false, openingPrice: 10 });
        const { player } = makePlayer();
        game.addPlayer(player);
        for (const price of [9, 8, 7]) game.placeOrder(player, { type: MessageType.STOCK_ACTION, action: "BUY", orderType: "LIMIT", quantity: 1, price });
        expect(player.orders.openCount).toBe(3);
        game.market.cancelAll(player.account, { olderThanMs: 0 }); // e.g. a power reaching into the market
        expect(player.orders.openCount).toBe(0);
        game.placeOrder(player, { type: MessageType.STOCK_ACTION, action: "BUY", orderType: "LIMIT", quantity: 1, price: 9 });
        game.placeOrder(player, { type: MessageType.STOCK_ACTION, action: "BUY", orderType: "LIMIT", quantity: 1, price: 8 });
        expect(game.cancelOrder(player, -1)).toBe(2);
        expect(player.orders.pastOrders().map((o) => o.status)).toEqual(Array(5).fill("cancelled"));
        expect(player.account.reservedCash).toBe(0);
    });

    test("bots trading against a player's resting order fill it in the player's history", () => {
        const { game } = makeGame({ openingPrice: 10, seed: 3 });
        const { player } = makePlayer();
        game.addPlayer(player);
        game.advance();
        const bid = game.market.book.bestBid()! / 100;
        game.placeOrder(player, { type: MessageType.STOCK_ACTION, action: "BUY", orderType: "LIMIT", quantity: 5, price: bid + 0.01 });
        game.model.applyShock(-0.5); // house quotes chase the guide price down through the bid
        runSeconds(game, 5);
        const order = [...player.orders.openOrders(), ...player.orders.pastOrders()][0]!;
        expect(order.filled).toBeGreaterThan(0);
        expect(order.avgPrice).toBeCloseTo(bid + 0.01, 2);
    });

    test("bot mix respects the selection and the count", () => {
        const { game } = makeGame({ bots: 7, botSelection: ["RandomBot", "MomentumBot"], houseLiquidity: false }, catalogWith());
        expect(game.bots).toHaveLength(7);
        expect(new Set(game.bots.map((b) => b.type))).toEqual(new Set(["RandomBot", "MomentumBot"]));
    });
    test("sweep: an outside buyer lifts offers up to maxMove above the mark, capped at maxQty", () => {
        const { game } = makeGame({ openingPrice: 10, houseLiquidity: false });
        const { player: seller } = makePlayer("seller");
        game.addPlayer(seller);
        seller.account.adjustShares(300);
        game.market.limit(seller.account, "sell", 10.05, 100);
        game.market.limit(seller.account, "sell", 10.1, 100);
        game.market.limit(seller.account, "sell", 10.5, 100); // beyond 2%
        expect(game.sweep("buy", 0.02, 150)).toEqual({ filled: 150, worstPrice: 10.1 });
        expect(game.sweep("buy", 0.02)).toEqual({ filled: 50, worstPrice: 10.1 });
        expect(game.sweep("buy", 0.02)).toEqual({ filled: 0, worstPrice: null });
        expect(seller.account.shares).toBe(100);
    });
});
