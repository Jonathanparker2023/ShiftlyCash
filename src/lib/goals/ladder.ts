/**
 * Pure goal-ladder maths.
 *
 * Lives apart from data.ts because the client recomputes the whole ladder
 * whenever an assumption, the weekly cashflow, or a rung itself is edited,
 * and data.ts pulls in server-only auth.
 */

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

export type DebtBalance = { name: string; cents: number };

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
  let cumulativeRemaining = 0;
  const weekly = Math.max(0, input.weeklyCashflowCents);

  const steps: GoalStep[] = ordered.map((rung, index) => {
    let resolvedTargetCents = rung.targetCents;
    let components: GoalComponent[] = [
      { label: rung.title, cents: rung.targetCents, note: "Target amount" },
    ];

    if (rung.targetKind === "debt") {
      const pattern = rung.debtMatch ? new RegExp(rung.debtMatch, "i") : null;
      const match = pattern
        ? input.debts.find((debt) => pattern.test(debt.name))
        : undefined;
      resolvedTargetCents = match?.cents ?? 0;
      components = [
        {
          label: match?.name ?? "Linked debt",
          cents: resolvedTargetCents,
          note: match ? "Live balance" : "No debt matches this rung",
        },
      ];
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
    cumulativeRemaining += remainingCents;

    const weeksAway =
      remainingCents <= 0
        ? 0
        : weekly > 0
          ? Math.ceil(cumulativeRemaining / weekly)
          : null;
    const etaIso =
      weeksAway === null ? null : addDaysIso(input.todayIso, weeksAway * 7);

    return {
      ...rung,
      order: index + 1,
      resolvedTargetCents,
      fundedCents,
      remainingCents,
      progress: resolvedTargetCents > 0 ? fundedCents / resolvedTargetCents : 0,
      status: (remainingCents <= 0 ? "complete" : "locked") as GoalStatus,
      components,
      weeksAway,
      etaIso,
      missesDeadline: Boolean(
        etaIso && rung.deadlineOn && etaIso > rung.deadlineOn,
      ),
    };
  });

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
