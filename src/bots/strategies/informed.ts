import { ceilCents } from "../helpers";
import { defineBot, sharesWorth, type BotStrategy, type BotView } from "../types";

export interface ValueTraderOptions {
    size: number;
    /** Buy when price < estimate * buyBelow. */
    buyBelow: number;
    /** Sell when price > estimate * sellAbove. */
    sellAbove: number;
    /** Take-profit limit placed after a buy, at estimate * takeProfit. */
    takeProfit: number;
    /** Per-step probability of acting at all (keeps them from hammering the book). */
    activity: number;
    /** Fair-value estimate given the true intrinsic value (lets "partial" bots be wrong). */
    estimate: (bot: BotView) => number;
}

/** Trades the gap between the market price and (its estimate of) intrinsic value. */
export function valueTrader(options: ValueTraderOptions): BotStrategy {
    return {
        decide(bot) {
            bot.cancelAll({ olderThanMs: 60_000 });
            if (!bot.rng.chance(options.activity)) return;
            const fair = options.estimate(bot);
            if (bot.price < fair * options.buyBelow) {
                const bought = bot.marketBuy(options.size);
                if (bought.ok && bought.filled > 0) bot.sell(ceilCents(fair * options.takeProfit), bought.filled);
            } else if (bot.price > fair * options.sellAbove && bot.account.availableShares >= options.size) {
                bot.marketSell(options.size);
            }
        },
    };
}

export default defineBot({
    id: "InformedBot",
    name: "Informed Bot",
    description: "Has knowledge of the intrinsic value of the asset and trades accordingly",
    enabled: true,
    create: (rng, settings) =>
        valueTrader({
            size: sharesWorth(settings, rng.range(0.003, 0.01)),
            buyBelow: 0.95,
            sellAbove: 1.1,
            takeProfit: 1.05,
            activity: 0.2,
            estimate: (bot) => bot.intrinsic,
        }),
});
