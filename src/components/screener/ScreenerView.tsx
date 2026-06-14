import {
  AppPanel,
  DataCard,
  MetricValue,
  SemanticChip,
} from "@/components/shell";
import type { ScreenerSnapshotState } from "@/lib/screener/snapshot";

type Props = {
  state: ScreenerSnapshotState;
};

export function ScreenerView({ state }: Props) {
  if (state.status === "empty") {
    return (
      <main className="mx-auto flex max-w-7xl flex-col gap-4 px-4 py-6 text-zinc-100 sm:px-6 lg:px-8">
        <AppPanel elevated>
          <div className="flex flex-col gap-3">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.2em] text-zinc-400">
                Screener
              </p>
              <h1 className="mt-2 text-2xl font-semibold tracking-tight">
                Paper twin
              </h1>
            </div>
            <p className="text-sm text-zinc-300">
              Twin starts publishing on the next daily run.
            </p>
          </div>
        </AppPanel>
      </main>
    );
  }

  const { payload, stale } = state;
  const heroTone = toneForPercent(payload.hero.pnlPct);

  return (
    <main className="mx-auto flex max-w-7xl flex-col gap-4 px-4 py-6 text-zinc-100 sm:px-6 lg:px-8">
      <AppPanel elevated>
        <div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <p className="text-xs font-semibold uppercase tracking-[0.2em] text-zinc-400">
                Screener
              </p>
              {payload.hero.unvalidated ? (
                <SemanticChip tone="warning">unvalidated</SemanticChip>
              ) : null}
              {stale ? <SemanticChip tone="warning">stale</SemanticChip> : null}
            </div>
            <MetricValue
              className="mt-3"
              label="Paper twin vs cash"
              tone={heroTone}
              value={`Paper twin: ${formatSignedPercent(payload.hero.pnlPct)} vs cash`}
            />
          </div>
          <div className="grid gap-3 sm:grid-cols-2 lg:min-w-[560px] xl:grid-cols-4">
            <DataCard>
              <p className="text-xs font-semibold uppercase tracking-[0.16em] text-zinc-400">
                Clock
              </p>
              <p className="mt-2 text-lg font-semibold">
                Day {formatInteger(payload.clock.day)} of {formatInteger(payload.clock.of)}
              </p>
            </DataCard>
            <DataCard>
              <p className="text-xs font-semibold uppercase tracking-[0.16em] text-zinc-400">
                Value
              </p>
              <p className="mt-2 text-lg font-semibold">
                {formatMoney(payload.hero.portfolioValue)}
              </p>
            </DataCard>
            <DataCard>
              <p className="text-xs font-semibold uppercase tracking-[0.16em] text-zinc-400">
                Cost
              </p>
              <p className="mt-2 text-lg font-semibold">
                {formatMoney(payload.hero.costBasis)}
              </p>
            </DataCard>
            <DataCard>
              <p className="text-xs font-semibold uppercase tracking-[0.16em] text-zinc-400">
                Realized
              </p>
              <p className={["mt-2 text-lg font-semibold", toneClass(payload.hero.realizedPnl)].join(" ")}>
                {formatMoney(payload.hero.realizedPnl)}
              </p>
            </DataCard>
          </div>
        </div>
        {stale ? (
          <p className="mt-4 text-sm text-amber-200">
            Stale: daily run may not have published.
          </p>
        ) : null}
      </AppPanel>

      <section className="grid gap-4 lg:grid-cols-[1.1fr_0.9fr]">
        <AppPanel>
          <SectionHeader title="Open positions" meta={`${payload.positions.length} open`} />
          <div className="mt-4 overflow-x-auto">
            <table className="min-w-full text-left text-sm">
              <thead className="text-xs uppercase tracking-[0.14em] text-zinc-500">
                <tr>
                  <th className="pb-2 pr-4 font-semibold">Ticker</th>
                  <th className="pb-2 pr-4 font-semibold">Entry</th>
                  <th className="pb-2 pr-4 font-semibold">Current</th>
                  <th className="pb-2 text-right font-semibold">P&amp;L</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/10">
                {payload.positions.length ? (
                  payload.positions.map((position) => (
                    <tr key={position.ticker}>
                      <td className="py-3 pr-4 font-semibold">{position.ticker}</td>
                      <td className="py-3 pr-4 text-zinc-300">{formatMoney(position.entry)}</td>
                      <td className="py-3 pr-4 text-zinc-300">{formatMoney(position.current)}</td>
                      <td className={["py-3 text-right font-semibold", toneClass(position.pnlPct)].join(" ")}>
                        {formatSignedPercent(position.pnlPct)}
                      </td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td className="py-4 text-zinc-400" colSpan={4}>
                      No open paper positions.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </AppPanel>

        <AppPanel>
          {(() => {
            const shadowTickers = new Set(
              payload.queue.filter((q) => q.shadowFlagged).map((q) => q.ticker),
            );
            const fearVisible = payload.fear.filter((item) => !shadowTickers.has(item.ticker));
            return (
              <>
          <SectionHeader title="In fear now" meta={`${fearVisible.length} active`} />
          <div className="mt-4 flex flex-col gap-2">
            {fearVisible.length ? (
              fearVisible.map((item) => (
                <DataCard className="flex items-center justify-between gap-3" key={`${item.ticker}-${item.variant}-${item.kind}`}>
                  <div>
                    <p className="font-semibold">{item.ticker}</p>
                    <p className="text-xs uppercase tracking-[0.14em] text-zinc-500">
                      {[item.variant, item.kind].filter(Boolean).join(" / ")}
                    </p>
                  </div>
                  <p className="text-sm font-semibold text-amber-200">
                    {formatSignedPercent(item.drawdownPct)}
                  </p>
                </DataCard>
              ))
            ) : (
              <p className="text-sm text-zinc-400">No active fear triggers.</p>
            )}
          </div>
              </>
            );
          })()}
        </AppPanel>
      </section>

      <AppPanel>
        <SectionHeader title="Closed trades" meta={`${payload.closed.length} closed`} />
        <div className="mt-4 overflow-x-auto">
          <table className="min-w-full text-left text-sm">
            <thead className="text-xs uppercase tracking-[0.14em] text-zinc-500">
              <tr>
                <th className="pb-2 pr-4 font-semibold">Ticker</th>
                <th className="pb-2 pr-4 font-semibold">Entry</th>
                <th className="pb-2 pr-4 font-semibold">Exit</th>
                <th className="pb-2 pr-4 font-semibold">Reason</th>
                <th className="pb-2 pr-4 font-semibold">Closed</th>
                <th className="pb-2 text-right font-semibold">Realized</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/10">
              {payload.closed.length ? (
                payload.closed.map((trade) => (
                  <tr key={`${trade.ticker}-${trade.closedAt ?? "unknown"}`}>
                    <td className="py-3 pr-4 font-semibold">{trade.ticker}</td>
                    <td className="py-3 pr-4 text-zinc-300">{formatMoney(trade.entry)}</td>
                    <td className="py-3 pr-4 text-zinc-300">{formatMoney(trade.exit)}</td>
                    <td className="py-3 pr-4 text-zinc-300">{formatReason(trade.reason)}</td>
                    <td className="py-3 pr-4 text-zinc-300">{formatDate(trade.closedAt)}</td>
                    <td className={["py-3 text-right font-semibold", toneClass(trade.realizedPnlPct)].join(" ")}>
                      {formatSignedPercent(trade.realizedPnlPct)}
                    </td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td className="py-4 text-zinc-400" colSpan={6}>
                    No closed paper trades.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </AppPanel>

      <AppPanel>
        {(() => {
          const queueBand = payload.queue.filter((item) => item.band === "queue");
          const nearMiss = payload.queue.filter((item) => item.band === "near_miss");
          return (
            <>
              <SectionHeader title="Queue" meta={`${queueBand.length} in queue`} />
              <div className="mt-4 grid gap-2 md:grid-cols-2 xl:grid-cols-3">
                {queueBand.length ? (
                  queueBand.map((item) => {
                    const research = payload.research[item.ticker];
                    return (
                    <DataCard key={item.ticker}>
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <p className="font-semibold">{item.ticker}</p>
                          <p className="mt-1 text-xs uppercase tracking-[0.14em] text-zinc-500">
                            rank {formatInteger(item.queueRank)}
                          </p>
                        </div>
                        <div className="flex flex-col items-end gap-2">
                          <span className="text-sm font-semibold">Score {formatInteger(item.score)}</span>
                          {research ? (
                            <SemanticChip tone={verdictTone(research.verdict)}>
                              {research.confidence !== null
                                ? `${research.verdict} ${Math.round(research.confidence * 100)}%`
                                : research.verdict}
                            </SemanticChip>
                          ) : null}
                          {item.shadowFlagged ? (
                            <SemanticChip tone="warning">shadow</SemanticChip>
                          ) : null}
                        </div>
                      </div>
                      {research?.summary ? (
                        <details className="mt-3">
                          <summary className="cursor-pointer text-xs font-semibold uppercase tracking-[0.14em] text-zinc-500">
                            Research note
                          </summary>
                          <p className="mt-2 text-sm leading-relaxed text-zinc-300">{research.summary}</p>
                        </details>
                      ) : null}
                    </DataCard>
                    );
                  })
                ) : (
                  <p className="text-sm text-zinc-400">No names in the queue band.</p>
                )}
              </div>
              {nearMiss.length ? (
                <p className="mt-4 text-sm text-zinc-400">
                  Near-miss (score 3): {nearMiss.length} names
                </p>
              ) : null}
            </>
          );
        })()}
      </AppPanel>
    </main>
  );
}

function SectionHeader({ title, meta }: { title: string; meta: string }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <h2 className="text-lg font-semibold tracking-tight">{title}</h2>
      <span className="text-xs font-semibold uppercase tracking-[0.14em] text-zinc-500">
        {meta}
      </span>
    </div>
  );
}

function verdictTone(verdict: string): "positive" | "warning" | "negative" {
  if (verdict === "compelling") {
    return "positive";
  }
  if (verdict === "pass") {
    return "negative";
  }
  return "warning";
}

function toneForPercent(value: number | null): "positive" | "negative" | "neutral" {
  if (value === null || value === 0) {
    return "neutral";
  }

  return value > 0 ? "positive" : "negative";
}

function toneClass(value: number | null): string {
  if (value === null || value === 0) {
    return "text-zinc-300";
  }

  return value > 0 ? "text-emerald-300" : "text-rose-300";
}

function formatMoney(value: number | null): string {
  if (value === null) {
    return "--";
  }

  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 2,
  }).format(value);
}

function formatInteger(value: number | null): string {
  return value === null ? "--" : new Intl.NumberFormat("en-US").format(value);
}

function formatReason(value: string | null): string {
  return value ? value.replaceAll("_", " ") : "--";
}

function formatDate(value: string | null): string {
  if (!value) {
    return "--";
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "--";
  }

  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(date);
}

function formatSignedPercent(value: number | null): string {
  if (value === null) {
    return "--";
  }

  const sign = value > 0 ? "+" : "";

  return `${sign}${value.toFixed(1)}%`;
}
