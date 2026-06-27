"use client";

import Link from "next/link";
import { useState } from "react";
import type { ReactNode } from "react";

const FIELD =
  "h-11 w-full rounded-xl border border-[var(--border-subtle)] bg-[var(--surface-hover)] px-3.5 text-sm text-[var(--text-primary)] outline-none transition placeholder:text-[var(--text-muted)] focus:border-[var(--border-strong)] focus:bg-[var(--surface-hover)] focus:ring-2 focus:ring-[var(--accent-ring)]";

type IncomeKind = "hourly" | "salary";

export function SetupWizard() {
  const [incomeRows, setIncomeRows] = useState<number[]>([0]);
  const [expenseRows, setExpenseRows] = useState<number[]>([0]);
  const [debtRows, setDebtRows] = useState<number[]>([0]);
  const next = useRowCounter();

  return (
    <main className="min-h-screen px-4 py-6 text-[var(--text-primary)] sm:px-6 lg:px-8">
      <section className="mx-auto max-w-3xl">
        <header className="mb-6">
          <p className="text-xs font-semibold uppercase tracking-[0.22em] text-[var(--text-tertiary)]">
            Welcome
          </p>
          <h1 className="mt-1.5 text-3xl font-semibold tracking-tight">
            Let&apos;s set up your money
          </h1>
          <p className="mt-1.5 text-sm text-[var(--text-tertiary)]">
            Tell us how you earn and what you owe. We&apos;ll turn it into a
            simple daily picture of your cashflow.
          </p>
        </header>

        <div className="mb-5 rounded-xl border border-[var(--accent-brand-border)] bg-[var(--accent-brand-fill)] px-4 py-3 text-xs font-medium text-[var(--accent-brand-text)]">
          Preview — this is the consumer setup flow. Saving gets wired up in the
          next build phase; nothing here is stored yet.
        </div>

        <div className="space-y-5">
          <SetupCard
            step="1"
            title="Income sources"
            blurb="Add each job or income stream. Hourly gets multiplied by hours you log; salary is spread evenly across the month."
          >
            {incomeRows.map((row) => (
              <IncomeSourceRow key={row} />
            ))}
            <AddRowButton
              label="Add income source"
              onClick={() => setIncomeRows((r) => [...r, next()])}
            />
          </SetupCard>

          <SetupCard
            step="2"
            title="Recurring expenses"
            blurb="Rent, insurance, phone, car, subscriptions. We spread these into a steady daily cost."
          >
            {expenseRows.map((row) => (
              <ExpenseRow key={row} />
            ))}
            <AddRowButton
              label="Add expense"
              onClick={() => setExpenseRows((r) => [...r, next()])}
            />
          </SetupCard>

          <SetupCard
            step="3"
            title="Debt accounts"
            blurb="Loans and credit cards you're paying down. We'll project a debt-free date."
          >
            {debtRows.map((row) => (
              <DebtRow key={row} />
            ))}
            <AddRowButton
              label="Add debt"
              onClick={() => setDebtRows((r) => [...r, next()])}
            />
          </SetupCard>

          <SetupCard
            step="4"
            title="Bank connection"
            blurb="Optionally connect your bank so transactions flow in automatically. You can skip this and add it later."
          >
            <button
              className="inline-flex h-11 items-center gap-2 rounded-xl border border-[var(--border-subtle)] bg-[var(--surface-hover)] px-4 text-sm font-semibold text-[var(--text-primary)] transition hover:border-[var(--border-strong)] hover:bg-[var(--surface-hover)]"
              type="button"
            >
              Connect a bank
            </button>
          </SetupCard>

          <SetupCard
            step="5"
            title="Starting balances"
            blurb="Your current cash and account balances, so net worth starts from the right number."
          >
            <label className="block">
              <FieldLabel>Cash on hand</FieldLabel>
              <input className={FIELD} inputMode="decimal" placeholder="$0.00" />
            </label>
          </SetupCard>
        </div>

        <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-xs text-[var(--text-muted)]">
            You can change any of this later in settings.
          </p>
          <Link
            className="inline-flex h-11 items-center justify-center rounded-xl border border-[var(--border-subtle)] bg-[var(--surface-hover)] px-5 text-sm font-semibold text-[var(--text-primary)] transition hover:border-[var(--border-strong)] hover:bg-[var(--surface-hover)]"
            href="/"
          >
            Finish setup
          </Link>
        </div>
      </section>
    </main>
  );
}

function useRowCounter() {
  const ref = useState(() => ({ n: 1 }))[0];
  return () => {
    ref.n += 1;
    return ref.n;
  };
}

function SetupCard({
  step,
  title,
  blurb,
  children,
}: {
  step: string;
  title: string;
  blurb: string;
  children: ReactNode;
}) {
  return (
    <section className="rounded-2xl border border-[var(--border-subtle)] bg-[var(--surface-hover)] p-5 shadow-[0_8px_30px_rgba(0,0,0,0.22)] backdrop-blur-xl">
      <div className="flex items-start gap-3">
        <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-[var(--surface-hover)] text-sm font-semibold">
          {step}
        </span>
        <div>
          <h2 className="text-lg font-semibold tracking-tight">{title}</h2>
          <p className="mt-1 text-sm text-[var(--text-tertiary)]">{blurb}</p>
        </div>
      </div>
      <div className="mt-4 space-y-3">{children}</div>
    </section>
  );
}

function IncomeSourceRow() {
  const [kind, setKind] = useState<IncomeKind>("hourly");

  return (
    <div className="grid gap-3 rounded-xl border border-[var(--border-subtle)] bg-[var(--surface-hover)] p-3 sm:grid-cols-2">
      <label className="block">
        <FieldLabel>Name</FieldLabel>
        <input className={FIELD} placeholder="Main job" />
      </label>
      <label className="block">
        <FieldLabel>Type</FieldLabel>
        <select
          className={FIELD}
          onChange={(e) => setKind(e.target.value as IncomeKind)}
          value={kind}
        >
          <option value="hourly">Hourly</option>
          <option value="salary">Salary</option>
        </select>
      </label>
      <label className="block">
        <FieldLabel>{kind === "hourly" ? "Hourly rate" : "Salary amount"}</FieldLabel>
        <input className={FIELD} inputMode="decimal" placeholder="$0.00" />
      </label>
      <label className="block">
        <FieldLabel>Tag color</FieldLabel>
        <input className={FIELD} placeholder="Blue" />
      </label>
    </div>
  );
}

function ExpenseRow() {
  return (
    <div className="grid gap-3 rounded-xl border border-[var(--border-subtle)] bg-[var(--surface-hover)] p-3 sm:grid-cols-3">
      <label className="block sm:col-span-1">
        <FieldLabel>Name</FieldLabel>
        <input className={FIELD} placeholder="Rent" />
      </label>
      <label className="block">
        <FieldLabel>Monthly amount</FieldLabel>
        <input className={FIELD} inputMode="decimal" placeholder="$0.00" />
      </label>
      <label className="block">
        <FieldLabel>Due day</FieldLabel>
        <input className={FIELD} inputMode="numeric" placeholder="1" />
      </label>
    </div>
  );
}

function DebtRow() {
  return (
    <div className="grid gap-3 rounded-xl border border-[var(--border-subtle)] bg-[var(--surface-hover)] p-3 sm:grid-cols-4">
      <label className="block">
        <FieldLabel>Name</FieldLabel>
        <input className={FIELD} placeholder="Car loan" />
      </label>
      <label className="block">
        <FieldLabel>Balance</FieldLabel>
        <input className={FIELD} inputMode="decimal" placeholder="$0.00" />
      </label>
      <label className="block">
        <FieldLabel>APR %</FieldLabel>
        <input className={FIELD} inputMode="decimal" placeholder="0" />
      </label>
      <label className="block">
        <FieldLabel>Min payment</FieldLabel>
        <input className={FIELD} inputMode="decimal" placeholder="$0.00" />
      </label>
    </div>
  );
}

function AddRowButton({
  label,
  onClick,
}: {
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      className="inline-flex h-10 items-center gap-2 rounded-xl border border-dashed border-[var(--border-default)] bg-transparent px-3.5 text-sm font-semibold text-[var(--text-secondary)] transition hover:border-[var(--border-strong)] hover:text-[var(--text-primary)]"
      onClick={onClick}
      type="button"
    >
      <span className="text-base leading-none">+</span>
      {label}
    </button>
  );
}

function FieldLabel({ children }: { children: ReactNode }) {
  return (
    <span className="mb-1.5 block text-[0.7rem] font-semibold uppercase tracking-[0.13em] text-[var(--text-tertiary)]">
      {children}
    </span>
  );
}
