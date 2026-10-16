import { definePower, type Player, type WheelSegment } from "@mod";

/** What a bust costs, in dollars. */
const TICKET = 5;
/** How long the wheel spins on screen. The prize is paid one game second after it stops. */
const SPIN_MS = 4000;

type Prize = "bust" | "small" | "big" | "jackpot";

/** Prize as a share of the starting cash. */
const PAYOUT: Record<Prize, number> = { bust: 0, small: 0.05, big: 0.25, jackpot: 1.5 };
const COLORS: Record<Prize, string> = { bust: "#6b7280", small: "#16a34a", big: "#2563eb", jackpot: "#d97706" };
/** Slice sizes, which are also the odds: 4 busts (50%), 4 small (30%), 2 big (15%), 1 jackpot (5%). */
const SIZE: Record<Prize, number> = { bust: 12.5, small: 7.5, big: 7.5, jackpot: 5 };
/** Clockwise from the top, spread out so every prize sits between other ones. */
const WHEEL: Prize[] = ["bust", "small", "bust", "big", "small", "bust", "jackpot", "small", "bust", "big", "small"];

const money = (dollars: number, cents = true) =>
    `$${dollars.toLocaleString("en-US", { minimumFractionDigits: cents ? 2 : 0, maximumFractionDigits: cents ? 2 : 0 })}`;

/**
 * Spin the Wheel: a prize wheel spins on your screen (the "wheel" presentation, mod API v2). Half
 * the time it's a bust and you pay the $5 ticket; otherwise you win 5%, 25% or (1 in 20) a 150%
 * jackpot of the starting cash. The server rolls the result up front; the cash lands when the wheel
 * stops, and jackpots are announced to the room.
 */
export default definePower({
    id: "spin-the-wheel",
    title: "Spin the Wheel",
    description: "Spin the prize wheel! Often a bust, sometimes a little, and 1 in 20 a jackpot worth more than your starting cash.",
    icon: "wheel-of-fortune.svg",
    iconCredit: { author: "Caro Asercion", url: "https://game-icons.net/1x1/caro-asercion/tarot-10-wheel-of-fortune.html", license: "CC BY 3.0" },
    apiVersion: 2,
    type: "client",
    instant: true,
    weight: 15,
    durationSeconds: Math.ceil(SPIN_MS / 1000) + 1,
    state: () => ({ prize: "bust" as Prize, account: null as Player["account"] | null }),

    onActivate(ctx) {
        const start = ctx.game.settings.startingCash;
        const segments: WheelSegment[] = WHEEL.map((prize) => ({
            label: prize === "bust" ? "Bust" : `${prize === "jackpot" ? "💎 " : "+"}${money(start * PAYOUT[prize], false)}`,
            color: COLORS[prize],
            weight: SIZE[prize],
        }));
        let roll = ctx.rng.next() * WHEEL.reduce((sum, p) => sum + SIZE[p], 0);
        const result = Math.max(0, WHEEL.findIndex((p) => (roll -= SIZE[p]) < 0));
        ctx.state.prize = WHEEL[result]!;
        ctx.state.account = ctx.player.account;
        ctx.present(ctx.player, { kind: "wheel", segments, result, durationMs: SPIN_MS });
    },

    onExpire(ctx) {
        // The lobby rebuilt the game mid-spin: that account is gone.
        if (ctx.state.account !== ctx.player.account) return;
        const prize = ctx.state.prize;
        if (prize === "bust") {
            ctx.giveCash(ctx.player, -TICKET);
            ctx.notify(ctx.player, { level: "info", title: ctx.power.title, description: `Bust! That's ${money(TICKET)} for the ticket.` });
            return;
        }
        const won = Math.round(ctx.game.settings.startingCash * PAYOUT[prize] * 100) / 100;
        ctx.giveCash(ctx.player, won);
        ctx.notify(ctx.player, { level: "success", title: ctx.power.title, description: `${prize === "jackpot" ? "💎 JACKPOT! " : ""}You won ${money(won)}.` });
        if (prize === "jackpot") {
            ctx.notify(ctx.others, { level: "info", title: ctx.power.title, description: `💎 JACKPOT! ${ctx.player.name} just won ${money(won)} on the wheel.` });
        }
    },
});
