"use client";

import {
  Popover,
  PopoverContent,
  PopoverTitle,
  PopoverTrigger,
} from "@ui-sdk/react/popover";
import {
  SegmentedControl,
  SegmentedControlIndicator,
  SegmentedControlItem,
} from "@ui-sdk/react/segmented-control";
import { PauseIcon, PlayIcon, SearchIcon, SettingsIcon } from "lucide-react";
import { useEffect, useRef } from "react";
import { HaloTip } from "./halo-tip";
import { useClockActions, useClockAnchor, useSimNow } from "@/hooks/use-clock";
import {
  formatSimDate,
  formatSimDateLong,
  formatSimTime,
  simPhase,
} from "@/lib/time/sim";
import { HALO_PALETTES, type HaloPalette } from "./palettes";

const SPEEDS = [
  { value: "1", label: "1×" },
  { value: "10", label: "10×" },
  { value: "60", label: "60×" },
] as const;

const ADVANCE = [
  { minutes: 15, label: "+15 min" },
  { minutes: 60, label: "+1 hour" },
  { minutes: 360, label: "+6 hours" },
] as const;

export function HaloTopBar({
  palette,
  onPaletteChange,
  onOpenCommand,
  onOpenSettings,
}: {
  palette: HaloPalette;
  onPaletteChange: (palette: HaloPalette) => void;
  onOpenCommand: () => void;
  onOpenSettings: () => void;
}) {
  return (
    <header className="halo-bar">
      <div className="halo-brand">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/logo.png" alt="" className="halo-logo" width={32} height={32} />
        <span className="halo-wordmark">Kazusa</span>
      </div>
      <HaloClock />
      <div className="halo-bar-end">
        <button type="button" className="halo-search-button" onClick={onOpenCommand}>
          <SearchIcon aria-hidden className="size-4" />
          <span className="halo-search-label">Search or jump</span>
          <kbd className="halo-kbd">⌘K</kbd>
        </button>
        <PalettePicker palette={palette} onPaletteChange={onPaletteChange} />
        <HaloTip tip="Settings" type="label" side="bottom">
          <button
            type="button"
            className="halo-icon-button halo-phone-only"
            aria-label="Settings"
            onClick={onOpenSettings}
          >
            <SettingsIcon aria-hidden className="size-4" />
          </button>
        </HaloTip>
      </div>
    </header>
  );
}

/**
 * The clock is read constantly and changed rarely, so the reading is the
 * control: pause sits next to it, everything else opens from it.
 */
function HaloClock() {
  const anchor = useClockAnchor();
  const now = useSimNow();
  const { apply, enabled } = useClockActions();
  const lastSpeed = useRef(1);
  const speed = anchor?.clock.speed ?? 0;

  useEffect(() => {
    if (speed > 0) lastSpeed.current = speed;
  }, [speed]);

  if (!anchor || now === 0) {
    return <span className="halo-clock-off">Clock unavailable</span>;
  }
  const paused = speed === 0;

  return (
    <div className="halo-clock-group">
      <HaloTip
        tip={
          enabled
            ? paused
              ? "Resume time"
              : "Pause time"
            : "Only the world's owner can change the clock"
        }
        type={enabled ? "label" : "description"}
        side="bottom"
      >
        <button
          type="button"
          className="halo-play"
          aria-label={paused ? "Resume time" : "Pause time"}
          aria-disabled={!enabled || undefined}
          onClick={() => {
            if (enabled) apply({ action: "set_speed", speed: paused ? lastSpeed.current : 0 });
          }}
        >
          {paused ? (
            <PlayIcon aria-hidden className="size-4" />
          ) : (
            <PauseIcon aria-hidden className="size-4" />
          )}
        </button>
      </HaloTip>
      <Popover>
        <PopoverTrigger className="halo-clock" aria-label={`${formatSimDateLong(now)}, clock options`}>
          <time className="halo-clock-time" dateTime={new Date(now).toISOString()}>
            {formatSimTime(now)}
          </time>
          <span className="halo-clock-meta">
            <span className="halo-clock-day">
              {formatSimDate(now)} · {simPhase(now)}
            </span>
            <span className="halo-clock-speed" data-paused={paused ? "" : undefined}>
              {paused ? "Paused" : `${speed}× speed`}
            </span>
          </span>
        </PopoverTrigger>
        <PopoverContent className="halo-pop halo-clock-pop">
          <PopoverTitle className="halo-pop-title">{formatSimDateLong(now)}</PopoverTitle>
          <p className="halo-pop-note">
            Simulation time. Everyone in the world lives by this clock.
          </p>
          <span className="halo-pop-label">Speed</span>
          <SegmentedControl
            aria-label="Simulation speed"
            className="halo-seg"
            value={SPEEDS.some((s) => Number(s.value) === speed) ? String(speed) : null}
            disabled={!enabled}
            onValueChange={(value) =>
              value && apply({ action: "set_speed", speed: Number(value) })
            }
          >
            <SegmentedControlIndicator />
            {SPEEDS.map((s) => (
              <SegmentedControlItem key={s.value} value={s.value}>
                {s.label}
              </SegmentedControlItem>
            ))}
          </SegmentedControl>
          <span className="halo-pop-label">Skip ahead</span>
          <div className="halo-chip-row">
            {ADVANCE.map((a) => (
              <button
                key={a.minutes}
                type="button"
                className="halo-chip-button"
                disabled={!enabled}
                onClick={() => apply({ action: "advance", minutes: a.minutes })}
              >
                {a.label}
              </button>
            ))}
          </div>
          {enabled ? null : (
            <p className="halo-pop-note">{"Only the world's owner can change the clock."}</p>
          )}
        </PopoverContent>
      </Popover>
    </div>
  );
}

function PalettePicker({
  palette,
  onPaletteChange,
}: {
  palette: HaloPalette;
  onPaletteChange: (palette: HaloPalette) => void;
}) {
  return (
    <Popover>
      <HaloTip tip="Palette" type="label" side="bottom">
        <PopoverTrigger className="halo-icon-button" aria-label="Palette">
          <span className="halo-duo" data-swatch={palette} aria-hidden="true" />
        </PopoverTrigger>
      </HaloTip>
      <PopoverContent className="halo-pop">
        <PopoverTitle className="halo-pop-title">Palette</PopoverTitle>
        <div className="halo-palettes" role="radiogroup" aria-label="Palette">
          {HALO_PALETTES.map((p) => (
            <button
              key={p.value}
              type="button"
              role="radio"
              aria-checked={p.value === palette}
              className="halo-palette"
              onClick={() => onPaletteChange(p.value)}
            >
              <span className="halo-duo" data-swatch={p.value} aria-hidden="true" />
              <span className="halo-palette-text">
                <span className="halo-palette-name">{p.label}</span>
                <span className="halo-palette-hint">{p.hint}</span>
              </span>
            </button>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}
