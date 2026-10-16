import { definePower } from "../types";

export default definePower({
    id: "cash-heritage",
    title: "Cash Heritage",
    description: "Instantly receive cash from your ancestors.",
    icon: "present",
    type: "client",
    instant: true,
    weight: 10,

    onActivate(ctx) {
        // Between $1,000 and $1,000 + the starting cash, so it scales with the game.
        const amount = 1000 + Math.floor(ctx.rng.next() * ctx.game.settings.startingCash);
        ctx.giveCash(ctx.player, amount);
        ctx.notify(ctx.player, {
            level: "success",
            title: ctx.power.title,
            description: `You received $${amount.toLocaleString("en-US")} from your ancestors.`,
        });
        ctx.notify(ctx.others, { level: "info", title: ctx.power.title, description: `${ctx.player.name} just inherited a fortune.` });
    },
});
