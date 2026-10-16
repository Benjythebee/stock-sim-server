import { Bot } from "../bots/bot";
import { houseMarketMaker } from "../bots/house";
import type { BotRegistry } from "../bots/registry";
import { defaultBotInventory } from "../bots/types";
import { Account } from "../engine/account";
import { Market, type OrderOutcome } from "../engine/market";
import { toDollars, toTicks } from "../engine/money";
import type { Fill, Order } from "../engine/order-book";
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

    constructor(
        readonly settings: Readonly<GameSettings>,
        private readonly catalog: Catalog,
        private readonly out: GameOutput,
        now = Date.now(),
    ) {
        this.startClock = now;
        this.rng = new Rng(settings.seed);
        this.market = new Market(settings.openingPrice);
        this.model = new PriceModel(
            {
                initialPrice: settings.openingPrice,
                drift: 0.0005,
                volatility: settings.marketVolatility,
                meanReversion: 0.03,
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
        for (let t = interval; t < this.durationSeconds - 8; t += interval) this.intrinsicDriftAt.push(Math.round(t));
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

    /** Cancel one of a player's open orders (by OrderInfo id), or all of them. Returns how many were cancelled. */
    cancelOrder(player: Player, id: number): number {
        if (id === ORDER_CANCEL_ALL) return this.market.cancelAll(player.account);
        const bookId = player.orders.bookIdOf(id);
        return bookId !== null && this.market.cancel(player.account, bookId) ? 1 : 0;
    }

    /** Push pending price/depth/portfolio changes to clients. Cheap when nothing changed. */
    flush(): void {
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
        // Human takers move the guide price: bigger trades, more impact.
        if (!taker.isHuman) return;
        const notional = toDollars(fill.price * fill.qty);
        const weight = Math.min(1, Math.max(0.05, notional / (Math.max(1000, this.settings.startingCash) * 0.05)));
        this.model.absorbTrade(toDollars(fill.price), weight);
    };

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
