import { MAX_VOLATILITY } from "../../engine/price-model";
import { definePower } from "../types";

export default definePower({
    id: "volatility-storm",
    title: "Volatility Storm",
    description: "Increase market volatility for 20 seconds (everyone suffers).",
    icon: "volatility-storm",
    type: "market",
    weight: 5,
    durationSeconds: 20,
    state: () => ({ release: null as null | (() => void) }),

    onActivate(ctx) {
        if (ctx.model.volatility >= MAX_VOLATILITY) {
            ctx.notify(ctx.player, { level: "info", title: ctx.power.title, description: "Market volatility has already peaked." });
            return;
        }
        ctx.state.release = ctx.model.boostVolatility(4);
        const pct = (ctx.model.volatility * 100).toFixed(1);
        ctx.notify(ctx.player, { level: "success", title: ctx.power.title, description: `Volatility is now ${pct}% per tick (4x).` });
        ctx.notify(ctx.others, { level: "warning", title: ctx.power.title, description: `${ctx.player.name} whipped up a volatility storm!` });
    },

    onExpire(ctx) {
        if (!ctx.state.release) return;
        ctx.state.release();
        const pct = (ctx.model.volatility * 100).toFixed(1);
        ctx.notifyAll({ level: "info", title: ctx.power.title, description: `The storm has passed. Volatility is back to ${pct}%.` });
    },
});
