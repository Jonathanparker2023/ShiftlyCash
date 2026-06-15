import { AppPanel, SemanticChip } from "@/components/shell";
import type { ScreenerSnapshotState } from "@/lib/screener/snapshot";

type Props = {
  state: ScreenerSnapshotState;
};

export function ScreenerView({ state }: Props) {
  if (state.status === "empty") {
    return (
      <main className="mx-auto flex max-w-5xl flex-col gap-5 px-4 py-6 text-zinc-100 sm:px-6 lg:px-8">
        <AppPanel elevated>
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-zinc-400">
            Screener
          </p>
          <h1 className="mt-2 text-2xl font-semibold tracking-tight">
            Your practice portfolio
          </h1>
          <p className="mt-2 text-sm text-zinc-300">
            Nothing here yet — your picks show up after the next daily run.
          </p>
        </AppPanel>
      </main>
    );
  }

  const { payload, stale } = state;
  const hero = payload.hero;
  const twin = hero.twinTotalReturnPct ?? hero.pnlPct;
  const market = hero.sp500TotalReturnPct;
  const vs = hero.vsSp500Pct;
  const progress = Math.min(
    100,
    Math.max(0, ((payload.clock.day ?? 0) / (payload.clock.of ?? 180)) * 100),
  );

  const drawdown = hero.maxDrawdownPct;
  const volatility = hero.volatilityPct;
  const budget = hero.referenceCapital;
  const deployed = hero.costBasis;
  const idleCash =
    budget !== null && deployed !== null ? Math.max(0, budget - deployed) : null;
  const deployedPct =
    budget !== null && budget > 0 && deployed !== null ? (deployed / budget) * 100 : null;
  const asOfLabel = formatAsOf(payload.asOf, payload.generatedAt);

  const shadowTickers = new Set(
    payload.queue.filter((q) => q.shadowFlagged).map((q) => q.ticker),
  );
  const onSale = payload.fear.filter((item) => !shadowTickers.has(item.ticker));

  const queueBand = [...payload.queue.filter((item) => item.band === "queue")].sort(
    (a, b) =>
      Number(a.shadowFlagged) - Number(b.shadowFlagged) ||
      (a.queueRank ?? 9999) - (b.queueRank ?? 9999),
  );
  const nearMiss = payload.queue.filter((item) => item.band === "near_miss");

  return (
    <main className="mx-auto flex max-w-5xl flex-col gap-6 px-4 py-6 text-zinc-100 sm:px-6 lg:px-8">
      <section className="rounded-3xl bg-white/5 p-5 sm:p-6">
        <div className="flex items-center justify-between gap-3">
          <p className="text-sm text-zinc-400">Your practice portfolio</p>
          <div className="flex items-center gap-2">
            {hero.unvalidated ? (
              <span className="rounded-full bg-sky-500/15 px-3 py-1 text-xs font-medium text-sky-300">
                practice run
              </span>
            ) : null}
            {stale ? (
              <span className="rounded-full bg-amber-500/15 px-3 py-1 text-xs font-medium text-amber-300">
                a bit stale
              </span>
            ) : null}
          </div>
        </div>

        <h1 className="mt-2 text-2xl font-semibold tracking-tight">
          {statusHeadline(vs)}
        </h1>
        <p className="mt-1 text-sm leading-relaxed text-zinc-400">
          {statusSub(vs, payload.clock.day)}
        </p>
        {asOfLabel ? (
          <p className="mt-2 text-xs text-zinc-500">{asOfLabel}</p>
        ) : null}

        <div className="mt-5 grid grid-cols-3 gap-3">
          <FriendlyStat label="Your picks" value={friendlyPct(twin)} tone={tone(twin)} />
          <FriendlyStat label="The market" value={friendlyPct(market)} tone="neutral" />
          <FriendlyStat label="Ahead by" value={friendlyPct(vs)} tone={tone(vs)} />
        </div>

        {budget !== null || drawdown !== null || volatility !== null ? (
          <div className="mt-3 space-y-1.5 text-xs text-zinc-400">
            {budget !== null && deployed !== null ? (
              <p>
                Invested <span className="text-zinc-200">{formatMoney(deployed)}</span> of{" "}
                <span className="text-zinc-200">{formatMoney(budget)}</span>
                {deployedPct !== null ? ` (${Math.round(deployedPct)}% in)` : ""}
                {idleCash !== null && idleCash >= 1 ? (
                  <>
                    {" · "}
                    <span className="text-zinc-200">{formatMoney(idleCash)}</span> waiting in cash
                  </>
                ) : null}
              </p>
            ) : null}
            {drawdown !== null || volatility !== null ? (
              <p className="flex flex-wrap gap-x-5 gap-y-1">
                {drawdown !== null ? (
                  <span>
                    Worst dip so far:{" "}
                    <span className="text-zinc-200">{formatDip(drawdown)}</span>
                  </span>
                ) : null}
                {volatility !== null ? (
                  <span>
                    How bumpy:{" "}
                    <span className="text-zinc-200">{formatBumpiness(volatility)}</span>
                  </span>
                ) : null}
              </p>
            ) : null}
          </div>
        ) : null}

        <div className="mt-5">
          <div className="h-1.5 overflow-hidden rounded-full bg-white/10">
            <div className="h-full rounded-full bg-sky-400" style={{ width: `${progress}%` }} />
          </div>
          <p className="mt-2 text-xs text-zinc-500">
            Day {formatInteger(payload.clock.day)} of {formatInteger(payload.clock.of)} · the 6-month trial just started
          </p>
        </div>
      </section>

      <section>
        <SectionHeader icon="wallet" title="What you're holding" meta={`${payload.positions.length} names · buy-and-hold`} />
        <div className="mt-3 flex flex-col gap-2">
          {payload.positions.length ? (
            payload.positions.map((position) => {
              const hasDollars =
                position.costBasis !== null || position.marketValue !== null;
              const value = hasDollars
                ? position.marketValue ?? position.costBasis
                : position.current;
              const subline =
                hasDollars && position.shares !== null
                  ? `${formatShares(position.shares)} sh · ${formatMoney(position.current)}/sh`
                  : null;
              return (
                <div
                  key={position.ticker}
                  className="flex items-center justify-between gap-3 rounded-2xl bg-white/5 px-4 py-3"
                >
                  <div>
                    <p className="text-base font-semibold">{position.ticker}</p>
                    {subline ? (
                      <p className="mt-0.5 text-xs text-zinc-500">{subline}</p>
                    ) : null}
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="text-sm font-medium text-zinc-300">{formatMoney(value)}</span>
                    <span className={["min-w-[56px] text-right text-sm font-semibold", toneClass(position.pnlPct)].join(" ")}>
                      {friendlyPct(position.pnlPct)}
                    </span>
                  </div>
                </div>
              );
            })
          ) : (
            <p className="rounded-2xl bg-white/5 px-4 py-3 text-sm text-zinc-400">
              Holding nothing right now — waiting for a good company to go on sale.
            </p>
          )}
        </div>
      </section>

      <section>
        <SectionHeader icon="discount" title="On sale right now" meta="good companies that just dropped" tone="danger" />
        <div className="mt-3 flex flex-wrap gap-2">
          {onSale.length ? (
            onSale.map((item) => {
              const dd = item.drawdownPct;
              const deep = dd !== null && Math.abs(dd) >= 25;
              return (
                <span
                  key={`${item.ticker}-${item.variant}-${item.kind}`}
                  className={[
                    "rounded-full px-3 py-1.5 text-sm",
                    deep ? "bg-rose-500/15 text-rose-300" : "bg-white/5 text-zinc-300",
                  ].join(" ")}
                >
                  {item.ticker}
                  {dd !== null ? ` · down ${Math.abs(Math.round(dd))}%` : ""}
                </span>
              );
            })
          ) : (
            <p className="rounded-2xl bg-white/5 px-4 py-3 text-sm text-zinc-400">
              Nothing&apos;s cheap enough today. Quiet markets — it just waits.
            </p>
          )}
        </div>
      </section>

      <section>
        <SectionHeader icon="eye" title="Worth keeping an eye on" meta={`${queueBand.length} on the list, top few here`} />
        <div className="mt-3 flex flex-col gap-2.5">
          {queueBand.length ? (
            queueBand.slice(0, 8).map((item) => {
              const research = payload.research[item.ticker];
              return (
                <div key={item.ticker} className="rounded-2xl bg-white/5 px-4 py-3.5">
                  <div className="flex items-center justify-between gap-3">
                    <div className="flex items-center gap-2">
                      <span className="text-base font-semibold">{item.ticker}</span>
                      {item.shadowFlagged ? (
                        <span className="rounded-full bg-white/5 px-2 py-0.5 text-xs text-zinc-500">
                          flagged · not buyable
                        </span>
                      ) : null}
                    </div>
                    {research ? (
                      <SemanticChip tone={verdictTone(research.verdict)}>
                        {verdictWord(research.verdict)}
                        {research.confidence !== null ? ` · ${Math.round(research.confidence)}%` : ""}
                      </SemanticChip>
                    ) : null}
                  </div>
                  {research?.summary ? (
                    <p className="mt-2 text-sm leading-relaxed text-zinc-400">
                      {shortTake(research.summary)}
                    </p>
                  ) : null}
                </div>
              );
            })
          ) : (
            <p className="rounded-2xl bg-white/5 px-4 py-3 text-sm text-zinc-400">
              The watchlist is empty right now.
            </p>
          )}
        </div>
        {nearMiss.length ? (
          <p className="mt-3 text-sm text-zinc-500">
            Plus {nearMiss.length} more that just barely missed the cut.
          </p>
        ) : null}
      </section>

      {payload.closed.length ? (
        <section>
          <SectionHeader icon="check" title="Already sold" meta={`${payload.closed.length} closed`} />
          <div className="mt-3 flex flex-col gap-2">
            {payload.closed.map((trade) => (
              <div
                key={`${trade.ticker}-${trade.closedAt ?? "unknown"}`}
                className="flex items-center justify-between gap-3 rounded-2xl bg-white/5 px-4 py-3"
              >
                <div>
                  <p className="text-base font-semibold">{trade.ticker}</p>
                  <p className="text-xs text-zinc-500">
                    {soldReason(trade.reason)} · {formatDate(trade.closedAt)}
                  </p>
                </div>
                <span className={["text-sm font-semibold", toneClass(trade.realizedPnlPct)].join(" ")}>
                  {friendlyPct(trade.realizedPnlPct)}
                </span>
              </div>
            ))}
          </div>
        </section>
      ) : null}
    </main>
  );
}

function SectionHeader({
  title,
  meta,
  tone,
}: {
  icon?: string;
  title: string;
  meta: string;
  tone?: "danger";
}) {
  return (
    <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
      <span
        className={`inline-block h-2 w-2 rounded-full ${tone === "danger" ? "bg-rose-400" : "bg-zinc-500"}`}
        aria-hidden="true"
      />
      <h2 className="text-lg font-semibold tracking-tight">{title}</h2>
      <span className="text-xs text-zinc-500">— {meta}</span>
    </div>
  );
}

function FriendlyStat({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone: "positive" | "negative" | "neutral";
}) {
  const color =
    tone === "positive"
      ? "text-emerald-300"
      : tone === "negative"
        ? "text-rose-300"
        : "text-zinc-100";
  return (
    <div className="rounded-2xl bg-white/5 px-3 py-3">
      <p className="text-xs text-zinc-400">{label}</p>
      <p className={["mt-1 text-xl font-semibold", color].join(" ")}>{value}</p>
    </div>
  );
}

function statusHeadline(vs: number | null): string {
  if (vs === null || Math.abs(vs) < 0.1) {
    return "Neck and neck with the market";
  }
  return vs > 0 ? "Beating the market" : "Trailing the market";
}

function statusSub(vs: number | null, day: number | null): string {
  if (day !== null && day <= 1) {
    return "You just bought in today, so everything's flat for now. Give it room to run.";
  }
  if (vs === null || Math.abs(vs) < 0.1) {
    return "Right in step with the S&P 500 so far.";
  }
  return vs > 0
    ? "Your picks are ahead of the S&P 500 so far."
    : "Behind the S&P 500 so far — early days.";
}

function verdictWord(verdict: string): string {
  if (verdict === "compelling") {
    return "strong";
  }
  if (verdict === "pass") {
    return "skip";
  }
  return "worth watching";
}

function shortTake(summary: string): string {
  const firstSentence = summary.split(/(?<=[.!?])\s/)[0] ?? summary;
  if (firstSentence.length <= 170) {
    return firstSentence;
  }
  return `${firstSentence.slice(0, 167).trimEnd()}…`;
}

function soldReason(reason: string | null): string {
  if (reason === "recovered") {
    return "recovered — took profit";
  }
  if (reason === "thesis_break") {
    return "quality slipped — cut it";
  }
  return reason ? reason.replaceAll("_", " ") : "closed";
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

function tone(value: number | null): "positive" | "negative" | "neutral" {
  if (value === null || Math.abs(value) < 0.05) {
    return "neutral";
  }
  return value > 0 ? "positive" : "negative";
}

function toneClass(value: number | null): string {
  if (value === null || Math.abs(value) < 0.05) {
    return "text-zinc-400";
  }
  return value > 0 ? "text-emerald-300" : "text-rose-300";
}

function friendlyPct(value: number | null): string {
  if (value === null) {
    return "—";
  }
  if (Math.abs(value) < 0.05) {
    return "even";
  }
  const sign = value > 0 ? "+" : "";
  return `${sign}${value.toFixed(1)}%`;
}

function formatMoney(value: number | null): string {
  if (value === null) {
    return "—";
  }
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 2,
  }).format(value);
}

function formatShares(value: number | null): string {
  if (value === null) {
    return "—";
  }
  return new Intl.NumberFormat("en-US", {
    maximumFractionDigits: value >= 10 ? 0 : 2,
  }).format(value);
}

function formatDip(value: number | null): string {
  if (value === null) {
    return "—";
  }
  const mag = Math.abs(value);
  return mag < 0.05 ? "none yet" : `down ${mag.toFixed(1)}%`;
}

function formatBumpiness(value: number | null): string {
  if (value === null) {
    return "—";
  }
  return Math.abs(value) < 0.05 ? "steady so far" : `${Math.abs(value).toFixed(1)}%`;
}

function formatAsOf(asOf: string | null, generatedAt: string | null): string | null {
  const datePart = asOf ? formatDate(asOf) : null;
  const rel = generatedAt ? relativeTime(generatedAt) : null;
  if (datePart && rel) {
    return `Prices as of ${datePart} · checked ${rel}`;
  }
  if (datePart) {
    return `Prices as of ${datePart}`;
  }
  return rel ? `Updated ${rel}` : null;
}

function relativeTime(iso: string): string | null {
  const then = Date.parse(iso);
  if (!Number.isFinite(then)) {
    return null;
  }
  const diffMs = Date.now() - then;
  const mins = Math.floor(diffMs / 60000);
  if (mins < 1) {
    return "just now";
  }
  if (mins < 60) {
    return `${mins}m ago`;
  }
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) {
    return `${hrs}h ago`;
  }
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}

function formatInteger(value: number | null): string {
  return value === null ? "—" : new Intl.NumberFormat("en-US").format(value);
}

function formatDate(value: string | null): string {
  if (!value) {
    return "—";
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "—";
  }
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
  }).format(date);
}
