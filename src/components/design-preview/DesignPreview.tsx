"use client";

import { useState } from "react";
import type { CSSProperties } from "react";

type AccentName = "Emerald" | "Lavender" | "Gold";
type PreviewStyle = CSSProperties & Record<`--dp-${string}`, string>;

const ACCENTS: Record<
  AccentName,
  { accent: string; text: string; fill: string; border: string }
> = {
  Emerald: {
    accent: "#10b981",
    text: "#34d399",
    fill: "rgba(16,185,129,0.12)",
    border: "rgba(16,185,129,0.30)",
  },
  Lavender: {
    accent: "#5e6ad2",
    text: "#828fff",
    fill: "rgba(94,106,210,0.14)",
    border: "rgba(94,106,210,0.34)",
  },
  Gold: {
    accent: "#d4af37",
    text: "#e6c75a",
    fill: "rgba(212,175,55,0.12)",
    border: "rgba(212,175,55,0.30)",
  },
};

const ICONS = {
  dashboard: ["M3 3h7v9H3z", "M14 3h7v5h-7z", "M14 12h7v9h-7z", "M3 16h7v5H3z"],
  receipt: [
    "M4 2v20l2-2 2 2 2-2 2 2 2-2 2 2 2-2 2 2V2l-2 2-2-2-2 2-2-2-2 2-2-2-2 2Z",
    "M16 8h-6",
    "M16 12h-6",
    "M13 16h-3",
  ],
  clock: ["M12 2a10 10 0 1 0 0 20 10 10 0 1 0 0-20", "M12 6v6l4 2"],
  trendingUp: ["m3 17 6-6 4 4 8-8", "M14 7h7v7"],
  target: [
    "M12 2a10 10 0 1 0 0 20 10 10 0 1 0 0-20",
    "M12 6a6 6 0 1 0 0 12 6 6 0 1 0 0-12",
    "M12 10a2 2 0 1 0 0 4 2 2 0 1 0 0-4",
  ],
  wallet: [
    "M19 7V4a1 1 0 0 0-1-1H5a2 2 0 0 0 0 4h15a1 1 0 0 1 1 1v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5",
    "M16 13h2",
  ],
  banknote: [
    "M4 6h16a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2Z",
    "M12 10a2 2 0 1 0 0 4 2 2 0 1 0 0-4",
    "M6 12h.01",
    "M18 12h.01",
  ],
  activity: "M22 12h-4l-3 9L9 3l-3 9H2",
  calendar: [
    "M8 2v4",
    "M16 2v4",
    "M5 4h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2Z",
    "M3 10h18",
  ],
  grip: ["M9 5h.01", "M9 12h.01", "M9 19h.01", "M15 5h.01", "M15 12h.01", "M15 19h.01"],
  chevronDown: "m6 9 6 6 6-6",
  plus: ["M5 12h14", "M12 5v14"],
  fuel: [
    "M3 22V5a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v17",
    "M3 11h12",
    "M18 14h.01",
    "M17 7l3 3",
    "M21 10v9a2 2 0 0 1-2 2h0a2 2 0 0 1-2-2v-5",
  ],
  home: ["M3 11 12 2l9 9", "M5 10v10h14V10", "M9 20v-6h6v6"],
  ellipsis: ["M5 12h.01", "M12 12h.01", "M19 12h.01"],
} as const;

const NAV_ITEMS = [
  { label: "Dashboard", icon: ICONS.dashboard },
  { label: "Fixed", icon: ICONS.receipt },
  { label: "History", icon: ICONS.clock },
  { label: "Trends", icon: ICONS.trendingUp },
  { label: "Goals", icon: ICONS.target },
  { label: "Paychecks", icon: ICONS.wallet },
  { label: "Debt", icon: ICONS.banknote },
  { label: "Net Worth", icon: ICONS.activity },
  { label: "Templates", icon: ICONS.calendar },
] as const;

const STATS = [
  { label: "EARN", value: "$1,740", delta: "↑ 1%", tone: "positive" },
  { label: "SPEND", value: "$781", delta: "↑ 13%", tone: "negative" },
  { label: "CASHFLOW", value: "+$564", delta: "↓ 11%", tone: "warning" },
] as const;

const DAYS = [
  { day: "SUN", date: "12", amount: "−$20", positive: false },
  { day: "MON", date: "13", amount: "+$60", positive: true },
  { day: "TUE", date: "14", amount: "+$260", positive: true },
  { day: "WED", date: "15", amount: "−$150", positive: false },
  { day: "THU", date: "16", amount: "+$35", positive: true },
  { day: "FRI", date: "17", amount: "+$245", positive: true },
  { day: "SAT", date: "18", amount: "+$150", positive: true },
] as const;

const SPENDING = [
  { name: "Gas", subtitle: "daily average spread", amount: "$19", gas: true },
  { name: "Gulf", subtitle: "8:19 AM", amount: "$20", gas: false },
  { name: "DoorDash", subtitle: "12:34 PM", amount: "$75", gas: false },
  { name: "McDonalds", subtitle: "6:42 PM", amount: "$8", gas: false },
] as const;

const EXEMPT = [
  { name: "Best Buy", amount: "+$2,818" },
  { name: "Transfer", amount: "$55" },
  { name: "Dunkin", amount: "$5" },
  { name: "McDonalds", amount: "$8" },
] as const;

const INTERACTIVE =
  "transition-[background-color,border-color,color] duration-150 ease-out hover:bg-[var(--dp-hover)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--dp-focus)]";
const TABULAR = "[font-variant-numeric:tabular-nums]";

function Icon({ d, size = 16 }: { d: string | readonly string[]; size?: number }) {
  const paths = typeof d === "string" ? [d] : d;

  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      width={size}
      height={size}
      className="shrink-0"
    >
      {paths.map((path, index) => (
        <path key={`${path}-${index}`} d={path} />
      ))}
    </svg>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="text-[11px] font-semibold uppercase text-[var(--dp-text3)]">
      {children}
    </div>
  );
}

function StatTile({
  label,
  value,
  delta,
  tone,
  className = "",
}: (typeof STATS)[number] & { className?: string }) {
  const toneClass =
    tone === "positive"
      ? "bg-[var(--dp-accentFill)] text-[var(--dp-accentText)]"
      : tone === "negative"
        ? "bg-[var(--dp-negativeFill)] text-[var(--dp-negative)]"
        : "bg-[var(--dp-warningFill)] text-[var(--dp-warning)]";

  return (
    <div className={`rounded-[12px] bg-[var(--dp-surface2)] p-4 ${className}`}>
      <SectionLabel>{label}</SectionLabel>
      <div className="mt-3 flex items-end justify-between gap-3">
        <div className={`text-[26px] font-[650] leading-none ${TABULAR}`}>{value}</div>
        <span className={`rounded-full px-2 py-1 text-[10px] font-semibold ${toneClass}`}>
          {delta}
        </span>
      </div>
    </div>
  );
}

function DayStrip({
  selected,
  onSelect,
  mobile = false,
}: {
  selected: number;
  onSelect: (index: number) => void;
  mobile?: boolean;
}) {
  return (
    <div
      className={
        mobile
          ? "flex snap-x gap-2 overflow-x-auto pb-2"
          : "grid grid-cols-7 gap-2"
      }
    >
      {DAYS.map((day, index) => {
        const isSelected = selected === index;
        return (
          <button
            key={`${day.day}-${day.date}`}
            type="button"
            aria-pressed={isSelected}
            onClick={() => onSelect(index)}
            className={`${INTERACTIVE} ${mobile ? "min-w-[78px] snap-start" : "min-w-0"} rounded-[6px] border px-2 py-3 text-left ${
              isSelected
                ? "border-[var(--dp-accentBorder)] bg-[var(--dp-accentFill)]"
                : "border-transparent bg-[var(--dp-surface2)]"
            }`}
          >
            <div className="text-[10px] font-semibold text-[var(--dp-text3)]">
              {day.day} {day.date}
            </div>
            <div
              className={`mt-1.5 truncate text-[14px] font-semibold ${TABULAR} ${
                day.positive ? "text-[var(--dp-accentText)]" : "text-[var(--dp-negative)]"
              }`}
            >
              {day.amount}
            </div>
          </button>
        );
      })}
    </div>
  );
}

function ShiftBar({ compact = false }: { compact?: boolean }) {
  return (
    <div
      className={`flex items-center gap-2 rounded-[6px] py-3 pr-3 ${compact ? "pl-2" : "pl-3"}`}
      style={{
        backgroundColor: "var(--dp-prestigeFill)",
        borderLeft: "2px solid var(--dp-prestige)",
      }}
    >
      <span className="text-[var(--dp-text4)]">
        <Icon d={ICONS.grip} size={14} />
      </span>
      <span className="h-2 w-2 shrink-0 rounded-full bg-[var(--dp-prestige)]" />
      <span className="font-semibold">Prestige</span>
      <span className="rounded-full bg-[var(--dp-surface1)] px-1.5 py-0.5 text-[10px] font-semibold text-[var(--dp-text2)]">
        REG
      </span>
      <span className={`text-[12px] text-[var(--dp-text2)] ${TABULAR}`}>2.0h</span>
      {!compact && <span className="ml-auto text-[12px] text-[var(--dp-text3)]">Mike</span>}
      <span className={`${compact ? "ml-auto" : "ml-2"} font-semibold ${TABULAR}`}>$29</span>
    </div>
  );
}

function SpendingList({ compact = false }: { compact?: boolean }) {
  return (
    <div className="space-y-2">
      {SPENDING.map((item) => (
        <div
          key={item.name}
          className="flex items-center gap-3 rounded-[6px] bg-[var(--dp-surface2)] px-3 py-2.5"
        >
          <div className="min-w-0 flex-1">
            <div
              className={`flex items-center gap-1.5 truncate text-[14px] font-semibold ${
                item.gas ? "text-[#38bdf8]" : "text-[var(--dp-text1)]"
              }`}
            >
              {item.gas && <Icon d={ICONS.fuel} size={13} />}
              {item.name}
            </div>
            <div className="mt-0.5 truncate text-[11px] text-[var(--dp-text3)]">
              {item.subtitle}
            </div>
          </div>
          <span
            className={`font-semibold ${TABULAR} ${
              item.gas ? "text-[#38bdf8]" : "text-[var(--dp-negative)]"
            } ${compact ? "text-[13px]" : "text-[14px]"}`}
          >
            {item.amount}
          </span>
        </div>
      ))}
    </div>
  );
}

function DashboardMock({
  selectedDay,
  onSelectDay,
  exemptOpen,
  onToggleExempt,
}: {
  selectedDay: number;
  onSelectDay: (index: number) => void;
  exemptOpen: boolean;
  onToggleExempt: () => void;
}) {
  return (
    <section aria-labelledby="desktop-preview-heading">
      <div className="mx-auto mb-3 max-w-[1200px]">
        <SectionLabel>Desktop dashboard</SectionLabel>
      </div>
      <div className="overflow-x-auto pb-2">
        <div className="mx-auto flex min-w-[1080px] max-w-[1200px] overflow-hidden rounded-[12px] border border-[var(--dp-hairline)] bg-[var(--dp-surface1)]">
          <aside className="flex w-56 shrink-0 flex-col border-r border-[var(--dp-hairline)] bg-[#0d0e10] p-4">
            <div className="px-2 py-2 text-[20px] font-bold text-[var(--dp-accentText)]">
              Bashflow
            </div>
            <nav aria-label="Preview navigation" className="mt-6 space-y-1">
              {NAV_ITEMS.map((item, index) => {
                const active = index === 0;
                return (
                  <button
                    key={item.label}
                    type="button"
                    aria-current={active ? "page" : undefined}
                    className={`${INTERACTIVE} flex w-full items-center gap-3 rounded-[6px] px-3 py-2 text-left text-[13px] font-medium ${
                      active
                        ? "bg-[var(--dp-accentFill)] text-[var(--dp-accentText)]"
                        : "text-[var(--dp-text2)]"
                    }`}
                  >
                    <Icon d={item.icon} size={16} />
                    {item.label}
                  </button>
                );
              })}
            </nav>
            <div className="mt-auto border-t border-[var(--dp-hairline)] px-2 pt-4">
              <div className="truncate text-[11px] text-[var(--dp-text3)]">
                jay1park1@gmail.com
              </div>
              <button
                type="button"
                className={`${INTERACTIVE} mt-2 flex w-full items-center justify-between rounded-[6px] px-2 py-2 text-left text-[12px] text-[var(--dp-text2)]`}
              >
                Sign out <span aria-hidden="true">→</span>
              </button>
            </div>
          </aside>

          <div className="min-w-0 flex-1">
            <div className="px-7 pb-7 pt-6">
              <header className="flex items-end justify-between gap-8">
                <div>
                  <h2 id="desktop-preview-heading" className="text-[22px] font-[650] leading-tight">
                    Week 28
                  </h2>
                  <div className="mt-1 text-[13px] text-[var(--dp-text3)]">
                    Jul 12 – Jul 18, 2026
                  </div>
                </div>
                <div className="text-right">
                  <SectionLabel>Running balance</SectionLabel>
                  <div className={`mt-1 text-[28px] font-[650] leading-none ${TABULAR}`}>
                    $17,337
                  </div>
                </div>
              </header>

              <div className="mt-7 grid grid-cols-3 gap-3">
                {STATS.map((stat) => (
                  <StatTile key={stat.label} {...stat} />
                ))}
              </div>

              <div className="mt-6">
                <div className="flex items-center justify-between gap-4">
                  <SectionLabel>Weekly target</SectionLabel>
                  <span className={`text-[12px] font-semibold text-[var(--dp-text2)] ${TABULAR}`}>
                    $564 / $900
                  </span>
                </div>
                <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-[var(--dp-surface2)]">
                  <div
                    className="h-full rounded-full bg-gradient-to-r from-[var(--dp-accent)] to-[var(--dp-accentText)]"
                    style={{ width: "62.7%" }}
                  />
                </div>
                <div className={`mt-2 text-[12px] text-[var(--dp-text3)] ${TABULAR}`}>
                  $336 to go
                </div>
              </div>

              <div className="mt-6">
                <DayStrip selected={selectedDay} onSelect={onSelectDay} />
              </div>

              <div className="mt-6 grid grid-cols-[minmax(0,2fr)_minmax(0,3fr)] gap-4">
                <section>
                  <div className="mb-2 flex items-center justify-between">
                    <SectionLabel>Wednesday</SectionLabel>
                    <span className="text-[10px] font-semibold text-[var(--dp-text3)]">1 SHIFT</span>
                  </div>
                  <ShiftBar />
                  <button
                    type="button"
                    className={`${INTERACTIVE} mt-2 flex w-full items-center justify-center gap-2 rounded-[6px] border border-dashed border-[var(--dp-hairlineStrong)] px-3 py-3 text-[12px] text-[var(--dp-text3)]`}
                  >
                    <Icon d={ICONS.plus} size={14} /> Add shift
                  </button>

                  <div className="mt-3 rounded-[12px] bg-[var(--dp-surface2)] p-4 text-[13px]">
                    <div className="space-y-2 text-[var(--dp-text2)]">
                      <div className="flex justify-between"><span>Earn</span><span className={TABULAR}>$29</span></div>
                      <div className="flex justify-between"><span>Spend</span><span className={TABULAR}>$122</span></div>
                      <div className="flex justify-between"><span>Fixed</span><span className={TABULAR}>$56</span></div>
                    </div>
                    <div className="my-3 h-px bg-[var(--dp-hairline)]" />
                    <div className="flex justify-between font-semibold text-[var(--dp-negative)]">
                      <span>Cashflow</span><span className={TABULAR}>−$150</span>
                    </div>
                  </div>
                </section>

                <div className="grid grid-cols-2 gap-3">
                  <section>
                    <div className="mb-2 flex items-center justify-between">
                      <SectionLabel>Spending</SectionLabel>
                      <span className="text-[10px] font-semibold text-[var(--dp-text3)]">4</span>
                    </div>
                    <SpendingList />
                    <button
                      type="button"
                      className={`${INTERACTIVE} mt-2 flex w-full items-center justify-center gap-2 rounded-[6px] border border-dashed border-[var(--dp-hairlineStrong)] px-3 py-3 text-[12px] text-[var(--dp-text3)]`}
                    >
                      <Icon d={ICONS.plus} size={14} /> Add transaction
                    </button>
                  </section>

                  <section>
                    <button
                      type="button"
                      aria-expanded={exemptOpen}
                      onClick={onToggleExempt}
                      className={`${INTERACTIVE} flex w-full items-center justify-between rounded-[6px] px-1 py-1 text-left`}
                    >
                      <span className="flex items-center gap-2">
                        <SectionLabel>Exempt</SectionLabel>
                        <span className="text-[10px] font-semibold text-[var(--dp-text3)]">4</span>
                      </span>
                      <span className={`text-[var(--dp-text3)] transition-transform duration-150 ${exemptOpen ? "rotate-180" : ""}`}>
                        <Icon d={ICONS.chevronDown} size={14} />
                      </span>
                    </button>
                    {exemptOpen && (
                      <div className="mt-2 space-y-2">
                        {EXEMPT.map((item) => (
                          <div
                            key={item.name}
                            className="flex items-center justify-between rounded-[6px] bg-[var(--dp-surface2)] px-3 py-3 text-[13px] text-[var(--dp-text3)] line-through"
                          >
                            <span>{item.name}</span>
                            <span className={TABULAR}>{item.amount}</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </section>
                </div>
              </div>
            </div>

            <footer className="flex items-center gap-5 border-t border-[var(--dp-hairline)] px-7 py-4 text-[11px]">
              <div className="flex min-w-0 flex-1 items-center gap-3 text-[var(--dp-text3)]">
                <span className="flex items-center gap-1"><span className="h-1.5 w-1.5 rounded-full bg-[var(--dp-prestige)]" />PRESTIGE <b className="text-[var(--dp-text1)]">56h</b></span>
                <span className="flex items-center gap-1"><span className="h-1.5 w-1.5 rounded-full bg-[var(--dp-ccf)]" />CCF <b className="text-[var(--dp-text1)]">17h</b></span>
                <span className="flex items-center gap-1"><span className="h-1.5 w-1.5 rounded-full bg-[var(--dp-larc)]" />LARC <b className="text-[var(--dp-text1)]">29h</b></span>
                <span>TOTAL <b className="text-[var(--dp-text1)]">102h</b></span>
              </div>
              <div className={`whitespace-nowrap text-[var(--dp-text2)] ${TABULAR}`}>
                $955 / $249 / $479 · <b className="text-[var(--dp-text1)]">TOTAL $1,683</b>
              </div>
              <button
                type="button"
                className={`${INTERACTIVE} rounded-[8px] bg-[var(--dp-accent)] px-4 py-2.5 font-semibold text-[#08090b]`}
              >
                Close week
              </button>
            </footer>
          </div>
        </div>
      </div>
    </section>
  );
}

function MobileMock({
  selectedDay,
  onSelectDay,
  activeTab,
  onSelectTab,
}: {
  selectedDay: number;
  onSelectDay: (index: number) => void;
  activeTab: string;
  onSelectTab: (tab: string) => void;
}) {
  const tabs = [
    { label: "Home", icon: ICONS.home, action: false },
    { label: "Trends", icon: ICONS.trendingUp, action: false },
    { label: "Add", icon: ICONS.plus, action: true },
    { label: "Debt", icon: ICONS.banknote, action: false },
    { label: "More", icon: ICONS.ellipsis, action: false },
  ] as const;

  return (
    <section aria-labelledby="mobile-preview-heading" className="mt-14">
      <div className="mx-auto mb-3 w-[390px] max-w-full">
        <SectionLabel>Mobile dashboard</SectionLabel>
      </div>
      <div className="mx-auto flex h-[780px] w-[390px] max-w-full flex-col overflow-hidden rounded-[28px] border border-[var(--dp-hairlineStrong)] bg-[var(--dp-canvas)]">
        <div className="min-h-0 flex-1 overflow-y-auto">
          <header className="flex items-end justify-between px-5 pb-4 pt-6">
            <div>
              <h2 id="mobile-preview-heading" className="text-[21px] font-[650]">Week 28</h2>
              <div className="mt-1 text-[11px] text-[var(--dp-text3)]">Wed, Jul 15</div>
            </div>
            <div className="text-right">
              <div className="text-[10px] font-semibold uppercase text-[var(--dp-text3)]">Running balance</div>
              <div className={`mt-1 text-[22px] font-[650] ${TABULAR}`}>$17,337</div>
            </div>
          </header>

          <div className="flex snap-x gap-3 overflow-x-auto px-5 pb-2">
            {STATS.map((stat) => (
              <StatTile key={stat.label} {...stat} className="min-w-[168px] snap-start" />
            ))}
          </div>

          <div className="mt-4 px-5">
            <DayStrip selected={selectedDay} onSelect={onSelectDay} mobile />
          </div>

          <div className="mt-5 px-5">
            <div className="mb-2 flex items-center justify-between">
              <SectionLabel>Wednesday</SectionLabel>
              <span className="text-[10px] font-semibold text-[var(--dp-text3)]">1 SHIFT</span>
            </div>
            <ShiftBar compact />
          </div>

          <div className="mt-5 px-5 pb-5">
            <div className="mb-2 flex items-center justify-between">
              <SectionLabel>Spending</SectionLabel>
              <span className="text-[10px] font-semibold text-[var(--dp-text3)]">4</span>
            </div>
            <SpendingList compact />
          </div>
        </div>

        <nav className="relative z-10 grid grid-cols-5 border-t border-[var(--dp-hairline)] bg-[var(--dp-surface1)] px-2 pb-3 pt-2" aria-label="Preview mobile tabs">
          {tabs.map((tab) => {
            const active = activeTab === tab.label;
            return (
              <button
                key={tab.label}
                type="button"
                aria-pressed={active}
                aria-label={tab.label}
                title={tab.action ? "Add" : undefined}
                onClick={() => onSelectTab(tab.label)}
                className={`${INTERACTIVE} flex min-h-[52px] flex-col items-center justify-end gap-1 rounded-[8px] text-[10px] ${
                  active ? "text-[var(--dp-accentText)]" : "text-[var(--dp-text3)]"
                }`}
              >
                <span
                  className={
                    tab.action
                      ? "-mt-5 flex h-11 w-11 items-center justify-center rounded-full bg-[var(--dp-accent)] text-[#08090b]"
                      : "flex h-6 items-center justify-center"
                  }
                >
                  <Icon d={tab.icon} size={tab.action ? 22 : 18} />
                </span>
                {tab.label}
              </button>
            );
          })}
        </nav>
      </div>
    </section>
  );
}

function KitItem({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex min-h-[118px] min-w-0 flex-col justify-between rounded-[12px] bg-[var(--dp-surface2)] p-3">
      <div className="flex min-h-14 items-center justify-center">{children}</div>
      <div className="mt-3 text-center text-[10px] text-[var(--dp-text3)]">{label}</div>
    </div>
  );
}

function ComponentKit() {
  return (
    <section aria-labelledby="kit-heading" className="mx-auto mt-14 max-w-[1200px] pb-16">
      <div className="mb-3">
        <SectionLabel>The kit</SectionLabel>
      </div>
      <h2 id="kit-heading" className="sr-only">Component kit</h2>
      <div className="grid grid-cols-2 gap-2 rounded-[12px] border border-[var(--dp-hairline)] bg-[var(--dp-surface1)] p-2 sm:grid-cols-3 lg:grid-cols-7">
        <KitItem label="Primary button">
          <button type="button" className={`${INTERACTIVE} rounded-[8px] bg-[var(--dp-accent)] px-4 py-2.5 font-semibold text-[#08090b]`}>
            Continue
          </button>
        </KitItem>
        <KitItem label="Ghost button">
          <button type="button" className={`${INTERACTIVE} rounded-[8px] px-4 py-2.5 font-semibold text-[var(--dp-text2)]`}>
            Cancel
          </button>
        </KitItem>
        <KitItem label="Destructive">
          <button type="button" className={`${INTERACTIVE} rounded-[8px] bg-[var(--dp-negativeFill)] px-4 py-2.5 font-semibold text-[var(--dp-negative)]`}>
            Delete
          </button>
        </KitItem>
        <KitItem label="Focused input">
          <input
            aria-label="Preview amount"
            readOnly
            value="$900"
            className={`${INTERACTIVE} w-full rounded-[8px] bg-[var(--dp-surface1)] px-3 py-2.5 text-[13px] text-[var(--dp-text1)] outline-2 outline-[var(--dp-focus)] ${TABULAR}`}
          />
        </KitItem>
        <KitItem label="Badges">
          <div className="flex flex-wrap justify-center gap-1.5 text-[9px] font-semibold">
            <span className="rounded-[6px] bg-[var(--dp-surface1)] px-2 py-1 text-[var(--dp-text2)]">REG</span>
            <span className="rounded-[6px] bg-[var(--dp-warningFill)] px-2 py-1 text-[var(--dp-warning)]">OT</span>
            <span className="rounded-[6px] bg-[var(--dp-accentFill)] px-2 py-1 text-[var(--dp-accentText)]">SPLIT</span>
            <span className="rounded-[6px] bg-[rgba(56,189,248,0.12)] px-2 py-1 text-[#38bdf8]">GAS</span>
          </div>
        </KitItem>
        <KitItem label="Toggle on">
          <button
            type="button"
            role="switch"
            aria-checked="true"
            aria-label="Preview toggle"
            className={`${INTERACTIVE} flex h-6 w-11 items-center justify-end rounded-full bg-[var(--dp-accent)] p-1`}
          >
            <span className="h-4 w-4 rounded-full bg-[#08090b]" />
          </button>
        </KitItem>
        <KitItem label="Stat tile">
          <div className="w-full rounded-[12px] bg-[var(--dp-surface1)] p-3">
            <div className="text-[9px] font-semibold uppercase text-[var(--dp-text3)]">Cashflow</div>
            <div className={`mt-2 text-[20px] font-[650] text-[var(--dp-accentText)] ${TABULAR}`}>+$564</div>
          </div>
        </KitItem>
      </div>
    </section>
  );
}

export function DesignPreview() {
  const [accentName, setAccentName] = useState<AccentName>("Emerald");
  const [selectedDay, setSelectedDay] = useState(3);
  const [exemptOpen, setExemptOpen] = useState(false);
  const [activeTab, setActiveTab] = useState("Home");
  const accent = ACCENTS[accentName];

  const previewStyle: PreviewStyle = {
    "--dp-canvas": "#0a0b0d",
    "--dp-surface1": "#131417",
    "--dp-surface2": "#191a1e",
    "--dp-hover": "#1e2024",
    "--dp-hairline": "rgba(255,255,255,0.07)",
    "--dp-hairlineStrong": "rgba(255,255,255,0.13)",
    "--dp-text1": "#f6f7f9",
    "--dp-text2": "rgba(246,247,249,0.68)",
    "--dp-text3": "rgba(246,247,249,0.48)",
    "--dp-text4": "rgba(246,247,249,0.32)",
    "--dp-accent": accent.accent,
    "--dp-accentText": accent.text,
    "--dp-accentFill": accent.fill,
    "--dp-accentBorder": accent.border,
    "--dp-focus": `color-mix(in srgb, ${accent.accent} 40%, transparent)`,
    "--dp-negative": "#fb7185",
    "--dp-negativeFill": "rgba(251,113,133,0.12)",
    "--dp-warning": "#fbbf24",
    "--dp-warningFill": "rgba(251,191,36,0.12)",
    "--dp-prestige": "#fbbf24",
    "--dp-prestigeFill": "rgba(251,191,36,0.10)",
    "--dp-ccf": "#2dd4bf",
    "--dp-ccfFill": "rgba(45,212,191,0.10)",
    "--dp-larc": "#fb7185",
    "--dp-larcFill": "rgba(251,113,133,0.10)",
    "--dp-panelRadius": "12px",
    "--dp-controlRadius": "8px",
    "--dp-chipRadius": "6px",
    "--dp-font": '-apple-system, "SF Pro Display", "Segoe UI Variable", "Segoe UI", Inter, sans-serif',
    fontFamily: "var(--dp-font)",
    letterSpacing: 0,
  };

  return (
    <div
      style={previewStyle}
      className="fixed inset-0 z-[100] min-h-screen overflow-y-auto bg-[var(--dp-canvas)] text-[14px] text-[var(--dp-text1)]"
    >
      <div className="sticky top-0 z-30 border-b border-[var(--dp-hairline)] bg-[var(--dp-surface1)]">
        <div className="mx-auto flex max-w-[1320px] flex-wrap items-center justify-between gap-3 px-4 py-3 sm:px-6">
          <div className="flex flex-wrap items-center gap-3">
            <SectionLabel>Bashflow — Redesign Preview</SectionLabel>
            <span className="rounded-[6px] bg-[var(--dp-warningFill)] px-2 py-1 text-[10px] font-semibold text-[var(--dp-warning)]">
              MOCK / no live data
            </span>
          </div>
          <div className="flex items-center gap-1 rounded-[8px] bg-[var(--dp-canvas)] p-1">
            {(Object.keys(ACCENTS) as AccentName[]).map((name) => {
              const active = accentName === name;
              return (
                <button
                  key={name}
                  type="button"
                  aria-pressed={active}
                  onClick={() => setAccentName(name)}
                  className={`${INTERACTIVE} rounded-[6px] border px-3 py-2 text-[11px] font-semibold ${
                    active
                      ? "border-[var(--dp-accentBorder)] bg-[var(--dp-accentFill)] text-[var(--dp-accentText)]"
                      : "border-transparent text-[var(--dp-text2)]"
                  }`}
                >
                  {name}
                </button>
              );
            })}
          </div>
        </div>
      </div>

      <main className="px-4 py-10 sm:px-6 lg:px-8">
        <DashboardMock
          selectedDay={selectedDay}
          onSelectDay={setSelectedDay}
          exemptOpen={exemptOpen}
          onToggleExempt={() => setExemptOpen((open) => !open)}
        />
        <MobileMock
          selectedDay={selectedDay}
          onSelectDay={setSelectedDay}
          activeTab={activeTab}
          onSelectTab={setActiveTab}
        />
        <ComponentKit />
      </main>
    </div>
  );
}
