import { GlobeIcon, ListIcon, MessagesSquareIcon } from "lucide-react";
import { ChatsView } from "@/components/views/chats/chats-view";
import { TimelineView } from "@/components/views/timeline/timeline-view";
import { WorldView } from "@/components/views/world/world-view";
import type { StageView } from "./types";

/** Slots reserved for later: `social`, `wiki` (see references/roadmap.md). */
export const STAGE_VIEWS: readonly StageView[] = [
  { id: "world", label: "World", icon: GlobeIcon, order: 0, requires: ["characters"], component: WorldView },
  { id: "chats", label: "Chats", icon: MessagesSquareIcon, order: 10, requires: ["chats"], component: ChatsView },
  { id: "timeline", label: "Timeline", icon: ListIcon, order: 20, requires: ["timeline"], component: TimelineView },
];

export const DEFAULT_VIEW = "world";
