"use client";

import { ChevronRightIcon, MousePointerClickIcon, XIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { useAccess } from "@/hooks/use-access";
import { useSelection } from "@/hooks/use-selection";
import { INSPECTOR_SECTIONS } from "@/lib/registry/inspector";
import type { InspectorSection as InspectorSectionEntry } from "@/lib/registry/types";
import { satisfies } from "@/lib/source/capabilities";
import { useSources } from "@/lib/source/provider";
import {
  serializeEntityRef,
  type EntityKind,
  type EntityRef,
} from "@/lib/state/entity-ref";
import { setSectionOpen, useSectionOpen } from "@/lib/state/preferences-store";
import {
  closeInspectorTab,
  markQuietSelection,
  openInspectorTab,
  setInspectorTab,
  useUiStore,
} from "@/lib/state/ui-store";
import { SECTION_TITLE } from "@/components/inspector/parts";
import { useEffect } from "react";
import { cn } from "@/lib/utils";

const KIND_LABEL = {
  character: "Character",
  chat: "Chat",
  place: "Place",
} as const;

/** Tabs in a fixed order, so each kind keeps its place. */
const KIND_ORDER = ["character", "place", "chat"] as const;

/**
 * Entity-polymorphic and slim: depth belongs in stage views. One tab per kind
 * stays open as the selection moves on (the last character, place and chat
 * selected), and while the person plays someone, You: that character's page,
 * the same as anyone's less what a section leaves out for the one played.
 */
export function Inspector() {
  const [selection, select] = useSelection();
  const { player } = useSources();
  const tab = useUiStore((state) => state.inspectorTab);
  const tabs = useUiStore((state) => state.inspectorTabs);
  const key = selection ? serializeEntityRef(selection) : null;
  // The URL says what is shown: the one played is You, anyone or anything else
  // opens its kind's tab (or takes it over). Who you play changing is looked at
  // again too: the one you now play leaves the Character tab for You.
  useEffect(() => {
    const { inspectorTabs } = useUiStore.getState();
    if (player.id && inspectorTabs.character === player.id)
      closeInspectorTab("character");
    if (!selection) return;
    if (selection.kind === "character" && selection.id === player.id)
      setInspectorTab("you");
    else openInspectorTab(selection.kind, selection.id);
    // `selection` is followed through `key`, which names it.
  }, [key, player.id]);

  const kinds = KIND_ORDER.filter(
    (kind) =>
      tabs[kind] !== undefined &&
      !(kind === "character" && tabs[kind] === player.id),
  );
  const open: ("you" | EntityKind)[] = [
    ...(player.id ? (["you"] as const) : []),
    ...kinds,
  ];
  if (!open.length) return <EmptyInspector />;
  const showing = open.includes(tab) ? tab : open[0];
  // Showing a tab selects what it shows, so the next pick of anything else (or
  // the same thing again) is a change the URL sees.
  const show = (next: "you" | EntityKind) => {
    setInspectorTab(next);
    const id = next === "you" ? player.id : tabs[next];
    if (id === undefined) return;
    const ref: EntityRef = { kind: next === "you" ? "character" : next, id };
    // The sheet, already open, stays open.
    markQuietSelection(serializeEntityRef(ref));
    void select(ref);
  };
  const close = (kind: EntityKind) => {
    closeInspectorTab(kind);
    const next = open.find((other) => other !== kind);
    if (next) show(next);
    else void select(null);
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {open.length > 1 ? (
        <div
          role="tablist"
          aria-label="Inspector"
          className="flex shrink-0 gap-1 border-b px-2 py-1.5"
        >
          {open.map((one) => (
            <TabButton
              key={one}
              selected={showing === one}
              onClick={() => show(one)}
            >
              {one === "you" ? "You" : KIND_LABEL[one]}
            </TabButton>
          ))}
        </div>
      ) : null}
      {showing === "you" ? (
        <EntitySections entity={{ kind: "character", id: player.id }} />
      ) : (
        <EntitySections
          entity={{ kind: showing, id: tabs[showing]! }}
          onClose={() => close(showing)}
        />
      )}
    </div>
  );
}

function EmptyInspector() {
  return (
    <Empty className="border-none">
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <MousePointerClickIcon />
        </EmptyMedia>
        <EmptyTitle>Nothing selected</EmptyTitle>
        <EmptyDescription>
          Pick a character in the roster, or any name in a view.
        </EmptyDescription>
      </EmptyHeader>
    </Empty>
  );
}

function TabButton({
  selected,
  onClick,
  children,
}: {
  selected: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={selected}
      onClick={onClick}
      className={cn(
        "min-w-0 truncate rounded-md px-2.5 py-1 text-xs font-medium text-muted-foreground outline-none hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring",
        selected && "bg-muted text-foreground",
      )}
    >
      {children}
    </button>
  );
}

/**
 * One entity's sections, as the registry lists them for its kind and what the
 * viewer may see. No title bar: the header section says what this is. The close
 * button sits in its corner and scrolls away with it; each header keeps its
 * first row clear of it (`pr-8`).
 */
function EntitySections({
  entity,
  onClose,
}: {
  entity: EntityRef;
  onClose?: () => void;
}) {
  const { resolved } = useSources();
  const { hasPermission } = useAccess();
  const sections = INSPECTOR_SECTIONS.filter(
    (section) =>
      section.entity === entity.kind &&
      satisfies(resolved, section.requires) &&
      (!section.requiresPermission ||
        hasPermission(section.requiresPermission)),
  );
  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
      <div className="relative flex flex-col">
        {onClose ? (
          <Button
            variant="ghost"
            size="icon-sm"
            className="absolute top-3 right-3 z-10 text-muted-foreground"
            onClick={onClose}
          >
            <XIcon />
            <span className="sr-only">Close details</span>
          </Button>
        ) : null}
        {sections.length === 0 ? (
          <p className="p-4 pr-12 text-sm text-muted-foreground">{`Nothing to show for this ${entity.kind} yet.`}</p>
        ) : (
          // Keyed by the entity too: a half-typed rename or a pending remove
          // must not carry over to the next chat or character.
          sections.map((section) => (
            <SectionFrame
              key={`${section.id}:${serializeEntityRef(entity)}`}
              section={section}
              entity={entity}
            />
          ))
        )}
      </div>
    </div>
  );
}

const appliesToAll = () => true;

function SectionFrame({
  section,
  entity,
}: {
  section: InspectorSectionEntry;
  entity: EntityRef;
}) {
  const useApplies = section.useApplies ?? appliesToAll;
  if (!useApplies(entity)) return null;
  if (section.fold) return <FoldingSection section={section} entity={entity} />;
  return (
    <section
      aria-label={section.title || KIND_LABEL[entity.kind]}
      className="flex flex-col gap-2 border-b p-4 last:border-b-0"
    >
      {section.title ? (
        <h3
          className={cn(
            "flex items-center justify-between gap-2",
            SECTION_TITLE,
          )}
        >
          {section.title}
        </h3>
      ) : null}
      <section.component entity={entity} />
    </section>
  );
}

/**
 * Detail a glance doesn't need: the title row opens it, and while folded a
 * summary keeps its one key fact in view.
 */
function FoldingSection({
  section,
  entity,
}: {
  section: InspectorSectionEntry;
  entity: EntityRef;
}) {
  const open = useSectionOpen(section.id, section.fold === "open");
  const Summary = section.summary;
  return (
    <section
      aria-label={section.title}
      className="flex flex-col border-b last:border-b-0"
    >
      <h3>
        <button
          type="button"
          aria-expanded={open}
          onClick={() => setSectionOpen(section.id, !open)}
          className="group/fold flex h-10 w-full items-center gap-2 px-4 text-left outline-none hover:bg-accent/40 focus-visible:bg-accent/40 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring"
        >
          <span className={cn("shrink-0", SECTION_TITLE)}>{section.title}</span>
          <span className="min-w-0 flex-1 truncate text-right text-xs text-muted-foreground">
            {!open && Summary ? <Summary entity={entity} /> : null}
          </span>
          <ChevronRightIcon
            aria-hidden
            className={cn(
              "size-3.5 shrink-0 text-muted-foreground transition-transform duration-150 motion-reduce:transition-none",
              open && "rotate-90",
            )}
          />
        </button>
      </h3>
      {open ? (
        <div className="flex flex-col gap-2 px-4 pb-4">
          <section.component entity={entity} />
        </div>
      ) : null}
    </section>
  );
}
