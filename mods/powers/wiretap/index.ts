import { definePower } from "@mod";

interface Heard {
    name: string;
    side: "buy" | "sell";
    qty: number;
    notional: number;
}

const money = (dollars: number) => `$${dollars.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/**
 * Wiretap: for 20 seconds you hear every trade your rivals make, as one private toast per
 * second ("Bob bought 120 @ $1.04 · Carol sold 30 @ $1.10"). Rivals aren't told. Countered by
 * Burner Phone, which hides a player's trades and reveals who was listening.
 */
export default definePower({
    id: "wiretap",
    title: "Wiretap",
    description: "For 20 seconds, hear every trade your rivals make.",
    icon: "headphones.svg",
    iconCredit: { author: "Delapouite", url: "https://game-icons.net/1x1/delapouite/headphones.html", license: "CC BY 3.0" },
    type: "others",
    weight: 15,
    durationSeconds: 20,
    state: () => ({ heard: new Map<string, Heard>(), total: 0 }),

    onActivate(ctx) {
        ctx.onPlayerTrade((trade) => {
            if (trade.player === ctx.player) return;
            const key = `${trade.player.id}:${trade.side}`;
            const heard = ctx.state.heard.get(key) ?? { name: trade.player.name, side: trade.side, qty: 0, notional: 0 };
            heard.qty += trade.qty;
            heard.notional += trade.qty * trade.avgPrice;
            ctx.state.heard.set(key, heard);
        });
        ctx.notify(ctx.player, {
            level: "success",
            title: ctx.power.title,
            description: `You're listening in on every rival for ${ctx.secondsLeft} seconds.`,
        });
    },

    onTick(ctx) {
        if (ctx.state.heard.size === 0) return;
        const lines = [...ctx.state.heard.values()].map(
            (h) => `${h.name} ${h.side === "buy" ? "bought" : "sold"} ${h.qty} @ ${money(h.notional / h.qty)}`,
        );
        ctx.state.total += ctx.state.heard.size;
        ctx.state.heard.clear();
        ctx.notify(ctx.player, { level: "info", title: ctx.power.title, description: lines.join(" · ") });
    },

    onExpire(ctx) {
        const total = ctx.state.total;
        ctx.notify(ctx.player, {
            level: "info",
            title: ctx.power.title,
            description: total ? `The line went quiet. You overheard ${total} trade${total === 1 ? "" : "s"}.` : "The line went quiet. Nobody traded.",
        });
    },
});
