import { quotePair } from "../helpers";
import { defineBot, referenceCash, sharesWorth, type BotStrategy, type BotView } from "../types";

export interface MarketMakerOptions {
    /** Price levels quoted on each side. */
    levels: number;
    /** Base half-spread as a fraction of the guide price. */
    halfSpread: number;
    /** Extra distance between consecutive levels (fraction of guide). */
    levelGap: number;
    /** Shares at the innermost level; level i quotes size * (i + 1). */
    size: number;
    /** Re-quote every N steps. */
    requoteEvery: number;
    /** Step offset so many makers don't all re-quote on the same step. */
    phase: number;
    /** Inventory the maker tries to stay near, and how far it tolerates drifting. */
    targetShares: number;
    maxDeviation: number;
}

/**
 * Market maker: cancels and re-posts a ladder of bids and asks around the guide price.
 * The spread widens with volatility; quotes skew against inventory so the maker leans
 * toward its target position. This is what makes the traded price track the price model.
 */
export function marketMaker(options: MarketMakerOptions): BotStrategy {
    return {
        decide(bot: BotView) {
            if ((bot.step + options.phase) % options.requoteEvery !== 0) return;
            bot.cancelAll();

            const mid = bot.guide;
            const vol = bot.model.volatility;
            const half = Math.min(0.08, options.halfSpread + vol * 0.25);
            const deviation = Math.max(-1, Math.min(1, (bot.account.shares - options.targetShares) / options.maxDeviation));
            const skewedMid = mid * (1 - deviation * half * 0.5);

            for (let i = 0; i < options.levels; i++) {
                const { bid, ask } = quotePair(skewedMid, half + i * options.levelGap);
                const qty = options.size * (i + 1);
                if (deviation < 1) bot.buy(bid, qty); // too long: stop buying
                if (deviation > -1) bot.sell(ask, qty); // too short: stop selling
            }
        },
    };
}

export default defineBot({
    id: "LiquidityBot",
    name: "Liquidity Bot",
    description: "Provides liquidity by quoting a bid/ask ladder around fair price, skewing against its inventory",
    enabled: true,
    create: (rng, settings) => {
        const startShares = sharesWorth(settings, 1);
        return marketMaker({
            levels: 3,
            halfSpread: rng.range(0.008, 0.02),
            levelGap: rng.range(0.004, 0.01),
            size: sharesWorth(settings, rng.range(0.002, 0.006)),
            requoteEvery: 5,
            phase: rng.int(5),
            targetShares: startShares,
            maxDeviation: startShares,
        });
    },
    inventory: (settings, rng) => ({
        cash: Math.max(100_000, referenceCash(settings) * 10),
        shares: sharesWorth(settings, rng.range(0.8, 1.2)),
    }),
});
