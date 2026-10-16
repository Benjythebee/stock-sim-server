import { definePower } from "../types";

export default definePower({
    id: "the-hacker-ddos",
    title: "The Hacker: DDoS Attack",
    description: "Launch a DDoS attack on all traders, disabling their ability to trade for 15 seconds.",
    icon: "stop",
    type: "others",
    weight: 20,
    durationSeconds: 15,
    state: () => ({ releases: [] as (() => void)[] }),

    onActivate(ctx) {
        ctx.state.releases = ctx.others.map((p) => p.lockTrading());
        ctx.notify(ctx.player, { level: "success", title: ctx.power.title, description: "You launched a DDoS attack on your rivals." });
        ctx.notify(ctx.others, {
            level: "warning",
            title: ctx.power.title,
            description: `${ctx.player.name} hired a hacker to block everybody. You cannot trade for ${ctx.secondsLeft} seconds.`,
        });
    },

    onExpire(ctx) {
        for (const release of ctx.state.releases) release();
        ctx.notify(ctx.player, { level: "info", title: ctx.power.title, description: "Your hacker's DDoS ended." });
        ctx.notify(ctx.others, { level: "success", title: ctx.power.title, description: "You can trade again." });
    },
});
