import { definePower } from "../types";

export default definePower({
    id: "rumor-mill",
    title: "Rumor Mill",
    description: "Spread a false rumor that jolts the market up or down for a few seconds (everyone suffers).",
    icon: "talk",
    type: "market",
    weight: 25,

    onActivate(ctx) {
        // ±5% extra drift per step for 10 steps (2s), then mean reversion pulls it back.
        const intensity = ctx.rng.signed() * 0.05;
        ctx.publishNews({
            title: "Market Rumor!",
            description: "A major event is rumored to be affecting the market. Traders react strongly!",
            durationSeconds: 10,
            onStart: ({ model }) => model.applyShock(intensity, 10),
        });
        ctx.notify(ctx.player, {
            level: "success",
            title: ctx.power.title,
            description: `Your rumor is pushing the price ${intensity >= 0 ? "up" : "down"}.`,
        });
    },
});
