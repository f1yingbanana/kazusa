"use client";

import type { DesireDefinition, DesireRecord, DesiresConfig } from "@kazusa/client";
import { Meter, MeterIndicator, MeterLabel, MeterTrack } from "@ui-sdk/react/meter";
import { ArrowDownIcon, ArrowUpIcon, PauseIcon } from "lucide-react";
import type { CSSProperties } from "react";
import { useCharacterStatus } from "@/hooks/use-characters";
import { useSimNow } from "@/hooks/use-clock";
import { useDesireConfig, useDesireRecord } from "@/hooks/use-desires";
import { setSectionOpen, useSectionOpen } from "@/lib/state/preferences-store";
import {
  desireLabel,
  dropOf,
  isNotable,
  levelAt,
  stateIndex,
  trendOf,
} from "@/lib/time/desires";
import { formatSimDuration, formatSimTime } from "@/lib/time/sim";
import { HaloTip } from "./halo-tip";

const QUIET_TILES = 4;
const SHOW_ALL = "character.desires.all";

/**
 * How they feel, as tiles: the ones that stand out (low, or being moved by
 * what they're doing) first, the rest one press away. A tile's hint says what
 * the desire is and when it next changes.
 */
export function HaloDesires({ id }: { id: string }) {
  const config = useDesireConfig();
  const record = useDesireRecord(id);
  const status = useCharacterStatus(id);
  const now = useSimNow();
  const showAll = useSectionOpen(SHOW_ALL, false);
  const offstage = status?.onstage === false;

  if (!config || now <= 0) {
    return (
      <section className="halo-desires" aria-label="How they feel" aria-busy="true">
        <ul className="halo-desire-grid" aria-hidden="true">
          {[0, 1].map((n) => (
            <li key={n} className="halo-desire halo-desire-skeleton" />
          ))}
        </ul>
      </section>
    );
  }

  // Offstage, their body waits: levels stand where they were when they left.
  const at = Math.max(offstage ? (status.offstageSince ?? now) : now, record?.anchorAt ?? 0);
  const notable = config.catalog.filter((d) => isNotable(config, record, d, at, offstage));
  const lead = notable.length
    ? notable
    : config.catalog
        .toSorted((a, b) => levelAt(config, record, a, at) - levelAt(config, record, b, at))
        .slice(0, QUIET_TILES);
  const shown = showAll ? config.catalog : lead;
  const hidden = config.catalog.length - lead.length;

  return (
    <section className="halo-desires" aria-labelledby={`desires-${id}`}>
      <div className="halo-desires-head">
        <h3 id={`desires-${id}`}>How they feel</h3>
        {offstage ? (
          <HaloTip tip="Desires stop changing while a character is offstage.">
            <span className="halo-desires-paused" tabIndex={0}>
              <PauseIcon aria-hidden className="size-3" />
              Paused
            </span>
          </HaloTip>
        ) : null}
        {hidden > 0 ? (
          <button
            type="button"
            className="halo-text-button halo-desires-more"
            aria-expanded={showAll}
            onClick={() => setSectionOpen(SHOW_ALL, !showAll)}
          >
            {showAll ? "Fewer" : `All ${config.catalog.length}`}
          </button>
        ) : null}
      </div>
      <ul className="halo-desire-grid">
        {shown.map((desire, index) => (
          <DesireTile
            key={desire.name}
            config={config}
            record={record}
            desire={desire}
            at={at}
            paused={offstage}
            order={index}
          />
        ))}
      </ul>
    </section>
  );
}

function DesireTile({
  config,
  record,
  desire,
  at,
  paused,
  order,
}: {
  config: DesiresConfig;
  record: DesireRecord | undefined;
  desire: DesireDefinition;
  at: number;
  paused: boolean;
  order: number;
}) {
  const level = levelAt(config, record, desire, at);
  const index = stateIndex(config, level);
  const state = config.states[index]?.name ?? "";
  const initial = Math.max(
    0,
    config.states.findIndex(({ name }) => name === config.initial),
  );
  const trend = paused ? undefined : trendOf(config, record, desire, at);
  const drop = paused || trend ? undefined : dropOf(config, record, desire, at);
  const label = desireLabel(desire.name);
  const tone = index === 0 ? "pressing" : index < initial ? "low" : "fine";
  const when = trend
    ? `${trend.direction === "up" ? "Rising" : "Falling"} to ${trend.targetState} by ${formatSimTime(trend.reachesAt)}`
    : drop
      ? `Turns ${drop.state} in ${formatSimDuration(drop.at - at)}`
      : paused
        ? "Holding while offstage"
        : undefined;
  const TrendIcon = trend?.direction === "down" ? ArrowDownIcon : ArrowUpIcon;
  const ghost = trend
    ? { from: Math.min(level, trend.target), span: Math.abs(trend.target - level) }
    : undefined;

  return (
    <li
      className="halo-desire"
      data-tone={tone}
      data-trend={trend?.direction}
      style={{ "--i": order } as CSSProperties}
    >
      <HaloTip
        tip={
          <span className="halo-tip-stack">
            <span>{desire.description}</span>
            {when ? <span className="halo-tip-meta">{when}</span> : null}
          </span>
        }
      >
        <div className="halo-desire-hit" tabIndex={0}>
          <Meter
            value={level}
            getValueLabel={() =>
              trend ? `${state}, moving to ${trend.targetState}` : state
            }
            className="halo-desire-meter"
          >
            <span className="halo-desire-top">
              <MeterLabel className="halo-desire-name">{label}</MeterLabel>
              <span className="halo-desire-state" aria-hidden="true">
                {trend ? <TrendIcon className="size-3" /> : null}
                {state}
              </span>
            </span>
            <MeterTrack className="halo-desire-track">
              {ghost ? (
                <span
                  className="halo-desire-ghost"
                  aria-hidden="true"
                  style={{ insetInlineStart: `${ghost.from}%`, width: `${ghost.span}%` }}
                />
              ) : null}
              <MeterIndicator className="halo-desire-fill" />
              {config.states.slice(1).map((s) => (
                <span
                  key={s.name}
                  className="halo-desire-notch"
                  aria-hidden="true"
                  style={{ insetInlineStart: `${s.min}%` }}
                />
              ))}
            </MeterTrack>
          </Meter>
        </div>
      </HaloTip>
    </li>
  );
}
