import { definePower } from "@mod";

const money = (dollars: number) => `$${dollars.toFixed(2)}`;

/**
 * Fat Finger: a rogue trader market-sells into the bids, sweeping the book 6-10% below the
 * price, and the guide price is knocked down by the same amount (so the house re-quotes there
 * even when the book is thin). The fair value doesn't move, so the market makers and informed
 * bots pull the price back up over the next seconds. Only the initiator knows it's fake: buy
 * the dip. Resting bids get filled cheap.
 */
export default definePower({
    id: "fat-finger",
    title: "Fat Finger",
    description: "A rogue trader dumps a huge sell order and the price flash-crashes. Only you know it's fake: buy the dip!",
    icon: "button-finger.svg",
    iconCredit: { author: "Delapouite", url: "https://game-icons.net/1x1/delapouite/button-finger.html", license: "CC BY 3.0" },
    type: "market",
    instant: true,
    weight: 10,

    onActivate(ctx) {
        const before = ctx.market.price;
        const drop = ctx.rng.range(0.06, 0.1);
        const crashTo = Math.max(0.01, before * (1 - drop));
        const { sold } = ctx.dumpShares(drop);
        // The crash drags the guide down with it; the untouched fair value pulls it back up.
        ctx.model.absorbTrade(crashTo, 1);
        const what = sold > 0 ? `dumped ${sold} shares at market` : "slammed the sell button";
        ctx.notify(ctx.player, {
            level: "success",
            title: ctx.power.title,
            description: `Your rogue trader ${what}: ${money(before)} → ${money(crashTo)}. The fair value hasn't moved, so it should bounce back.`,
        });
        ctx.notify(ctx.others, {
            level: "warning",
            title: ctx.power.title,
            description: `Flash crash! Someone just ${what}: ${money(before)} → ${money(crashTo)}.`,
        });
    },
});
