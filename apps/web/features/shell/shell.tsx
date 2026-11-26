"use client";

import { parseAsString, useQueryState } from "nuqs";
import { useEffect, useState, type ComponentType } from "react";
import { useActiveView } from "@/hooks/use-active-view";
import { useMediaQuery } from "@/hooks/use-media-query";
import { useSwitchResets } from "@/hooks/use-play";
import { useSelection } from "@/hooks/use-selection";
import { RealtimeProvider } from "@/lib/live/realtime-provider";
import type { SectionSidebarProps } from "@/lib/registry/types";
import { SourcesProvider, useSources } from "@/lib/source/provider";
import { syncPreferences } from "@/lib/state/preferences-store";
import { Drawer, DrawerPanel } from "@/ui/drawer";
import { Segmented, SegmentedItem } from "@/ui/segmented";
import { CharactersStage } from "../characters/characters-stage";
import { PlayAsDialog } from "../characters/play-as-dialog";
import { ChatList } from "../chats/chat-list";
import { ChatsStage } from "../chats/chats-stage";
import {
  chatsParsers,
  Stage,
  StatusBar,
  VisitorWelcome,
  WorldUpdateNotice,
} from "../legacy";
import { SettingsSidebar } from "../settings/settings-sidebar";
import { SettingsStage } from "../settings/settings-stage";
import { UpdateSaveDialog } from "../settings/update-save-dialog";
import { TimelineSidebar } from "../timeline/timeline-sidebar";
import { TimelineStage } from "../timeline/timeline-stage";
import { WikiSidebar } from "../wiki/wiki-sidebar";
import { wikiParsers } from "../wiki/search-params";
import { WikiStage } from "../wiki/wiki-stage";
import { WhosWhere } from "../world/whos-where";
import { WorldStage } from "../world/world-stage";
import { CommandPalette } from "./command-palette";
import { DetailsPanel } from "./details-panel";
import { SectionNav } from "./section-nav";
import { TopBar } from "./top-bar";
import { useAppearance } from "./use-palette";
import { useDetailsSheet } from "./use-sheet";

/** Sections rebuilt here; the rest still come from the registry's old views. */
const SIDEBARS: Record<string, ComponentType<SectionSidebarProps> | null> = {
  // The cast is the stage, and a profile is a page in it: no list beside them.
  characters: null,
  chats: ChatList,
  settings: SettingsSidebar,
  timeline: TimelineSidebar,
  wiki: WikiSidebar,
  world: WhosWhere,
};

const STAGES: Record<string, ComponentType> = {
  characters: CharactersStage,
  chats: ChatsStage,
  settings: SettingsStage,
  timeline: TimelineStage,
  wiki: WikiStage,
  world: WorldStage,
};

const PANE_LABELS: Record<string, [string, string]> = {
  chats: ["Conversations", "Thread"],
  settings: ["Categories", "Settings"],
  timeline: ["People", "Timeline"],
  wiki: ["Index", "Page"],
  world: ["Who's where", "Map"],
};

type Pane = "list" | "stage";

export function Shell() {
  useEffect(syncPreferences, []);
  useAppearance();
  return (
    <SourcesProvider fallback={<Loading />}>
      <RealtimeProvider>
        <Frame />
      </RealtimeProvider>
    </SourcesProvider>
  );
}

function Frame() {
  useSwitchResets();
  const [commandOpen, setCommandOpen] = useState(false);
  const [selection, select] = useSelection();
  const { player } = useSources();
  const [, setView] = useQueryState("view", parseAsString);
  const [chatId] = useQueryState("chats.id", chatsParsers["chats.id"]);
  const [wikiPage] = useQueryState("wiki.page", wikiParsers["wiki.page"]);
  const [wikiTab] = useQueryState("wiki.tab", wikiParsers["wiki.tab"]);
  const active = useActiveView();
  const docked = useMediaQuery("(min-width: 1024px)");
  const wide = useMediaQuery("(min-width: 1280px)");
  const tablet = useMediaQuery("(min-width: 768px)");
  const Sidebar = active.id in SIDEBARS ? SIDEBARS[active.id] : active.sidebar;
  const OwnStage = STAGES[active.id];
  const [pane, setPane] = useState<Pane>("stage");
  const [sheetOpen, setSheetOpen] = useDetailsSheet(selection, active.id);

  // On a phone, a section opens on its list unless something in it is already open.
  // biome-ignore lint/correctness/useExhaustiveDependencies: only when the section changes
  useEffect(() => {
    setPane(
      (active.id === "chats" && !chatId) ||
        (active.id === "wiki" && !wikiPage && !wikiTab)
        ? "list"
        : "stage",
    );
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
  const [listLabel, stageLabel] = PANE_LABELS[active.id] ?? [
    "List",
    active.label,
  ];
  // Docked, You is always open beside the stage; in a drawer, only a pick opens it.
  const showDocked = wide && (Boolean(selection) || Boolean(player.id));

  return (
    <div
      className="grid h-dvh grid-cols-[5.5rem_minmax(0,1fr)] grid-rows-[auto_minmax(0,1fr)_auto] bg-ui-ground text-ui-ink max-md:grid-cols-[minmax(0,1fr)]"
      onContextMenu={(event) => {
        if (event.defaultPrevented) return;
        const target = event.target as HTMLElement | null;
        if (
          target?.closest("input, textarea, select, [contenteditable], a[href]")
        )
          return;
        if (window.getSelection()?.toString().trim()) return;
        event.preventDefault();
      }}
    >
      <TopBar
        className="col-span-full"
        onOpenCommand={() => setCommandOpen(true)}
        onOpenSettings={() => void setView("settings")}
      />
      <SectionNav className="col-start-1 row-span-2 row-start-2 max-md:row-span-1 max-md:row-start-3" />
      <div className="col-start-2 row-start-2 flex min-h-0 min-w-0 gap-4 pe-4 pb-3 max-lg:flex-col max-lg:gap-3 max-md:col-start-1 max-md:px-3 max-md:pb-2">
        {split ? (
          <Segmented<Pane>
            aria-label={`${active.label} view`}
            stretch
            value={pane}
            onValueChange={(value) => value && setPane(value)}
          >
            <SegmentedItem value="list">{listLabel}</SegmentedItem>
            <SegmentedItem value="stage">{stageLabel}</SegmentedItem>
          </Segmented>
        ) : null}
        {showList && Sidebar ? (
          <aside
            aria-label={`${active.label} list`}
            className="flex min-h-0 w-76 shrink-0 flex-col max-lg:w-auto max-lg:flex-1"
          >
            <Sidebar key={active.id} onNavigated={() => setPane("stage")} />
          </aside>
        ) : null}
        {showStage ? (
          <main className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden rounded-[1.5rem] ui-raised *:min-h-0 *:flex-1">
            {OwnStage ? <OwnStage /> : <Stage />}
          </main>
        ) : null}
        {showDocked ? (
          <aside
            aria-label="Details"
            className="flex min-h-0 w-92 min-w-0 shrink-0 flex-col overflow-hidden rounded-[1.5rem] ui-raised *:min-h-0 *:flex-1"
          >
            <DetailsPanel docked />
          </aside>
        ) : null}
      </div>
      <div className="col-start-2 row-start-3 *:border-0 *:bg-transparent max-md:hidden">
        <StatusBar />
      </div>

      {wide ? null : (
        <Drawer
          open={sheetOpen}
          onOpenChange={(open) => {
            setSheetOpen(open);
            if (!open) void select(null);
          }}
          side={tablet ? "right" : "bottom"}
          snapPoints={tablet ? undefined : [0.6, 1]}
        >
          <DrawerPanel
            title="Details"
            handle={tablet ? undefined : "Resize details"}
          >
            {selection ? <DetailsPanel docked={false} /> : null}
          </DrawerPanel>
        </Drawer>
      )}

      <CommandPalette
        open={commandOpen}
        onOpenChange={setCommandOpen}
        onOpenedChat={() => setPane("stage")}
      />
      <WorldUpdateNotice />
      <UpdateSaveDialog />
      <PlayAsDialog />
      <VisitorWelcome />
    </div>
  );
}

function Loading() {
  return (
    <div
      className="grid h-dvh place-content-center justify-items-center gap-4 text-ui-soft"
      aria-busy="true"
    >
      <img
        src="/logo.png"
        alt=""
        className="size-12 rounded-[1rem] object-cover"
        width={48}
        height={48}
      />
      <p>Connecting…</p>
    </div>
  );
}
