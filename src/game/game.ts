import { Bot } from "../bots/bot";
import { houseMarketMaker } from "../bots/house";
import type { BotRegistry } from "../bots/registry";
import { defaultBotInventory } from "../bots/types";
import { Account } from "../engine/account";
import { Market, type OrderOutcome } from "../engine/market";
import { toDollars, toTicks } from "../engine/money";
import type { Fill, Order, Side } from "../engine/order-book";
import { PriceModel } from "../engine/price-model";
import { RingBuffer } from "../engine/ring-buffer";
import { Rng } from "../engine/rng";
import { NewsManager } from "../news/manager";
import type { NewsDefinition } from "../news/types";
import { PowerManager } from "../powers/manager";
import type { PowerRegistry } from "../powers/registry";
import {
    MessageType,
    ORDER_CANCEL_ALL,
    type ConclusionMessage,
    type Depth,
    type Notification,
    type ServerMessage,
    type StockActionMessage,
} from "../protocol/messages";
import { log } from "../log";
import { OrderJournal } from "./orders";
import { portfolioOf, type Player } from "./player";
import type { GameSettings } from "./settings";

/** One market step. Bots act and the price model advances every step. */
export const STEP_MS = 200;
export const STEPS_PER_SECOND = 1000 / STEP_MS;
/** Depth levels per side sent to clients. */
export const DEPTH_LEVELS = 25;

/** Content the game draws from (loaded once at startup, shared by all rooms). */
export interface Catalog {
    bots: BotRegistry;
    powers: PowerRegistry;
    news: readonly NewsDefinition[];
}

/**
 * A player's fills from one order (or one flush), aggregated per side. What surveillance powers
 * (Wiretap, Copycat) listen to through `Game.onPlayerTrade`.
 */
export interface PlayerTrade {
    player: Player;
    side: Side;
    qty: number;
    /** Volume-weighted fill price, in dollars. */
    avgPrice: number;
    /** Made by a power reacting to another trade (e.g. a Copycat copy), not by the player. */
    automatic: boolean;
}

/** Where the game sends room-wide messages. Per-player messages go through Player.send. */
export interface GameOutput {
    broadcast(message: ServerMessage): void;
}

/**
 * One match: the exchange, the price model, bots, powers and news, driven by `advance()`.
 * The game has no timers and no sockets of its own. The room calls `advance()` every STEP_MS
 * while running, so tests can drive a whole game synchronously and deterministically.
 */
export class Game {
    readonly rng: Rng;
    readonly market: Market;
    readonly model: PriceModel;
    readonly bots: Bot[] = [];
    readonly powers: PowerManager;
    readonly news: NewsManager;
    /** Traded price sampled once per step (what non-informed bots look at). */
    readonly priceHistory = new RingBuffer(512);
    readonly startClock: number;

    step = 0;
    elapsedSeconds = 0;
    ended = false;
    /** The final standings, frozen when the game ends (so players removed later still show). */
    result: ConclusionMessage | null = null;

    private readonly playerMap = new Map<string, Player>();
    private readonly intrinsicDriftAt: number[] = [];
    private depthCache: { version: number; json: string } | null = null;
    private readonly tradeListeners = new Set<(trade: PlayerTrade) => void>();
    private tradeFeed: { player: Player; side: Side; qty: number; ticks: number; automatic: boolean }[] = [];
    private dispatchingTrades = false;
    /** The non-human account Fat Finger sells from (created on first use). */
    private rogue: Account | null = null;

    constructor(
        readonly settings: Readonly<GameSettings>,
        private readonly catalog: Catalog,
        private readonly out: GameOutput,
        now = Date.now(),
    ) {
        this.startClock = now;
        this.rng = new Rng(settings.seed);
        this.market = new Market(settings.openingPrice);
        // Without the random walk the visible price only moves when a trade prints.
        this.market.markToQuotes = !settings.disableRandomWalk;
        this.model = new PriceModel(
            {
                initialPrice: settings.openingPrice,
                drift: 0.0005,
                volatility: settings.marketVolatility,
                meanReversion: 0.03,
                randomWalk: !settings.disableRandomWalk,
            },
            this.rng.fork(1),
        );
        this.market.onTrade = this.onTrade;
        this.market.onCancel = this.onCancel;
        this.priceHistory.push(this.market.price);

        this.spawnBots(this.rng.fork(2));
        this.powers = new PowerManager(this, catalog.powers, this.rng.fork(3));
        this.news = new NewsManager(this, catalog.news, this.rng.fork(4), settings.enableRandomNews);

        // Slow fundamental drift: ~10 nudges of ±5% over the game.
        const interval = Math.max(8, (this.durationSeconds - 8) / 10);
        if (!settings.disableRandomWalk) {
            for (let t = interval; t < this.durationSeconds - 8; t += interval) this.intrinsicDriftAt.push(Math.round(t));
        }
    }

    get durationSeconds(): number {
        return Math.round(this.settings.gameDuration * 60);
    }

    /** Game clock as epoch ms (what the UI plots candles against). */
    get clock(): number {
        return this.startClock + this.elapsedSeconds * 1000;
    }

    /** Game clock with step resolution (epoch ms), stamped on players' orders. */
    get stepClock(): number {
        return this.startClock + this.step * STEP_MS;
    }

    get timeLeftMs(): number {
        return Math.max(0, (this.durationSeconds - this.elapsedSeconds) * 1000);
    }

    players(): Player[] {
        return [...this.playerMap.values()];
    }

    addPlayer(player: Player): void {
        player.account = this.market.add(new Account(player.id, toTicks(this.settings.startingCash), 0, true));
        player.orders = new OrderJournal();
        this.playerMap.set(player.id, player);
    }

    /** Permanently remove a player: cancel their resting orders and forget their powers. */
    removePlayer(player: Player): void {
        this.market.cancelAll(player.account);
        this.powers.forgetPlayer(player);
        this.playerMap.delete(player.id);
    }

    /** Advance one market step. */
    advance(): void {
        if (this.ended) return;
        this.market.now = this.step * STEP_MS;
        this.model.step();

        const bots = this.bots;
        if (bots.length) {
            const start = this.step % bots.length; // rotate who acts first, so nobody always gets first dibs
            for (let i = 0; i < bots.length; i++) bots[(start + i) % bots.length]!.turn(this.step, this.market.now);
        }
        this.priceHistory.push(this.market.price);

        this.step++;
        if (this.step % STEPS_PER_SECOND === 0) this.onSecond();
        this.flush();
    }

    /** Place a player's order. Returns the engine outcome (the caller reports rejections). */
    placeOrder(player: Player, msg: StockActionMessage): OrderOutcome {
        const side = msg.action === "BUY" ? "buy" : "sell";
        const qty = Math.floor(msg.quantity);
        const isMarket = msg.orderType === "MARKET";
        const outcome = isMarket ? this.market.market(player.account, side, qty) : this.market.limit(player.account, side, msg.price, qty);
        if (outcome.ok) player.orders.placed(side, isMarket ? null : toTicks(msg.price), qty, outcome, this.stepClock);
        return outcome;
    }

    /** A market order on a player's behalf (from a power), recorded in their order history. */
    marketOrder(player: Player, side: Side, qty: number): OrderOutcome {
        return this.placeOrder(player, {
            type: MessageType.STOCK_ACTION,
            action: side === "buy" ? "BUY" : "SELL",
            orderType: "MARKET",
            quantity: qty,
            price: 0,
        });
    }

    /**
     * Listen to human players' trades (both sides of every fill), aggregated per player and side
     * and delivered at the next flush, after matching is done, so listeners may trade themselves.
     * Players with `concealTrades()` active are left out. Returns the unsubscribe function.
     */
    onPlayerTrade(listener: (trade: PlayerTrade) => void): () => void {
        this.tradeListeners.add(listener);
        return () => {
            this.tradeListeners.delete(listener);
        };
    }

    /**
     * A rogue (non-human) trader market-sells into the bids, sweeping every level down to
     * `maxDrop` below the mark price (0.08 = 8%). Doesn't touch the price model. Returns the
     * shares sold and the lowest fill price in dollars (null when there was nothing to hit).
     */
    dumpShares(maxDrop: number): { sold: number; lowPrice: number | null } {
        const { filled, worstPrice } = this.sweep("sell", maxDrop);
        return { sold: filled, lowPrice: worstPrice };
    }

    /**
     * An outside (non-human) trader takes every resting order on the other side of the book up to
     * `maxMove` away from the mark price (0.02 = 2%), with whatever cash or shares that needs.
     * Doesn't touch the price model. Returns the shares traded and the worst fill price in dollars.
     */
    sweep(side: Side, maxMove: number, maxQty = Infinity): { filled: number; worstPrice: number | null } {
        const buying = side === "buy";
        const limit = this.market.markTicks * (buying ? 1 + maxMove : 1 - maxMove);
        let qty = 0;
        let worst: number | null = null;
        for (const [price, levelQty] of this.market.book.depth(1000)[buying ? 0 : 1]) {
            if (buying ? price > limit : price < limit) break;
            qty += Math.min(levelQty, maxQty - qty);
            worst = price;
            if (qty >= maxQty) break;
        }
        if (qty === 0 || worst === null) return { filled: 0, worstPrice: null };
        this.rogue ??= this.market.add(new Account("rogue-trader", 0, 0, false));
        if (buying) this.rogue.adjustCash(worst * qty);
        else this.rogue.adjustShares(qty);
        const outcome = this.market.market(this.rogue, side, qty);
        if (!outcome.ok) return { filled: 0, worstPrice: null };
        return { filled: outcome.filled, worstPrice: toDollars(worst) };
    }

    /** Cancel one of a player's open orders (by OrderInfo id), or all of them. Returns how many were cancelled. */
    cancelOrder(player: Player, id: number): number {
        if (id === ORDER_CANCEL_ALL) return this.market.cancelAll(player.account);
        const bookId = player.orders.bookIdOf(id);
        return bookId !== null && this.market.cancel(player.account, bookId) ? 1 : 0;
    }

    /** Push pending price/depth/portfolio changes to clients. Cheap when nothing changed. */
    flush(): void {
        if (this.tradeFeed.length) this.dispatchTrades();
        const market = this.market;
        if (market.priceDirty) {
            market.markPricePublished();
            this.out.broadcast({ type: MessageType.STOCK_MOVEMENT, price: market.price });
        }
        if (market.bookDirty) {
            market.markBookPublished();
            this.out.broadcast({ type: MessageType.ORDER_BOOK_UPDATE, depth: this.depth() });
        }
        const mark = market.markTicks;
        for (const player of this.playerMap.values()) {
            if (!player.account.dirty) continue;
            player.account.dirty = false;
            player.send({ type: MessageType.PORTFOLIO_UPDATE, id: player.id, value: portfolioOf(player.account, mark) });
        }
        for (const player of this.playerMap.values()) {
            const update = player.orders.takeUpdate();
            if (update) player.send({ type: MessageType.ORDER_UPDATE, ...update });
        }
    }

    depth(): Depth {
        const [asks, bids] = this.market.book.depth(DEPTH_LEVELS);
        return [asks.map(([p, q]) => [toDollars(p), q]), bids.map(([p, q]) => [toDollars(p), q])];
    }

    /** Serialized ORDER_BOOK_UPDATE, cached per book version (for joiners and reconnects). */
    depthMessageJson(): string {
        const version = this.market.book.version;
        if (this.depthCache?.version !== version) {
            this.depthCache = { version, json: JSON.stringify({ type: MessageType.ORDER_BOOK_UPDATE, depth: this.depth() }) };
        }
        return this.depthCache.json;
    }

    broadcast(message: ServerMessage): void {
        this.out.broadcast(message);
    }

    notify(players: Player[], notification: Notification): void {
        if (players.length === 0) return;
        const json = JSON.stringify({ type: MessageType.NOTIFICATION, ...notification });
        for (const p of players) p.sendRaw(json);
    }

    notifyAll(notification: Notification): void {
        this.out.broadcast({ type: MessageType.NOTIFICATION, ...notification });
    }

    conclusion(): ConclusionMessage {
        const mark = this.market.markTicks;
        return {
            type: MessageType.GAME_CONCLUSION,
            players: this.players()
                .map((p) => ({ name: p.name, ...portfolioOf(p.account, mark) }))
                .sort((a, b) => b.pnl - a.pnl),
            bots: this.bots
                .filter((b) => b.definition !== houseMarketMaker)
                .map((b) => ({ name: b.name, type: b.type, ...portfolioOf(b.account, mark) }))
                .sort((a, b) => b.pnl - a.pnl),
            volumeTraded: toDollars(this.market.volumeTicks),
            highestPrice: toDollars(this.market.highTicks),
            lowestPrice: toDollars(this.market.lowTicks),
        };
    }

    dispose(): void {
        this.ended = true;
        this.powers.dispose();
        this.news.dispose();
        this.market.onTrade = null;
        this.market.onCancel = null;
        this.tradeListeners.clear();
        this.tradeFeed = [];
        this.market.book.clear();
        this.bots.length = 0;
        this.playerMap.clear();
    }

    private onSecond(): void {
        this.elapsedSeconds++;
        this.out.broadcast({ type: MessageType.CLOCK, value: this.clock, timeLeft: this.timeLeftMs });
        if (this.settings.revealPrices) {
            this.out.broadcast({ type: MessageType.DEBUG_PRICES, intrinsicValue: this.model.intrinsicValue, guidePrice: this.model.guidePrice });
        }

        while (this.intrinsicDriftAt.length && this.intrinsicDriftAt[0]! <= this.elapsedSeconds) {
            this.intrinsicDriftAt.shift();
            this.model.driftIntrinsic(0.05);
        }
        this.news.onSecond(this.elapsedSeconds);
        this.powers.onSecond(this.elapsedSeconds);

        if (this.elapsedSeconds >= this.durationSeconds) this.end();
    }

    private end(): void {
        this.ended = true;
        this.flush();
        this.result = this.conclusion();
        this.out.broadcast(this.result);
    }

    private readonly onTrade = (fill: Fill, taker: Account, maker: Account) => {
        if (maker.isHuman) this.playerMap.get(maker.id)?.orders.filled(fill.makerOrderId, fill.price, fill.qty, fill.makerDone, this.stepClock);
        if (this.tradeListeners.size) {
            const automatic = this.dispatchingTrades;
            const ticks = fill.price * fill.qty;
            const takerPlayer = taker.isHuman ? this.playerMap.get(taker.id) : undefined;
            const makerPlayer = maker.isHuman ? this.playerMap.get(maker.id) : undefined;
            if (takerPlayer) this.tradeFeed.push({ player: takerPlayer, side: fill.takerSide, qty: fill.qty, ticks, automatic });
            if (makerPlayer) this.tradeFeed.push({ player: makerPlayer, side: fill.takerSide === "buy" ? "sell" : "buy", qty: fill.qty, ticks, automatic });
        }
        // Human takers move the guide price: bigger trades, more impact (unless they're in a dark pool).
        if (!taker.isHuman || taker.impactShields > 0) return;
        const notional = toDollars(fill.price * fill.qty);
        const weight = Math.min(1, Math.max(0.05, notional / (Math.max(1000, this.settings.startingCash) * 0.05)));
        this.model.absorbTrade(toDollars(fill.price), weight);
    };

    /** Deliver queued trades to listeners. Trades the listeners make go out next round, marked automatic. */
    private dispatchTrades(): void {
        for (let round = 0; round < 4 && this.tradeFeed.length; round++) {
            const merged = new Map<string, { player: Player; side: Side; qty: number; ticks: number; automatic: boolean }>();
            for (const e of this.tradeFeed) {
                if (e.player.tradesConcealed) continue;
                const key = `${e.player.id}:${e.side}:${e.automatic}`;
                const m = merged.get(key);
                if (m) {
                    m.qty += e.qty;
                    m.ticks += e.ticks;
                } else merged.set(key, { ...e });
            }
            this.tradeFeed = [];
            this.dispatchingTrades = true;
            try {
                for (const m of merged.values()) {
                    const trade: PlayerTrade = {
                        player: m.player,
                        side: m.side,
                        qty: m.qty,
                        avgPrice: toDollars(Math.round(m.ticks / m.qty)),
                        automatic: m.automatic,
                    };
                    for (const listener of [...this.tradeListeners]) {
                        try {
                            listener(trade);
                        } catch (err) {
                            log.error("trade listener threw", err);
                        }
                    }
                }
            } finally {
                this.dispatchingTrades = false;
            }
        }
        this.tradeFeed = []; // a runaway chain of reactions stops here
    }

    private readonly onCancel = (order: Order, account: Account) => {
        if (account.isHuman) this.playerMap.get(account.id)?.orders.cancelled(order.id, this.stepClock);
    };

    private spawnBots(rng: Rng): void {
        const create = (id: string, name: string, def: typeof houseMarketMaker) => {
            const inv = (def.inventory ?? defaultBotInventory)(this.settings, rng);
            const account = this.market.add(new Account(id, toTicks(inv.cash), Math.round(inv.shares), false));
            this.bots.push(new Bot(id, name, def, account, rng.fork(this.bots.length), this.market, this.model, this.settings, this.priceHistory));
        };

        if (this.settings.houseLiquidity) create("house", houseMarketMaker.name, houseMarketMaker);

        const enabled = this.catalog.bots.enabled();
        const selected = this.settings.botSelection?.length
            ? enabled.filter((d) => this.settings.botSelection!.includes(d.id))
            : enabled;
        if (selected.length === 0) return;
        // A seeded shuffle then round-robin gives a balanced, reproducible mix.
        const order = rng.shuffle([...selected]);
        for (let i = 0; i < this.settings.bots; i++) {
            const def = order[i % order.length]!;
            create(`bot-${i + 1}`, `${def.name} ${i + 1}`, def);
        }
    }
}
