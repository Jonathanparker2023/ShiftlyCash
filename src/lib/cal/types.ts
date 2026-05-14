export type FoodEntry = {
  id: string;
  date: string;
  mealName: string;
  calories: number;
  proteinG: number | null;
  carbsG: number | null;
  fatG: number | null;
  savedFoodId: string | null;
  createdAt: string;
  updatedAt: string;
};

export type SavedFood = {
  id: string;
  name: string;
  calories: number;
  proteinG: number | null;
  carbsG: number | null;
  fatG: number | null;
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
};

export type ShiftlyCalData = {
  todayIso: string;
  targets: CalTargets;
  todaysEntries: FoodEntry[];
  savedFoods: SavedFood[];
  todaysWeight: WeightLog | null;
};
