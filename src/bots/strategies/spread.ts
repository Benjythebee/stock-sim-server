import { ceilCents, floorCents } from "../helpers";
import { defineBot, sharesWorth } from "../types";

/**
 * Spread capturer: when the bid/ask spread is wide, steps inside it on both sides. When the book
 * is one-sided it leans on the guide price instead.
 */
export default defineBot({
    id: "SpreadTradingBot",
    name: "Spread Trading Bot",
    description: "Trades based on bid-ask spread analysis",
    enabled: true,
    create: (rng, settings) => {
        const minSpread = rng.range(0.005, 0.015);
        const refreshMs = 2_000 + rng.int(4_000);
        const size = sharesWorth(settings, rng.range(0.002, 0.008));
        return {
            decide(bot) {
                bot.cancelAll({ olderThanMs: refreshMs });
                if (bot.account.openOrders.size >= 4) return;
                const bid = bot.bestBid();
                const ask = bot.bestAsk();

                if (bid === null || ask === null) {
                    if (bid === null && bot.orders("buy").length === 0) bot.buy(floorCents(bot.guide * 0.98), size);
                    if (ask === null && bot.orders("sell").length === 0) bot.sell(ceilCents(bot.guide * 1.02), size);
                    return;
                }

                const spread = ask - bid;
                if (spread / bot.price < minSpread || spread < 0.03) return;
                if (bot.orders("buy").length === 0) bot.buy(floorCents(bid + spread * 0.3), size);
                if (bot.orders("sell").length === 0) bot.sell(ceilCents(ask - spread * 0.3), size);
            },
        };
    },
});
