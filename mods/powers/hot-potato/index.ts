import { definePower, type Player, type PowerContext } from "@mod";

/** Share of the holder's net worth the blast destroys. */
const BLAST = 0.1;
/** The fuse burns for a hidden 15-25 game seconds. */
const MIN_FUSE = 15;
const MAX_FUSE = 25;

interface State {
    holder: Player | null;
    /** Share count when the holder got the potato: any change means they traded, which passes it on. */
    sharesAtPass: number;
    fuse: number;
    elapsed: number;
    passes: number;
    exploded: boolean;
}

const money = (cents: number) => `$${(cents / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

function pass(ctx: PowerContext<State>, to: Player): void {
    ctx.state.holder = to;
    ctx.state.sharesAtPass = to.account.shares;
    ctx.notify(to, {
        level: "warning",
        title: ctx.power.title,
        description: "You're holding the hot potato! Make a trade to pass it on before it blows.",
    });
    ctx.notify(
        ctx.players.filter((p) => p !== to),
        { level: "info", title: ctx.power.title, description: `${to.name} is holding the hot potato.` },
    );
}

/**
 * Hot Potato: a bomb lands on a random rival. Whoever holds it passes it to another random player
 * (the initiator included) the moment they trade, i.e. as soon as their share count changes. When
 * the hidden 15-25s fuse runs out, the holder loses 10% of their net worth: cash first, then their
 * open orders are cancelled and shares are blown up at the market price. Pure chaos: everyone is
 * told who holds it, so the room watches the holder scramble to trade.
 */
export default definePower({
    id: "hot-potato",
    title: "Hot Potato",
    description: `Toss a ticking bomb to a rival. It passes on whenever its holder trades. When it blows, the holder loses ${BLAST * 100}% of their net worth.`,
    icon: "time-bomb.svg",
    iconCredit: { author: "Lorc", url: "https://game-icons.net/1x1/lorc/time-bomb.html", license: "CC BY 3.0" },
    type: "others",
    weight: 10,
    durationSeconds: MAX_FUSE + 1,
    state: (): State => ({ holder: null, sharesAtPass: 0, fuse: MAX_FUSE, elapsed: 0, passes: 0, exploded: false }),

    onActivate(ctx) {
        const first = ctx.others[ctx.rng.int(ctx.others.length)];
        if (!first) {
            ctx.notify(ctx.player, { level: "info", title: ctx.power.title, description: "There's nobody to throw it at." });
            return;
        }
        ctx.state.fuse = MIN_FUSE + ctx.rng.int(MAX_FUSE - MIN_FUSE + 1);
        ctx.notify(ctx.player, { level: "success", title: ctx.power.title, description: `You tossed a hot potato to ${first.name}. Don't let it come back!` });
        pass(ctx, first);
    },

    onTick(ctx) {
        const s = ctx.state;
        if (!s.holder || s.exploded) return;
        s.elapsed++;
        const players = ctx.players;
        const holder = s.holder;
        if (!players.includes(holder) || holder.account.shares !== s.sharesAtPass) {
            const next = players.filter((p) => p !== holder);
            const to = next[ctx.rng.int(next.length)];
            if (!to) return;
            s.passes++;
            pass(ctx, to);
        }
        if (s.elapsed === s.fuse - 3) {
            ctx.notify(s.holder, { level: "warning", title: ctx.power.title, description: "The potato is smoking. Trade now!" });
        }
        if (s.elapsed < s.fuse) return;

        s.exploded = true;
        const victim = s.holder;
        const account = victim.account;
        const mark = ctx.market.markTicks;
        const owed = Math.round(account.equity(mark) * BLAST);
        let cash = -account.adjustCash(-Math.min(owed, account.availableCash));
        let shares = 0;
        if (cash < owed) {
            ctx.market.cancelAll(account);
            cash += -account.adjustCash(-Math.min(owed - cash, account.availableCash));
            if (cash < owed && mark > 0) {
                shares = Math.min(account.availableShares, Math.ceil((owed - cash) / mark));
                account.adjustShares(-shares);
            }
        }
        const lost = shares ? `${money(cash)} and ${shares} share${shares === 1 ? "" : "s"}` : money(cash);
        ctx.notify(victim, { level: "error", title: ctx.power.title, description: `BOOM! The potato blew up in your hands. You lost ${lost}.` });
        ctx.notify(
            players.filter((p) => p !== victim),
            {
                level: "info",
                title: ctx.power.title,
                description: `BOOM! The potato blew up on ${victim.name} after ${s.passes} pass${s.passes === 1 ? "" : "es"}. They lost ${lost}.`,
            },
        );
    },
});
