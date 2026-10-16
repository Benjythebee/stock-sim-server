import { definePower } from "@mod";

/** What a spin costs, in dollars (only charged when you lose). */
const TICKET = 5;

/** Payouts as a share of the starting cash. Odds are relative weights. */
const REELS = [
    { symbols: "🍋 🍒 🔔", payout: 0, odds: 50 },
    { symbols: "🍒 🍒 🍒", payout: 0.05, odds: 30 },
    { symbols: "🔔 🔔 🔔", payout: 0.25, odds: 15 },
    { symbols: "💎 💎 💎", payout: 1.5, odds: 5 },
] as const;

const money = (dollars: number) => `$${dollars.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/**
 * Slot Machine: pull the lever. Half the time you lose the $5 ticket; otherwise you win 5%, 25%
 * or (1 in 20) a 150% jackpot of the starting cash. Jackpots are announced to the whole room.
 */
export default definePower({
    id: "slot-machine",
    title: "Slot Machine",
    description: "Pull the lever! Usually nothing, sometimes a little, and 1 in 20 a jackpot worth more than your starting cash.",
    icon: "slot-machine.svg",
    iconCredit: { author: "Caro Asercion", url: "https://game-icons.net/1x1/caro-asercion/slot-machine.html", license: "CC BY 3.0" },
    type: "client",
    instant: true,
    weight: 20,

    onActivate(ctx) {
        let roll = ctx.rng.next() * REELS.reduce((sum, r) => sum + r.odds, 0);
        const reel = REELS.find((r) => (roll -= r.odds) < 0) ?? REELS[0];
        if (reel.payout === 0) {
            ctx.giveCash(ctx.player, -TICKET);
            ctx.notify(ctx.player, { level: "info", title: ctx.power.title, description: `${reel.symbols}. No luck. That's ${money(TICKET)} for the ticket.` });
            return;
        }
        const won = Math.round(ctx.game.settings.startingCash * reel.payout * 100) / 100;
        ctx.giveCash(ctx.player, won);
        ctx.notify(ctx.player, { level: "success", title: ctx.power.title, description: `${reel.symbols}! You won ${money(won)}.` });
        if (reel === REELS[3]) {
            ctx.notify(ctx.others, { level: "info", title: ctx.power.title, description: `💎 JACKPOT! ${ctx.player.name} just won ${money(won)} on the slots.` });
        }
    },
});
