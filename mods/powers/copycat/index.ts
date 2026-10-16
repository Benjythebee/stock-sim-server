import { definePower, type Player } from "@mod";

/**
 * Copycat: for 20 seconds every trade the leading rival makes is copied onto your account,
 * scaled to your size (buys by share of net worth, sells by share of holdings). The leader is
 * warned, so they can bait you. Copies are marked automatic, so two Copycats never loop, and a
 * Burner Phone hides the leader's trades.
 */
export default definePower({
    id: "copycat",
    title: "Copycat",
    description: "For 20 seconds, copy every trade the leading rival makes, scaled to your cash. They'll know someone is copying them.",
    icon: "two-shadows.svg",
    iconCredit: { author: "Lorc", url: "https://game-icons.net/1x1/lorc/two-shadows.html", license: "CC BY 3.0" },
    type: "others",
    weight: 10,
    durationSeconds: 20,
    state: () => ({ target: null as Player | null, copied: [] as string[] }),

    onActivate(ctx) {
        const mark = ctx.market.markTicks;
        const target = ctx.others.reduce<Player | null>(
            (best, p) => (!best || p.account.pnl(mark) > best.account.pnl(mark) ? p : best),
            null,
        );
        if (!target) {
            ctx.notify(ctx.player, { level: "info", title: ctx.power.title, description: "There's nobody to copy." });
            return;
        }
        ctx.state.target = target;

        ctx.onPlayerTrade((trade) => {
            if (trade.player !== target || trade.automatic) return;
            const mark = ctx.market.markTicks;
            const me = ctx.player.account;
            const them = target.account;
            const priceCents = Math.round(trade.avgPrice * 100);
            let qty: number;
            if (trade.side === "buy") {
                const share = Math.min(1, (trade.qty * priceCents) / Math.max(1, them.equity(mark)));
                qty = Math.floor((share * me.equity(mark)) / Math.max(1, priceCents));
            } else {
                const share = trade.qty / (them.shares + trade.qty);
                qty = Math.floor(share * me.availableShares);
            }
            if (qty < 1) return;
            const outcome = ctx.marketOrder(ctx.player, trade.side, qty);
            if (!outcome.ok || outcome.filled === 0) return;
            const verb = trade.side === "buy" ? "bought" : "sold";
            ctx.state.copied.push(`${verb} ${outcome.filled} (${target.name} ${verb} ${trade.qty})`);
        });

        ctx.notify(ctx.player, {
            level: "success",
            title: ctx.power.title,
            description: `You're copying ${target.name}'s trades for ${ctx.secondsLeft} seconds, scaled to your size.`,
        });
        ctx.notify(target, {
            level: "warning",
            title: ctx.power.title,
            description: `Someone is copying your trades for ${ctx.secondsLeft} seconds.`,
        });
    },

    onTick(ctx) {
        if (ctx.state.copied.length === 0) return;
        ctx.notify(ctx.player, { level: "info", title: ctx.power.title, description: `You ${ctx.state.copied.join(" · ")}.` });
        ctx.state.copied = [];
    },

    onExpire(ctx) {
        const target = ctx.state.target;
        if (!target) return;
        ctx.notify(ctx.player, { level: "info", title: ctx.power.title, description: `You stopped copying ${target.name}.` });
        ctx.notify(target, { level: "info", title: ctx.power.title, description: "Nobody is copying you anymore." });
    },
});
