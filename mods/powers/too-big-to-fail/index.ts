import { definePower } from "@mod";

const money = (cents: number) => `$${(cents / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/**
 * Too Big to Fail: the bank decides it can't afford to lose you. Your bank loan becomes
 * interest-free: an open loan has the interest it accrued so far written off and accrues nothing
 * from then on, and without one you get the room's loan amount at 0%. Repay it whenever you like
 * (a later loan from the bank pays the normal rate again). As rare as the rarest powers (weight 5,
 * about 1 briefcase in 20), and only offered when the room has borrowing on.
 */
export default definePower({
    id: "too-big-to-fail",
    title: "Too Big to Fail",
    description: "The bank can't let you go under: your bank loan is interest-free. No loan yet? You get one at 0%.",
    icon: "bank.svg",
    type: "client",
    weight: 5,
    apiVersion: 3,
    available: (game) => game.settings.enableBorrowing,

    onActivate(ctx) {
        const bank = ctx.game.bank;
        const loan = ctx.player.account.loan;
        if (loan) {
            const forgiven = bank.forgiveInterest(ctx.player) ?? 0;
            ctx.notify(ctx.player, {
                level: "success",
                title: ctx.power.title,
                description:
                    `Your ${money(loan.principal)} loan is now interest-free` +
                    (forgiven > 0 ? `, and the bank wrote off the ${money(forgiven)} of interest it had built up.` : "."),
            });
            return;
        }
        const outcome = bank.borrow(ctx.player, 0);
        if (!outcome.ok) {
            ctx.notify(ctx.player, { level: "info", title: ctx.power.title, description: "The bank's window is closed: no loan this time." });
            return;
        }
        ctx.notify(ctx.player, {
            level: "success",
            title: ctx.power.title,
            description: `You borrowed ${money(outcome.principal)} at 0% interest. Pay it back whenever you like, or the bank takes just that at the end.`,
        });
    },
});
