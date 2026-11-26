"use client";

import type { Domain, Permission } from "@kazusa/client";
import {
  BookOpenIcon,
  GlobeIcon,
  ListIcon,
  MessagesSquareIcon,
  SettingsIcon,
  UsersRoundIcon,
  type LucideIcon,
} from "lucide-react";
import { parseAsString, useQueryState } from "nuqs";
import type { ComponentType } from "react";
import { useAccess } from "@/hooks/use-access";
import { satisfies } from "@/lib/source/capabilities";
import { useSources } from "@/lib/source/provider";
import { CharactersStage } from "../characters/characters-stage";
import { ChatList } from "../chats/chat-list";
import { ChatsStage } from "../chats/chats-stage";
import { SettingsSidebar } from "../settings/settings-sidebar";
import { SettingsStage } from "../settings/settings-stage";
import { TimelineSidebar } from "../timeline/timeline-sidebar";
import { TimelineStage } from "../timeline/timeline-stage";
import { WikiSidebar } from "../wiki/wiki-sidebar";
import { WikiStage } from "../wiki/wiki-stage";
import { WhosWhere } from "../world/whos-where";
import { WorldStage } from "../world/world-stage";
import { TalksBadge, TextsBadge } from "./unread-badges";

export interface SectionSidebarProps {
  /** Called after the sidebar navigated or selected, so a sheet can close. */
  readonly onNavigated?: () => void;
}

/**
 * A part of the app: one rail icon, its list beside the stage (if it has one),
 * and the stage. `panes` names the two halves on a phone, where they take
 * turns.
 */
export interface Section {
  readonly id: string;
  readonly label: string;
  readonly icon: LucideIcon;
  readonly requires: readonly Domain[];
  readonly requiresPermission?: Permission;
  readonly Stage: ComponentType;
  readonly Sidebar?: ComponentType<SectionSidebarProps>;
  readonly Badge?: ComponentType;
  readonly panes?: readonly [list: string, stage: string];
  /**
   * Where a narrow screen puts the list: `pane`, in its place, the stage
   * reached from it and left by Back; `sheet`, over the stage, which is where
   * one lands (a list that only narrows it); `tabs`, beside it as two tabs when
   * both are a way to look at the same thing.
   */
  readonly narrow?: "pane" | "sheet" | "tabs";
  /** The list's icon on the button that opens it over the stage (`sheet`). */
  readonly listIcon?: LucideIcon;
  /** At the bottom of the rail with the app's own tools, off the phone's bar. */
  readonly end?: boolean;
}

export const SECTIONS: readonly Section[] = [
  {
    id: "world",
    label: "World",
    icon: GlobeIcon,
    requires: ["characters"],
    Stage: WorldStage,
    Sidebar: WhosWhere,
    // What was said to you face to face counts here.
    Badge: TalksBadge,
    panes: ["Who's where", "Map"],
    narrow: "tabs",
  },
  {
    id: "chats",
    label: "Chats",
    icon: MessagesSquareIcon,
    requires: ["chats"],
    Stage: ChatsStage,
    Sidebar: ChatList,
    Badge: TextsBadge,
    panes: ["Conversations", "Thread"],
    narrow: "pane",
  },
  {
    id: "timeline",
    label: "Timeline",
    icon: ListIcon,
    requires: ["timeline"],
    Stage: TimelineStage,
    Sidebar: TimelineSidebar,
    panes: ["Characters", "Timeline"],
    narrow: "sheet",
    listIcon: UsersRoundIcon,
  },
  {
    // The cast is the stage, and a profile is a page in it: no list beside.
    id: "characters",
    label: "Characters",
    icon: UsersRoundIcon,
    requires: ["wiki"],
    Stage: CharactersStage,
  },
  {
    id: "wiki",
    label: "Wiki",
    icon: BookOpenIcon,
    requires: ["wiki"],
    Stage: WikiStage,
    Sidebar: WikiSidebar,
    panes: ["Index", "Page"],
    narrow: "pane",
  },
  {
    id: "settings",
    label: "Settings",
    icon: SettingsIcon,
    requires: [],
    Stage: SettingsStage,
    Sidebar: SettingsSidebar,
    panes: ["Settings", "Settings"],
    narrow: "pane",
    end: true,
  },
];

/** Where everyone lands: what people are saying is what there is to see. */
const DEFAULT_SECTION = "chats";

/** The section the URL names, if this viewer may open it; else Chats. */
export function useActiveSection(): Section {
  const [requested] = useQueryState("view", parseAsString);
  const { hasPermission } = useAccess();
  const match = SECTIONS.find(
    (section) =>
      section.id === requested &&
      (!section.requiresPermission ||
        hasPermission(section.requiresPermission)),
  );
  return match ?? SECTIONS.find((section) => section.id === DEFAULT_SECTION)!;
}

/** The sections this viewer can open, in rail order. */
export function useSections(): Section[] {
  const { resolved } = useSources();
  const { hasPermission } = useAccess();
  return SECTIONS.filter(
    (section) =>
      satisfies(resolved, section.requires) &&
      (!section.requiresPermission ||
        hasPermission(section.requiresPermission)),
  );
}
