import type { Account } from "../engine/account";
import type { Market, OrderOutcome } from "../engine/market";
import type { Side } from "../engine/order-book";
import type { PriceModel } from "../engine/price-model";
import type { RingBuffer } from "../engine/ring-buffer";
import type { Rng } from "../engine/rng";
import { toDollars } from "../engine/money";
import type { GameSettings } from "../game/settings";
import { log } from "../log";
import type { BotDefinition, BotStrategy, BotView } from "./types";

/**
 * Runtime wrapper around a strategy. It is its own BotView: fields are refreshed in place every
 * step, so a bot turn allocates nothing.
 */
export class Bot implements BotView {
    readonly strategy: BotStrategy;
    step = 0;
    now = 0;
    price = 0;
    guide = 0;
    intrinsic = 0;
    private failures = 0;

    constructor(
        readonly id: string,
        readonly name: string,
        readonly definition: BotDefinition,
        readonly account: Account,
        readonly rng: Rng,
        readonly market: Market,
        readonly model: PriceModel,
        readonly settings: Readonly<GameSettings>,
        readonly priceHistory: RingBuffer,
    ) {
        this.strategy = definition.create(rng, settings);
    }

    get type(): string {
        return this.definition.id;
    }

    turn(step: number, now: number): void {
        if (this.failures >= 3) return; // a strategy that keeps throwing is benched for the game
        this.step = step;
        this.now = now;
        this.price = this.market.price;
        this.guide = this.model.guide;
        this.intrinsic = this.model.intrinsic;
        try {
            this.strategy.decide(this);
        } catch (err) {
            this.failures++;
            log.error(`bot ${this.id} (${this.type}) threw`, err);
        }
    }

    bestBid(): number | null {
        const t = this.market.book.bestBid();
        return t === null ? null : toDollars(t);
    }

    bestAsk(): number | null {
        const t = this.market.book.bestAsk();
        return t === null ? null : toDollars(t);
    }

    buy(price: number, qty: number): OrderOutcome {
        return this.market.limit(this.account, "buy", price, Math.floor(qty));
    }

    sell(price: number, qty: number): OrderOutcome {
        return this.market.limit(this.account, "sell", price, Math.floor(qty));
    }

    marketBuy(qty: number): OrderOutcome {
        return this.market.market(this.account, "buy", Math.floor(qty));
    }

    marketSell(qty: number): OrderOutcome {
        return this.market.market(this.account, "sell", Math.floor(qty));
    }

    cancelAll(filter?: { side?: Side; olderThanMs?: number }): number {
        return this.market.cancelAll(this.account, filter);
    }

    orders(side?: Side) {
        return this.market.ordersOf(this.account, side);
    }
}
