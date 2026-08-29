create table if not exists public.credit_card_accounts (
  id uuid primary key default extensions.gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  debt_id uuid,
  name text not null,
  issuer text not null,
  last_four text,
  account_kind text not null default 'credit_card',
  account_status text not null default 'active',
  raw_current_balance numeric(12, 2),
  planning_balance numeric(12, 2) not null default 0,
  statement_balance numeric(12, 2),
  statement_date date,
  pending_total numeric(12, 2),
  credit_limit numeric(12, 2),
  available_credit numeric(12, 2),
  minimum_due numeric(10, 2),
  due_date date,
  autopay_status text not null default 'unknown',
  autopay_mode text,
  autopay_day integer,
  autopay_source_label text,
  apr numeric(7, 4),
  monthly_fee numeric(10, 2),
  annual_fee numeric(10, 2),
  credit_protection_amount numeric(10, 2),
  verification_status text not null default 'unverified',
  verified_at timestamptz,
  disputed_total numeric(12, 2) not null default 0,
  risk_status text not null default 'unverified',
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint credit_card_accounts_debt_same_user_fk
    foreign key (debt_id, user_id) references public.debts(id, user_id),
  constraint credit_card_accounts_kind_check
    check (account_kind in ('credit_card', 'store_card')),
  constraint credit_card_accounts_status_check
    check (account_status in ('active', 'paid', 'replacement_pending', 'unverified')),
  constraint credit_card_accounts_autopay_status_check
    check (autopay_status in ('on', 'off', 'unknown', 'paused')),
  constraint credit_card_accounts_verification_check
    check (verification_status in ('verified', 'user_reported', 'unverified', 'disputed')),
  constraint credit_card_accounts_risk_check
    check (risk_status in ('clear', 'open_dispute', 'unverified')),
  constraint credit_card_accounts_last_four_check
    check (last_four is null or last_four ~ '^[0-9]{4}$'),
  constraint credit_card_accounts_autopay_day_check
    check (autopay_day is null or autopay_day between 1 and 31),
  constraint credit_card_accounts_non_negative_check
    check (
      planning_balance >= 0
      and coalesce(pending_total, 0) >= 0
      and coalesce(credit_limit, 0) >= 0
      and coalesce(available_credit, 0) >= 0
      and coalesce(minimum_due, 0) >= 0
      and coalesce(apr, 0) >= 0
      and coalesce(monthly_fee, 0) >= 0
      and coalesce(annual_fee, 0) >= 0
      and coalesce(credit_protection_amount, 0) >= 0
      and disputed_total >= 0
    )
);

create unique index if not exists credit_card_accounts_user_name_unique
  on public.credit_card_accounts(user_id, lower(name));

create unique index if not exists credit_card_accounts_id_user_unique
  on public.credit_card_accounts(id, user_id);

create index if not exists credit_card_accounts_user_status_idx
  on public.credit_card_accounts(user_id, account_status);

alter table public.credit_card_accounts enable row level security;

create policy credit_card_accounts_own
  on public.credit_card_accounts for all
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

grant select, insert, update, delete on public.credit_card_accounts to authenticated;

alter table public.transactions
  add column if not exists credit_card_account_id uuid,
  add column if not exists card_transaction_classification text not null default 'unknown';

alter table public.transactions
  add constraint transactions_credit_card_account_same_user_fk
  foreign key (credit_card_account_id, user_id)
  references public.credit_card_accounts(id, user_id);

alter table public.transactions
  add constraint transactions_card_classification_check
  check (card_transaction_classification in ('legitimate', 'disputed', 'recurring', 'unknown'));

create index if not exists transactions_credit_card_account_idx
  on public.transactions(credit_card_account_id, date desc);
