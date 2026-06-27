"use client";

import {
  closestCenter,
  DndContext,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { useEffect, useMemo, useState } from "react";

import { centsToDollars } from "@/lib/domain/money";
import type { HistoryWeek, ProjectionExclusionField } from "@/lib/history/types";

const STORAGE_KEY = "shiftlycash-history-summary-v1";

const TILE_DEFINITIONS = [
  { id: "totalEarnings", label: "Total earnings", field: "earnings" },
  { id: "totalSpend", label: "Total spend", field: "spend" },
  { id: "avgEarnings", label: "Avg earnings", field: "earnings" },
  { id: "avgSpend", label: "Avg spend", field: "spend" },
  { id: "avgCashflow", label: "Avg cashflow", field: "cashflow" },
  { id: "medianEarnings", label: "Median earnings", field: "earnings" },
  { id: "medianSpend", label: "Median spend", field: "spend" },
  { id: "medianCashflow", label: "Median cashflow", field: "cashflow" },
] as const satisfies readonly {
  id: string;
  label: string;
  field: ProjectionExclusionField;
}[];

type TileId = (typeof TILE_DEFINITIONS)[number]["id"];

type SummaryTile = {
  id: TileId;
  label: string;
  value: number | null;
  displayValue: string;
  isMoney: boolean;
};

type WeekWindow = number | "all";

type SavedPreferences = {
  order: string[];
  hidden: string[];
  weekWindow?: WeekWindow;
};

const TILE_IDS = TILE_DEFINITIONS.map((tile) => tile.id);
const WEEK_WINDOW_OPTIONS = [4, 6, 8, 12, 26] as const;

export function HistorySummary({ weeks }: { weeks: HistoryWeek[] }) {
  const closedWeeks = useMemo(
    () => weeks.filter((week) => week.status === "closed"),
    [weeks],
  );
  const [isCustomizing, setIsCustomizing] = useState(false);
  // Limit the totals/averages/medians to the most recent N closed weeks. The
  // weeks arrive newest-first, so slice from the front.
  const [weekWindow, setWeekWindow] = useState<WeekWindow>("all");
  const windowedWeeks = useMemo(
    () =>
      weekWindow === "all" ? closedWeeks : closedWeeks.slice(0, weekWindow),
    [closedWeeks, weekWindow],
  );
  const tiles = useMemo(() => buildTiles(windowedWeeks), [windowedWeeks]);
  const defaultOrder = useMemo(() => buildDefaultOrder(tiles), [tiles]);
  const [order, setOrder] = useState<TileId[]>(defaultOrder);
  const [hidden, setHidden] = useState<Set<TileId>>(() => new Set());
  const [hasHydrated, setHasHydrated] = useState(false);

  useEffect(() => {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    const preferences = readSavedPreferences(raw, defaultOrder);

    window.setTimeout(() => {
      setOrder(preferences.order);
      setHidden(preferences.hidden);
      setWeekWindow(preferences.weekWindow);
      setHasHydrated(true);
    }, 0);
    // Hydrate saved prefs ONCE on mount. The old [defaultOrder] dependency
    // re-fired this effect on every week-window change (defaultOrder is sorted
    // by value, so it changes with the data), re-applying saved prefs mid-edit
    // and making the numbers twitch/jump.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!hasHydrated) {
      return;
    }

    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ order, hidden: Array.from(hidden), weekWindow }),
    );
  }, [hasHydrated, hidden, order, weekWindow]);

  const normalizedOrder = normalizeOrder(order);
  const orderedTiles = normalizedOrder
    .map((id) => tiles.find((tile) => tile.id === id))
    .filter((tile): tile is SummaryTile => Boolean(tile));
  const visibleTiles = orderedTiles.filter((tile) => !hidden.has(tile.id));

  return (
    <section className="mx-auto mb-5 max-w-7xl rounded-md border border-[var(--border-subtle)] bg-[var(--surface-elevated)] p-4 shadow-sm backdrop-blur-md">
      {weeks.length === 0 ? (
        <div className="rounded-md border border-[var(--border-subtle)] bg-[var(--surface-overlay)] p-4 backdrop-blur-sm">
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-[var(--text-tertiary)]">
            No history yet
          </p>
          <p className="mt-2 text-sm text-[var(--text-secondary)]">
            Close your first week from the dashboard to start filling in metrics.
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.14em] text-[var(--text-tertiary)]">
                History summary
              </p>
              <p className="mt-1 text-sm text-[var(--text-secondary)]">
                Totals, averages, and medians across{" "}
                {weekWindow === "all"
                  ? "all closed weeks"
                  : `the last ${windowedWeeks.length} closed week${windowedWeeks.length === 1 ? "" : "s"}`}
                .
              </p>
            </div>
            <div className="flex items-center gap-2">
              <select
                aria-label="Weeks to summarize"
                className="rounded-md border border-[var(--border-default)] bg-[var(--surface-overlay)] px-2.5 py-2 text-sm font-semibold text-[var(--text-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--accent-ring)]"
                onChange={(event) =>
                  setWeekWindow(
                    event.target.value === "all"
                      ? "all"
                      : Number(event.target.value),
                  )
                }
                value={String(weekWindow)}
              >
                <option value="all">All weeks</option>
                {WEEK_WINDOW_OPTIONS.filter((n) => n < closedWeeks.length).map(
                  (n) => (
                    <option key={n} value={n}>
                      Last {n} weeks
                    </option>
                  ),
                )}
              </select>
              <button
                className="rounded-md border border-[var(--border-default)] bg-[var(--surface-hover)] px-3 py-2 text-sm font-semibold text-[var(--text-primary)] transition hover:bg-[var(--surface-hover)] focus:outline-none focus:ring-2 focus:ring-[var(--accent-ring)]"
                onClick={() => setIsCustomizing((current) => !current)}
                type="button"
              >
                Customize
              </button>
            </div>
          </div>

          {isCustomizing ? (
            <CustomizePanel
              hidden={hidden}
              onClose={() => setIsCustomizing(false)}
              onHiddenChange={setHidden}
              onOrderChange={setOrder}
              order={normalizedOrder}
              tiles={tiles}
            />
          ) : null}

          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
            {visibleTiles.map((tile) => (
              <SummaryTileCard key={tile.id} tile={tile} />
            ))}
          </div>
        </div>
      )}
    </section>
  );
}

function readSavedPreferences(
  raw: string | null,
  defaultOrder: TileId[],
): { order: TileId[]; hidden: Set<TileId>; weekWindow: WeekWindow } {
  if (!raw) {
    return { order: defaultOrder, hidden: new Set(), weekWindow: "all" };
  }

  try {
    const parsed = JSON.parse(raw) as SavedPreferences;
    const weekWindow: WeekWindow =
      typeof parsed.weekWindow === "number" && parsed.weekWindow > 0
        ? parsed.weekWindow
        : "all";

    return {
      order: normalizeOrder(parsed.order),
      hidden: new Set(
        parsed.hidden.filter((id): id is TileId => isTileId(id)),
      ),
      weekWindow,
    };
  } catch {
    return { order: defaultOrder, hidden: new Set(), weekWindow: "all" };
  }
}

function CustomizePanel({
  hidden,
  order,
  tiles,
  onClose,
  onHiddenChange,
  onOrderChange,
}: {
  hidden: Set<TileId>;
  order: TileId[];
  tiles: SummaryTile[];
  onClose: () => void;
  onHiddenChange: (nextHidden: Set<TileId>) => void;
  onOrderChange: (nextOrder: TileId[]) => void;
}) {
  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: 6 },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  );
  const orderedTiles = order
    .map((id) => tiles.find((tile) => tile.id === id))
    .filter((tile): tile is SummaryTile => Boolean(tile));

  function reorderTiles(event: DragEndEvent) {
    if (!event.over || event.active.id === event.over.id) {
      return;
    }

    const oldIndex = order.findIndex((id) => id === event.active.id);
    const newIndex = order.findIndex((id) => id === event.over?.id);
    if (oldIndex === -1 || newIndex === -1) {
      return;
    }

    onOrderChange(arrayMove(order, oldIndex, newIndex));
  }

  function toggleTile(tileId: TileId) {
    const nextHidden = new Set(hidden);
    if (nextHidden.has(tileId)) {
      nextHidden.delete(tileId);
    } else {
      nextHidden.add(tileId);
    }

    onHiddenChange(nextHidden);
  }

  return (
    <div className="rounded-md border border-[var(--border-subtle)] bg-[var(--surface-overlay)] p-3 backdrop-blur-md">
      <DndContext
        collisionDetection={closestCenter}
        onDragEnd={reorderTiles}
        sensors={sensors}
      >
        <SortableContext items={order} strategy={verticalListSortingStrategy}>
          <div className="space-y-2">
            {orderedTiles.map((tile) => (
              <SortableCustomizeRow
                hidden={hidden.has(tile.id)}
                key={tile.id}
                onToggle={() => toggleTile(tile.id)}
                tile={tile}
              />
            ))}
          </div>
        </SortableContext>
      </DndContext>
      <div className="mt-3 flex justify-end">
        <button
          className="rounded-md bg-[var(--accent-brand)] px-3 py-2 text-sm font-semibold text-white transition hover:bg-[var(--accent-brand-hover)] focus:outline-none focus:ring-2 focus:ring-[var(--accent-ring)]"
          onClick={onClose}
          type="button"
        >
          Done
        </button>
      </div>
    </div>
  );
}

function SortableCustomizeRow({
  hidden,
  tile,
  onToggle,
}: {
  hidden: boolean;
  tile: SummaryTile;
  onToggle: () => void;
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: tile.id });
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  return (
    <div
      className={
        isDragging
          ? "flex items-center gap-3 rounded-md border border-[var(--border-default)] bg-[var(--surface-hover)] p-2 opacity-80 shadow-sm"
          : "flex items-center gap-3 rounded-md border border-[var(--border-subtle)] bg-[var(--surface-hover)] p-2 shadow-sm"
      }
      ref={setNodeRef}
      style={style}
    >
      <button
        aria-label={`Drag ${tile.label}`}
        className="h-8 w-8 touch-none rounded-md border border-[var(--border-default)] bg-[var(--surface-hover)] text-sm font-bold text-[var(--text-primary)] transition hover:border-[var(--border-strong)] hover:text-[var(--text-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--accent-ring)]"
        title="Drag to reorder"
        type="button"
        {...attributes}
        {...listeners}
      >
        ::
      </button>
      <label className="flex min-w-0 flex-1 items-center gap-3 text-sm font-semibold text-[var(--text-primary)]">
        <input
          checked={!hidden}
          className="h-4 w-4 accent-[var(--accent-brand)]"
          onChange={onToggle}
          type="checkbox"
        />
        <span className="truncate">{tile.label}</span>
      </label>
      <span className="text-sm font-bold tabular-nums text-[var(--text-primary)]">
        {tile.displayValue}
      </span>
    </div>
  );
}

function SummaryTileCard({ tile }: { tile: SummaryTile }) {
  return (
    <div className="rounded-md border-2 border-[var(--border-default)] bg-[var(--surface-overlay)] p-4 shadow-sm backdrop-blur-md">
      <p className="text-xs font-bold uppercase tracking-[0.14em] text-[var(--text-secondary)]">
        {tile.label}
      </p>
      <p className="mt-3 rounded-md bg-[var(--surface-overlay)] px-2 py-1 text-3xl font-black leading-none tracking-tight tabular-nums text-[var(--text-primary)] shadow-sm ring-1 ring-[var(--border-subtle)] sm:text-4xl">
        {tile.displayValue}
      </p>
    </div>
  );
}

function buildTiles(closedWeeks: HistoryWeek[]): SummaryTile[] {
  return [
    {
      id: "totalEarnings",
      label: "Total earnings",
      value: sumIncluded(closedWeeks, "earnings"),
      displayValue: formatMoney(sumIncluded(closedWeeks, "earnings")),
      isMoney: true,
    },
    {
      id: "totalSpend",
      label: "Total spend",
      value: sumIncluded(closedWeeks, "spend"),
      displayValue: formatMoney(sumIncluded(closedWeeks, "spend")),
      isMoney: true,
    },
    {
      id: "avgEarnings",
      label: "Avg earnings",
      value: averageIncluded(closedWeeks, "earnings"),
      displayValue: formatNullableMoney(averageIncluded(closedWeeks, "earnings")),
      isMoney: true,
    },
    {
      id: "avgSpend",
      label: "Avg spend",
      value: averageIncluded(closedWeeks, "spend"),
      displayValue: formatNullableMoney(averageIncluded(closedWeeks, "spend")),
      isMoney: true,
    },
    {
      id: "avgCashflow",
      label: "Avg cashflow",
      value: averageIncluded(closedWeeks, "cashflow"),
      displayValue: formatNullableMoney(averageIncluded(closedWeeks, "cashflow")),
      isMoney: true,
    },
    {
      id: "medianEarnings",
      label: "Median earnings",
      value: medianIncluded(closedWeeks, "earnings"),
      displayValue: formatNullableMoney(medianIncluded(closedWeeks, "earnings")),
      isMoney: true,
    },
    {
      id: "medianSpend",
      label: "Median spend",
      value: medianIncluded(closedWeeks, "spend"),
      displayValue: formatNullableMoney(medianIncluded(closedWeeks, "spend")),
      isMoney: true,
    },
    {
      id: "medianCashflow",
      label: "Median cashflow",
      value: medianIncluded(closedWeeks, "cashflow"),
      displayValue: formatNullableMoney(medianIncluded(closedWeeks, "cashflow")),
      isMoney: true,
    },
  ];
}

function buildDefaultOrder(tiles: SummaryTile[]): TileId[] {
  return [...tiles].sort((a, b) => {
    if (a.value === null && b.value === null) {
      return a.id.localeCompare(b.id);
    }

    if (a.value === null) {
      return 1;
    }

    if (b.value === null) {
      return -1;
    }

    return b.value - a.value;
  }).map((tile) => tile.id);
}

function normalizeOrder(input: string[]): TileId[] {
  const knownIds = input.filter((id): id is TileId => isTileId(id));
  const missingIds = TILE_IDS.filter((id) => !knownIds.includes(id));

  return [...knownIds, ...missingIds];
}

function isTileId(value: string): value is TileId {
  return TILE_IDS.includes(value as TileId);
}

function sumIncluded(
  weeks: HistoryWeek[],
  field: ProjectionExclusionField,
): number {
  return weeks.reduce((total, week) => {
    if (week.exclusions[field]) {
      return total;
    }

    return total + valueForField(week, field);
  }, 0);
}

function averageIncluded(
  weeks: HistoryWeek[],
  field: ProjectionExclusionField,
): number | null {
  const includedWeeks = weeks.filter((week) => !week.exclusions[field]);
  if (includedWeeks.length === 0) {
    return null;
  }

  return Math.round(sumIncluded(includedWeeks, field) / includedWeeks.length);
}

function medianIncluded(
  weeks: HistoryWeek[],
  field: ProjectionExclusionField,
): number | null {
  const values = weeks
    .filter((week) => !week.exclusions[field])
    .map((week) => valueForField(week, field))
    .sort((a, b) => a - b);
  if (values.length === 0) {
    return null;
  }

  const middle = Math.floor(values.length / 2);
  if (values.length % 2 === 1) {
    return values[middle];
  }

  return Math.round((values[middle - 1] + values[middle]) / 2);
}

function valueForField(
  week: HistoryWeek,
  field: ProjectionExclusionField,
): number {
  if (field === "earnings") {
    return week.earningsCents;
  }

  if (field === "spend") {
    return week.spendCents;
  }

  return week.cashflowCents;
}

function formatNullableMoney(value: number | null): string {
  return value === null ? "—" : formatMoney(value);
}

function formatMoney(value: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(Math.round(centsToDollars(value)));
}
