import { definePower, type Player } from "@mod";

/** Powers that spy on other players' trades, and how to tell whether one is aimed at `target`. */
const SPYING: Record<string, (state: unknown, target: Player) => boolean> = {
    wiretap: () => true, // listens to everyone
    copycat: (state, target) => (state as { target?: Player | null }).target === target,
};

/**
 * Burner Phone, the anti-wiretap: for 45 seconds your trades are hidden from Wiretap and
 * Copycat, any tap already on you goes dead, and you learn who was listening (they're told
 * you switched phones).
 */
export default definePower({
    id: "burner-phone",
    title: "Burner Phone",
    description: "For 45 seconds, nobody can wiretap or copy your trades. Also tells you who was listening in.",
    icon: "smartphone.svg",
    iconCredit: { author: "Delapouite", url: "https://game-icons.net/1x1/delapouite/smartphone.html", license: "CC BY 3.0" },
    type: "client",
    weight: 15,
    durationSeconds: 45,
    state: () => ({ release: null as null | (() => void) }),

    onActivate(ctx) {
        ctx.state.release = ctx.player.concealTrades();
        const spies = [
            ...new Set(
                ctx
                    .activeEffects()
                    .filter((e) => e.player !== ctx.player && SPYING[e.powerId]?.(e.state, ctx.player))
                    .map((e) => e.player),
            ),
        ];
        const seconds = ctx.secondsLeft;
        if (spies.length === 0) {
            ctx.notify(ctx.player, {
                level: "success",
                title: ctx.power.title,
                description: `Nobody was listening in, and for ${seconds} seconds nobody can.`,
            });
            return;
        }
        const names = spies.map((p) => p.name).join(", ");
        ctx.notify(ctx.player, {
            level: "success",
            title: ctx.power.title,
            description: `${names} ${spies.length === 1 ? "was" : "were"} listening in. Not anymore: your trades are hidden for ${seconds} seconds.`,
        });
        ctx.notify(spies, {
            level: "warning",
            title: ctx.power.title,
            description: `${ctx.player.name} switched to a burner phone. You can't see their trades anymore.`,
        });
    },

    onExpire(ctx) {
        ctx.state.release?.();
        ctx.notify(ctx.player, { level: "info", title: ctx.power.title, description: "Your burner phone died. Your trades can be seen again." });
    },
});
