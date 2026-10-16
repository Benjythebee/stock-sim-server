import { definePower } from "../types";

export default definePower({
    id: "the-homeless-gift",
    title: "The Homeless Man's Gift",
    description: "A homeless man gives you a gift.",
    icon: "present",
    type: "client",
    instant: true,
    weight: 40,

    onActivate(ctx) {
        ctx.giveCash(ctx.player, 1);
        ctx.notify(ctx.player, {
            level: "success",
            title: ctx.power.title,
            description: "You received $1.00 from a homeless man. Feel grateful!",
        });
    },
});
