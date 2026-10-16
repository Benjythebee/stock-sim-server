import type { Account } from "../engine/account";
import type { Market, OrderOutcome } from "../engine/market";
import type { Order, Side } from "../engine/order-book";
import type { PriceModel } from "../engine/price-model";
import type { RingBuffer } from "../engine/ring-buffer";
import type { Rng } from "../engine/rng";
import type { GameSettings } from "../game/settings";

/**
 * Everything a bot can see and do during its turn. Prices are in dollars.
 * Only "informed" strategies should read `intrinsic`; that's an honor system.
 */
export interface BotView {
    readonly id: string;
    readonly account: Account;
    readonly rng: Rng;
    readonly market: Market;
    readonly model: PriceModel;
    readonly settings: Readonly<GameSettings>;
    /** Market step counter (5 steps per game second). */
    readonly step: number;
    /** Game time in ms since the start. */
    readonly now: number;
    /** Last traded price. */
    readonly price: number;
    /** Guide price (what liquidity providers quote around). */
    readonly guide: number;
    /** Hidden fair value. */
    readonly intrinsic: number;
    /** Traded price sampled once per step, oldest first. */
    readonly priceHistory: RingBuffer;

    bestBid(): number | null;
    bestAsk(): number | null;
    buy(price: number, qty: number): OrderOutcome;
    sell(price: number, qty: number): OrderOutcome;
    marketBuy(qty: number): OrderOutcome;
    marketSell(qty: number): OrderOutcome;
    cancelAll(filter?: { side?: Side; olderThanMs?: number }): number;
    orders(side?: Side): Order[];
}

export interface BotStrategy {
    /** Called once per market step (every 200ms) while the game runs. */
    decide(bot: BotView): void;
}

export interface BotDefinition {
    /** Stable id, used in settings.botSelection and /api/bots.json. */
    id: string;
    name: string;
    description: string;
    /** Disabled strategies are hidden from the admin UI and never spawned. */
    enabled: boolean;
    /** Starting holdings. Defaults to `defaultBotInventory`. */
    inventory?: (settings: GameSettings, rng: Rng) => { cash: number; shares: number };
    create(rng: Rng, settings: GameSettings): BotStrategy;
}

export function defineBot(definition: BotDefinition): BotDefinition {
    return definition;
}

/** A player's starting cash, floored so games with tiny/zero starting cash still get a market. */
export function referenceCash(settings: GameSettings): number {
    return Math.max(1_000, settings.startingCash);
}

/** Shares worth roughly `fraction` of a player's starting cash. Scales bots with the game. */
export function sharesWorth(settings: GameSettings, fraction: number): number {
    return Math.max(1, Math.round((referenceCash(settings) * fraction) / settings.openingPrice));
}

export function defaultBotInventory(settings: GameSettings, rng: Rng) {
    return {
        cash: Math.max(100_000, referenceCash(settings) * 10),
        shares: sharesWorth(settings, rng.range(0.5, 2)),
    };
}
