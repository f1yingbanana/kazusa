"use client";

import { parseAsString, useQueryState } from "nuqs";
import { useMediaQuery } from "@/hooks/use-media-query";
import { NavRail, NavRailItem } from "@/ui/nav-rail";
import { useActiveSection, useSections } from "./sections";

export function SectionNav({ className }: { className?: string }) {
  const sections = useSections();
  const active = useActiveSection();
  const [, setView] = useQueryState("view", parseAsString);
  const side = useMediaQuery("(min-width: 768px)");

  return (
    <NavRail
      label="Sections"
      vertical={side}
      current={active.id}
      currentOffBar={!side && Boolean(active.end)}
      className={className}
    >
      {sections.map((section) => (
        <NavRailItem
          key={section.id}
          value={section.id}
          icon={<section.icon aria-hidden />}
          label={section.label}
          badge={section.Badge ? <section.Badge /> : undefined}
          end={section.end}
          href={`?view=${section.id}`}
          onClick={() => void setView(section.id)}
        />
      ))}
    </NavRail>
  );
}
