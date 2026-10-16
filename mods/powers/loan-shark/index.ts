import { definePower, type Player, type PowerContext } from "@mod";

/** Loan size, as a share of the starting cash. */
const LOAN = 1;
/** Interest owed on top of the loan when it's collected. */
const INTEREST = 0.05;
/** Term of the loan, in game seconds. */
const TERM = 30;

const money = (cents: number) => `$${(cents / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

interface State {
    account: Player["account"] | null;
    owed: number;
    repaid: boolean;
}

/**
 * Loan Shark: borrow your starting cash again, right now. After 30 seconds the shark collects
 * the loan plus 5%: from your cash, then by cancelling your orders, then by selling your shares
 * at market (any shortfall left after that is repossessed at the market price). Double your
 * firepower, but you have to be right fast. If the game ends first, the shark collects then.
 */
export default definePower({
    id: "loan-shark",
    title: "Loan Shark",
    description: `Borrow your starting cash again. In ${TERM} seconds the shark wants it back plus ${INTEREST * 100}%, and sells your shares if you're short.`,
    icon: "shark-jaws.svg",
    iconCredit: { author: "Lorc", url: "https://game-icons.net/1x1/lorc/shark-jaws.html", license: "CC BY 3.0" },
    type: "client",
    weight: 10,
    durationSeconds: TERM,
    state: (): State => ({ account: null, owed: 0, repaid: false }),

    onActivate(ctx) {
        const loan = Math.round(ctx.game.settings.startingCash * LOAN * 100);
        ctx.giveCash(ctx.player, loan / 100);
        ctx.state.account = ctx.player.account;
        ctx.state.owed = Math.round(loan * (1 + INTEREST));
        ctx.notify(ctx.player, {
            level: "success",
            title: ctx.power.title,
            description: `You borrowed ${money(loan)}. The shark collects ${money(ctx.state.owed)} in ${ctx.secondsLeft} seconds.`,
        });
    },

    onTick(ctx) {
        if (ctx.secondsLeft === 6) {
            ctx.notify(ctx.player, { level: "warning", title: ctx.power.title, description: `The shark collects ${money(ctx.state.owed)} in 5 seconds. Have the cash ready!` });
        }
        // The game ends this second: collect now, the effect won't get to expire.
        if (ctx.game.elapsedSeconds >= ctx.game.durationSeconds) collect(ctx);
    },

    onExpire(ctx) {
        collect(ctx);
    },
});

function collect(ctx: PowerContext<State>): void {
    const s = ctx.state;
    const account = s.account;
    if (s.repaid || !account || account !== ctx.player.account) return;
    s.repaid = true;
    const owed = s.owed;

    let cash = -account.adjustCash(-Math.min(owed, account.availableCash));
    let sold = 0;
    if (cash < owed) {
        ctx.market.cancelAll(account);
        cash += -account.adjustCash(-Math.min(owed - cash, account.availableCash));
    }
    // Still short: sell shares at market, a few rounds since deeper bids pay less.
    for (let round = 0; round < 3 && cash < owed && account.availableShares > 0; round++) {
        const bid = ctx.market.book.bestBid();
        if (bid === null || bid <= 0) break;
        const qty = Math.min(account.availableShares, Math.ceil((owed - cash) / bid));
        const outcome = ctx.marketOrder(ctx.player, "sell", qty);
        if (!outcome.ok || outcome.filled === 0) break;
        sold += outcome.filled;
        cash += -account.adjustCash(-Math.min(owed - cash, account.availableCash));
    }
    // No buyers or trading locked: repossess shares at the mark.
    let seized = 0;
    const mark = ctx.market.markTicks;
    if (cash < owed && mark > 0) {
        seized = Math.min(account.availableShares, Math.ceil((owed - cash) / mark));
        account.adjustShares(-seized);
    }

    if (sold === 0 && seized === 0) {
        ctx.notify(ctx.player, { level: "info", title: ctx.power.title, description: `The shark collected ${money(owed)}. Pleasure doing business.` });
        return;
    }
    const parts = [sold && `sold ${sold} of your shares`, seized && `repossessed ${seized} more`].filter(Boolean).join(" and ");
    ctx.notify(ctx.player, {
        level: "warning",
        title: ctx.power.title,
        description: `You were short, so the shark cancelled your orders, ${parts}, and took ${money(cash)}.`,
    });
}
