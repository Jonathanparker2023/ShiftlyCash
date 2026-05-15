"use client";

import { useRef, useState, useTransition } from "react";

import { estimateFoodAction } from "@/app/(protected)/cal/actions";
import { categoryLabel } from "@/lib/cal/color";
import type { FoodEstimate } from "@/lib/cal/estimate";
import type { FoodCategory } from "@/lib/cal/types";

type EstimateForm = {
  mealName: string;
  category: FoodCategory;
  calories: string;
  proteinG: string;
  carbsG: string;
  fatG: string;
  fiberG: string;
  sodiumMg: string;
  addedSugarG: string;
  saturatedFatG: string;
  reasoning: string;
  confidence: "high" | "medium" | "low";
};

type Props = {
  buttonLabel?: string;
  confirmLabel?: string;
  disabled: boolean;
  onConfirm: (input: {
    mealName: string;
    category: FoodCategory;
    loggedTime: string;
    calories: string;
    proteinG: string;
    carbsG: string;
    fatG: string;
    fiberG: string;
    sodiumMg: string;
    addedSugarG: string;
    saturatedFatG: string;
  }) => void;
};

type SpeechRecognitionResult = { transcript: string };
type SpeechRecognitionEvent = {
  results: { 0: { 0: SpeechRecognitionResult } } & { length: number };
};
type SpeechRecognitionLike = {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  start: () => void;
  stop: () => void;
  onresult: ((event: SpeechRecognitionEvent) => void) | null;
  onerror: (() => void) | null;
  onend: (() => void) | null;
};
type SpeechRecognitionConstructor = new () => SpeechRecognitionLike;

declare global {
  interface Window {
    SpeechRecognition?: SpeechRecognitionConstructor;
    webkitSpeechRecognition?: SpeechRecognitionConstructor;
  }
}

const FOOD_CATEGORY_OPTIONS: Array<{ value: FoodCategory; label: string }> = [
  { value: "meal", label: "Meal" },
  { value: "healthy_snack", label: "Healthy snack" },
  { value: "unhealthy_snack", label: "Unhealthy snack" },
  { value: "drink", label: "Drink" },
  { value: "other", label: "Other" },
];

export function AiFoodEstimator({
  buttonLabel = "Log food",
  confirmLabel = "Log food",
  disabled,
  onConfirm,
}: Props) {
  const [isOpen, setIsOpen] = useState(false);
  const [description, setDescription] = useState("");
  const [estimate, setEstimate] = useState<EstimateForm | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isListening, setIsListening] = useState(false);
  const [isPending, startTransition] = useTransition();
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const speechSupported =
    typeof window !== "undefined" &&
    Boolean(window.SpeechRecognition ?? window.webkitSpeechRecognition);

  function runEstimate() {
    setError(null);

    startTransition(async () => {
      try {
        const result = await estimateFoodAction({ description });
        setEstimate(toEstimateForm(result));
      } catch (err) {
        setError(err instanceof Error ? err.message : "Unable to estimate food.");
      }
    });
  }

  function toggleListening() {
    setError(null);

    if (isListening) {
      recognitionRef.current?.stop();
      setIsListening(false);
      return;
    }

    const Recognition =
      window.SpeechRecognition ?? window.webkitSpeechRecognition ?? null;
    if (!Recognition) return;

    const recognition = new Recognition();
    recognition.lang = "en-US";
    recognition.continuous = false;
    recognition.interimResults = false;
    recognition.onresult = (event) => {
      const transcript = event.results[0]?.[0]?.transcript ?? "";
      if (transcript) setDescription(transcript);
    };
    recognition.onerror = () => {
      setError("Voice input did not work. Try typing it.");
      setIsListening(false);
    };
    recognition.onend = () => setIsListening(false);
    recognitionRef.current = recognition;
    setIsListening(true);
    recognition.start();
  }

  function reset() {
    setDescription("");
    setEstimate(null);
    setError(null);
  }

  function confirm() {
    if (!estimate) return;
    onConfirm({
      mealName: estimate.mealName,
      category: estimate.category,
      loggedTime: currentTimeInput(),
      calories: estimate.calories,
      proteinG: estimate.proteinG,
      carbsG: estimate.carbsG,
      fatG: estimate.fatG,
      fiberG: estimate.fiberG,
      sodiumMg: estimate.sodiumMg,
      addedSugarG: estimate.addedSugarG,
      saturatedFatG: estimate.saturatedFatG,
    });
    reset();
    setIsOpen(false);
  }

  return (
    <div>
      <button
        className="rounded-md border border-emerald-300/50 bg-emerald-500 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-emerald-400 disabled:cursor-not-allowed disabled:opacity-60"
        disabled={disabled}
        onClick={() => setIsOpen((current) => !current)}
        type="button"
      >
        {buttonLabel}
      </button>

      {isOpen ? (
        <div className="mt-3 rounded-md border border-white/15 bg-black/20 p-3 text-white">
          {estimate ? (
            <EstimateResult
              confirmLabel={confirmLabel}
              disabled={disabled}
              estimate={estimate}
              onChange={setEstimate}
              onConfirm={confirm}
              onDiscard={reset}
            />
          ) : (
            <div className="mt-3 space-y-3">
              <label className="block text-sm font-semibold text-white/80">
                What did you eat?
                <textarea
                  className="mt-1 min-h-24 w-full rounded-md border border-white/20 bg-black/25 px-3 py-2 text-sm text-white outline-none transition placeholder:text-white/50 focus:border-white/60 focus:ring-2 focus:ring-white/40"
                  maxLength={500}
                  onChange={(event) => setDescription(event.target.value)}
                  placeholder="What did you eat? Be as specific or as casual as you want."
                  value={description}
                />
              </label>
              {error ? (
                <p className="rounded-md border border-red-300/60 bg-red-500/15 px-3 py-2 text-sm font-medium text-red-200">
                  {error}
                </p>
              ) : null}
              <div className="flex flex-wrap gap-2">
                {speechSupported ? (
                  <button
                    className="rounded-md border border-white/20 bg-white/10 px-3 py-2 text-sm font-semibold text-white transition hover:bg-white/20 disabled:cursor-not-allowed disabled:opacity-60"
                    disabled={disabled || isPending}
                    onClick={toggleListening}
                    type="button"
                  >
                    {isListening ? (
                      <span className="inline-flex items-center gap-2">
                        <span className="h-2 w-2 animate-pulse rounded-full bg-red-300" />
                        Listening...
                      </span>
                    ) : (
                      "Mic"
                    )}
                  </button>
                ) : null}
                <button
                  className="rounded-md border border-emerald-300/50 bg-emerald-500 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-emerald-400 disabled:cursor-not-allowed disabled:opacity-60"
                  disabled={disabled || isPending || !description.trim()}
                  onClick={runEstimate}
                  type="button"
                >
                  {isPending ? "Looking up nutrition data..." : "Estimate"}
                </button>
                <button
                  className="rounded-md border border-white/20 bg-white/10 px-4 py-2 text-sm font-semibold text-white transition hover:bg-white/20"
                  onClick={() => {
                    reset();
                    setIsOpen(false);
                  }}
                  type="button"
                >
                  Cancel
                </button>
              </div>
            </div>
          )}
        </div>
      ) : null}
    </div>
  );
}

function currentTimeInput(): string {
  const now = new Date();
  return `${String(now.getHours()).padStart(2, "0")}:${String(
    now.getMinutes(),
  ).padStart(2, "0")}`;
}

function EstimateResult({
  confirmLabel,
  disabled,
  estimate,
  onChange,
  onConfirm,
  onDiscard,
}: {
  confirmLabel: string;
  disabled: boolean;
  estimate: EstimateForm;
  onChange: (estimate: EstimateForm) => void;
  onConfirm: () => void;
  onDiscard: () => void;
}) {
  return (
    <div className="mt-3 rounded-md border border-white/15 bg-black/25 p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span
          className={`rounded-full border px-3 py-1 text-xs font-semibold ${confidenceClass(estimate.confidence)}`}
        >
          {estimate.confidence} confidence
        </span>
        <span className="text-xs font-semibold text-white/60">
          {categoryLabel(estimate.category)}
        </span>
      </div>
      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <TextInput
          className="sm:col-span-2"
          label="Name"
          onChange={(value) => onChange({ ...estimate, mealName: value })}
          value={estimate.mealName}
        />
        <CategorySelect
          label="Category"
          onChange={(category) => onChange({ ...estimate, category })}
          value={estimate.category}
        />
        <NumberInput
          label="Calories"
          onChange={(value) => onChange({ ...estimate, calories: value })}
          required
          value={estimate.calories}
        />
        <NumberInput
          label="Protein"
          onChange={(value) => onChange({ ...estimate, proteinG: value })}
          suffix="g"
          value={estimate.proteinG}
        />
        <NumberInput
          label="Carbs"
          onChange={(value) => onChange({ ...estimate, carbsG: value })}
          suffix="g"
          value={estimate.carbsG}
        />
        <NumberInput
          label="Fat"
          onChange={(value) => onChange({ ...estimate, fatG: value })}
          suffix="g"
          value={estimate.fatG}
        />
        <NumberInput
          label="Fiber"
          onChange={(value) => onChange({ ...estimate, fiberG: value })}
          suffix="g"
          value={estimate.fiberG}
        />
        <NumberInput
          label="Sodium"
          onChange={(value) => onChange({ ...estimate, sodiumMg: value })}
          suffix="mg"
          value={estimate.sodiumMg}
        />
        <NumberInput
          label="Added sugar"
          onChange={(value) => onChange({ ...estimate, addedSugarG: value })}
          suffix="g"
          value={estimate.addedSugarG}
        />
        <NumberInput
          label="Sat fat"
          onChange={(value) => onChange({ ...estimate, saturatedFatG: value })}
          suffix="g"
          value={estimate.saturatedFatG}
        />
      </div>
      <div className="mt-4 flex flex-wrap gap-2">
        <button
          className="rounded-md border border-emerald-300/50 bg-emerald-500 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-emerald-400 disabled:cursor-not-allowed disabled:bg-white/20"
          disabled={disabled || !estimate.calories.trim()}
          onClick={onConfirm}
          type="button"
        >
          {confirmLabel}
        </button>
        <button
          className="rounded-md border border-white/20 bg-white/10 px-4 py-2 text-sm font-semibold text-white transition hover:bg-white/20"
          onClick={onDiscard}
          type="button"
        >
          Discard
        </button>
      </div>
    </div>
  );
}

function CategorySelect({
  label,
  onChange,
  value,
}: {
  label: string;
  onChange: (value: FoodCategory) => void;
  value: FoodCategory;
}) {
  return (
    <label className="block text-sm font-semibold text-white/80">
      {label}
      <select
        className="mt-1 h-10 w-full rounded-md border border-white/20 bg-[#111827] px-3 text-sm text-white outline-none transition focus:border-white/60 focus:ring-2 focus:ring-white/40"
        onChange={(event) => onChange(event.target.value as FoodCategory)}
        value={value}
      >
        {FOOD_CATEGORY_OPTIONS.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  );
}

function TextInput({
  className = "",
  label,
  onChange,
  value,
}: {
  className?: string;
  label: string;
  onChange: (value: string) => void;
  value: string;
}) {
  return (
    <label className={`block text-sm font-semibold text-white/80 ${className}`}>
      {label}
      <input
        className="mt-1 h-10 w-full rounded-md border border-white/20 bg-black/25 px-3 text-sm text-white outline-none transition placeholder:text-white/50 focus:border-white/60 focus:ring-2 focus:ring-white/40"
        onChange={(event) => onChange(event.target.value)}
        type="text"
        value={value}
      />
    </label>
  );
}

function NumberInput({
  label,
  onChange,
  required = false,
  suffix,
  value,
}: {
  label: string;
  onChange: (value: string) => void;
  required?: boolean;
  suffix?: string;
  value: string;
}) {
  return (
    <label className="block text-sm font-semibold text-white/80">
      {label}
      <span className="relative mt-1 block">
        <input
          className="h-10 w-full rounded-md border border-white/20 bg-black/25 px-3 text-sm text-white outline-none transition placeholder:text-white/50 focus:border-white/60 focus:ring-2 focus:ring-white/40"
          min={0}
          onChange={(event) => onChange(event.target.value)}
          required={required}
          step={1}
          type="number"
          value={value}
        />
        {suffix ? (
          <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-sm font-semibold text-white/50">
            {suffix}
          </span>
        ) : null}
      </span>
    </label>
  );
}

function confidenceClass(confidence: EstimateForm["confidence"]): string {
  switch (confidence) {
    case "high":
      return "border-emerald-300/50 bg-emerald-500/15 text-emerald-300";
    case "medium":
      return "border-amber-300/50 bg-amber-500/15 text-amber-300";
    case "low":
      return "border-red-300/50 bg-red-500/15 text-red-300";
  }
}

function toEstimateForm(estimate: FoodEstimate): EstimateForm {
  return {
    mealName: estimate.mealName,
    category: estimate.category,
    calories: estimate.calories.toString(),
    proteinG: estimate.proteinG?.toString() ?? "",
    carbsG: estimate.carbsG?.toString() ?? "",
    fatG: estimate.fatG?.toString() ?? "",
    fiberG: estimate.fiberG?.toString() ?? "",
    sodiumMg: estimate.sodiumMg?.toString() ?? "",
    addedSugarG: estimate.addedSugarG?.toString() ?? "",
    saturatedFatG: estimate.saturatedFatG?.toString() ?? "",
    reasoning: estimate.reasoning,
    confidence: estimate.confidence,
  };
}
