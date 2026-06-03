"use client";

import { useMemo, useRef, useState, useTransition } from "react";

import {
  createSavedFoodAction,
  estimateFoodAction,
  estimateFoodLabelPhotoAction,
} from "@/app/(protected)/cal/actions";
import { categoryLabel } from "@/lib/cal/color";
import type { FoodEstimate } from "@/lib/cal/estimate";
import { parsePastedLog } from "@/lib/cal/parsePastedLog";
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
  // When true, log AND save this food to saved_foods so it appears as a
  // quick-tap chip next time. Only surfaced for the primary "Log food"
  // entry point; embedded "AI add food" inside the entry editor doesn't
  // create presets.
  saveForNextTime: boolean;
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
  const [estimate, setEstimate] = useState<EstimateForm[] | null>(null);
  const [estimateStatus, setEstimateStatus] = useState<
    "idle" | "loading" | "error" | "ready"
  >("idle");
  const [error, setError] = useState<string | null>(null);
  const [isListening, setIsListening] = useState(false);
  const [labelPhotoName, setLabelPhotoName] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const labelPhotoInputRef = useRef<HTMLInputElement | null>(null);
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const requestSeqRef = useRef(0);
  const speechSupported =
    typeof window !== "undefined" &&
    Boolean(window.SpeechRecognition ?? window.webkitSpeechRecognition);

  // Live preview: how many lines would the paste-bypass parser pick
  // up if the user hit the action button right now? When > 0, the
  // primary button switches to "Run" (no AI call); when 0, it stays
  // "Estimate" (AI).
  const parsedLineCount = useMemo(
    () => (description.trim() ? parsePastedLog(description).length : 0),
    [description],
  );
  const willBypassAi = parsedLineCount > 0;

  function runEstimate() {
    const trimmed = description.trim();
    if (!trimmed) return;

    // Paste bypass: if the user already typed/pasted explicit macros,
    // log them verbatim. No AI estimator call, no AI reinterpretation,
    // no risk of the model "normalizing" the user's numbers into
    // different numbers. Falls through to AI only when no explicit
    // calories were found on any line.
    const parsedFromPaste = parsePastedLog(trimmed);
    if (parsedFromPaste.length > 0) {
      parsedFromPaste.forEach((item) => {
        const form: EstimateForm = {
          mealName: item.mealName,
          category: item.category,
          calories: String(item.calories),
          proteinG: item.proteinG?.toString() ?? "",
          carbsG: item.carbsG?.toString() ?? "",
          fatG: item.fatG?.toString() ?? "",
          fiberG: item.fiberG?.toString() ?? "",
          sodiumMg: item.sodiumMg?.toString() ?? "",
          addedSugarG: item.addedSugarG?.toString() ?? "",
          saturatedFatG: item.saturatedFatG?.toString() ?? "",
          reasoning: "",
          confidence: "high",
          saveForNextTime: false,
        };
        void confirmEstimate(form);
      });
      reset();
      setIsOpen(false);
      return;
    }

    const requestSeq = requestSeqRef.current + 1;
    requestSeqRef.current = requestSeq;
    setError(null);
    setEstimate(null);
    setEstimateStatus("loading");

    startTransition(async () => {
      try {
        const result = await estimateFoodAction({ description: trimmed });
        if (requestSeqRef.current !== requestSeq) return;
        // Auto-log every returned estimate without a second confirm
        // tap. User explicitly didn't want the preview-then-Log
        // two-step. If a macro looks off they can edit the entry
        // row afterward.
        const forms = result.map(toEstimateForm);
        forms.forEach((item) => void confirmEstimate(item));
        reset();
        setIsOpen(false);
      } catch (err) {
        if (requestSeqRef.current !== requestSeq) return;
        setError(err instanceof Error ? err.message : "Unable to estimate food.");
        setEstimateStatus("error");
      }
    });
  }

  function estimateLabelPhoto(file: File | null) {
    if (!file) return;

    if (!["image/jpeg", "image/png", "image/webp"].includes(file.type)) {
      setError("Use a JPEG, PNG, or WebP label photo.");
      if (labelPhotoInputRef.current) labelPhotoInputRef.current.value = "";
      return;
    }

    setLabelPhotoName(file.name || "Label photo");
    setError(null);
    setEstimate(null);
    setEstimateStatus("loading");

    const requestSeq = requestSeqRef.current + 1;
    requestSeqRef.current = requestSeq;

    startTransition(async () => {
      try {
        const imageBase64 = await readFileAsBase64(file);
        const result = await estimateFoodLabelPhotoAction({
          imageBase64,
          mediaType: file.type as "image/jpeg" | "image/png" | "image/webp",
          note: description.trim() || undefined,
        });
        if (requestSeqRef.current !== requestSeq) return;
        const forms = result.map(toEstimateForm);
        forms.forEach((item) => void confirmEstimate(item));
        reset();
        setIsOpen(false);
      } catch (err) {
        if (requestSeqRef.current !== requestSeq) return;
        setError(
          err instanceof Error ? err.message : "Unable to read the label photo.",
        );
        setEstimateStatus("error");
      } finally {
        if (labelPhotoInputRef.current) labelPhotoInputRef.current.value = "";
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
    requestSeqRef.current += 1;
    setDescription("");
    setEstimate(null);
    setEstimateStatus("idle");
    setError(null);
    setLabelPhotoName(null);
    if (labelPhotoInputRef.current) labelPhotoInputRef.current.value = "";
  }

  async function confirmEstimate(item: EstimateForm) {
    if (item.saveForNextTime) {
      // Fire-and-forget — if it fails, the food still gets logged. We only
      // surface the error if BOTH the log and the save fail; not blocking
      // here keeps the log path snappy.
      try {
        await createSavedFoodAction({
          name: item.mealName,
          category: item.category,
          calories: item.calories,
          proteinG: item.proteinG || null,
          carbsG: item.carbsG || null,
          fatG: item.fatG || null,
          fiberG: item.fiberG || null,
          sodiumMg: item.sodiumMg || null,
          addedSugarG: item.addedSugarG || null,
          saturatedFatG: item.saturatedFatG || null,
        });
      } catch (err) {
        // Non-fatal; log proceeds.
        console.warn(
          "[AiFoodEstimator] Save-as-preset failed:",
          err instanceof Error ? err.message : err,
        );
      }
    }
    onConfirm({
      mealName: item.mealName,
      category: item.category,
      loggedTime: currentTimeInput(),
      calories: item.calories,
      proteinG: item.proteinG,
      carbsG: item.carbsG,
      fatG: item.fatG,
      fiberG: item.fiberG,
      sodiumMg: item.sodiumMg,
      addedSugarG: item.addedSugarG,
      saturatedFatG: item.saturatedFatG,
    });
  }

  function confirmSingle() {
    if (!estimate?.[0]) return;
    void confirmEstimate(estimate[0]);
    reset();
    setIsOpen(false);
  }

  function confirmBatchItem(index: number) {
    const item = estimate?.[index];
    if (!item) return;
    void confirmEstimate(item);
    removeEstimateItem(index, { closeWhenEmpty: true });
  }

  function confirmBatchAll() {
    if (!estimate) return;
    estimate.forEach((item) => void confirmEstimate(item));
    reset();
    setIsOpen(false);
  }

  function discardBatchItem(index: number) {
    removeEstimateItem(index, { closeWhenEmpty: true });
  }

  function discardAll() {
    reset();
    setIsOpen(false);
  }

  function updateEstimate(index: number, nextEstimate: EstimateForm) {
    setEstimate((current) =>
      current?.map((item, itemIndex) =>
        itemIndex === index ? nextEstimate : item,
      ) ?? null,
    );
  }

  function removeEstimateItem(
    index: number,
    { closeWhenEmpty }: { closeWhenEmpty: boolean },
  ) {
    const nextEstimate =
      estimate?.filter((_, itemIndex) => itemIndex !== index) ?? null;

    if (nextEstimate && nextEstimate.length > 0) {
      setEstimate(nextEstimate);
      return;
    }

    setEstimate(null);
    if (closeWhenEmpty) {
      reset();
      setIsOpen(false);
    }
  }

  // The default "Log food" button is the primary mobile entry point — make
  // it large, full-width, and high-contrast so it's the obvious next tap
  // when the user lands on the day view. Embedded usages (e.g. "AI add
  // food" inside the entry editor) keep the compact style via a smaller
  // visual variant.
  const isPrimary = buttonLabel === "Log food";
  const buttonClass = isPrimary
    ? "flex w-full items-center justify-center gap-2 rounded-lg border border-[var(--accent-primary-border)] bg-[var(--accent-primary)] px-5 py-4 text-base font-bold text-[var(--text-primary)] shadow-md transition hover:bg-[var(--accent-primary)] disabled:cursor-not-allowed disabled:opacity-60 sm:w-auto sm:px-6 sm:py-3"
    : "rounded-md border border-[var(--accent-primary-border)] bg-[var(--accent-primary)] px-4 py-2 text-sm font-semibold text-[var(--text-primary)] shadow-sm transition hover:bg-[var(--accent-primary)] disabled:cursor-not-allowed disabled:opacity-60";

  return (
    <div>
      <button
        className={buttonClass}
        disabled={disabled}
        onClick={() => setIsOpen((current) => !current)}
        type="button"
      >
        {isPrimary ? (
          <>
            <span aria-hidden="true" className="text-lg leading-none">+</span>
            {buttonLabel}
          </>
        ) : (
          buttonLabel
        )}
      </button>

      {isOpen ? (
        <div className="mt-3 rounded-md border border-[var(--border-subtle)] bg-[var(--surface-elevated)] p-3 text-[var(--text-primary)]">
          {estimateStatus === "loading" ? (
            <EstimateLoadingPanel
              onCancel={() => {
                reset();
                setIsOpen(false);
              }}
            />
          ) : estimateStatus === "error" ? (
            <EstimateErrorPanel
              error={error ?? "Unable to estimate food."}
              onCancel={() => {
                reset();
                setIsOpen(false);
              }}
              onRetry={runEstimate}
            />
          ) : estimate ? (
            estimate.length === 1 ? (
              <EstimateResult
                allowSavePreset={isPrimary}
                confirmLabel={confirmLabel}
                disabled={disabled}
                estimate={estimate[0]}
                onChange={(nextEstimate) => updateEstimate(0, nextEstimate)}
                onConfirm={confirmSingle}
                onDiscard={reset}
              />
            ) : (
              <BatchEstimateResult
                allowSavePreset={isPrimary}
                confirmLabel={confirmLabel}
                disabled={disabled}
                estimates={estimate}
                onChange={updateEstimate}
                onConfirmAll={confirmBatchAll}
                onConfirmItem={confirmBatchItem}
                onDiscardAll={discardAll}
                onDiscardItem={discardBatchItem}
              />
            )
          ) : (
            <div className="mt-3 space-y-3">
              <label className="block text-sm font-semibold text-[var(--text-secondary)]">
                What did you eat?
                <textarea
                  className="mt-1 min-h-32 w-full rounded-md border border-[var(--border-default)] bg-[var(--surface-elevated)] px-3 py-3 text-base text-[var(--text-primary)] outline-none transition placeholder:text-[var(--text-tertiary)] focus:border-[var(--border-strong)] focus:ring-2 focus:ring-white/40 sm:min-h-24 sm:text-sm"
                  maxLength={4000}
                  onChange={(event) => setDescription(event.target.value)}
                  placeholder="What did you eat? For labels, add serving count if needed."
                  value={description}
                />
              </label>
              <input
                ref={labelPhotoInputRef}
                accept="image/jpeg,image/png,image/webp"
                capture="environment"
                className="sr-only"
                onChange={(event) =>
                  estimateLabelPhoto(event.currentTarget.files?.[0] ?? null)
                }
                type="file"
              />
              {description.trim() ? (
                <p
                  className={
                    willBypassAi
                      ? "rounded-md border border-[var(--accent-primary-border)] bg-[var(--accent-primary-fill)] px-3 py-2 text-xs font-semibold text-[var(--accent-primary-text)]"
                      : "rounded-md border border-[var(--border-default)] bg-[var(--surface-elevated)] px-3 py-2 text-xs font-medium text-[var(--text-secondary)]"
                  }
                >
                  {willBypassAi
                    ? `Your numbers detected · ${parsedLineCount} ${
                        parsedLineCount === 1 ? "entry" : "entries"
                      } · will log exactly as typed, no AI call`
                    : "No explicit macros detected · AI will estimate"}
                </p>
              ) : null}
              {labelPhotoName ? (
                <p className="rounded-md border border-[var(--border-default)] bg-[var(--surface-elevated)] px-3 py-2 text-xs font-medium text-[var(--text-secondary)]">
                  Reading label - {labelPhotoName}
                </p>
              ) : null}
              {error ? (
                <p className="rounded-md border border-red-300/60 bg-red-500/15 px-3 py-2 text-sm font-medium text-red-200">
                  {error}
                </p>
              ) : null}
              <div className="flex flex-wrap gap-2">
                {speechSupported ? (
                  <button
                    className="rounded-md border border-[var(--border-default)] bg-[var(--surface-elevated)] px-3 py-2 text-sm font-semibold text-[var(--text-primary)] transition hover:bg-[var(--surface-hover)] disabled:cursor-not-allowed disabled:opacity-60"
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
                  className="rounded-md border border-[var(--border-default)] bg-[var(--surface-elevated)] px-3 py-2 text-sm font-semibold text-[var(--text-primary)] transition hover:bg-[var(--surface-hover)] disabled:cursor-not-allowed disabled:opacity-60"
                  disabled={disabled || isPending}
                  onClick={() => labelPhotoInputRef.current?.click()}
                  type="button"
                >
                  Label photo
                </button>
                <button
                  className="flex-1 rounded-md border border-[var(--accent-primary-border)] bg-[var(--accent-primary)] px-4 py-3 text-base font-bold text-[var(--text-primary)] shadow-sm transition hover:bg-[var(--accent-primary)] disabled:cursor-not-allowed disabled:opacity-60 sm:flex-none sm:py-2 sm:text-sm sm:font-semibold"
                  disabled={disabled || isPending || !description.trim()}
                  onClick={runEstimate}
                  type="button"
                >
                  {isPending
                    ? "Estimating..."
                    : willBypassAi
                      ? `Run ${parsedLineCount} ${
                          parsedLineCount === 1 ? "entry" : "entries"
                        }`
                      : "Estimate"}
                </button>
                <button
                  className="rounded-md border border-[var(--border-default)] bg-[var(--surface-elevated)] px-4 py-3 text-sm font-semibold text-[var(--text-primary)] transition hover:bg-[var(--surface-hover)] sm:py-2"
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

function readFileAsBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("Unable to read the label photo."));
    reader.onload = () => {
      const result = reader.result;
      if (typeof result !== "string") {
        reject(new Error("Unable to read the label photo."));
        return;
      }
      const commaIndex = result.indexOf(",");
      resolve(commaIndex >= 0 ? result.slice(commaIndex + 1) : result);
    };
    reader.readAsDataURL(file);
  });
}

function EstimateLoadingPanel({ onCancel }: { onCancel: () => void }) {
  return (
    <div className="mt-3 rounded-md border border-[var(--border-subtle)] bg-[var(--surface-elevated)] p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="rounded-full border border-[var(--accent-primary-border)] bg-[var(--accent-primary-fill)] px-3 py-1 text-xs font-semibold text-[var(--accent-primary-text)]">
          Working...
        </span>
        <span className="text-xs font-semibold text-[var(--text-tertiary)]">
          Looking up nutrition data
        </span>
      </div>
      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <SkeletonField className="sm:col-span-2" label="Name" />
        <SkeletonField label="Category" />
        <SkeletonField label="Calories" badge="Working..." />
        <SkeletonField label="Protein" suffix="g" />
        <SkeletonField label="Carbs" suffix="g" />
        <SkeletonField label="Fat" suffix="g" />
        <SkeletonField label="Fiber" suffix="g" />
        <SkeletonField label="Sodium" suffix="mg" />
        <SkeletonField label="Added sugar" suffix="g" />
        <SkeletonField label="Sat fat" suffix="g" />
      </div>
      <EstimateProgressBar />
      <div className="mt-4 flex flex-wrap gap-2">
        <button
          className="rounded-md border border-[var(--border-default)] bg-[var(--surface-elevated)] px-4 py-2 text-sm font-semibold text-[var(--text-primary)] transition hover:bg-[var(--surface-hover)]"
          onClick={onCancel}
          type="button"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}

function EstimateErrorPanel({
  error,
  onCancel,
  onRetry,
}: {
  error: string;
  onCancel: () => void;
  onRetry: () => void;
}) {
  return (
    <div className="mt-3 rounded-md border border-red-300/50 bg-red-500/10 p-3">
      <span className="rounded-full border border-red-300/50 bg-red-500/15 px-3 py-1 text-xs font-semibold text-red-100">
        Estimate failed
      </span>
      <p className="mt-3 text-sm font-medium text-red-100">{error}</p>
      <div className="mt-4 flex flex-wrap gap-2">
        <button
          className="rounded-md border border-[var(--accent-primary-border)] bg-[var(--accent-primary)] px-4 py-2 text-sm font-semibold text-[var(--text-primary)] shadow-sm transition hover:bg-[var(--accent-primary)]"
          onClick={onRetry}
          type="button"
        >
          Retry
        </button>
        <button
          className="rounded-md border border-[var(--border-default)] bg-[var(--surface-elevated)] px-4 py-2 text-sm font-semibold text-[var(--text-primary)] transition hover:bg-[var(--surface-hover)]"
          onClick={onCancel}
          type="button"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}

function EstimateProgressBar() {
  return (
    <div className="mt-4 space-y-2">
      <div className="flex items-center justify-between gap-2 text-xs font-semibold text-[var(--text-secondary)]">
        <span>Estimating nutrition...</span>
        <span className="text-[var(--text-tertiary)]">A few seconds</span>
      </div>
      <div className="relative h-2 w-full overflow-hidden rounded-full bg-[var(--surface-elevated)]">
        <div className="estimate-progress-stripe absolute inset-y-0 left-0 w-1/3 rounded-full bg-gradient-to-r from-transparent via-[var(--accent-primary-text)] to-transparent" />
      </div>
      <style>{`
        @keyframes estimate-progress-slide {
          0% { transform: translateX(-100%); }
          100% { transform: translateX(400%); }
        }
        .estimate-progress-stripe {
          animation: estimate-progress-slide 1.4s ease-in-out infinite;
        }
      `}</style>
    </div>
  );
}

function SkeletonField({
  badge,
  className = "",
  label,
  suffix,
}: {
  badge?: string;
  className?: string;
  label: string;
  suffix?: string;
}) {
  return (
    <div className={`block text-sm font-semibold text-[var(--text-secondary)] ${className}`}>
      {label}
      <div className="relative mt-1 h-10 w-full overflow-hidden rounded-md border border-[var(--border-subtle)] bg-[var(--surface-elevated)]">
        <div className="absolute inset-y-0 left-0 w-1/2 animate-pulse bg-[var(--surface-elevated)]" />
        {badge ? (
          <span className="absolute left-3 top-1/2 -translate-y-1/2 rounded-full border border-[var(--border-default)] bg-[var(--surface-elevated)] px-2 py-0.5 text-xs text-[var(--text-secondary)]">
            {badge}
          </span>
        ) : null}
        {suffix ? (
          <span className="absolute right-3 top-1/2 -translate-y-1/2 text-sm font-semibold text-[var(--text-muted)]">
            {suffix}
          </span>
        ) : null}
      </div>
    </div>
  );
}

function EstimateResult({
  allowSavePreset,
  confirmLabel,
  disabled,
  estimate,
  onChange,
  onConfirm,
  onDiscard,
}: {
  allowSavePreset: boolean;
  confirmLabel: string;
  disabled: boolean;
  estimate: EstimateForm;
  onChange: (estimate: EstimateForm) => void;
  onConfirm: () => void;
  onDiscard: () => void;
}) {
  return (
    <div className="mt-3 rounded-md border border-[var(--border-subtle)] bg-[var(--surface-elevated)] p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span
          className={`rounded-full border px-3 py-1 text-xs font-semibold ${confidenceClass(estimate.confidence)}`}
        >
          {estimate.confidence} confidence
        </span>
        <span className="text-xs font-semibold text-[var(--text-tertiary)]">
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
      {allowSavePreset ? (
        <SavePresetCheckbox
          checked={estimate.saveForNextTime}
          onChange={(next) => onChange({ ...estimate, saveForNextTime: next })}
        />
      ) : null}
      <div className="mt-4 flex flex-wrap gap-2">
        <button
          className="rounded-md border border-[var(--accent-primary-border)] bg-[var(--accent-primary)] px-4 py-2 text-sm font-semibold text-[var(--text-primary)] shadow-sm transition hover:bg-[var(--accent-primary)] disabled:cursor-not-allowed disabled:bg-[var(--surface-hover)]"
          disabled={disabled || !estimate.calories.trim()}
          onClick={onConfirm}
          type="button"
        >
          {confirmLabel}
        </button>
        <button
          className="rounded-md border border-[var(--border-default)] bg-[var(--surface-elevated)] px-4 py-2 text-sm font-semibold text-[var(--text-primary)] transition hover:bg-[var(--surface-hover)]"
          onClick={onDiscard}
          type="button"
        >
          Discard
        </button>
      </div>
    </div>
  );
}

function SavePresetCheckbox({
  checked,
  onChange,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
}) {
  return (
    <label className="mt-3 flex cursor-pointer items-center gap-2 rounded-md border border-[var(--border-subtle)] bg-[var(--surface-elevated)] px-3 py-2 text-sm font-semibold text-[var(--text-secondary)] transition hover:bg-[var(--surface-elevated)]">
      <input
        checked={checked}
        className="h-4 w-4 cursor-pointer accent-[var(--accent-primary)]"
        onChange={(event) => onChange(event.target.checked)}
        type="checkbox"
      />
      <span>Save for next time</span>
      <span className="ml-auto text-[10px] font-semibold uppercase tracking-wide text-[var(--text-tertiary)]">
        Quick log chip
      </span>
    </label>
  );
}

function BatchEstimateResult({
  allowSavePreset,
  confirmLabel,
  disabled,
  estimates,
  onChange,
  onConfirmAll,
  onConfirmItem,
  onDiscardAll,
  onDiscardItem,
}: {
  allowSavePreset: boolean;
  confirmLabel: string;
  disabled: boolean;
  estimates: EstimateForm[];
  onChange: (index: number, estimate: EstimateForm) => void;
  onConfirmAll: () => void;
  onConfirmItem: (index: number) => void;
  onDiscardAll: () => void;
  onDiscardItem: (index: number) => void;
}) {
  const canConfirmAll = estimates.every((estimate) => estimate.calories.trim());
  const allLabel = confirmLabel === "Log food" ? "Log all" : "Add all";
  const itemLabel = confirmLabel === "Log food" ? "Log this" : confirmLabel;

  return (
    <div className="mt-3 space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="text-sm font-semibold text-[var(--text-primary)]">
            {estimates.length} foods detected
          </p>
          <p className="text-xs text-[var(--text-tertiary)]">
            Review each item, then log them together or one at a time.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            className="rounded-md border border-[var(--accent-primary-border)] bg-[var(--accent-primary)] px-4 py-2 text-sm font-semibold text-[var(--text-primary)] shadow-sm transition hover:bg-[var(--accent-primary)] disabled:cursor-not-allowed disabled:bg-[var(--surface-hover)]"
            disabled={disabled || !canConfirmAll}
            onClick={onConfirmAll}
            type="button"
          >
            {allLabel}
          </button>
          <button
            className="rounded-md border border-[var(--border-default)] bg-[var(--surface-elevated)] px-4 py-2 text-sm font-semibold text-[var(--text-primary)] transition hover:bg-[var(--surface-hover)]"
            onClick={onDiscardAll}
            type="button"
          >
            Discard all
          </button>
        </div>
      </div>

      <div className="space-y-2">
        {estimates.map((estimate, index) => (
          <MiniEstimateCard
            allowSavePreset={allowSavePreset}
            disabled={disabled}
            estimate={estimate}
            itemLabel={itemLabel}
            key={index}
            onChange={(nextEstimate) => onChange(index, nextEstimate)}
            onConfirm={() => onConfirmItem(index)}
            onDiscard={() => onDiscardItem(index)}
          />
        ))}
      </div>
    </div>
  );
}

function MiniEstimateCard({
  allowSavePreset,
  disabled,
  estimate,
  itemLabel,
  onChange,
  onConfirm,
  onDiscard,
}: {
  allowSavePreset: boolean;
  disabled: boolean;
  estimate: EstimateForm;
  itemLabel: string;
  onChange: (estimate: EstimateForm) => void;
  onConfirm: () => void;
  onDiscard: () => void;
}) {
  return (
    <div className="rounded-md border border-[var(--border-subtle)] bg-[var(--surface-elevated)] p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span
          className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold ${confidenceClass(estimate.confidence)}`}
        >
          {estimate.confidence} confidence
        </span>
        <span className="text-xs font-semibold text-[var(--text-tertiary)]">
          {categoryLabel(estimate.category)}
        </span>
      </div>

      <div className="mt-3 grid gap-2 sm:grid-cols-2">
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
          onChange={(value) =>
            onChange({ ...estimate, saturatedFatG: value })
          }
          suffix="g"
          value={estimate.saturatedFatG}
        />
      </div>

      {estimate.reasoning ? (
        <details className="mt-3 rounded-md border border-[var(--border-subtle)] bg-[var(--surface-elevated)] px-3 py-2 text-xs text-[var(--text-secondary)]">
          <summary className="cursor-pointer font-semibold text-[var(--text-secondary)]">
            Reasoning
          </summary>
          <p className="mt-2 whitespace-pre-line">{estimate.reasoning}</p>
        </details>
      ) : null}

      {allowSavePreset ? (
        <SavePresetCheckbox
          checked={estimate.saveForNextTime}
          onChange={(next) => onChange({ ...estimate, saveForNextTime: next })}
        />
      ) : null}

      <div className="mt-3 flex flex-wrap gap-2">
        <button
          className="rounded-md border border-[var(--accent-primary-border)] bg-[var(--accent-primary)] px-3 py-2 text-sm font-semibold text-[var(--text-primary)] shadow-sm transition hover:bg-[var(--accent-primary)] disabled:cursor-not-allowed disabled:bg-[var(--surface-hover)]"
          disabled={disabled || !estimate.calories.trim()}
          onClick={onConfirm}
          type="button"
        >
          {itemLabel}
        </button>
        <button
          className="rounded-md border border-[var(--border-default)] bg-[var(--surface-elevated)] px-3 py-2 text-sm font-semibold text-[var(--text-primary)] transition hover:bg-[var(--surface-hover)]"
          onClick={onDiscard}
          type="button"
        >
          Discard this
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
    <label className="block text-sm font-semibold text-[var(--text-secondary)]">
      {label}
      <select
        className="mt-1 h-10 w-full rounded-md border border-[var(--border-default)] bg-[var(--surface-elevated)] px-3 text-sm text-[var(--text-primary)] outline-none transition focus:border-[var(--border-strong)] focus:ring-2 focus:ring-white/40"
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
    <label className={`block text-sm font-semibold text-[var(--text-secondary)] ${className}`}>
      {label}
      <input
        className="mt-1 h-10 w-full rounded-md border border-[var(--border-default)] bg-[var(--surface-elevated)] px-3 text-sm text-[var(--text-primary)] outline-none transition placeholder:text-[var(--text-tertiary)] focus:border-[var(--border-strong)] focus:ring-2 focus:ring-white/40"
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
    <label className="block text-sm font-semibold text-[var(--text-secondary)]">
      {label}
      <span className="relative mt-1 block">
        <input
          className="h-10 w-full rounded-md border border-[var(--border-default)] bg-[var(--surface-elevated)] px-3 text-sm text-[var(--text-primary)] outline-none transition placeholder:text-[var(--text-tertiary)] focus:border-[var(--border-strong)] focus:ring-2 focus:ring-white/40"
          min={0}
          onChange={(event) => onChange(event.target.value)}
          required={required}
          step={1}
          type="number"
          value={value}
        />
        {suffix ? (
          <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-sm font-semibold text-[var(--text-tertiary)]">
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
      return "border-[var(--accent-primary-border)] bg-[var(--accent-primary-fill)] text-[var(--accent-primary-text)]";
    case "medium":
      return "border-[var(--accent-warning-border)] bg-[var(--accent-warning-fill)] text-[var(--accent-warning-text)]";
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
    saveForNextTime: false,
  };
}
