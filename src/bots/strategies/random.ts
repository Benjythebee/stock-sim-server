import { ceilCents, floorCents } from "../helpers";
import { defineBot, sharesWorth } from "../types";

/** Noise trader: occasional random buys/sells, market or limit within ±4% of the price. */
export default defineBot({
    id: "RandomBot",
    name: "Random Bot",
    description: "Makes random buy/sell decisions without market analysis",
    enabled: true,
    create: (rng, settings) => {
        const size = sharesWorth(settings, rng.range(0.001, 0.006));
        return {
            decide(bot) {
                bot.cancelAll({ olderThanMs: 10_000 });
                const roll = bot.rng.next();
                if (roll > 0.2 || bot.account.openOrders.size >= 10) return;
                const useMarket = bot.rng.chance(0.4);
                const offset = bot.rng.range(0.96, 1.04);
                if (roll < 0.1) {
                    if (useMarket) bot.marketBuy(size);
                    else bot.buy(floorCents(bot.price * Math.min(offset, 1.01)), size);
                } else if (bot.account.availableShares > 0) {
                    const qty = Math.min(size, bot.account.availableShares);
                    if (useMarket) bot.marketSell(qty);
                    else bot.sell(ceilCents(bot.price * Math.max(offset, 0.99)), qty);
                }
            },
        };
    },
});
