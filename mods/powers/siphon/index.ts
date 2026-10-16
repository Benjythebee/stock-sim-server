import { definePower, type Player } from "@mod";

/** Share of the victim's available cash moved each second. */
const DRAIN_PER_SECOND = 0.02;

/**
 * Siphon: drains cash from the richest rival for 10 seconds (~18% of their available cash).
 * Counterplay: cash locked in open orders can't be siphoned.
 */
export default definePower({
    id: "siphon",
    title: "Siphon",
    description: "Drains money from another player.",
    icon: "robber-hand.svg",
    iconCredit: { author: "Lorc", url: "https://game-icons.net/1x1/lorc/robber-hand.html", license: "CC BY 3.0" },
    type: "others",
    weight: 15,
    durationSeconds: 10,
    state: () => ({ victim: null as Player | null, total: 0 }),

    onActivate(ctx) {
        // Aim at whoever is ahead: highest net worth at the current price.
        const mark = ctx.market.markTicks;
        const victim = ctx.others.reduce<Player | null>(
            (best, p) => (!best || p.account.equity(mark) > best.account.equity(mark) ? p : best),
            null,
        );
        if (!victim) {
            ctx.notify(ctx.player, { level: "info", title: ctx.power.title, description: "There's nobody to rob." });
            return;
        }
        ctx.state.victim = victim;
        ctx.notify(ctx.player, { level: "success", title: ctx.power.title, description: `You're draining ${victim.name}'s cash.` });
        ctx.notify(victim, {
            level: "warning",
            title: ctx.power.title,
            description: `${ctx.player.name} is siphoning your cash! Money locked in orders is safe.`,
        });
    },

    onTick(ctx) {
        const victim = ctx.state.victim;
        if (!victim) return;
        const amount = Math.floor((victim.account.availableCash / 100) * DRAIN_PER_SECOND * 100) / 100;
        if (amount <= 0) return;
        const taken = -ctx.giveCash(victim, -amount);
        ctx.giveCash(ctx.player, taken);
        ctx.state.total += taken;
    },

    onExpire(ctx) {
        const victim = ctx.state.victim;
        if (!victim) return;
        const total = `$${ctx.state.total.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
        ctx.notify(ctx.player, { level: "success", title: ctx.power.title, description: `You siphoned ${total} from ${victim.name}.` });
        ctx.notify(victim, { level: "info", title: ctx.power.title, description: `The siphon stopped. You lost ${total}.` });
    },
});
