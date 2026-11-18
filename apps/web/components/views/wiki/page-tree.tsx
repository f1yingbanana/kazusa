"use client";

import {
  BookOpenIcon,
  CalendarIcon,
  ChevronRightIcon,
  EyeIcon,
  FolderIcon,
  ImageIcon,
  ImagePlusIcon,
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
import { cn } from "@/lib/utils";

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

const rowClass = (selected: boolean) =>
  cn(
    "w-full justify-start font-normal",
    selected && "bg-accent text-accent-foreground",
  );

function Folder({
  label,
  icon: Icon,
  children,
}: {
  label: string;
  icon: LucideIcon;
  children: React.ReactNode;
}) {
  return (
    <Collapsible defaultOpen>
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
        <Icon />
        {label}
      </CollapsibleTrigger>
      <CollapsibleContent>
        <div className="ml-4 flex flex-col">{children}</div>
      </CollapsibleContent>
    </Collapsible>
  );
}

/**
 * A wiki's pages in a folder per kind, all open to start: shadcn's file tree
 * (ui.shadcn.com/docs/ai-elements/base/file-tree), a Collapsible per folder and
 * a Button per page. A character of the cast has a button for their view, as
 * Chats has one for their conversations; the world's has a Backdrops folder.
 */
export function PageTree({
  pages,
  selected,
  onSelect,
  viewable,
  onView,
  backdrops,
  backdrop,
  onBackdrop,
  onNewBackdrop,
}: {
  pages: readonly WikiListItem[];
  selected?: string | undefined;
  onSelect: (id: string) => void;
  /** Pages that are characters of the cast, by id: name. */
  viewable?: ReadonlyMap<string, string>;
  onView?: (id: string) => void;
  backdrops?: readonly { name: string; preview?: string | undefined }[];
  backdrop?: string | undefined;
  onBackdrop?: (name: string) => void;
  onNewBackdrop?: () => void;
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
          <Folder key={folder.kind} label={folder.label} icon={FolderIcon}>
            {inside.map((page) => {
              const who = viewable?.get(page.id);
              return (
                <div key={page.id} className="group/row flex items-center">
                  <Button
                    variant="ghost"
                    size="sm"
                    className={cn(
                      rowClass(selected === page.id),
                      "min-w-0 flex-1",
                    )}
                    aria-current={selected === page.id ? "true" : undefined}
                    title={page.summary || page.name}
                    onClick={() => onSelect(page.id)}
                  >
                    <folder.icon />
                    <span className="truncate">{page.name}</span>
                  </Button>
                  {who && onView ? (
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      className="shrink-0 opacity-0 group-focus-within/row:opacity-100 group-hover/row:opacity-100"
                      aria-label={`See ${who}'s view`}
                      title={`${who}'s view`}
                      onClick={() => onView(page.id)}
                    >
                      <EyeIcon />
                    </Button>
                  ) : null}
                </div>
              );
            })}
          </Folder>
        );
      })}
      {backdrops ? (
        <Folder label="Backdrops" icon={FolderIcon}>
          {backdrops.map((set) => (
            <Button
              key={set.name}
              variant="ghost"
              size="sm"
              className={rowClass(backdrop === set.name)}
              aria-current={backdrop === set.name ? "true" : undefined}
              onClick={() => onBackdrop?.(set.name)}
            >
              {set.preview ? (
                <img
                  src={set.preview}
                  alt=""
                  loading="lazy"
                  className="size-4 shrink-0 rounded-sm object-cover"
                />
              ) : (
                <ImageIcon />
              )}
              <span className="truncate">{set.name}</span>
            </Button>
          ))}
          {onNewBackdrop ? (
            <Button
              variant="ghost"
              size="sm"
              className="w-full justify-start font-normal text-muted-foreground"
              onClick={onNewBackdrop}
            >
              <ImagePlusIcon />
              New backdrop set
            </Button>
          ) : null}
        </Folder>
      ) : null}
    </div>
  );
}
