"use client";

import {
  BookOpenIcon,
  CalendarIcon,
  ChevronRightIcon,
  FolderIcon,
  MapPinIcon,
  UserRoundIcon,
  type LucideIcon,
} from "lucide-react";
import type { WikiKind, WikiListItem } from "@kazusa/client";
import { Button } from "@/components/ui/button";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";

const FOLDERS: ReadonlyArray<{
  readonly kind: WikiKind;
  readonly label: string;
  readonly icon: LucideIcon;
}> = [
  { kind: "person", label: "People", icon: UserRoundIcon },
  { kind: "place", label: "Places", icon: MapPinIcon },
  { kind: "concept", label: "Concepts", icon: BookOpenIcon },
  { kind: "day", label: "Journal", icon: CalendarIcon },
];

/**
 * A wiki's pages in a folder per kind, all open to start: shadcn's file tree
 * (ui.shadcn.com/docs/ai-elements/base/file-tree), a Collapsible per folder and
 * a Button per page.
 */
export function PageTree({
  pages,
  selected,
  onSelect,
}: {
  pages: readonly WikiListItem[];
  selected?: string | undefined;
  onSelect: (id: string) => void;
}) {
  return (
    <div className="flex flex-col text-sm">
      {FOLDERS.map((folder) => {
        const inside = pages
          .filter((page) => page.kind === folder.kind)
          .sort((a, b) =>
            // The newest day first; everything else by name.
            folder.kind === "day"
              ? b.id.localeCompare(a.id)
              : a.name.localeCompare(b.name),
          );
        if (!inside.length) return null;
        return (
          <Collapsible key={folder.kind} defaultOpen>
            <CollapsibleTrigger
              render={
                <Button
                  variant="ghost"
                  size="sm"
                  className="w-full justify-start font-normal aria-expanded:bg-transparent aria-expanded:hover:bg-muted dark:aria-expanded:hover:bg-muted/50"
                />
              }
            >
              <ChevronRightIcon className="transition-transform group-data-panel-open/button:rotate-90" />
              <FolderIcon />
              {folder.label}
            </CollapsibleTrigger>
            <CollapsibleContent>
              <div className="ml-4 flex flex-col">
                {inside.map((page) => (
                  <Button
                    key={page.id}
                    variant="ghost"
                    size="sm"
                    className={`w-full justify-start font-normal ${
                      selected === page.id
                        ? "bg-accent text-accent-foreground"
                        : ""
                    }`}
                    aria-current={selected === page.id ? "true" : undefined}
                    title={page.summary || page.name}
                    onClick={() => onSelect(page.id)}
                  >
                    <folder.icon />
                    <span className="truncate">{page.name}</span>
                  </Button>
                ))}
              </div>
            </CollapsibleContent>
          </Collapsible>
        );
      })}
    </div>
  );
}
