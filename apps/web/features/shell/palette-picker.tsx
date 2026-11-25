"use client";

import { IconButton } from "@/ui/button";
import { PaletteSwatch } from "@/ui/palette-swatch";
import { PALETTES, type Palette } from "@/ui/palettes";
import {
  Popover,
  PopoverContent,
  PopoverTitle,
  PopoverTrigger,
} from "@/ui/popover";
import { RadioList, RadioOption } from "@/ui/radio-list";

export function PalettePicker({
  palette,
  onPaletteChange,
}: {
  palette: Palette;
  onPaletteChange: (palette: Palette) => void;
}) {
  return (
    <Popover>
      <PopoverTrigger render={<IconButton label="Palette" />}>
        <PaletteSwatch palette={palette} />
      </PopoverTrigger>
      <PopoverContent>
        <PopoverTitle>Palette</PopoverTitle>
        <RadioList
          label="Palette"
          value={palette}
          onValueChange={onPaletteChange}
        >
          {PALETTES.map((p) => (
            <RadioOption
              key={p.value}
              value={p.value}
              label={p.label}
              hint={p.hint}
              leading={<PaletteSwatch palette={p.value} size="lg" />}
            />
          ))}
        </RadioList>
      </PopoverContent>
    </Popover>
  );
}
