"use client";

import { parseAsString, useQueryState } from "nuqs";
import { useActiveView } from "@/hooks/use-active-view";
import { NavRail, NavRailItem } from "@/ui/nav-rail";
import { useSections } from "./sections";
import { TalksBadge, TextsBadge } from "./unread-badges";

/** Texts count on Chats; what was said to you face to face counts on World. */
const BADGES: Record<string, () => React.ReactNode> = {
  chats: TextsBadge,
  world: TalksBadge,
};

export function SectionNav({ className }: { className?: string }) {
  const sections = useSections();
  const active = useActiveView();
  const [, setView] = useQueryState("view", parseAsString);

  return (
    <NavRail label="Sections" className={className}>
      {sections.map((view) => {
        const Badge = BADGES[view.id] ?? view.badge;
        return (
          <NavRailItem
            key={view.id}
            icon={<view.icon aria-hidden />}
            label={view.label}
            badge={Badge ? <Badge /> : undefined}
            current={view.id === active.id}
            end={view.placement === "end"}
            onClick={() => void setView(view.id)}
          />
        );
      })}
    </NavRail>
  );
}
