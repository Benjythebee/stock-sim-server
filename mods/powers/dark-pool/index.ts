import { definePower } from "@mod";

/**
 * Dark Pool: for 20 seconds your trades don't move the guide price (no market impact), so you
 * can build or dump a big position without pushing the price against yourself. Pairs well with
 * Insider Tip. Private: rivals aren't told.
 */
export default definePower({
    id: "dark-pool",
    title: "Dark Pool",
    description: "For 20 seconds, your trades don't move the price. Build or dump a big position quietly.",
    icon: "iceberg.svg",
    iconCredit: { author: "Delapouite", url: "https://game-icons.net/1x1/delapouite/iceberg.html", license: "CC BY 3.0" },
    type: "client",
    weight: 15,
    durationSeconds: 20,
    state: () => ({ release: null as null | (() => void) }),

    onActivate(ctx) {
        ctx.state.release = ctx.player.hideMarketImpact();
        ctx.notify(ctx.player, {
            level: "success",
            title: ctx.power.title,
            description: `You're trading in the dark for ${ctx.secondsLeft} seconds. Your orders won't move the price.`,
        });
    },

    onExpire(ctx) {
        ctx.state.release?.();
        ctx.notify(ctx.player, { level: "info", title: ctx.power.title, description: "You're back on the lit exchange. Your trades move the price again." });
    },
});
