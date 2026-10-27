import { GlobeIcon, ListIcon, MessagesSquareIcon } from "lucide-react";
import { ChatsPanel } from "@/components/views/chats/chats-panel";
import { ChatsUnreadBadge } from "@/components/views/chats/chats-unread-badge";
import { ChatsView } from "@/components/views/chats/chats-view";
import { TimelineSidebar } from "@/components/views/timeline/timeline-sidebar";
import { TimelineView } from "@/components/views/timeline/timeline-view";
import { WorldSidebar } from "@/components/views/world/world-sidebar";
import { WorldView } from "@/components/views/world/world-view";
import type { StageView } from "./types";

/** Slots reserved for later: `social`, `wiki` (see references/roadmap.md). */
export const STAGE_VIEWS: readonly StageView[] = [
  {
    id: "world",
    label: "World",
    icon: GlobeIcon,
    order: 0,
    requires: ["characters"],
    component: WorldView,
    sidebar: WorldSidebar,
  },
  {
    id: "chats",
    label: "Chats",
    icon: MessagesSquareIcon,
    order: 10,
    requires: ["chats"],
    component: ChatsView,
    sidebar: ChatsPanel,
    badge: ChatsUnreadBadge,
  },
  {
    id: "timeline",
    label: "Timeline",
    icon: ListIcon,
    order: 20,
    requires: ["timeline"],
    component: TimelineView,
    sidebar: TimelineSidebar,
  },
];

export const DEFAULT_VIEW = "world";
