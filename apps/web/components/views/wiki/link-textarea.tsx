"use client";

import { useRef, useState } from "react";
import type { WikiListItem } from "@kazusa/client";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

/** The `[[` being typed before the caret, if any: where it starts, and what. */
function openLink(
  text: string,
  caret: number,
): { start: number; query: string } | undefined {
  const before = text.slice(0, caret);
  const start = before.lastIndexOf("[[");
  if (start < 0) return undefined;
  const query = before.slice(start + 2);
  return /[\]\n|]/.test(query) ? undefined : { start, query };
}

/**
 * A textarea where typing `[[` offers the wiki's pages, and picking one writes
 * a link to it, `[[id]]`, which readers see as its name.
 */
export function LinkTextarea({
  value,
  onChange,
  pages,
  className,
  ...props
}: Omit<React.ComponentProps<"textarea">, "value" | "onChange"> & {
  value: string;
  onChange: (value: string) => void;
  pages: readonly WikiListItem[];
}) {
  const area = useRef<HTMLTextAreaElement>(null);
  const [link, setLink] = useState<{ start: number; query: string }>();
  const [active, setActive] = useState(0);
  const needle = link?.query.trim().toLowerCase() ?? "";
  const matches = link
    ? pages
        .filter(
          (page) =>
            !needle ||
            page.name.toLowerCase().includes(needle) ||
            page.id.includes(needle),
        )
        .toSorted(
          (a, b) =>
            Number(b.name.toLowerCase().startsWith(needle)) -
              Number(a.name.toLowerCase().startsWith(needle)) ||
            a.name.localeCompare(b.name),
        )
        .slice(0, 8)
    : [];

  const watch = (text: string, caret: number) => {
    setLink(openLink(text, caret));
    setActive(0);
  };
  const pick = (page: WikiListItem) => {
    if (!link || !area.current) return;
    const caret = area.current.selectionStart;
    const written = `[[${page.id}]]`;
    const next = `${value.slice(0, link.start)}${written}${value.slice(caret)}`;
    onChange(next);
    setLink(undefined);
    const at = link.start + written.length;
    requestAnimationFrame(() => {
      area.current?.focus();
      area.current?.setSelectionRange(at, at);
    });
  };

  return (
    <div className="relative">
      <Textarea
        {...props}
        ref={area}
        value={value}
        className={className}
        onChange={(event) => {
          onChange(event.target.value);
          watch(event.target.value, event.target.selectionStart);
        }}
        onKeyDown={(event) => {
          // Enter while composing (Japanese, Chinese…) belongs to the input method.
          if (!link || !matches.length || event.nativeEvent.isComposing) return;
          if (event.key === "ArrowDown" || event.key === "ArrowUp") {
            event.preventDefault();
            setActive(
              (at) =>
                (at + (event.key === "ArrowDown" ? 1 : -1) + matches.length) %
                matches.length,
            );
          } else if (event.key === "Enter" || event.key === "Tab") {
            event.preventDefault();
            pick(matches[active]);
          } else if (event.key === "Escape") {
            event.preventDefault();
            setLink(undefined);
          }
        }}
        onBlur={() => setLink(undefined)}
      />
      {link && matches.length ? (
        <ul
          role="listbox"
          aria-label="Link to a page"
          className="absolute inset-x-0 top-full z-20 mt-1 max-h-64 overflow-y-auto rounded-lg bg-popover p-1 text-sm text-popover-foreground shadow-md ring-1 ring-foreground/10"
        >
          {matches.map((page, at) => (
            <li
              key={page.id}
              role="option"
              aria-selected={at === active}
              className={cn(
                "flex cursor-default items-baseline gap-2 rounded-md px-2 py-1.5",
                at === active && "bg-accent text-accent-foreground",
              )}
              // Before the textarea's blur, so the pick lands.
              onMouseDown={(event) => {
                event.preventDefault();
                pick(page);
              }}
              onMouseEnter={() => setActive(at)}
            >
              <span className="truncate">{page.name}</span>
              <span className="truncate text-xs text-muted-foreground">
                {page.id}
              </span>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
