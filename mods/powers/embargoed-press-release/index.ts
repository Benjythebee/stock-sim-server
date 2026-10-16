import { definePower, resolveText } from "@mod";

/** How far ahead of everyone else you read the headline, in game seconds. */
const LEAD_SECONDS = 10;

/**
 * Embargoed Press Release: reveals the next headline (and whether it moves the fair value)
 * and brings it forward so it's published within 10 seconds. Works even with random news off.
 */
export default definePower({
    id: "embargoed-press-release",
    title: "Embargoed Press Release",
    description: `Read the next headline ${LEAD_SECONDS} seconds before everyone else, and whether it will move the price.`,
    icon: "newspaper.svg",
    iconCredit: { author: "Delapouite", url: "https://game-icons.net/1x1/delapouite/newspaper.html", license: "CC BY 3.0" },
    type: "client",
    instant: true,
    weight: 15,

    onActivate(ctx) {
        const next = ctx.upcomingNews(LEAD_SECONDS);
        if (!next) {
            ctx.notify(ctx.player, { level: "info", title: ctx.power.title, description: "Nothing's on the wire. No headlines are coming." });
            return;
        }
        const headline = resolveText(next.news.title, ctx.game.settings.ticketName);
        const shock = next.news.fairValueShock ?? 0;
        const pct = Math.round(Math.abs(shock) * 100);
        const outlook =
            shock > 0
                ? `Bullish: the fair value should jump about ${pct}%.`
                : shock < 0
                  ? `Bearish: the fair value should fall about ${pct}%.`
                  : "It won't change the fair value, so don't let the crowd spook you.";
        ctx.notify(ctx.player, {
            level: "success",
            title: ctx.power.title,
            description: `"${headline}" goes out in ${next.inSeconds}s. ${outlook}`,
        });
    },
});
