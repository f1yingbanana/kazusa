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
import { serializeEntityRef, type EntityRef } from "@/lib/state/entity-ref";
import { setSectionOpen, useSectionOpen } from "@/lib/state/preferences-store";
import { cn } from "@/lib/utils";

const KIND_LABEL = {
  character: "Character",
  chat: "Chat",
  place: "Place",
} as const;

/** Entity-polymorphic and slim: depth belongs in stage views. */
export function Inspector() {
  const [selection, select] = useSelection();
  const { resolved } = useSources();
  const { hasPermission } = useAccess();

  if (!selection) {
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

  const sections = INSPECTOR_SECTIONS.filter(
    (section) =>
      section.entity === selection.kind &&
      satisfies(resolved, section.requires) &&
      (!section.requiresPermission ||
        hasPermission(section.requiresPermission)),
  );

  // No title bar: the header section says what this is. The close button sits
  // in its corner and scrolls away with it; each header keeps its first row
  // clear of it (`pr-8`).
  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
      <div className="relative flex flex-col">
        <Button
          variant="ghost"
          size="icon-sm"
          className="absolute top-3 right-3 z-10 text-muted-foreground"
          onClick={() => void select(null)}
        >
          <XIcon />
          <span className="sr-only">Close details</span>
        </Button>
        {sections.length === 0 ? (
          <p className="p-4 pr-12 text-sm text-muted-foreground">{`Nothing to show for this ${selection.kind} yet.`}</p>
        ) : (
          // Keyed by the entity too: a half-typed rename or a pending remove
          // must not carry over to the next chat or character.
          sections.map((section) => (
            <SectionFrame
              key={`${section.id}:${serializeEntityRef(selection)}`}
              section={section}
              entity={selection}
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
      className="flex flex-col gap-2 border-b px-4 py-4 last:border-b-0"
    >
      {section.title ? (
        <h3 className="flex items-center justify-between gap-2 font-mono text-[11px] font-medium tracking-wide text-muted-foreground uppercase">
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
          <span className="shrink-0 font-mono text-[11px] font-medium tracking-wide text-muted-foreground uppercase">
            {section.title}
          </span>
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
