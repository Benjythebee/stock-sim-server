import { definePower, type Player } from "@mod";

/** Share of the P&L drop refunded when the cover ends. */
const COVER = 0.75;
/** Biggest payout, as a share of starting cash, so an all-in crash can't print a fortune. */
const MAX_PAYOUT = 0.25;

const dollars = (cents: number) => `$${(cents / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/**
 * Golden Parachute: insures your P&L for 30 seconds. If it's lower when the cover ends, 75% of
 * the drop is refunded in cash; gains are yours to keep. A defensive answer to Rumor Mill,
 * Volatility Storm and Siphon, or cover for a risky bet. Private: rivals aren't told.
 */
export default definePower({
    id: "golden-parachute",
    title: "Golden Parachute",
    description: "Insure your P&L for 30 seconds. If it drops, you get 75% of the loss back. Gains are yours to keep.",
    icon: "parachute.svg",
    iconCredit: { author: "Lorc", url: "https://game-icons.net/1x1/lorc/parachute.html", license: "CC BY 3.0" },
    type: "client",
    weight: 15,
    durationSeconds: 30,
    state: () => ({ account: null as Player["account"] | null, startPnl: 0 }),

    onActivate(ctx) {
        ctx.state.account = ctx.player.account;
        ctx.state.startPnl = ctx.player.account.pnl(ctx.market.markTicks);
        ctx.notify(ctx.player, {
            level: "success",
            title: ctx.power.title,
            description: `Your P&L is insured for ${ctx.secondsLeft} seconds. If it ends lower, you get ${COVER * 100}% of the drop back.`,
        });
    },

    onExpire(ctx) {
        const account = ctx.state.account;
        if (!account || account !== ctx.player.account) return;
        const drop = ctx.state.startPnl - account.pnl(ctx.market.markTicks);
        if (drop <= 0) {
            ctx.notify(ctx.player, { level: "info", title: ctx.power.title, description: "Your cover ended. Your P&L didn't drop, so there's nothing to pay out." });
            return;
        }
        const cap = Math.round(ctx.game.settings.startingCash * 100 * MAX_PAYOUT);
        const payout = Math.min(cap, Math.floor(drop * COVER));
        ctx.giveCash(ctx.player, payout / 100);
        ctx.notify(ctx.player, {
            level: "success",
            title: ctx.power.title,
            description: `Your parachute opened: ${dollars(payout)} refunded on a ${dollars(drop)} drop.`,
        });
    },
});
