"use client";

import { parseAsString, useQueryStates } from "nuqs";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { MemoryTab } from "@/components/views/wiki/memory-tab";
import { failureText } from "@/components/views/wiki/parts";
import { wikiParsers } from "@/components/views/wiki/search-params";
import { useAccess } from "@/hooks/use-access";
import { useWikiCharacter } from "@/hooks/use-wiki-editor";

/**
 * A character's `MEMORY.md` in a side panel from their inspector: read by
 * anyone, edited by the owner.
 */
export function CharacterMemorySheet({
  id,
  name,
  open,
  onOpenChange,
}: {
  id: string;
  name: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [, setParams] = useQueryStates({
    view: parseAsString,
    ...wikiParsers,
  });
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      {/* Above the inspector, which is itself a sheet on narrow screens. */}
      <SheetContent side="right" className="z-60 w-full gap-0 sm:max-w-xl">
        <SheetHeader>
          <SheetTitle>{`${name}'s memory`}</SheetTitle>
          <SheetDescription>
            Their notes on their life and plans, rewritten by their sleep each
            night. More detailed long-term memories of particular people, places
            and things are in{" "}
            <button
              type="button"
              className="text-foreground underline underline-offset-2 hover:no-underline"
              onClick={() => {
                onOpenChange(false);
                void setParams({
                  view: "wiki",
                  "wiki.agent": id,
                  "wiki.page": null,
                  "wiki.part": null,
                  "wiki.edit": null,
                  "wiki.tab": null,
                });
              }}
            >
              their own wiki pages
            </button>
            .
          </SheetDescription>
        </SheetHeader>
        <div className="min-h-0 flex-1 overflow-y-auto p-4 pt-0">
          {open ? <MemoryEditor id={id} /> : null}
        </div>
      </SheetContent>
    </Sheet>
  );
}

function MemoryEditor({ id }: { id: string }) {
  const { data, error, mutate } = useWikiCharacter(id);
  const { canManage } = useAccess();
  if (error)
    return <p className="text-sm text-destructive">{failureText(error)}</p>;
  if (!data) return <p className="text-sm text-muted-foreground">Loading…</p>;
  return (
    <MemoryTab
      character={data}
      onSaved={() => mutate()}
      headed={false}
      readOnly={!canManage}
    />
  );
}
