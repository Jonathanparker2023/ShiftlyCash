"use client";

type DailyBriefButtonProps = {
  disabled?: boolean;
  onBrief: (reply: string) => void;
  onError: (message: string) => void;
  onUsage: () => Promise<void>;
  setPending: (pending: boolean) => void;
};

type DailyBriefResponse = {
  reply: string;
  usage: {
    input_tokens: number;
    output_tokens: number;
    cache_creation_input_tokens: number;
    cache_read_input_tokens: number;
  };
};

type DailyCapExceededResponse = {
  error: "daily_cap_exceeded";
  usedCents: number;
  capCents: number;
  resetsAtIso: string;
};

export function DailyBriefButton({
  disabled = false,
  onBrief,
  onError,
  onUsage,
  setPending,
}: DailyBriefButtonProps) {
  async function requestBrief() {
    if (disabled) return;

    setPending(true);
    onError("");

    try {
      const response = await fetch("/api/projects-chat/brief", {
        method: "POST",
      });
      const payload = (await response.json()) as
        | DailyBriefResponse
        | DailyCapExceededResponse
        | { error?: string };

      if (!response.ok) {
        if (response.status === 429 && isDailyCapExceeded(payload)) {
          throw new Error(
            `Daily Opus budget reached (${formatMoneyFromCents(
              payload.usedCents,
            )} / ${formatMoneyFromCents(payload.capCents)}). Resets at ${formatResetTime(
              payload.resetsAtIso,
            )}.`,
          );
        }

        const errorMessage =
          "error" in payload && typeof payload.error === "string"
            ? payload.error
            : "Daily brief failed.";
        throw new Error(errorMessage);
      }

      onBrief((payload as DailyBriefResponse).reply);
      await onUsage();
    } catch (error) {
      onError(error instanceof Error ? error.message : "Daily brief failed.");
    } finally {
      setPending(false);
    }
  }

  return (
    <button
      className="h-9 rounded-md border border-white/20 bg-black/20 backdrop-blur-md px-3 text-xs font-semibold text-white/85 shadow-sm transition hover:border-white/50 hover:text-white disabled:cursor-not-allowed disabled:opacity-60"
      disabled={disabled}
      onClick={requestBrief}
      type="button"
    >
      Brief me
    </button>
  );
}

function isDailyCapExceeded(
  payload: DailyBriefResponse | DailyCapExceededResponse | { error?: string },
): payload is DailyCapExceededResponse {
  return (
    "error" in payload &&
    payload.error === "daily_cap_exceeded" &&
    "usedCents" in payload &&
    "capCents" in payload &&
    "resetsAtIso" in payload
  );
}

function formatMoneyFromCents(cents: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(cents / 100);
}

function formatResetTime(value: string): string {
  return new Intl.DateTimeFormat("en-US", {
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(value));
}
