export type FoodCategory =
  | "meal"
  | "healthy_snack"
  | "unhealthy_snack"
  | "drink"
  | "other";

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
  savedFoodId: string | null;
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

export type CalTargets = {
  tdeeCalories: number | null;
  proteinTargetG: number | null;
  carbsTargetG: number | null;
  fatTargetG: number | null;
  fiberTargetG: number | null;
};

export type CalTotals = {
  calories: number;
  proteinG: number;
  carbsG: number;
  fatG: number;
  fiberG: number;
};

export type CalDay = {
  date: string;
  dayIndex: number;
  entries: FoodEntry[];
  totals: CalTotals;
  weight: WeightLog | null;
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
  currentWeek: CalWeek;
  projection: CalProjection;
  savedFoods: SavedFood[];
};
