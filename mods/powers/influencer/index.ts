import { definePower } from "@mod";

/** How far the herd pushes the price (and how deep it sweeps the book) each time it follows. */
const PUSH = 0.02;
/** The herd buys or sells this many times your trade size. */
const HERD_SIZE = 2;
/** Game steps between two herd moves (5 steps per second), so it can't be farmed every tick. */
const COOLDOWN_STEPS = 15;

/**
 * Influencer: for 20 seconds a herd of followers copies every trade you make, twice your size,
 * right after you, pushing the price ~2% your way. Buy, let the herd lift the price, sell into
 * it. Everyone is told, so rivals can fade the herd. The herd follows at most every 3 seconds,
 * and a Burner Phone hides your trades from your followers too.
 */
export default definePower({
    id: "influencer",
    title: "Influencer",
    description: `For 20 seconds, a herd of followers copies your trades at ${HERD_SIZE}x your size and pushes the price your way.`,
    icon: "megaphone.svg",
    iconCredit: { author: "Delapouite", url: "https://game-icons.net/1x1/delapouite/megaphone.html", license: "CC BY 3.0" },
    type: "market",
    weight: 10,
    durationSeconds: 20,
    state: () => ({ readyAt: 0, moves: 0 }),

    onActivate(ctx) {
        ctx.onPlayerTrade((trade) => {
            if (trade.player !== ctx.player || trade.automatic || ctx.game.step < ctx.state.readyAt) return;
            const before = ctx.market.price;
            ctx.game.sweep(trade.side, PUSH, trade.qty * HERD_SIZE);
            // The herd's conviction moves the guide too, so the house re-quotes up there; the fair
            // value doesn't move, so the price drifts back over the next seconds.
            ctx.model.absorbTrade(before * (trade.side === "buy" ? 1 + PUSH : 1 - PUSH), 1);
            ctx.state.readyAt = ctx.game.step + COOLDOWN_STEPS;
            ctx.state.moves++;
            const verb = trade.side === "buy" ? "bought" : "sold";
            ctx.notify(ctx.player, {
                level: "info",
                title: ctx.power.title,
                description: `Your followers ${verb} right after you: $${before.toFixed(2)} → $${ctx.market.price.toFixed(2)}.`,
            });
        });
        ctx.notify(ctx.player, {
            level: "success",
            title: ctx.power.title,
            description: `You're live for ${ctx.secondsLeft} seconds. Your followers will copy your trades and push the price your way.`,
        });
        ctx.notify(ctx.others, {
            level: "warning",
            title: ctx.power.title,
            description: `${ctx.player.name} is shilling the stock to their followers. Whatever they trade, the herd follows.`,
        });
    },

    onExpire(ctx) {
        ctx.notify(ctx.player, {
            level: "info",
            title: ctx.power.title,
            description: `Your stream ended. Your followers moved the market ${ctx.state.moves} time${ctx.state.moves === 1 ? "" : "s"}.`,
        });
    },
});
