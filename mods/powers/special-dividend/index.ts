import { definePower } from "@mod";

/** Dividend per share, as a share of the current price. */
const YIELD = 0.03;

const money = (cents: number) => `$${(cents / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/**
 * Special Dividend: every shareholder (players and bots) is paid 3% of the current price per
 * share they hold, in cash, right now. Rewards holding; play it after building a position, but
 * your rivals' shares get paid too.
 */
export default definePower({
    id: "special-dividend",
    title: "Special Dividend",
    description: `Every shareholder is paid ${YIELD * 100}% of the price per share, in cash, right now. Load up first!`,
    icon: "receive-money.svg",
    iconCredit: { author: "Delapouite", url: "https://game-icons.net/1x1/delapouite/receive-money.html", license: "CC BY 3.0" },
    type: "all",
    instant: true,
    weight: 15,

    onActivate(ctx) {
        const perShare = Math.max(1, Math.round(ctx.market.markTicks * YIELD));
        for (const bot of ctx.game.bots) {
            if (bot.account.shares > 0) bot.account.adjustCash(bot.account.shares * perShare);
        }
        for (const p of ctx.players) {
            const shares = p.account.shares;
            const paid = shares > 0 ? Math.round(ctx.giveCash(p, (shares * perShare) / 100) * 100) : 0;
            const got = paid ? `You received ${money(paid)} on ${shares} share${shares === 1 ? "" : "s"}.` : "You hold no shares, so you got nothing.";
            ctx.notify(p, {
                level: p === ctx.player ? "success" : "info",
                title: ctx.power.title,
                description: p === ctx.player ? `You declared a ${money(perShare)} dividend per share. ${got}` : `${ctx.player.name} declared a ${money(perShare)} dividend per share. ${got}`,
            });
        }
    },
});
