import { definePower } from "../types";

/** Example of a read-only power: it changes nothing, it just leaks information. */
export default definePower({
    id: "insider-tip",
    title: "Insider Tip",
    description: ({ ticker }) => `A friend at the company whispers what $${ticker} is really worth.`,
    icon: "talk",
    type: "client",
    instant: true,
    weight: 15,

    onActivate(ctx) {
        // Slightly fuzzy (±3%) so it's a strong hint, not a free win.
        const tip = ctx.model.intrinsic * (1 + ctx.rng.signed() * 0.03);
        ctx.notify(ctx.player, {
            level: "success",
            title: ctx.power.title,
            description: `Word is the fair value is around $${tip.toFixed(2)}. The market is at $${ctx.market.price.toFixed(2)}.`,
        });
    },
});
