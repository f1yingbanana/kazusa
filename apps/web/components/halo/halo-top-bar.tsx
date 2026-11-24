"use client";

import { Menu, MenuContent, MenuItem, MenuTrigger } from "@ui-sdk/react/menu";
import {
  SegmentedControl,
  SegmentedControlIndicator,
  SegmentedControlItem,
} from "@ui-sdk/react/segmented-control";
import { FastForwardIcon, SearchIcon } from "lucide-react";
import { useClockActions, useClockAnchor, useSimNow } from "@/hooks/use-clock";
import {
  formatSimDate,
  formatSimDateLong,
  formatSimTime,
  simPhase,
} from "@/lib/time/sim";
import { HALO_PALETTES, type HaloPalette } from "./palettes";

const SPEEDS = [
  { value: "0", label: "Pause" },
  { value: "1", label: "1×" },
  { value: "10", label: "10×" },
  { value: "60", label: "60×" },
] as const;

const ADVANCE = [
  { value: "15", label: "+15 minutes" },
  { value: "60", label: "+1 hour" },
  { value: "360", label: "+6 hours" },
] as const;

export function HaloTopBar({
  palette,
  onPaletteChange,
  onOpenPalette,
}: {
  palette: HaloPalette;
  onPaletteChange: (palette: HaloPalette) => void;
  onOpenPalette: () => void;
}) {
  return (
    <header className="halo-bar">
      <div className="halo-brand">
        <span className="halo-wordmark">Kazusa</span>
        <HaloClock />
      </div>
      <SpeedControl />
      <div className="halo-bar-end">
        <button
          type="button"
          className="halo-search-button"
          onClick={onOpenPalette}
        >
          <SearchIcon aria-hidden className="size-4" />
          <span>Search</span>
          <kbd className="halo-kbd">⌘K</kbd>
        </button>
        <SegmentedControl
          aria-label="Palette"
          className="halo-seg halo-swatches"
          value={palette}
          onValueChange={(value) =>
            value && onPaletteChange(value as HaloPalette)
          }
        >
          <SegmentedControlIndicator />
          {HALO_PALETTES.map((p) => (
            <SegmentedControlItem
              key={p.value}
              value={p.value}
              data-swatch={p.value}
              aria-label={p.label}
              title={p.label}
            >
              <span className="halo-swatch" aria-hidden="true" />
            </SegmentedControlItem>
          ))}
        </SegmentedControl>
      </div>
    </header>
  );
}

function HaloClock() {
  const anchor = useClockAnchor();
  const now = useSimNow();
  if (!anchor || now === 0) {
    return <span className="halo-clock-day">Clock unavailable</span>;
  }
  return (
    <time
      className="halo-clock"
      dateTime={new Date(now).toISOString()}
      title={`${formatSimDateLong(now)} · simulation time (UTC)`}
    >
      <span className="halo-clock-day">
        {formatSimDate(now)} · {simPhase(now)}
      </span>
      <span className="halo-clock-time">{formatSimTime(now)}</span>
    </time>
  );
}

function SpeedControl() {
  const anchor = useClockAnchor();
  const { apply, enabled } = useClockActions();
  if (!anchor) return null;
  const speed = String(anchor.clock.speed);
  return (
    <div className="halo-speed">
      <SegmentedControl
        aria-label="Simulation speed"
        className="halo-seg"
        value={SPEEDS.some((s) => s.value === speed) ? speed : undefined}
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
      <Menu
        onAction={(value) =>
          apply({ action: "advance", minutes: Number(value) })
        }
      >
        <MenuTrigger
          className="halo-icon-button"
          aria-label="Advance clock"
          disabled={!enabled}
        >
          <FastForwardIcon aria-hidden className="size-4" />
        </MenuTrigger>
        <MenuContent className="halo-menu">
          {ADVANCE.map((a) => (
            <MenuItem key={a.value} value={a.value}>
              {a.label}
            </MenuItem>
          ))}
        </MenuContent>
      </Menu>
    </div>
  );
}
