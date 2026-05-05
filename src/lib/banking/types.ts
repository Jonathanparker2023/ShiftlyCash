export type PlaidItemStatus = "active" | "login_required" | "error";

export type BankingPlaidItem = {
  id: string;
  plaidItemId: string | null;
  institutionName: string | null;
  status: PlaidItemStatus;
  lastSyncedAt: string | null;
};

export type PendingTransaction = {
  id: string;
  date: string;
  time: string | null;
  createdAt: string;
  merchantName: string;
  amountCents: number;
  source: string;
  status: string;
  reviewReason: string | null;
  dayId: string | null;
};

export type BankingDayOption = {
  id: string;
  label: string;
  date: string;
};

export type BankingConfigStatus = {
  isConfigured: boolean;
  missing: string[];
};

export type BankingData = {
  config: BankingConfigStatus;
  items: BankingPlaidItem[];
  pendingTransactions: PendingTransaction[];
  dayOptions: BankingDayOption[];
};
