import { describe, expect, it } from "vitest";

import { isPlaidSyncRemoval } from "@/lib/domain/transactions";

describe("isPlaidSyncRemoval", () => {
  it("hides only Plaid replacement tombstones", () => {
    expect(isPlaidSyncRemoval("Removed by Plaid transaction sync.")).toBe(true);
    expect(isPlaidSyncRemoval(" Removed by Plaid transaction sync. ")).toBe(true);
    expect(isPlaidSyncRemoval("User-confirmed reimbursable transfer.")).toBe(false);
    expect(isPlaidSyncRemoval(null)).toBe(false);
  });
});
