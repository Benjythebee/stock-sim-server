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

    test("bot mix respects the selection and the count", () => {
        const { game } = makeGame({ bots: 7, botSelection: ["RandomBot", "MomentumBot"], houseLiquidity: false }, catalogWith());
        expect(game.bots).toHaveLength(7);
        expect(new Set(game.bots.map((b) => b.type))).toEqual(new Set(["RandomBot", "MomentumBot"]));
    });
});
