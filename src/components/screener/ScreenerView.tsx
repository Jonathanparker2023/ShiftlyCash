import { AppPanel, SemanticChip } from "@/components/shell";
import type { ScreenerNavPoint, ScreenerSnapshotState } from "@/lib/screener/snapshot";

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
  const verdict = hero.verdict;
  const fearEvents = hero.fearEvents;
  const cohort = payload.clock.cohort;
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
  const navSeries = payload.navSeries;
  const health = payload.health;
  const excluded = payload.excluded;

  return (
    <main className="mx-auto flex max-w-5xl flex-col gap-6 px-4 py-6 text-zinc-100 sm:px-6 lg:px-8">
      {health.ingestErrors7d !== null && health.ingestErrors7d > 0 ? (
        <div className="rounded-2xl bg-amber-500/10 px-4 py-3 text-sm text-amber-200">
          Heads up — {formatInteger(health.ingestErrors7d)} data hiccup
          {health.ingestErrors7d === 1 ? "" : "s"} in the last 7 days. A few figures may be a little behind.
        </div>
      ) : null}

      <section className="rounded-3xl bg-white/5 p-5 sm:p-6">
        <div className="flex items-center justify-between gap-3">
          <p className="text-sm text-zinc-400">Your practice portfolio</p>
          <div className="flex items-center gap-2">
            <span className={verdictChipClass(verdict)}>{verdictLabel(verdict)}</span>
            {stale ? (
              <span className="rounded-full bg-amber-500/15 px-3 py-1 text-xs font-medium text-amber-300">
                a bit stale
              </span>
            ) : null}
          </div>
        </div>

        <h1 className="mt-2 text-2xl font-semibold tracking-tight">
          {statusHeadline(vs, verdict)}
        </h1>
        <p className="mt-1 text-sm leading-relaxed text-zinc-400">
          {statusSub(vs, payload.clock.day, verdict, fearEvents)}
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
            Day {formatInteger(payload.clock.day)} of {formatInteger(payload.clock.of)} · {trialNote(verdict)}
            {cohort !== null && cohort > 1 ? ` · cohort ${formatInteger(cohort)} (clock was reset)` : ""}
          </p>
        </div>
      </section>

      {navSeries.length >= 2 ? (
        <section>
          <SectionHeader title="Picks vs. the market" meta={`${navSeries.length} days in`} />
          <div className="mt-3 rounded-2xl bg-white/5 p-4">
            <div className="h-32 w-full">
              <NavChart series={navSeries} />
            </div>
            <div className="mt-3 flex items-center gap-4 text-xs text-zinc-400">
              <span className="flex items-center gap-1.5">
                <span className="inline-block h-2 w-2 rounded-full bg-sky-400" />
                Your picks
              </span>
              <span className="flex items-center gap-1.5">
                <span className="inline-block h-2 w-2 rounded-full bg-zinc-500" />
                The market
              </span>
            </div>
          </div>
        </section>
      ) : null}

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
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="text-base font-semibold">{position.ticker}</p>
                      {position.stale ? (
                        <span className="rounded-full bg-amber-500/15 px-2 py-0.5 text-xs text-amber-300">
                          price stale — check
                        </span>
                      ) : null}
                    </div>
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
        <SectionHeader icon="discount" title="On sale right now" meta="dropped hard AND historically cheap" tone="danger" />
        <div className="mt-3 flex flex-col gap-2">
          {onSale.length ? (
            onSale.map((item) => {
              const dd = item.drawdownPct;
              const deep = dd !== null && Math.abs(dd) >= 25;
              const cheap = cheapnessLabel(item.valuationPctile);
              return (
                <div
                  key={`${item.ticker}-${item.variant}-${item.kind}`}
                  className="flex items-center justify-between gap-3 rounded-2xl bg-white/5 px-4 py-3"
                >
                  <span className="text-base font-semibold">{item.ticker}</span>
                  <div className="flex flex-wrap items-center justify-end gap-x-3 gap-y-0.5 text-sm">
                    {dd !== null ? (
                      <span className={deep ? "text-rose-300" : "text-zinc-300"}>
                        down {Math.abs(Math.round(dd))}%
                      </span>
                    ) : null}
                    {cheap ? <span className="text-emerald-300/90">{cheap}</span> : null}
                  </div>
                </div>
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
              const passes = passedCount(item.criteria);
              const moat = research ? moatLabel(research.moatRating) : null;
              const hasThesis =
                research &&
                (moat ||
                  research.redFlags.length > 0 ||
                  research.bullCase.length > 0 ||
                  research.bearCase.length > 0);
              return (
                <div key={item.ticker} className="rounded-2xl bg-white/5 px-4 py-3.5">
                  <div className="flex items-center justify-between gap-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-base font-semibold">{item.ticker}</span>
                      {passes === 4 ? (
                        <span className="rounded-full bg-emerald-500/10 px-2 py-0.5 text-xs text-emerald-300/90">
                          passes all 4 tests
                        </span>
                      ) : null}
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
                  {hasThesis ? (
                    <div className="mt-2.5 space-y-1.5 text-xs">
                      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                        {moat ? <span className="text-zinc-300">{moat}</span> : null}
                        {research && research.bullCase[0] ? (
                          <span className="line-clamp-1 max-w-[18rem] text-emerald-300/80">
                            + {research.bullCase[0]}
                          </span>
                        ) : null}
                        {research && research.bearCase[0] ? (
                          <span className="line-clamp-1 max-w-[18rem] text-amber-300/80">
                            – {research.bearCase[0]}
                          </span>
                        ) : null}
                      </div>
                      {research && research.redFlags.length > 0 ? (
                        <p className="line-clamp-2 text-rose-300/80">
                          ⚠ {research.redFlags.slice(0, 2).join(" · ")}
                        </p>
                      ) : null}
                    </div>
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
          <div className="mt-4">
            <p className="text-sm text-zinc-500">Just missed the cut ({nearMiss.length}):</p>
            <div className="mt-2 flex flex-col gap-1.5">
              {nearMiss.slice(0, 5).map((item) => {
                const missed = missedTests(item.criteria);
                return (
                  <div
                    key={item.ticker}
                    className="flex items-center justify-between gap-3 rounded-xl bg-white/[0.03] px-3 py-2"
                  >
                    <span className="text-sm font-medium">{item.ticker}</span>
                    <span className="text-xs text-zinc-500">
                      {missed.length ? `missed: ${missed.join(", ")}` : "scored 3 of 4"}
                    </span>
                  </div>
                );
              })}
              {nearMiss.length > 5 ? (
                <p className="text-xs text-zinc-500">+{nearMiss.length - 5} more</p>
              ) : null}
            </div>
          </div>
        ) : null}
      </section>

      {excluded.length ? (
        <section>
          <SectionHeader title="Filtered out" meta="strong names blocked by the rules" />
          <div className="mt-3 flex flex-col gap-2">
            {excluded.slice(0, 6).map((item) => (
              <div
                key={`${item.ticker}-${item.ruleId ?? ""}`}
                className="flex items-center justify-between gap-3 rounded-2xl bg-white/5 px-4 py-3"
              >
                <div>
                  <p className="text-base font-semibold">{item.ticker}</p>
                  <p className="mt-0.5 text-xs text-zinc-500">
                    {excludedReason(item.reason, item.ruleId)}
                  </p>
                </div>
                {item.score !== null ? (
                  <span className="text-xs text-zinc-500">scored {item.score}/4</span>
                ) : null}
              </div>
            ))}
            {excluded.length > 6 ? (
              <p className="text-xs text-zinc-500">+{excluded.length - 6} more</p>
            ) : null}
          </div>
        </section>
      ) : null}

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

function NavChart({ series }: { series: ScreenerNavPoint[] }) {
  const width = 320;
  const height = 120;
  const padX = 4;
  const padY = 10;
  const values = series
    .flatMap((p) => [p.twinPct, p.sp500Pct])
    .filter((v): v is number => v !== null);
  if (values.length < 2) {
    return null;
  }
  const min = Math.min(0, ...values);
  const max = Math.max(0, ...values);
  const range = max - min || 1;
  const lastIndex = Math.max(1, series.length - 1);
  const xAt = (i: number) => padX + (i / lastIndex) * (width - 2 * padX);
  const yAt = (v: number) => padY + (1 - (v - min) / range) * (height - 2 * padY);
  const toPoints = (key: "twinPct" | "sp500Pct") =>
    series
      .map((p, i) => {
        const v = p[key];
        return v === null ? null : `${xAt(i).toFixed(1)},${yAt(v).toFixed(1)}`;
      })
      .filter((s): s is string => s !== null)
      .join(" ");
  const zeroY = yAt(0).toFixed(1);
  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      preserveAspectRatio="none"
      className="h-full w-full"
      role="img"
      aria-label="Your picks versus the market over time"
    >
      <line
        x1={padX}
        y1={zeroY}
        x2={width - padX}
        y2={zeroY}
        stroke="currentColor"
        strokeWidth="1"
        strokeDasharray="3 3"
        className="text-white/15"
      />
      <polyline
        points={toPoints("sp500Pct")}
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        className="text-zinc-500"
      />
      <polyline
        points={toPoints("twinPct")}
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        className="text-sky-400"
      />
    </svg>
  );
}

const CRITERION_LABELS: Record<string, string> = {
  real_eps_growth: "earnings growth",
  manageable_debt: "debt load",
  light_capex: "low capex",
  pricing_power: "pricing power",
};

function missedTests(criteria: Record<string, boolean> | null): string[] {
  if (!criteria) {
    return [];
  }
  return Object.entries(criteria)
    .filter(([, passed]) => !passed)
    .map(([key]) => CRITERION_LABELS[key] ?? key.replaceAll("_", " "));
}

function passedCount(criteria: Record<string, boolean> | null): number | null {
  if (!criteria) {
    return null;
  }
  return Object.values(criteria).filter(Boolean).length;
}

function cheapnessLabel(pctile: number | null): string | null {
  if (pctile === null) {
    return null;
  }
  const cheapest = Math.min(99, Math.max(1, Math.round(100 - pctile)));
  return `in its cheapest ${cheapest}%`;
}

function moatLabel(rating: string | null): string | null {
  if (!rating) {
    return null;
  }
  const normalized = rating.toLowerCase();
  if (normalized === "wide") {
    return "wide moat";
  }
  if (normalized === "narrow") {
    return "narrow moat";
  }
  if (normalized === "none") {
    return "no moat";
  }
  return `${rating} moat`;
}

function excludedReason(reason: string | null, ruleId: string | null): string {
  if (reason && reason.trim()) {
    return reason.trim();
  }
  if (ruleId) {
    return ruleId.replaceAll("_", " ");
  }
  return "filtered out";
}

function verdictLabel(verdict: string | null): string {
  if (verdict === "pass") {
    return "validated";
  }
  if (verdict === "fail") {
    return "did not pass";
  }
  if (verdict === "inconclusive") {
    return "inconclusive";
  }
  return "practice run";
}

function verdictChipClass(verdict: string | null): string {
  const base = "rounded-full px-3 py-1 text-xs font-medium ";
  if (verdict === "pass") {
    return base + "bg-emerald-500/15 text-emerald-300";
  }
  if (verdict === "fail") {
    return base + "bg-rose-500/15 text-rose-300";
  }
  if (verdict === "inconclusive") {
    return base + "bg-amber-500/15 text-amber-300";
  }
  return base + "bg-sky-500/15 text-sky-300";
}

function trialNote(verdict: string | null): string {
  if (verdict === "pass") {
    return "validated";
  }
  if (verdict === "fail") {
    return "did not pass";
  }
  if (verdict === "inconclusive") {
    return "trial complete — inconclusive";
  }
  return "6-month trial in progress";
}

function eventsPhrase(fearEvents: number | null): string | null {
  if (fearEvents === null) {
    return null;
  }
  return `${fearEvents} fear signal${fearEvents === 1 ? "" : "s"} so far`;
}

function statusHeadline(vs: number | null, verdict: string | null): string {
  if (verdict === "pass") {
    return "Validated — it beat the market";
  }
  if (verdict === "fail") {
    return "It didn't beat the market";
  }
  if (verdict === "inconclusive") {
    return "Inconclusive — too little happened to judge";
  }
  if (vs === null || Math.abs(vs) < 0.1) {
    return "Neck and neck with the market";
  }
  return vs > 0 ? "Ahead of the market so far" : "Behind the market so far";
}

function statusSub(
  vs: number | null,
  day: number | null,
  verdict: string | null,
  fearEvents: number | null,
): string {
  const events = eventsPhrase(fearEvents);
  if (verdict === "inconclusive") {
    return `The 6 months are up, but ${events ?? "too few signals"} — not enough happened to call it either way.`;
  }
  if (verdict === "pass") {
    return "Cleared the bar set at the start: beat the S&P 500 with enough signal to count.";
  }
  if (verdict === "fail") {
    return "Fell short of the bar set at the start against the S&P 500.";
  }
  if (day !== null && day <= 1) {
    return "You just bought in today, so everything's flat for now. Give it room to run.";
  }
  const tail = events ? ` ${events} — too early to call.` : " Too early to call.";
  if (vs === null || Math.abs(vs) < 0.1) {
    return "Right in step with the S&P 500 so far." + tail;
  }
  return (
    (vs > 0 ? "Your picks are ahead of the S&P 500 so far." : "Behind the S&P 500 so far.") + tail
  );
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
