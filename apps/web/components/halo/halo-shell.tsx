"use client";

import type { ComponentType } from "react";
import { useEffect, useState } from "react";
import { CommandPalette } from "@/components/shell/command-palette";
import { Inspector } from "@/components/shell/inspector";
import { Stage } from "@/components/shell/stage";
import { StatusBar } from "@/components/shell/status-bar";
import { VisitorWelcome } from "@/components/shell/visitor-welcome";
import { WorldUpdateNotice } from "@/components/shell/world-update-notice";
import { PlayAsDialog } from "@/components/play/play-as-dialog";
import { useActiveView } from "@/hooks/use-active-view";
import { useMediaQuery } from "@/hooks/use-media-query";
import { useSwitchResets } from "@/hooks/use-play";
import { useSelection } from "@/hooks/use-selection";
import { RealtimeProvider } from "@/lib/live/realtime-provider";
import type { SectionSidebarProps } from "@/lib/registry/types";
import { SourcesProvider } from "@/lib/source/provider";
import { syncPreferences } from "@/lib/state/preferences-store";
import { HaloChatList } from "./halo-chat-list";
import { HaloNav } from "./halo-nav";
import { HaloTopBar } from "./halo-top-bar";
import { HaloWhosWhere } from "./halo-whos-where";
import type { HaloPalette } from "./palettes";

const NATIVE_SIDEBARS: Record<string, ComponentType<SectionSidebarProps>> = {
  chats: HaloChatList,
  world: HaloWhosWhere,
};

export function HaloShell() {
  useEffect(syncPreferences, []);
  const [palette, setPalette] = useState<HaloPalette>("sky");
  // Dialogs and menus portal to <body>, so the palette lives on <html>.
  useEffect(() => {
    const root = document.documentElement;
    root.dataset.halo = palette;
    return () => {
      delete root.dataset.halo;
    };
  }, [palette]);
  return (
    <div className="halo" data-palette={palette}>
      <SourcesProvider fallback={<HaloLoading />}>
        <RealtimeProvider>
          <HaloLayout palette={palette} onPaletteChange={setPalette} />
        </RealtimeProvider>
      </SourcesProvider>
    </div>
  );
}

function HaloLayout({
  palette,
  onPaletteChange,
}: {
  palette: HaloPalette;
  onPaletteChange: (palette: HaloPalette) => void;
}) {
  useSwitchResets();
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [selection] = useSelection();
  const active = useActiveView();
  const docked = useMediaQuery("(min-width: 1024px)");
  const wide = useMediaQuery("(min-width: 1280px)");
  const Sidebar = NATIVE_SIDEBARS[active.id] ?? active.sidebar;

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setPaletteOpen((open) => !open);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <div className="halo-frame">
      <HaloTopBar
        palette={palette}
        onPaletteChange={onPaletteChange}
        onOpenPalette={() => setPaletteOpen(true)}
      />
      <HaloNav />
      <div className="halo-body">
        {Sidebar && docked ? (
          <aside aria-label={`${active.label} list`} className="halo-sidebar">
            <Sidebar key={active.id} />
          </aside>
        ) : null}
        <main className="halo-stage">
          <Stage />
        </main>
        {wide && selection ? (
          <aside aria-label="Inspector" className="halo-inspector">
            <Inspector />
          </aside>
        ) : null}
      </div>
      <div className="halo-status">
        <StatusBar />
      </div>

      <CommandPalette open={paletteOpen} onOpenChange={setPaletteOpen} />
      <WorldUpdateNotice />
      <PlayAsDialog />
      <VisitorWelcome />
    </div>
  );
}

function HaloLoading() {
  return (
    <div className="halo-loading" aria-busy="true">
      <span className="halo-wordmark">Kazusa</span>
      <p>Connecting to the world…</p>
    </div>
  );
}
