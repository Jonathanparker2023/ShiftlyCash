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
  /** Rung four: starting capital for the BRRR operation. */
  brrrCapitalCents: number;
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
  brrrCapitalCents: 90_000_00,
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
  /**
   * Capital actually earmarked against the ladder today. Deliberately NOT the
   * year's running balance: that is cumulative cashflow already spent, a
   * historical metric, and treating it as a war chest made rung one read
   * "Cleared" while $13,923 was still owed on the Explorer. The ladder is a
   * forward projection unless real money is assigned to it.
   */
  appliedCapitalCents: number;
  weeklyCashflowCents: number;
  assumptions: HouseHackAssumptions;
  todayIso: string;
};

export function buildLadder(input: LadderInput): GoalStep[] {
  const entry = houseHackEntry(input.assumptions);
  const a = input.assumptions;

  const rungs = [
    {
      id: "explorer-payoff",
      order: 1,
      title: "Clear the Explorer",
      kicker: "Rung one",
      imageSrc: "/goals/explorer-payoff.png",
      description:
        "The Explorer is the most expensive money on the board at 18.8%, so it dies first on pure arithmetic — no other dollar bought back earns that much. It is also the smallest rung, which means the ladder starts with a win rather than a slog. Clearing it does double duty: it ends the interest, and it strips a $455 monthly payment out of the debt-to-income ratio a mortgage underwriter will scrutinise on the very next rung.",
      deadlineIso: EXPLORER_MATURITY,
      deadlineLabel: "Explorer loan matures",
      components: [
        {
          label: "Ford Explorer payoff",
          cents: input.explorerCents,
          note: "Holyoke Credit Union at 18.8% — the costliest money on the board",
        },
      ],
    },
    {
      id: "multifamily-house-hack",
      order: 2,
      title: "Multifamily house hack",
      kicker: "Rung two",
      imageSrc: "/goals/multifamily-house-hack.png",
      description:
        "The cash it takes to actually stand at a closing table on a Hartford-area multifamily. Three separate piles, not one: the FHA down payment, the closing costs, and reserves — and the reserves are the part people miss, because the FHA requires three months of the full payment held AFTER the deposit and closing on a three or four unit purchase. Living in one unit and renting the rest is what turns housing from the largest expense on the board into something that pays. It sits above the Explorer because the underwriter looks at debt-to-income, and a cleared auto loan makes this rung cheaper to qualify for.",
      deadlineIso: null,
      deadlineLabel: null,
      components: [
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
      order: 3,
      title: "Kill the Tesla note",
      kicker: "Rung three",
      imageSrc: "/goals/tesla-payoff.png",
      description:
        "The Onyx loan is the single largest obligation on the board — 72 months at 10.94%, roughly $11,700 of interest if it runs to term. Every dollar thrown at it after the house hack is interest bought back. It sits third deliberately: at 10.94% it is cheaper money than the Explorer was, and a paid-off car with no property is a worse position than a property with the note still running, because the property pays rent and the car does not.",
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
    {
      id: "brrr-capital",
      order: 4,
      title: "BRRR business capital",
      kicker: "Rung four",
      imageSrc: "/goals/brrr-capital.png",
      description:
        "Buy, rehab, rent, refinance, repeat — the first real operating war chest. This is the rung where the ladder stops being about escaping debt and starts being about buying assets on purpose. It comes last not because it matters least, but because it is the only rung that needs everything below it to be true first: no consumer debt draining cashflow, a property already producing rent, and the experience of having run one deal. Capital without that sequence is just risk.",
      deadlineIso: null,
      deadlineLabel: null,
      components: [
        {
          label: "Operating capital",
          cents: a.brrrCapitalCents,
          note: "Acquisition, rehab runway, and holding costs for the first deal",
        },
      ],
    },
  ];

  let pool = Math.max(0, input.appliedCapitalCents);
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
