import { ceilCents, floorCents, momentum } from "../helpers";
import { defineBot, sharesWorth } from "../types";

/** Chases trends: buys after the traded price rose over the lookback window, sells after it fell. */
export default defineBot({
    id: "MomentumBot",
    name: "Momentum Bot",
    description: "Follows the momentum of the market. Buys when price is rising, sells when falling",
    enabled: true,
    create: (rng, settings) => {
        const lookback = 5 + rng.int(10);
        const threshold = rng.range(0.005, 0.02);
        const size = sharesWorth(settings, rng.range(0.002, 0.01));
        return {
            decide(bot) {
                bot.cancelAll({ olderThanMs: 5_000 });
                if (!bot.rng.chance(0.3)) return;
                const m = momentum(bot.priceHistory, lookback);
                if (m === null) return;
                if (m > threshold && bot.orders("buy").length === 0) {
                    bot.buy(ceilCents((bot.bestAsk() ?? bot.price) * 1.001), size);
                } else if (m < -threshold && bot.orders("sell").length === 0 && bot.account.availableShares >= size) {
                    bot.sell(floorCents((bot.bestBid() ?? bot.price) * 0.999), size);
                }
            },
        };
    },
});
