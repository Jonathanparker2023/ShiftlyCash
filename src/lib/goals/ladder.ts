/**
 * Pure goal-ladder maths.
 *
 * Lives apart from data.ts because the client recomputes the whole ladder
 * whenever an assumption, the weekly cashflow, or a rung itself is edited,
 * and data.ts pulls in server-only auth.
 */

import { monthlyInterestCents } from "@/lib/goals/amortize";
import {
  simulateLadder,
  weeklyToMonthlyCents,
  type SimRung,
} from "@/lib/goals/simulate";

export type GoalStatus = "complete" | "active" | "locked";

export type TargetKind = "fixed" | "debt" | "house_hack";

/** A rung exactly as it is stored — the editable record. */
export type GoalRungRecord = {
  id: string;
  orderIndex: number;
  title: string;
  kicker: string;
  description: string;
  imageSrc: string | null;
  targetKind: TargetKind;
  targetCents: number;
  debtMatch: string | null;
  deadlineOn: string | null;
  deadlineLabel: string | null;
};

export type GoalComponent = {
  label: string;
  cents: number;
  note: string;
};

/** A rung with everything derived for display. */
export type GoalStep = GoalRungRecord & {
  order: number;
  resolvedTargetCents: number;
  fundedCents: number;
  remainingCents: number;
  progress: number;
  status: GoalStatus;
  components: GoalComponent[];
  /** Cumulative: reaching rung 3 means clearing 1 and 2 first. */
  weeksAway: number | null;
  etaIso: string | null;
  missesDeadline: boolean;
  /** Present on debt rungs: how the note actually retires the balance. */
  payoff: DebtPayoff | null;
};

export type DebtPayoff = {
  /** Months until this rung clears, from the whole-ladder simulation. */
  months: number | null;
  firstInterestCents: number;
  firstPrincipalCents: number;
  /** Interest this rung costs while the ladder works through it. */
  totalInterestCents: number;
  /** This rung's own contractual payment. Zero on a savings rung. */
  monthlyPaymentCents: number;
  /** Month cashflow started attacking this rung specifically. */
  becameActiveMonth: number | null;
  neverPaysOff: boolean;
};

export type HouseHackAssumptions = {
  propertyPriceCents: number;
  downPaymentPct: number;
  closingCostPct: number;
  reserveMonths: number;
  monthlyPitiCents: number;
};

/**
 * Researched defaults, all editable in the UI.
 *
 * FHA allows 3.5% down on 2-4 units. A 3-4 unit purchase additionally requires
 * cash reserves of three months' full payment held AFTER the down payment and
 * closing — reserves are a separate pile, not part of the deposit. $400k is a
 * working mid-market Hartford-area multifamily figure: city listings start
 * around $299k, while the county average (~$570k) is dragged up by larger
 * commercial buildings.
 *
 * monthlyPitiCents drives only the reserve line and is the first number to
 * replace with a real quote.
 */
export const DEFAULT_ASSUMPTIONS: HouseHackAssumptions = {
  propertyPriceCents: 400_000_00,
  downPaymentPct: 3.5,
  closingCostPct: 3,
  reserveMonths: 3,
  monthlyPitiCents: 3_700_00,
};

export const ASSUMPTION_SOURCES = [
  "FHA permits 3.5% down on 2-4 units; 3-4 units must also pass the self-sufficiency test, where 75% of gross rents has to cover PITI.",
  "FHA requires three months of PITI in reserves on a 3-4 unit purchase, held after the down payment and closing costs.",
  "The 2026 FHA four-unit loan limit in standard-cost areas is $1,041,125.",
  "Hartford assesses 4+ unit buildings as commercial, which raises the tax line versus a two or three family.",
];

export function houseHackEntry(a: HouseHackAssumptions) {
  const down = Math.round(a.propertyPriceCents * (a.downPaymentPct / 100));
  const closing = Math.round(a.propertyPriceCents * (a.closingCostPct / 100));
  const reserves = Math.round(a.monthlyPitiCents * a.reserveMonths);
  return { down, closing, reserves, total: down + closing + reserves };
}

export type DebtBalance = {
  name: string;
  cents: number;
  /** Annual rate as a fraction: 0.188 for 18.8%. */
  apr: number;
  /** The contractual monthly payment, already a fixed expense. */
  minimumPaymentCents: number;
};

export type LadderInput = {
  rungs: GoalRungRecord[];
  debts: DebtBalance[];
  /**
   * Capital actually earmarked against the ladder today. Deliberately NOT the
   * year's running balance: that is cumulative cashflow already spent, a
   * historical metric, and treating it as a war chest made a rung read
   * "Cleared" while the debt behind it was still owed.
   */
  appliedCapitalCents: number;
  weeklyCashflowCents: number;
  assumptions: HouseHackAssumptions;
  todayIso: string;
};

export function buildLadder(input: LadderInput): GoalStep[] {
  const entry = houseHackEntry(input.assumptions);
  const a = input.assumptions;

  const ordered = [...input.rungs].sort((x, y) => x.orderIndex - y.orderIndex);

  let pool = Math.max(0, input.appliedCapitalCents);
  const weekly = Math.max(0, input.weeklyCashflowCents);
  // Collected on the first pass so the whole ladder can be simulated at once --
  // a rung's date depends on the rungs below it, so none of them can be worked
  // out in isolation.
  const simRungs: SimRung[] = [];

  const steps: GoalStep[] = ordered.map((rung, index) => {
    let resolvedTargetCents = rung.targetCents;
    let components: GoalComponent[] = [
      { label: rung.title, cents: rung.targetCents, note: "Target amount" },
    ];

    let payoff: DebtPayoff | null = null;
    let matchedDebt: DebtBalance | null = null;

    if (rung.targetKind === "debt") {
      const pattern = rung.debtMatch ? new RegExp(rung.debtMatch, "i") : null;
      const match = pattern
        ? input.debts.find((debt) => pattern.test(debt.name))
        : undefined;
      resolvedTargetCents = match?.cents ?? 0;

      matchedDebt = match ?? null;

      if (match && match.minimumPaymentCents > 0) {
        const firstInterest = monthlyInterestCents(match.cents, match.apr);
        payoff = {
          months: null,
          firstInterestCents: firstInterest,
          firstPrincipalCents: Math.max(0, match.minimumPaymentCents - firstInterest),
          totalInterestCents: 0,
          monthlyPaymentCents: match.minimumPaymentCents,
          becameActiveMonth: null,
          neverPaysOff: false,
        };
        components = [
          {
            label: match.name,
            cents: resolvedTargetCents,
            note: "Live balance",
          },
          {
            label: "Paid by the note",
            cents: Math.max(0, match.minimumPaymentCents - firstInterest),
            note: `of ${formatRate(match.apr)} on ${centsLabel(match.minimumPaymentCents)}/mo — the rest is interest`,
          },
          {
            label: "Interest, first month",
            cents: firstInterest,
            note: "Rent on the money. Extra principal is what shrinks this.",
          },
        ];
      } else {
        components = [
          {
            label: match?.name ?? "Linked debt",
            cents: resolvedTargetCents,
            note: match
              ? "No monthly payment set on this debt"
              : "No debt matches this rung",
          },
        ];
      }
    } else if (rung.targetKind === "house_hack") {
      resolvedTargetCents = entry.total;
      components = [
        {
          label: "FHA down payment",
          cents: entry.down,
          note: `${a.downPaymentPct}% of the purchase price`,
        },
        {
          label: "Closing costs",
          cents: entry.closing,
          note: `${a.closingCostPct}% estimate`,
        },
        {
          label: "FHA reserves",
          cents: entry.reserves,
          note: `${a.reserveMonths} months of PITI, required on 3-4 units`,
        },
      ];
    }

    const fundedCents = Math.min(pool, resolvedTargetCents);
    pool -= fundedCents;
    const remainingCents = Math.max(0, resolvedTargetCents - fundedCents);

    // Every rung joins the simulation with its OWN minimum payment: $455.33 on
    // the Explorer, zero on a savings rung. Free cashflow is aimed at one rung
    // at a time on top of that, which is what actually pulls a date in.
    simRungs.push({
      id: rung.id,
      remainingCents,
      minimumPaymentCents: matchedDebt?.minimumPaymentCents ?? 0,
      apr: matchedDebt?.apr ?? 0,
      isDebt: rung.targetKind === "debt" && matchedDebt !== null,
    });

    // Both filled in by the simulation below.
    const weeksAway: number | null = null;


    return {
      ...rung,
      order: index + 1,
      resolvedTargetCents,
      fundedCents,
      remainingCents,
      progress: resolvedTargetCents > 0 ? fundedCents / resolvedTargetCents : 0,
      payoff,
      status: (remainingCents <= 0 ? "complete" : "locked") as GoalStatus,
      components,
      weeksAway,
      etaIso: null as string | null,
      missesDeadline: false,
    };
  });

  // SECOND PASS. Now that every rung's minimum and remaining balance are known,
  // run the ladder forward as one system. A rung's date depends on everything
  // below it -- and on its own balance still moving while something below it is
  // the target -- so this cannot be done rung by rung.
  const sim = simulateLadder({
    rungs: simRungs,
    monthlyCashflowCents: weeklyToMonthlyCents(weekly),
  });
  const simById = new Map(sim.map((result) => [result.id, result]));

  for (const step of steps) {
    const result = simById.get(step.id);
    if (!result) continue;

    step.weeksAway =
      result.monthsToClear === null
        ? null
        : Math.ceil((result.monthsToClear * 365) / 12 / 7);
    step.etaIso =
      step.weeksAway === null
        ? null
        : addDaysIso(input.todayIso, step.weeksAway * 7);
    step.missesDeadline = Boolean(
      step.etaIso && step.deadlineOn && step.etaIso > step.deadlineOn,
    );

    if (step.payoff) {
      step.payoff = {
        ...step.payoff,
        months: result.monthsToClear,
        totalInterestCents: result.interestPaidCents,
        becameActiveMonth: result.becameActiveMonth,
        neverPaysOff: result.monthsToClear === null,
      };
    }
  }

  // Exactly one rung reads as active: the lowest incomplete one.
  const next = steps.find((step) => step.status !== "complete");
  if (next) next.status = "active";

  return steps;
}

function addDaysIso(iso: string, days: number): string {
  const base = Date.parse(`${iso}T00:00:00.000Z`);
  if (Number.isNaN(base)) return iso;
  return new Date(base + days * 86_400_000).toISOString().slice(0, 10);
}

function formatRate(apr: number): string {
  return `${(apr * 100).toFixed(2).replace(/\.00$/, "")}%`;
}

function centsLabel(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}
