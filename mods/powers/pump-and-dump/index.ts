import { definePower } from "@mod";

/** Game seconds of hype before the rug pull. */
const HYPE_SECONDS = 10;
/** Extra guide drift per step while hyping (5 steps per second); mean reversion caps it around +13%. */
const PUMP = 0.005;
/** Drift per step during the dump, for DUMP_STEPS steps: it overshoots below the fair value. */
const DUMP = -0.012;
const DUMP_STEPS = 15;

/**
 * Pump and Dump: anonymous promoters hype the stock for 10 seconds (a headline, and the price
 * climbs ~10-15%), then cash out and the price collapses below where it started. The fair value
 * never moves, so it drifts back afterwards. Only the initiator knows when the rug gets pulled
 * (with a 2-second warning): ride the pump and sell at the top, or buy the crash.
 */
export default definePower({
    id: "pump-and-dump",
    title: "Pump and Dump",
    description: `Hire promoters to hype the stock for ${HYPE_SECONDS} seconds, then pull the rug. Only you know when the crash comes.`,
    icon: "rocket-flight.svg",
    iconCredit: { author: "Lorc", url: "https://game-icons.net/1x1/lorc/rocket-flight.html", license: "CC BY 3.0" },
    type: "market",
    weight: 10,
    durationSeconds: HYPE_SECONDS + 5,
    state: () => ({ elapsed: 0, startPrice: 0, topPrice: 0 }),

    onActivate(ctx) {
        ctx.state.startPrice = ctx.market.price;
        ctx.publishNews({
            title: ({ ticker }) => `$${ticker} to the moon?`,
            description: ({ ticker }) => `Anonymous accounts are hyping $${ticker} everywhere. Retail is piling in!`,
            durationSeconds: HYPE_SECONDS,
            onStart: ({ model }) => model.applyShock(PUMP, HYPE_SECONDS * 5),
        });
        ctx.notify(ctx.player, {
            level: "success",
            title: ctx.power.title,
            description: `Your promoters are pumping for ${HYPE_SECONDS} seconds, then they dump. Sell before the rug pull!`,
        });
    },

    onTick(ctx) {
        const s = ctx.state;
        s.elapsed++;
        if (s.elapsed === HYPE_SECONDS - 2) {
            ctx.notify(ctx.player, { level: "warning", title: ctx.power.title, description: "Your promoters dump in 2 seconds!" });
        }
        if (s.elapsed !== HYPE_SECONDS) return;
        s.topPrice = ctx.market.price;
        ctx.publishNews({
            title: ({ ticker }) => `$${ticker} promoters vanish`,
            description: "The hype accounts were a pump-and-dump scheme. They've cashed out and the price is collapsing.",
            durationSeconds: 5,
            onStart: ({ model }) => model.applyShock(DUMP, DUMP_STEPS),
        });
    },

    onExpire(ctx) {
        const { startPrice, topPrice } = ctx.state;
        if (!topPrice) return;
        ctx.notify(ctx.player, {
            level: "info",
            title: ctx.power.title,
            description: `Your scheme ran $${startPrice.toFixed(2)} → $${topPrice.toFixed(2)} → $${ctx.market.price.toFixed(2)}.`,
        });
    },
});
