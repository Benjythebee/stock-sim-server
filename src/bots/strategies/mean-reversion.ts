import { ceilCents, floorCents } from "../helpers";
import { defineBot, sharesWorth } from "../types";

/** Fades moves: buys when the price is well below its recent average, sells when well above. */
export default defineBot({
    id: "MeanReversionBot",
    name: "Mean Reversion Bot",
    description: "Buys when price is low compared to recent average, sells when high",
    enabled: true,
    create: (rng, settings) => {
        const lookback = 20 + rng.int(30);
        const band = rng.range(0.015, 0.04);
        const size = sharesWorth(settings, rng.range(0.002, 0.01));
        return {
            decide(bot) {
                bot.cancelAll({ olderThanMs: 5_000 });
                if (bot.priceHistory.length < lookback || !bot.rng.chance(0.5)) return;
                const average = bot.priceHistory.mean(lookback);
                if (bot.price < average * (1 - band) && bot.orders("buy").length === 0) {
                    bot.buy(ceilCents(bot.price * 1.002), size);
                } else if (bot.price > average * (1 + band) && bot.orders("sell").length === 0 && bot.account.availableShares >= size) {
                    bot.sell(floorCents(bot.price * 0.998), size);
                }
            },
        };
    },
});
