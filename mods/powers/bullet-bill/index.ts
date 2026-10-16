import { definePower, type Player } from "@mod";

/** Share of the leader's shares dumped when the Bullet Bill hits. */
const LIQUIDATE = 0.5;
/** How long an all-cash leader (or one whose sale couldn't go through) is knocked out instead. */
const FREEZE_SECONDS = 8;

/**
 * Bullet Bill: fired straight at the leading rival. On impact their sell orders are cancelled and
 * half their shares are dumped at market. The sale hits the bids and moves the price like any
 * big sell, so everyone else gets a dip to buy. A leader with no shares (or who can't trade
 * right now) is knocked out for 8 seconds instead.
 */
export default definePower({
    id: "bullet-bill",
    title: "Bullet Bill",
    description: `Fire a Bullet Bill at the leading rival: it knocks ${LIQUIDATE * 100}% of their shares loose and dumps them at market. Buy the dip!`,
    icon: "bullet-bill.svg",
    iconCredit: { author: "Delapouite", url: "https://game-icons.net/1x1/delapouite/bullet-bill.html", license: "CC BY 3.0" },
    type: "others",
    weight: 10,
    durationSeconds: FREEZE_SECONDS,
    state: () => ({ release: null as null | (() => void) }),

    onActivate(ctx) {
        const mark = ctx.market.markTicks;
        const leader = ctx.others.reduce<Player | null>(
            (best, p) => (!best || p.account.pnl(mark) > best.account.pnl(mark) ? p : best),
            null,
        );
        if (!leader) {
            ctx.notify(ctx.player, { level: "info", title: ctx.power.title, description: "There's nobody to fire at." });
            return;
        }

        const account = leader.account;
        if (account.shares > 0 && !account.tradingDisabled) {
            ctx.market.cancelAll(account, { side: "sell" });
            const qty = Math.ceil(account.availableShares * LIQUIDATE);
            const before = ctx.market.price;
            const outcome = qty > 0 ? ctx.marketOrder(leader, "sell", qty) : null;
            if (outcome?.ok && outcome.filled > 0) {
                const sold = `${outcome.filled} share${outcome.filled === 1 ? "" : "s"}`;
                const move = `$${before.toFixed(2)} → $${ctx.market.price.toFixed(2)}`;
                ctx.notify(ctx.player, { level: "success", title: ctx.power.title, description: `Direct hit! ${leader.name} dropped ${sold} (${move}).` });
                ctx.notify(leader, { level: "warning", title: ctx.power.title, description: `${ctx.player.name} hit you with a Bullet Bill! ${sold} dumped at market (${move}).` });
                ctx.notify(
                    ctx.others.filter((p) => p !== leader),
                    { level: "info", title: ctx.power.title, description: `${leader.name} got hit by a Bullet Bill: ${sold} dumped (${move}).` },
                );
                return;
            }
        }

        // Nothing to knock loose (or the sale couldn't go through): the leader is knocked out instead.
        ctx.state.release = leader.lockTrading();
        ctx.notify(ctx.player, { level: "success", title: ctx.power.title, description: `Direct hit! ${leader.name} had no shares to drop, so they're knocked out for ${ctx.secondsLeft} seconds.` });
        ctx.notify(leader, { level: "warning", title: ctx.power.title, description: `${ctx.player.name} hit you with a Bullet Bill! You can't trade for ${ctx.secondsLeft} seconds.` });
    },

    onExpire(ctx) {
        ctx.state.release?.();
    },
});
