import { describe, expect, it } from "vitest";

import { validateAuditPayload } from "./reconcile-credit-card-audit.mjs";

describe("credit-card audit reconciliation payload", () => {
  it("accepts a complete, internally linked payload", () => {
    expect(
      validateAuditPayload({
        profileEmail: "owner@example.com",
        accounts: [
          {
            name: "Example Card",
            debtName: "Example Card",
            planningBalance: 25,
            scheduledPaymentAmount: 25,
            scheduledPaymentDate: "2026-09-09",
          },
        ],
        transactions: [
          {
            accountName: "Example Card",
            date: "2026-08-29",
            importKey: "card-audit:example:1",
            amount: 25,
            status: "applied",
            classification: "legitimate",
          },
        ],
        expenses: [],
      }),
    ).toEqual([]);
  });

  it("rejects duplicate import keys and unknown account references", () => {
    const errors = validateAuditPayload({
      profileEmail: "owner@example.com",
      accounts: [
        {
          name: "Example Card",
          debtName: "Example Card",
          planningBalance: 0,
        },
      ],
      transactions: [
        {
          accountName: "Missing Card",
          date: "2026-08-29",
          importKey: "duplicate",
          amount: 10,
          status: "excluded",
          classification: "disputed",
        },
        {
          accountName: "Example Card",
          date: "not-a-date",
          importKey: "duplicate",
          amount: 10,
          status: "excluded",
          classification: "disputed",
        },
      ],
      expenses: [],
    });

    expect(errors).toContain("transactions[0] references an unknown account.");
    expect(errors).toContain("Duplicate transaction importKey: duplicate.");
    expect(errors).toContain("transactions[1].date must be YYYY-MM-DD.");
  });

  it("rejects incomplete or malformed scheduled payments", () => {
    const errors = validateAuditPayload({
      profileEmail: "owner@example.com",
      accounts: [
        {
          name: "Example Card",
          debtName: "Example Card",
          planningBalance: 25,
          scheduledPaymentAmount: 0,
          scheduledPaymentDate: "September 9",
        },
      ],
      transactions: [],
      expenses: [],
    });

    expect(errors).toContain(
      "accounts[0].scheduledPaymentAmount must be positive or null.",
    );
    expect(errors).toContain(
      "accounts[0].scheduledPaymentDate must be YYYY-MM-DD or null.",
    );
  });
});
