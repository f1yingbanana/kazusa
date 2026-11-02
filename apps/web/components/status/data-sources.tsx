"use client";

import { DOMAINS } from "@kazusa/client";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useSources } from "@/lib/source/provider";
import type { SourceKind } from "@/lib/source/capabilities";
import { cn } from "@/lib/utils";

const STYLES: Record<SourceKind, string> = {
  live: "text-foreground",
  unavailable: "text-muted-foreground/70 line-through",
};

/** Per-domain live / unavailable matrix (D10). */
export function DataSourcesItem() {
  const { resolved } = useSources();
  const live = DOMAINS.filter((d) => resolved[d] === "live").length;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger className="rounded-sm px-1 hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring">
        {live} live
      </DropdownMenuTrigger>
      <DropdownMenuContent side="top" className="w-64">
        <DropdownMenuGroup>
          <DropdownMenuLabel>Data sources</DropdownMenuLabel>
          <ul className="flex flex-col gap-0.5 px-1.5 pb-1">
            {DOMAINS.map((domain) => (
              <li
                key={domain}
                className="flex items-center justify-between gap-2 py-0.5 text-sm"
              >
                <span className="font-mono text-xs">{domain}</span>
                <span
                  className={cn(
                    "rounded-sm px-1 font-mono text-[11px]",
                    STYLES[resolved[domain]],
                  )}
                >
                  {resolved[domain]}
                </span>
              </li>
            ))}
          </ul>
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
