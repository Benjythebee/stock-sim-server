import { describe, expect, test } from "bun:test";
import { Loan } from "../../src/engine/loan";

describe("Loan", () => {
    test("interest accrues linearly over the term and is capped at the full rate", () => {
        const loan = new Loan(500_000, 0.1, 100, 1100);
        expect(loan.maxInterest).toBe(50_000);
        expect(loan.interestAt(100)).toBe(0);
        expect(loan.interestAt(350)).toBe(12_500);
        expect(loan.interestAt(600)).toBe(25_000);
        expect(loan.interestAt(1100)).toBe(50_000);
        expect(loan.interestAt(5000)).toBe(50_000);
        expect(loan.interestAt(0)).toBe(0);
        expect(loan.owedAt(600)).toBe(525_000);
    });

    test("paying down settles the interest so far, then only what's left accrues, at the same pace", () => {
        const loan = new Loan(500_000, 0.1, 0, 1000);
        expect(loan.payDown(250_000, 250)).toBe(12_500);
        expect(loan.principal).toBe(250_000);
        expect(loan.interestAt(250)).toBe(0);
        expect(loan.interestAt(500)).toBe(6_250);
        expect(loan.maxInterest).toBe(18_750); // 12,500 + 18,750 in all, instead of 50,000
        expect(loan.payDown(1e9, 500)).toBe(6_250);
        expect(loan.principal).toBe(0);
        expect(loan.maxInterest).toBe(0);
    });

    test("a loan with no term left owes the full interest at once", () => {
        const loan = new Loan(1000, 0.25, 10, 10);
        expect(loan.interestAt(10)).toBe(250);
    });

    test("refinancing writes off the interest so far and accrues at the new rate from then on", () => {
        const loan = new Loan(500_000, 0.1, 0, 1000);
        expect(loan.interestAt(500)).toBe(25_000);
        loan.refinance(0, 500);
        expect(loan.rate).toBe(0);
        expect(loan.principal).toBe(500_000);
        expect(loan.interestAt(500)).toBe(0);
        expect(loan.maxInterest).toBe(0);
        expect(loan.owedAt(1000)).toBe(500_000);
    });
});
