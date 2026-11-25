"use client";

import { SearchIcon, SettingsIcon } from "lucide-react";
import { IconButton } from "@/ui/button";
import { cx } from "@/ui/cx";
import type { Palette } from "@/ui/palettes";
import { Clock } from "./clock";
import { PalettePicker } from "./palette-picker";

export function TopBar({
  palette,
  onPaletteChange,
  onOpenCommand,
  onOpenSettings,
  className,
}: {
  palette: Palette;
  onPaletteChange: (palette: Palette) => void;
  onOpenCommand: () => void;
  onOpenSettings: () => void;
  className?: string;
}) {
  return (
    <header
      className={cx(
        "flex min-w-0 items-center gap-5 px-5 py-3 max-md:gap-2 max-md:px-3 max-md:py-2.5",
        className,
      )}
    >
      <div className="flex shrink-0 items-center gap-2.5">
        <img
          src="/logo.png"
          alt=""
          className="size-8 rounded-[0.625rem] object-cover"
          width={32}
          height={32}
        />
        <span className="text-lg font-extrabold tracking-[-0.01em] max-md:hidden">
          Kazusa
        </span>
      </div>
      <Clock />
      <div className="ms-auto flex items-center gap-2">
        <button
          type="button"
          className="inline-flex h-10 items-center gap-2 rounded-full bg-ui-surface ps-3.5 pe-2 text-sm text-ui-soft inset-ring inset-ring-ui-line hover:text-ui-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ui-primary max-md:w-10 max-md:justify-center max-md:px-0 [&_svg]:size-4"
          aria-label="Search or jump"
          onClick={onOpenCommand}
        >
          <SearchIcon aria-hidden />
          <span className="max-md:hidden">Search or jump</span>
          <kbd className="rounded-full bg-ui-tint px-2 py-0.5 font-[inherit] text-xs max-md:hidden">
            ⌘K
          </kbd>
        </button>
        <PalettePicker palette={palette} onPaletteChange={onPaletteChange} />
        <IconButton
          label="Settings"
          className="hidden max-md:inline-flex"
          onClick={onOpenSettings}
        >
          <SettingsIcon aria-hidden />
        </IconButton>
      </div>
    </header>
  );
}
