import { defineBot, sharesWorth } from "../types";
import { valueTrader } from "./informed";

/** Like the informed bot, but its view of fair value is off by up to ±10% (re-drawn when the value moves). */
export default defineBot({
    id: "PartiallyInformedBot",
    name: "Partially Informed Bot",
    description: "Has imperfect knowledge of the intrinsic value of the asset and trades accordingly",
    enabled: true,
    create: (rng, settings) => {
        let seenIntrinsic = NaN;
        let estimate = NaN;
        return valueTrader({
            size: sharesWorth(settings, rng.range(0.002, 0.008)),
            buyBelow: 0.96,
            sellAbove: 1.08,
            takeProfit: 1.04,
            activity: 0.2,
            estimate: (bot) => {
                if (bot.intrinsic !== seenIntrinsic) {
                    seenIntrinsic = bot.intrinsic;
                    estimate = bot.intrinsic * (1 + bot.rng.signed() * 0.1);
                }
                return estimate;
            },
        });
    },
});
