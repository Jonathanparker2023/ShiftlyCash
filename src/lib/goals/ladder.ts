/**
 * Pure goal-ladder maths.
 *
 * Lives apart from data.ts because the client recomputes the whole ladder
 * whenever an assumption or the weekly cashflow is changed, and data.ts pulls
 * in server-only auth.
 */

export type GoalStatus = "complete" | "active" | "locked";

export type GoalComponent = {
  label: string;
  cents: number;
  note: string;
};

export type GoalStep = {
  id: string;
  /** 1 is the first rung and renders at the BOTTOM of the ladder. */
  order: number;
  title: string;
  kicker: string;
  description: string;
  /** Jon supplies artwork later; a placeholder renders until then. */
  imageSrc: string;
  targetCents: number;
  fundedCents: number;
  remainingCents: number;
  progress: number;
  status: GoalStatus;
  components: GoalComponent[];
  /** Cumulative: reaching rung 2 means clearing rung 1 first. */
  weeksAway: number | null;
  etaIso: string | null;
  deadlineIso: string | null;
  deadlineLabel: string | null;
  /** True when the projected date lands after the deadline. */
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

// Loan maturities: what makes the ladder time-sensitive.
export const EXPLORER_MATURITY = "2029-12-16"; // opened 2024-12-16, 60 months
export const TESLA_MATURITY = "2032-07-01"; // originated July 2026, 72 months

export function houseHackEntry(a: HouseHackAssumptions) {
  const down = Math.round(a.propertyPriceCents * (a.downPaymentPct / 100));
  const closing = Math.round(a.propertyPriceCents * (a.closingCostPct / 100));
  const reserves = Math.round(a.monthlyPitiCents * a.reserveMonths);
  return { down, closing, reserves, total: down + closing + reserves };
}

export type LadderInput = {
  explorerCents: number;
  teslaCents: number;
  bankedCents: number;
  weeklyCashflowCents: number;
  assumptions: HouseHackAssumptions;
  todayIso: string;
};

export function buildLadder(input: LadderInput): GoalStep[] {
  const entry = houseHackEntry(input.assumptions);
  const a = input.assumptions;

  const rungs = [
    {
      id: "explorer-and-keys",
      order: 1,
      title: "Clear the Explorer, buy the keys",
      kicker: "Rung one",
      imageSrc: "/goals/explorer-and-keys.png",
      description:
        "Two things must be true before a multifamily is reachable: the Explorer loan is gone, and there is real cash on the table for an FHA purchase. This rung holds both. The Explorer is the most expensive money on the board at 18.8%, so it dies first — and clearing it also strips a monthly payment out of the debt-to-income ratio the lender will scrutinise. On top of that sits the entry cash: the down payment, closing costs, and the three months of reserves the FHA specifically requires on a three or four unit purchase. Those reserves are held after the deposit, not inside it.",
      deadlineIso: EXPLORER_MATURITY,
      deadlineLabel: "Explorer loan matures",
      components: [
        {
          label: "Ford Explorer payoff",
          cents: input.explorerCents,
          note: "Holyoke Credit Union at 18.8% — the costliest money on the board",
        },
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
      ],
    },
    {
      id: "tesla-payoff",
      order: 2,
      title: "Kill the Tesla note",
      kicker: "Rung two",
      imageSrc: "/goals/tesla-payoff.png",
      description:
        "The Onyx loan is the single largest obligation on the board — 72 months at 10.94%. Run to term it costs roughly $11,700 in interest alone, so every week of cashflow thrown at it after rung one clears is interest bought back. It sits second deliberately: a paid-off Tesla with no property is a worse position than a property with the note still running, because the property pays rent and the car does not.",
      deadlineIso: TESLA_MATURITY,
      deadlineLabel: "Tesla loan matures",
      components: [
        {
          label: "TD Auto Finance balance",
          cents: input.teslaCents,
          note: "10.94% over 72 months — unconfirmed until TD's first statement",
        },
      ],
    },
  ];

  let pool = Math.max(0, input.bankedCents);
  let cumulativeRemaining = 0;
  const weekly = Math.max(0, input.weeklyCashflowCents);

  const goals: GoalStep[] = rungs.map((rung) => {
    const targetCents = rung.components.reduce((sum, c) => sum + c.cents, 0);
    const fundedCents = Math.min(pool, targetCents);
    pool -= fundedCents;
    const remainingCents = Math.max(0, targetCents - fundedCents);
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
      targetCents,
      fundedCents,
      remainingCents,
      progress: targetCents > 0 ? fundedCents / targetCents : 0,
      status: (remainingCents <= 0 ? "complete" : "locked") as GoalStatus,
      weeksAway,
      etaIso,
      deadlineIso: rung.deadlineIso,
      deadlineLabel: rung.deadlineLabel,
      missesDeadline: Boolean(etaIso && rung.deadlineIso && etaIso > rung.deadlineIso),
    };
  });

  // Exactly one rung reads as active: the lowest incomplete one.
  const next = goals.find((goal) => goal.status !== "complete");
  if (next) next.status = "active";

  return goals;
}

function addDaysIso(iso: string, days: number): string {
  const base = Date.parse(`${iso}T00:00:00.000Z`);
  if (Number.isNaN(base)) return iso;
  return new Date(base + days * 86_400_000).toISOString().slice(0, 10);
}
