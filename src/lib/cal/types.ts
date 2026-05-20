export type FoodCategory =
  | "meal"
  | "healthy_snack"
  | "unhealthy_snack"
  | "drink"
  | "other";

export type FoodVerdict = "good" | "bad";
export type FoodVerdictSource = "pending" | "ai" | "manual_override" | "unscored";
export type CalPhase = "cut" | "maintain" | "bulk" | "recomp";
export type CalSex = "male" | "female";

export type FoodVerdictContext = {
  estimated_facets?: {
    sodium_mg?: number | null;
    added_sugar_g?: number | null;
    alcohol_servings?: number | null;
    saturated_fat_g?: number | null;
    high_sodium?: boolean;
    high_added_sugar?: boolean;
    source?: "official" | "ai_estimate" | "unknown";
  };
  rules_triggered?: string[];
  week_pattern_summary?: string;
};

export type FoodEntry = {
  id: string;
  date: string;
  loggedTime: string | null;
  mealName: string;
  category: FoodCategory;
  calories: number;
  proteinG: number | null;
  carbsG: number | null;
  fatG: number | null;
  fiberG: number | null;
  sodiumMg: number | null;
  addedSugarG: number | null;
  saturatedFatG: number | null;
  savedFoodId: string | null;
  verdict: FoodVerdict | null;
  verdictReason: string | null;
  verdictSource: FoodVerdictSource;
  verdictError: string | null;
  verdictContext: FoodVerdictContext | null;
  isProjectedPlan: boolean;
  createdAt: string;
  updatedAt: string;
};

export type SavedFood = {
  id: string;
  name: string;
  category: FoodCategory;
  calories: number;
  proteinG: number | null;
  carbsG: number | null;
  fatG: number | null;
  fiberG: number | null;
  sodiumMg: number | null;
  addedSugarG: number | null;
  saturatedFatG: number | null;
  sortOrder: number;
  archivedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type WeightLog = {
  id: string;
  date: string;
  weightLbs: number;
  createdAt: string;
  updatedAt: string;
};

export type WaterLog = {
  id: string;
  date: string;
  amountOz: number;
  createdAt: string;
  updatedAt: string;
};

export type CalTargets = {
  tdeeCalories: number | null;
  proteinTargetG: number | null;
  carbsTargetG: number | null;
  fatTargetG: number | null;
  fiberTargetG: number | null;
  sodiumTargetMg: number | null;
  addedSugarTargetG: number | null;
  saturatedFatTargetG: number | null;
  waterTargetOz: number | null;
  age: number | null;
  sex: CalSex | null;
  heightCm: number | null;
  activityLevel: string | null;
  currentPhase: CalPhase | null;
  goalsText: string | null;
  healthFlags: string[];
};

export type CalTotals = {
  calories: number;
  proteinG: number;
  carbsG: number;
  fatG: number;
  fiberG: number;
  sodiumMg: number;
  addedSugarG: number;
  saturatedFatG: number;
};

export type DayFoodVerdict = {
  id: string;
  date: string;
  verdict: FoodVerdict;
  reason: string;
  calorieTotal: number;
  proteinTotal: number;
  withinCalorieTolerance: boolean;
  withinProteinTarget: boolean;
  generatedAt: string;
};

export type CalDay = {
  date: string;
  dayIndex: number;
  entries: FoodEntry[];
  totals: CalTotals;
  dayVerdict: DayFoodVerdict | null;
  weight: WeightLog | null;
  waterOz: number;
};

export type CalWeek = {
  weekStartIso: string;
  weekEndIso: string;
  days: CalDay[];
  totals: CalTotals;
};

export type CalProjection = {
  weeklyDeficitCalories: number;
  projectedWeightDeltaLbs: number;
};

export type ShiftlyCalData = {
  todayIso: string;
  targets: CalTargets;
  dailyTargetBand: { low: number | null; high: number | null };
  currentWeek: CalWeek;
  projection: CalProjection;
  savedFoods: SavedFood[];
};
