"use client";

import { useRouter } from "next/navigation";
import type { FormEvent } from "react";
import { useEffect, useMemo, useRef, useState } from "react";

import { DailyBriefButton } from "@/components/projects/DailyBriefButton";
import { VoiceInput } from "@/components/projects/VoiceInput";

type ChatMessage = {
  role: "user" | "assistant";
  content: string;
};

type TokenUsage = {
  input_tokens: number;
  output_tokens: number;
  cache_creation_input_tokens: number | null;
  cache_read_input_tokens: number | null;
};

type ProjectsChatResponse = {
  reply: string;
  toolCalls: Array<{ name: string; input: unknown; result: unknown }>;
  usage: TokenUsage;
};

type DailyUsage = {
  usedCents: number;
  capCents: number;
  resetsAtIso: string;
};

type DailyCapExceededResponse = DailyUsage & {
  error: "daily_cap_exceeded";
};

export function ClaudeChat() {
  const router = useRouter();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [usage, setUsage] = useState<TokenUsage | null>(null);
  const [dailyUsage, setDailyUsage] = useState<DailyUsage | null>(null);
  const [dailyBrief, setDailyBrief] = useState<string | null>(null);
  const [isBriefPending, setIsBriefPending] = useState(false);
  const [capExceededUntil, setCapExceededUntil] = useState<string | null>(null);
  const [toolCount, setToolCount] = useState(0);
  const [isPending, setIsPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const cacheReadPercent = useMemo(() => {
    if (!usage) {
      return null;
    }

    const cacheRead = usage.cache_read_input_tokens ?? 0;
    const total = usage.input_tokens + cacheRead;
    if (total <= 0) {
      return null;
    }

    return Math.round((cacheRead / total) * 100);
  }, [usage]);

  const isCapLocked =
    capExceededUntil !== null && Date.now() < new Date(capExceededUntil).getTime();

  useEffect(() => {
    void refreshDailyUsage();
  }, []);

  async function refreshDailyUsage() {
    try {
      const response = await fetch("/api/projects-chat/usage", {
        method: "GET",
      });

      if (!response.ok) {
        return;
      }

      const payload = (await response.json()) as DailyUsage;
      setDailyUsage(payload);
      if (payload.usedCents < payload.capCents) {
        setCapExceededUntil(null);
      }
    } catch {
      // Usage display is advisory; chat errors still surface through submit().
    }
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const text = input.trim();
    if (!text || isPending || isCapLocked) {
      return;
    }

    const nextMessages: ChatMessage[] = [...messages, { role: "user", content: text }];
    setMessages(nextMessages);
    setInput("");
    setIsPending(true);
    setError(null);

    try {
      const response = await fetch("/api/projects-chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: nextMessages.map((message) => ({
            role: message.role,
            content: message.content,
          })),
        }),
      });
      const payload = (await response.json()) as
        | ProjectsChatResponse
        | DailyCapExceededResponse
        | { error?: string };

      if (!response.ok) {
        if (response.status === 429 && isDailyCapExceeded(payload)) {
          setDailyUsage({
            usedCents: payload.usedCents,
            capCents: payload.capCents,
            resetsAtIso: payload.resetsAtIso,
          });
          setCapExceededUntil(payload.resetsAtIso);
          throw new Error(
            `Daily Opus budget reached (${formatMoneyFromCents(
              payload.usedCents,
            )} / ${formatMoneyFromCents(payload.capCents)}). Resets at ${formatResetTime(
              payload.resetsAtIso,
            )}.`,
          );
        }

        const errorPayload = payload as { error?: string };
        throw new Error(errorPayload.error ?? "Project chat failed.");
      }

      const chatPayload = payload as ProjectsChatResponse;
      setMessages([
        ...nextMessages,
        { role: "assistant", content: chatPayload.reply },
      ]);
      setUsage(chatPayload.usage);
      setToolCount(chatPayload.toolCalls.length);
      await refreshDailyUsage();
      router.refresh();
    } catch (err) {
      setMessages(messages);
      setError(err instanceof Error ? err.message : "Project chat failed.");
    } finally {
      setIsPending(false);
    }
  }

  function appendTranscript(transcript: string) {
    setInput((current) => `${current} ${transcript}`.trim());
    inputRef.current?.focus();
  }

  return (
    <section className="rounded-md border border-[#d7dee8] bg-[#f8fafc] p-3 text-[#0f172a] shadow-[0_18px_50px_rgba(0,0,0,0.16)] sm:p-4">
      <div className="mb-3 flex items-start justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold uppercase tracking-[0.16em] text-[#334155]">
            Claude Projects
          </h2>
          <p className="mt-1 text-sm text-[#64748b]">
            Short project and task updates.
          </p>
        </div>
        <span className="rounded-full bg-[#dbeafe] px-2.5 py-1 text-xs font-semibold text-[#1d4ed8]">
          Opus 4.7
        </span>
      </div>

      <UsageBudget usage={dailyUsage} />

      <div className="mb-3 rounded-md border border-[#d7dee8] bg-white px-3 py-2">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-[#64748b]">
            Daily Brief
          </p>
          <DailyBriefButton
            disabled={isBriefPending || isPending || isCapLocked}
            onBrief={setDailyBrief}
            onError={setError}
            onUsage={refreshDailyUsage}
            setPending={setIsBriefPending}
          />
        </div>
        {dailyBrief ? (
          <p className="mt-2 rounded-md bg-[#f8fafc] px-3 py-2 text-sm leading-6 text-[#334155]">
            {dailyBrief}
          </p>
        ) : null}
      </div>

      <div className="mb-3 flex h-[320px] flex-col gap-2 overflow-y-auto rounded-md border border-[#d7dee8] bg-white p-3">
        {messages.length === 0 ? (
          <div className="flex min-h-full items-center justify-center text-center text-sm text-[#64748b]">
            Ask Claude to create, update, archive, or delete projects and tasks.
          </div>
        ) : (
          messages.map((message, index) => (
            <div
              className={
                message.role === "user"
                  ? "ml-8 rounded-md bg-[#1d4ed8] px-3 py-2 text-sm text-white"
                  : "mr-8 rounded-md border border-[#d7dee8] bg-[#f8fafc] px-3 py-2 text-sm text-[#0f172a]"
              }
              key={`${message.role}-${index}`}
            >
              {message.content}
            </div>
          ))
        )}
      </div>

      <form className="flex gap-2" onSubmit={submit}>
        <input
          className="h-10 min-w-0 flex-1 rounded-md border border-[#cbd5e1] bg-white px-3 text-sm outline-none transition placeholder:text-[#94a3b8] focus:border-[#1d4ed8] focus:ring-2 focus:ring-[#bfdbfe]"
          disabled={isPending || isCapLocked}
          onChange={(event) => setInput(event.target.value)}
          placeholder="Ask for a project or task change"
          ref={inputRef}
          type="text"
          value={input}
        />
        <VoiceInput disabled={isPending || isCapLocked} onTranscript={appendTranscript} />
        <button
          className="h-10 rounded-md bg-[#0b1220] px-4 text-sm font-semibold text-white shadow-sm transition hover:bg-[#1e293b] disabled:cursor-not-allowed disabled:bg-[#94a3b8]"
          disabled={isPending || isCapLocked || !input.trim()}
          type="submit"
        >
          {isPending ? "Sending" : "Send"}
        </button>
      </form>

      {error ? (
        <p className="mt-2 rounded-md border border-[#fecaca] bg-[#fff1f2] px-3 py-2 text-sm font-medium text-[#b91c1c]">
          {error}
        </p>
      ) : null}

      <div className="mt-3 grid gap-2 text-xs text-[#475569] sm:grid-cols-5">
        <TokenPill label="Input" value={usage?.input_tokens ?? 0} />
        <TokenPill label="Output" value={usage?.output_tokens ?? 0} />
        <TokenPill
          label="Cache write"
          value={usage?.cache_creation_input_tokens ?? 0}
        />
        <TokenPill label="Cache read" value={usage?.cache_read_input_tokens ?? 0} />
        <TokenPill label="Tools" value={toolCount} suffix={cacheReadPercent === null ? "" : ` / ${cacheReadPercent}%`} />
      </div>
    </section>
  );
}

function TokenPill({
  label,
  value,
  suffix = "",
}: {
  label: string;
  value: number;
  suffix?: string;
}) {
  return (
    <div className="rounded-md border border-[#d7dee8] bg-white px-2.5 py-2">
      <span className="block font-semibold text-[#334155]">{label}</span>
      <span className="font-mono text-[#0f172a]">
        {value.toLocaleString()}
        {suffix}
      </span>
    </div>
  );
}

function UsageBudget({ usage }: { usage: DailyUsage | null }) {
  const usedCents = usage?.usedCents ?? 0;
  const capCents = usage?.capCents ?? 500;
  const progress = capCents > 0 ? Math.min(100, (usedCents / capCents) * 100) : 0;

  return (
    <div className="mb-3 rounded-md border border-[#d7dee8] bg-white px-3 py-2">
      <div className="mb-1 flex items-center justify-between gap-3 text-xs font-semibold text-[#334155]">
        <span>
          Today: {formatMoneyFromCents(usedCents)} of{" "}
          {formatMoneyFromCents(capCents)}
        </span>
        <span className="text-[#64748b]">
          Resets {usage ? formatResetTime(usage.resetsAtIso) : "at midnight UTC"}
        </span>
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-[#e2e8f0]">
        <div
          className="h-full rounded-full bg-[#1d4ed8] transition-[width]"
          style={{ width: `${progress}%` }}
        />
      </div>
    </div>
  );
}

function isDailyCapExceeded(
  payload: ProjectsChatResponse | DailyCapExceededResponse | { error?: string },
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
