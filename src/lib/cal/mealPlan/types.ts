export type ProvenanceTier = "database" | "published" | "inferred";

export type CarbMode = "high" | "low" | "indifferent";

export type ResearcherInput = {
  remainingTargets: {
    calories: number;
    proteinG: number;
    carbsG: number;
    fiberG: number;
    fatG: number;
    sodiumMg: number;
    addedSugarG: number;
    saturatedFatG: number;
  };
  axioms: MealPlanAxioms;
  savedFoods: SavedFoodForResearcher[];
  nowIso: string;
  healthFlags: string[];
};

export type SavedFoodForResearcher = {
  id: string;
  name: string;
  macros: MealPlanMacros;
};

export type RemainingTargets = {
  calories: number;
  proteinG: number;
  carbsG: number;
  fiberG: number;
  fatG: number;
  sodiumMg: number;
  addedSugarG: number;
  saturatedFatG: number;
};

export type AssembleOpts = {
  holdMainId?: string;
  excludeMainIds?: string[];
  excludeFillerIds?: string[];
  maxFillers?: number;
};

export type MealPlanAxioms = {
  eatOut: boolean;
  requireDoorDash: boolean;
  allowNonDoorDashMain: boolean;
  carbMode: CarbMode;
  locationHint: string | null;
};

export type MealPlanMacros = {
  calories: number;
  proteinG: number;
  carbsG: number;
  fiberG: number;
  fatG: number;
  sodiumMg: number | null;
  addedSugarG: number | null;
  saturatedFatG: number | null;
};

export type MealPlanMacroRange = {
  calories: { low: number; high: number };
  proteinG: { low: number; high: number };
  carbsG: { low: number; high: number };
  fiberG: { low: number; high: number };
  fatG: { low: number; high: number };
  sodiumMg: { low: number | null; high: number | null };
  addedSugarG: { low: number | null; high: number | null };
  saturatedFatG: { low: number | null; high: number | null };
};

export type MealPlanCandidate = {
  id: string;
  kind: "main" | "filler";
  name: string;
  sourceUrl: string | null;
  doordashUrl: string | null;
  tier: ProvenanceTier;
  macros: MealPlanMacros;
  macroRange: MealPlanMacroRange | null;
  confidence: "high" | "medium" | "low";
  notes: string | null;
};

export type CandidatePool = {
  fetchedAt: string;
  axioms: MealPlanAxioms;
  unfetchedReason: string | null;
  mains: MealPlanCandidate[];
  fillers: MealPlanCandidate[];
};

export type MealPlan = {
  main: MealPlanCandidate;
  fillers: MealPlanCandidate[];
  totals: {
    calories: number;
    proteinG: number;
    carbsG: number;
    fiberG: number;
    fatG: number;
    sodiumMg: number;
    addedSugarG: number;
    saturatedFatG: number;
  };
};

export type ValidationGap = {
  metric:
    | "calories"
    | "proteinG"
    | "carbsG"
    | "fiberG"
    | "fatG"
    | "sodiumMg"
    | "addedSugarG"
    | "saturatedFatG";
  target: number;
  actual: number;
  deltaPct: number;
  direction: "short" | "over";
  remediation: string;
};

export type ValidationResult =
  | { ok: true; plan: MealPlan }
  | { ok: false; bestAttempt: MealPlan | null; gaps: ValidationGap[] };

export type MealPlanPreset = {
  id: string;
  name: string;
  axioms: MealPlanAxioms;
  pool: CandidatePool;
  plan: MealPlan;
  validation: ValidationResult;
  validationOk: boolean;
  mainName: string;
  totals: MealPlan["totals"];
  useCount: number;
  lastUsedAt: string | null;
  createdAt: string;
};
