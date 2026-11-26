"use client";

import { MonitorIcon, MoonIcon, SunIcon } from "lucide-react";
import {
  setPalette,
  setThemeMode,
  usePalettePreference,
  useThemeMode,
  type ThemeMode,
} from "@/lib/state/preferences-store";
import { PaletteSwatch } from "@/ui/palette-swatch";
import { PALETTES, type Palette } from "@/ui/palettes";
import { RadioList, RadioOption } from "@/ui/radio-list";
import { Segmented, SegmentedItem } from "@/ui/segmented";
import { SettingsPage, SettingsSection } from "@/ui/settings";

const MODES: readonly {
  readonly value: ThemeMode;
  readonly label: string;
  readonly icon: typeof MonitorIcon;
}[] = [
  { value: "system", label: "System", icon: MonitorIcon },
  { value: "light", label: "Light", icon: SunIcon },
  { value: "dark", label: "Dark", icon: MoonIcon },
];

export function AppearanceSettings() {
  const mode = useThemeMode();
  const palette = usePalettePreference();

  return (
    <SettingsPage
      title="Appearance"
      description="Choose light or dark mode and the color palette for this browser."
    >
      <SettingsSection
        title="Color mode"
        description="Follow your device setting, or keep light or dark mode on."
      >
        <Segmented<ThemeMode>
          aria-label="Color mode"
          value={mode}
          onValueChange={(next) => {
            if (next) setThemeMode(next);
          }}
          className="self-start"
        >
          {MODES.map((entry) => {
            const Icon = entry.icon;
            return (
              <SegmentedItem key={entry.value} value={entry.value}>
                <span className="inline-flex items-center gap-1.5">
                  <Icon aria-hidden className="size-3.5" />
                  {entry.label}
                </span>
              </SegmentedItem>
            );
          })}
        </Segmented>
      </SettingsSection>

      <SettingsSection
        title="Color palette"
        description="Structure uses the first tone; live presence and highlights use the second."
      >
        <div className="rounded-[1rem] bg-ui-ground p-3 inset-ring inset-ring-ui-line">
          <RadioList<Palette>
            label="Color palette"
            value={palette}
            onValueChange={(next) => setPalette(next)}
          >
            {PALETTES.map((entry) => (
              <RadioOption
                key={entry.value}
                value={entry.value}
                label={entry.label}
                hint={entry.hint}
                leading={<PaletteSwatch palette={entry.value} size="lg" />}
              />
            ))}
          </RadioList>
        </div>
      </SettingsSection>
    </SettingsPage>
  );
}
