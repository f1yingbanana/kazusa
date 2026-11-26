"use client";

import type { UsageResponse } from "@kazusa/client";
import { useVirtualizer } from "@tanstack/react-virtual";
import { useMemo, useRef, useState } from "react";
import { useUsage } from "@/hooks/use-brain";
import { useCharacters } from "@/hooks/use-characters";
import { useSelection } from "@/hooks/use-selection";
import { formatCost, formatTokens } from "@/lib/format";
import { useSources } from "@/lib/source/provider";
import { Button } from "@/ui/button";
import { cx } from "@/ui/cx";
import { Note } from "@/ui/note";
import { Segmented, SegmentedItem } from "@/ui/segmented";
import {
  Callout,
  SettingsGroup,
  SettingsPage,
  SettingsRow,
  SettingsRowButton,
  SettingsSection,
} from "@/ui/settings";
import { Tooltip } from "@/ui/tooltip";
import { Unavailable } from "./unavailable";

const RANGES = [
  { days: "1", label: "Today" },
  { days: "7", label: "7d" },
  { days: "30", label: "30d" },
  { days: "90", label: "90d" },
  { days: "3650", label: "All" },
] as const;

const ROW_HEIGHT = 60;

function StatTile({
  label,
  value,
  note,
}: {
  label: string;
  value: string;
  note?: string;
}) {
  return (
    <div className="flex min-w-0 flex-col gap-0.5 rounded-[1rem] bg-ui-ground px-3.5 py-3 inset-ring inset-ring-ui-line">
      <span className="text-xs font-semibold text-ui-soft">{label}</span>
      <span className="font-[ui-monospace,monospace] text-xl font-extrabold text-ui-ink tabular-nums">
        {value}
      </span>
      {note ? (
        <span className="truncate text-xs text-ui-soft">{note}</span>
      ) : null}
    </div>
  );
}

function DailyChart({ daily }: { daily: UsageResponse["daily"] }) {
  const peak = Math.max(...daily.map((day) => day.tokens), 1);
  return (
    <>
      <div
        aria-hidden
        className="flex h-28 items-end gap-0.5 border-b border-ui-line pt-2"
      >
        {daily.map((day) => (
          <Tooltip
            key={day.date}
            label={`${day.date}: ${formatTokens(day.tokens)} tokens · ${formatCost(day.cost)}`}
          >
            <div className="group flex h-full max-w-8 min-w-0 flex-1 items-end">
              <div
                className="min-h-px w-full rounded-t-[3px] bg-ui-primary/75 transition-colors group-hover:bg-ui-primary"
                style={{ height: `${(day.tokens / peak) * 100}%` }}
              />
            </div>
          </Tooltip>
        ))}
      </div>
      <table className="sr-only">
        <caption>Tokens per day</caption>
        <tbody>
          {daily.map((day) => (
            <tr key={day.date}>
              <th scope="row">{day.date}</th>
              <td>{day.tokens}</td>
              <td>{formatCost(day.cost)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}

function ByCharacter({ report }: { report: UsageResponse }) {
  const { byId } = useCharacters();
  const [selection, select] = useSelection();
  const scrollRef = useRef<HTMLDivElement>(null);
  const rows = useMemo(
    () =>
      [...report.byAgent].sort(
        (a, b) => b.totals.totalTokens - a.totals.totalTokens,
      ),
    [report.byAgent],
  );
  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 8,
  });
  const peak = rows[0]?.totals.totalTokens || 1;

  if (rows.length === 0) {
    return <Note>No character has used any tokens in this range.</Note>;
  }

  return (
    <div
      ref={scrollRef}
      className="max-h-96 overflow-y-auto rounded-[1rem] bg-ui-ground inset-ring inset-ring-ui-line"
    >
      <ul
        className="relative w-full"
        style={{ height: virtualizer.getTotalSize() }}
      >
        {virtualizer.getVirtualItems().map((virtual) => {
          const { agentId, totals } = rows[virtual.index];
          const selected =
            selection?.kind === "character" && selection.id === agentId;
          return (
            <li
              key={agentId}
              className="absolute inset-x-0 top-0"
              style={{
                height: virtual.size,
                transform: `translateY(${virtual.start}px)`,
              }}
            >
              <SettingsRowButton
                aria-current={selected ? "true" : undefined}
                onClick={() => void select({ kind: "character", id: agentId })}
                className={cx("size-full", selected && "bg-ui-tint")}
              >
                <span className="flex min-w-0 flex-1 flex-col gap-1.5">
                  <span className="truncate text-sm font-semibold text-ui-ink">
                    {byId.get(agentId)?.name ?? agentId}
                  </span>
                  <span
                    aria-hidden
                    className="h-1.5 overflow-hidden rounded-full bg-ui-tint"
                  >
                    <span
                      className="block h-full rounded-full bg-ui-primary/80"
                      style={{ width: `${(totals.totalTokens / peak) * 100}%` }}
                    />
                  </span>
                </span>
                <span className="w-16 text-end font-[ui-monospace,monospace] text-xs text-ui-ink tabular-nums">
                  {formatTokens(totals.totalTokens)}
                </span>
                <span className="w-16 text-end font-[ui-monospace,monospace] text-xs text-ui-soft tabular-nums">
                  {formatCost(totals.totalCost)}
                </span>
              </SettingsRowButton>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

export function UsageSettings() {
  const { resolved } = useSources();
  const [days, setDays] = useState("30");
  const {
    data: report,
    error,
    isLoading,
    isValidating,
    settling,
    refresh,
  } = useUsage(Number(days));

  if (resolved.usage !== "live") {
    return (
      <SettingsPage
        title="Usage"
        description="Token counts and estimated cost across all characters and models."
      >
        <Unavailable requires={["usage"]} title="Usage needs a live Gateway" />
      </SettingsPage>
    );
  }

  const missing = report?.totals.missingCostEntries ?? 0;
  const models =
    report?.byModel.filter((entry) => entry.totals.totalTokens > 0) ?? [];

  return (
    <SettingsPage
      title="Usage"
      description="Every model call in this world, attention decisions included, in real days. Costs are estimates, not your provider's bill."
      action={
        <Segmented
          aria-label="Date range"
          value={days}
          onValueChange={(next) => next && setDays(next)}
        >
          {RANGES.map((range) => (
            <SegmentedItem key={range.days} value={range.days}>
              {range.label}
            </SegmentedItem>
          ))}
        </Segmented>
      }
    >
      <SettingsSection title="Tokens used">
        {error && !report ? (
          <Callout tone="danger" title="Couldn't read usage">
            {error.message}
          </Callout>
        ) : isLoading && !report ? (
          <Note>Loading usage…</Note>
        ) : report ? (
          <>
            {report.partial ? (
              <Callout
                title={
                  settling
                    ? "Still reading usage history…"
                    : "History is incomplete"
                }
                action={
                  settling ? null : (
                    <Button
                      tone="soft"
                      size="sm"
                      pending={isValidating}
                      onClick={() => void refresh()}
                    >
                      Refresh
                    </Button>
                  )
                }
              >
                {settling
                  ? "Totals may grow as remaining logs load."
                  : "OpenClaw couldn't read all of its history yet, so these totals may be low."}
              </Callout>
            ) : null}

            <div className="grid grid-cols-2 gap-2.5 lg:grid-cols-4">
              <StatTile
                label="Total tokens"
                value={formatTokens(report.totals.totalTokens)}
                note={`${formatTokens(report.totals.input)} in · ${formatTokens(report.totals.output)} out`}
              />
              <StatTile
                label="Cached tokens"
                value={formatTokens(report.totals.cacheRead)}
                note={`${formatTokens(report.totals.cacheWrite)} written`}
              />
              <StatTile
                label="Estimated cost"
                value={formatCost(report.totals.totalCost)}
                note={
                  missing > 0
                    ? `${missing} ${missing === 1 ? "call" : "calls"} without a price`
                    : undefined
                }
              />
              <StatTile
                label="Sessions"
                value={report.sessionCount.toLocaleString()}
                note={`${report.messages.toolCalls.toLocaleString()} tool calls`}
              />
            </div>

            {report.daily.length > 0 ? (
              <DailyChart daily={report.daily} />
            ) : null}
          </>
        ) : null}
      </SettingsSection>

      {report ? (
        <>
          <SettingsSection
            title="By character"
            description="Sorted by most tokens used. Pick someone to open them in the details panel."
          >
            <ByCharacter report={report} />
          </SettingsSection>

          <SettingsSection title="By model">
            {models.length === 0 ? (
              <Note>No model calls in this range.</Note>
            ) : (
              <SettingsGroup>
                {models.map((entry) => (
                  <SettingsRow
                    key={`${entry.provider}/${entry.model}`}
                    title={
                      <span className="font-[ui-monospace,monospace] text-xs font-semibold">
                        {[entry.provider, entry.model]
                          .filter(Boolean)
                          .join("/") || "Unknown model"}
                      </span>
                    }
                    action={
                      <div className="flex items-center gap-3 font-[ui-monospace,monospace] text-xs tabular-nums">
                        <span className="text-ui-soft">{`${entry.count.toLocaleString()} ${entry.count === 1 ? "call" : "calls"}`}</span>
                        <span className="w-14 text-end font-semibold text-ui-ink">
                          {formatTokens(entry.totals.totalTokens)}
                        </span>
                        <span className="w-14 text-end text-ui-soft">
                          {formatCost(entry.totals.totalCost)}
                        </span>
                      </div>
                    }
                  />
                ))}
              </SettingsGroup>
            )}
          </SettingsSection>
        </>
      ) : null}
    </SettingsPage>
  );
}
