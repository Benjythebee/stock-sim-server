/**
 * A bank loan. Its term runs from the step it was taken to the end of the game, and the interest
 * accrues linearly over that term: keep it to the end and you owe the full `rate`, repay it after
 * a quarter of the term and you owe a quarter of it. Paying part of it down settles the interest
 * accrued so far, and from then on only what's left accrues (at the same pace).
 * All amounts in cents, time in market steps.
 */
export class Loan {
    /** Principal still owed. */
    principal: number;
    /** The step interest has been settled up to (the start, or the last partial repayment). */
    accruedFrom: number;

    constructor(
        principal: number,
        /** Interest over the whole term, as a fraction (0.1 = 10%). See refinance(). */
        public rate: number,
        readonly startStep: number,
        readonly endStep: number,
        /** Game clock (epoch ms) when it was taken, for display. */
        readonly takenAt = 0,
    ) {
        this.principal = principal;
        this.accruedFrom = startStep;
    }

    /** Interest owed on what's left if the loan is kept to the end of the term. */
    get maxInterest(): number {
        return this.interestAt(this.endStep);
    }

    /** Interest accrued on the outstanding principal by `step` (capped at the end of the term). */
    interestAt(step: number): number {
        const term = this.endStep - this.startStep;
        if (term <= 0) return Math.round(this.principal * this.rate);
        const elapsed = Math.min(this.endStep, Math.max(this.accruedFrom, step)) - this.accruedFrom;
        return Math.round((this.principal * this.rate * elapsed) / term);
    }

    /** Principal plus the interest accrued by `step`: what repaying it all at `step` costs. */
    owedAt(step: number): number {
        return this.principal + this.interestAt(step);
    }

    /**
     * Pay `principal` cents of it down at `step`, settling the interest accrued so far. Returns
     * that interest (the caller collects it along with the principal).
     */
    payDown(principal: number, step: number): number {
        const interest = this.interestAt(step);
        this.principal -= Math.min(principal, this.principal);
        this.accruedFrom = Math.max(this.accruedFrom, Math.min(step, this.endStep));
        return interest;
    }

    /**
     * From `step` on, accrue interest at `rate` instead. The interest accrued before `step` is
     * written off, not collected.
     */
    refinance(rate: number, step: number): void {
        this.payDown(0, step);
        this.rate = rate;
    }
}
