"use client";

import { useQueryState } from "nuqs";
import { useEffect, useState } from "react";
import { useMediaQuery } from "@/hooks/use-media-query";
import { useSwitchResets } from "@/hooks/use-play";
import { useSelection } from "@/hooks/use-selection";
import { RealtimeProvider } from "@/lib/live/realtime-provider";
import { satisfies } from "@/lib/source/capabilities";
import { SourcesProvider, useSources } from "@/lib/source/provider";
import { syncPreferences } from "@/lib/state/preferences-store";
import { requestInspector, setInspectorTab } from "@/lib/state/ui-store";
import { Drawer, DrawerPanel } from "@/ui/drawer";
import { cx } from "@/ui/cx";
import { Segmented, SegmentedItem } from "@/ui/segmented";
import { PaneNavProvider, type PaneNav } from "@/ui/pane-nav";
import { Toasts } from "@/ui/toast";
import { PlayAsDialog } from "../characters/play-as-dialog";
import { chatsParsers } from "../chats/search-params";
import { UpdateSaveDialog } from "../settings/update-save-dialog";
import { Unavailable } from "../settings/unavailable";
import { wikiParsers } from "../wiki/search-params";
import { CommandPalette } from "./command-palette";
import { DetailsPanel } from "./details-panel";
import { SavesDialog } from "./saves-dialog";
import { SectionNav } from "./section-nav";
import { useActiveSection } from "./sections";
import { StatusBar } from "./status-bar";
import { TopBar } from "./top-bar";
import { useAppearance } from "./use-palette";
import { slide } from "./slide";
import { useDetailsSheet } from "./use-sheet";
import { VisitorWelcome } from "./visitor-welcome";
import { WorldUpdateNotice } from "./world-update-notice";

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
  const [chatId] = useQueryState("chats.id", chatsParsers["chats.id"]);
  const [wikiPage] = useQueryState("wiki.page", wikiParsers["wiki.page"]);
  const [wikiTab] = useQueryState("wiki.tab", wikiParsers["wiki.tab"]);
  const [settingsTab] = useQueryState("settings.tab");
  const [talk] = useQueryState("world.talk");
  const { resolved } = useSources();
  const active = useActiveSection();
  const docked = useMediaQuery("(min-width: 1024px)");
  const wide = useMediaQuery("(min-width: 1280px)");
  const tablet = useMediaQuery("(min-width: 768px)");
  const { Sidebar, Stage } = active;
  // A talk opened or closed on World, narrow: its screen slides in, or the
  // list does. Moves between list and stage slide by `slide` instead.
  const [move, setMove] = useState<"forward" | "back" | null>(null);
  const [listSheet, setListSheet] = useState(false);
  const [sheetOpen, setSheetOpen] = useDetailsSheet(selection, active.id);

  const [prevTalk, setPrevTalk] = useState(talk);
  if (prevTalk !== talk) {
    setPrevTalk(talk);
    if (Boolean(prevTalk) !== Boolean(talk)) setMove(talk ? "forward" : "back");
  }
  // What each section's stage shows, by the link: when it is the same on coming
  // back, the section opens on the pane it was left on (Back to the index
  // stays on the index); a different one (a link to a page) opens the stage.
  const opened =
    active.id === "chats"
      ? (chatId ?? "")
      : active.id === "wiki"
        ? `${wikiPage ?? ""}|${wikiTab ?? ""}`
        : active.id === "settings"
          ? (settingsTab ?? "")
          : "";
  // Nothing open in it yet, a section starts on its list.
  const fresh =
    (active.id === "chats" && !chatId) ||
    (active.id === "wiki" && !wikiPage && !wikiTab) ||
    (active.id === "settings" && !settingsTab);
  const [pane, setPane] = useState<Pane>(fresh ? "list" : "stage");
  const [left, setLeft] = useState<
    Readonly<Record<string, { pane: Pane; opened: string }>>
  >({});
  const [prevSection, setPrevSection] = useState(active.id);
  const [prevOpened, setPrevOpened] = useState(opened);
  if (prevSection === active.id && prevOpened !== opened) setPrevOpened(opened);
  if (prevSection !== active.id) {
    setLeft((was) => ({ ...was, [prevSection]: { pane, opened: prevOpened } }));
    setPrevSection(active.id);
    setPrevOpened(opened);
    setMove(null);
    setListSheet(false);
    const remembered = left[active.id];
    setPane(
      remembered && remembered.opened === opened
        ? remembered.pane
        : fresh
          ? "list"
          : "stage",
    );
  }

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
  const narrow = split ? (active.narrow ?? "pane") : null;
  const shownPane: Pane =
    narrow === "sheet" || (active.id === "world" && Boolean(talk))
      ? "stage"
      : pane;
  const showList = Boolean(Sidebar) && (docked || shownPane === "list");
  const showStage = !split || shownPane === "stage";
  const [listLabel, stageLabel] = active.panes ?? ["List", active.label];
  const paneNav: PaneNav =
    narrow === "pane"
      ? {
          back: {
            label: listLabel,
            go: () => {
              slide("back", () => {
                setMove(null);
                setPane("list");
              });
            },
          },
        }
      : narrow === "sheet"
        ? {
            list: {
              label: listLabel,
              icon: active.listIcon ? (
                <active.listIcon aria-hidden />
              ) : undefined,
              open: () => setListSheet(true),
            },
          }
        : {};
  // Docked, You is always open beside the stage; in a drawer, only a pick opens it.
  const showDocked = wide && (Boolean(selection) || Boolean(player.id));

  return (
    <div
      className="grid h-dvh grid-cols-[4.5rem_minmax(0,1fr)] grid-rows-[auto_minmax(0,1fr)_auto] bg-ui-ground text-ui-ink max-md:grid-cols-[minmax(0,1fr)]"
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
        onOpenDetails={() => {
          if (!player.id) return;
          setInspectorTab("you");
          void select({ kind: "character", id: player.id });
          requestInspector();
        }}
      />
      <SectionNav className="col-start-1 row-span-2 row-start-2 max-md:row-span-1 max-md:row-start-3" />
      <div className="col-start-2 row-start-2 flex min-h-0 min-w-0 gap-4 pe-4 pb-3 max-lg:flex-col max-lg:gap-3 max-md:col-start-1 max-md:gap-2 max-md:overflow-x-clip max-md:p-0">
        {narrow === "tabs" && !talk ? (
          <Segmented<Pane>
            aria-label={`${active.label} view`}
            stretch
            value={pane}
            onValueChange={(value) => value && setPane(value)}
            className="max-md:mx-3 max-md:w-auto [&_button]:h-7"
          >
            <SegmentedItem value="list">{listLabel}</SegmentedItem>
            <SegmentedItem value="stage">{stageLabel}</SegmentedItem>
          </Segmented>
        ) : null}
        {showList && Sidebar ? (
          <aside
            aria-label={`${active.label} list`}
            className={cx(
              "flex min-h-0 w-76 shrink-0 flex-col max-lg:w-auto max-lg:flex-1 max-md:px-3",
              split && "[view-transition-name:pane]",
              split && move === "back" && "motion-safe:animate-ui-pane-back",
            )}
          >
            <Sidebar
              key={active.id}
              onNavigated={() =>
                slide("forward", () => {
                  setMove(null);
                  setPane("stage");
                })
              }
            />
          </aside>
        ) : null}
        {showStage ? (
          <main
            key={split && !docked ? `${active.id}-${shownPane}` : active.id}
            className={cx(
              "flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden rounded-[1.5rem] ui-raised *:min-h-0 *:flex-1 max-md:rounded-none max-md:shadow-none max-md:inset-ring-0",
              !docked && "[view-transition-name:pane]",
              split && move === "forward" && "motion-safe:animate-ui-pane-in",
            )}
          >
            <PaneNavProvider value={paneNav}>
              {satisfies(resolved, active.requires) ? (
                <Stage />
              ) : (
                <Unavailable requires={active.requires} />
              )}
            </PaneNavProvider>
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
      <StatusBar className="col-start-2 row-start-3 max-md:hidden" />

      {narrow === "sheet" && Sidebar ? (
        <Drawer
          open={listSheet}
          onOpenChange={setListSheet}
          side={tablet ? "right" : "bottom"}
          snapPoints={tablet ? undefined : [0.7, 1]}
        >
          <DrawerPanel
            title={listLabel}
            heading={tablet}
            handle={tablet ? undefined : `Resize ${listLabel.toLowerCase()}`}
          >
            <div className="flex min-h-0 flex-col px-3 pt-3">
              <Sidebar key={active.id} />
            </div>
          </DrawerPanel>
        </Drawer>
      ) : null}

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
        onOpenedWiki={() => setPane("stage")}
      />
      <WorldUpdateNotice />
      <UpdateSaveDialog />
      <PlayAsDialog />
      <SavesDialog />
      <VisitorWelcome />
      <Toasts />
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
