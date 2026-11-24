"use client";

import {
  Drawer,
  DrawerBackdrop,
  DrawerContent,
  DrawerHandle,
  DrawerTitle,
} from "@ui-sdk/react/drawer";
import {
  SegmentedControl,
  SegmentedControlIndicator,
  SegmentedControlItem,
} from "@ui-sdk/react/segmented-control";
import { parseAsString, useQueryState } from "nuqs";
import type { ComponentType } from "react";
import { useEffect, useState } from "react";
import { PlayAsDialog } from "@/components/play/play-as-dialog";
import { Inspector } from "@/components/shell/inspector";
import { Stage } from "@/components/shell/stage";
import { StatusBar } from "@/components/shell/status-bar";
import { VisitorWelcome } from "@/components/shell/visitor-welcome";
import { WorldUpdateNotice } from "@/components/shell/world-update-notice";
import { chatsParsers } from "@/components/views/chats/search-params";
import { useActiveView } from "@/hooks/use-active-view";
import { useMediaQuery } from "@/hooks/use-media-query";
import { useSwitchResets } from "@/hooks/use-play";
import { useSelection } from "@/hooks/use-selection";
import { RealtimeProvider } from "@/lib/live/realtime-provider";
import type { SectionSidebarProps } from "@/lib/registry/types";
import { SourcesProvider } from "@/lib/source/provider";
import { syncPreferences } from "@/lib/state/preferences-store";
import { HaloChatList } from "./halo-chat-list";
import { HaloCommand } from "./halo-command";
import { HaloGallery } from "./halo-gallery";
import { HaloNav } from "./halo-nav";
import { HaloSheet } from "./halo-sheet";
import { HaloTopBar } from "./halo-top-bar";
import { HaloWhosWhere } from "./halo-whos-where";
import type { HaloPalette } from "./palettes";

const NATIVE_SIDEBARS: Record<string, ComponentType<SectionSidebarProps>> = {
  chats: HaloChatList,
  world: HaloWhosWhere,
};

const NATIVE_STAGES: Record<string, ComponentType> = {
  characters: HaloGallery,
};

const PANE_LABELS: Record<string, [string, string]> = {
  chats: ["Conversations", "Thread"],
  world: ["People", "Map"],
  characters: ["List", "Faces"],
};

export function HaloShell() {
  useEffect(syncPreferences, []);
  const [palette, setPalette] = useState<HaloPalette>("schale");
  // Dialogs and popovers portal to <body>, so the palette lives on <html>.
  useEffect(() => {
    const root = document.documentElement;
    root.dataset.halo = palette;
    return () => {
      delete root.dataset.halo;
    };
  }, [palette]);
  return (
    <SourcesProvider fallback={<HaloLoading />}>
      <RealtimeProvider>
        <HaloLayout palette={palette} onPaletteChange={setPalette} />
      </RealtimeProvider>
    </SourcesProvider>
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
  const [commandOpen, setCommandOpen] = useState(false);
  const [selection, select] = useSelection();
  const [, setView] = useQueryState("view", parseAsString);
  const [chatId] = useQueryState("chats.id", chatsParsers["chats.id"]);
  const active = useActiveView();
  const docked = useMediaQuery("(min-width: 1024px)");
  const wide = useMediaQuery("(min-width: 1280px)");
  const tablet = useMediaQuery("(min-width: 768px)");
  const Sidebar = NATIVE_SIDEBARS[active.id] ?? active.sidebar;
  const NativeStage = NATIVE_STAGES[active.id];
  const [pane, setPane] = useState<"list" | "stage">("stage");

  // On a phone, a section opens on its list unless something in it is already open.
  // biome-ignore lint/correctness/useExhaustiveDependencies: only when the section changes
  useEffect(() => {
    setPane(active.id === "chats" && !chatId ? "list" : "stage");
  }, [active.id]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setCommandOpen((open) => !open);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const split = Boolean(Sidebar) && !docked;
  const showList = Boolean(Sidebar) && (docked || pane === "list");
  const showStage = !split || pane === "stage";
  const characterId = selection?.kind === "character" ? selection.id : null;
  const [listLabel, stageLabel] = PANE_LABELS[active.id] ?? ["List", active.label];
  const details = characterId ? <HaloSheet id={characterId} /> : <Inspector />;

  return (
    <div className="halo-frame">
      <HaloTopBar
        palette={palette}
        onPaletteChange={onPaletteChange}
        onOpenCommand={() => setCommandOpen(true)}
        onOpenSettings={() => void setView("settings")}
      />
      <HaloNav />
      <div className="halo-body">
        {split ? (
          <SegmentedControl
            aria-label={`${active.label} view`}
            className="halo-seg halo-pane-switch"
            value={pane}
            onValueChange={(value) => value && setPane(value as "list" | "stage")}
          >
            <SegmentedControlIndicator />
            <SegmentedControlItem value="list">{listLabel}</SegmentedControlItem>
            <SegmentedControlItem value="stage">{stageLabel}</SegmentedControlItem>
          </SegmentedControl>
        ) : null}
        {showList && Sidebar ? (
          <aside aria-label={`${active.label} list`} className="halo-sidebar">
            <Sidebar key={active.id} onNavigated={() => setPane("stage")} />
          </aside>
        ) : null}
        {showStage ? (
          <main className="halo-stage">{NativeStage ? <NativeStage /> : <Stage />}</main>
        ) : null}
        {wide && selection ? (
          <aside aria-label="Details" className="halo-inspector">
            {details}
          </aside>
        ) : null}
      </div>
      <div className="halo-status">
        <StatusBar />
      </div>

      {wide ? null : (
        <Drawer
          open={Boolean(selection)}
          onOpenChange={(open) => {
            if (!open) void select(null);
          }}
          side={tablet ? "right" : "bottom"}
          snapPoints={tablet ? undefined : [0.6, 1]}
        >
          <DrawerBackdrop className="halo-backdrop" />
          <DrawerContent className="halo-drawer">
            {tablet ? null : <DrawerHandle className="halo-grip" aria-label="Resize details" />}
            <DrawerTitle className="sr-only">Details</DrawerTitle>
            {selection ? details : null}
          </DrawerContent>
        </Drawer>
      )}

      <HaloCommand
        open={commandOpen}
        onOpenChange={setCommandOpen}
        onPaletteChange={onPaletteChange}
      />
      <WorldUpdateNotice />
      <PlayAsDialog />
      <VisitorWelcome />
    </div>
  );
}

function HaloLoading() {
  return (
    <div className="halo-loading" aria-busy="true">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/logo.png" alt="" className="halo-logo" width={48} height={48} />
      <p>Connecting to Kivotos…</p>
    </div>
  );
}
