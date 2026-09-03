const PLAID_SYNC_REMOVAL_NOTE = "Removed by Plaid transaction sync.";

/**
 * Plaid leaves the replaced pending row behind as an excluded audit tombstone.
 * It is useful in the database, but showing it beside the replacement creates a
 * fake duplicate in the human-facing Exempt ledger.
 */
export function isPlaidSyncRemoval(notes: string | null): boolean {
  return notes?.trim() === PLAID_SYNC_REMOVAL_NOTE;
}
