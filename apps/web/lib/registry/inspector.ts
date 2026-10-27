import { CharacterConversationsSection } from "@/components/inspector/sections/character-conversations";
import { CharacterHeaderSection } from "@/components/inspector/sections/character-header";
import { CharacterNowSection } from "@/components/inspector/sections/character-now";
import { CharacterProfileSection } from "@/components/inspector/sections/character-profile";
import { CharacterRecentSection } from "@/components/inspector/sections/character-recent";
import { ChatSummarySection } from "@/components/inspector/sections/chat-summary";
import type { InspectorSection } from "./types";

/** Header sections render without a title. Later: Needs, Attention, Relationships. */
export const INSPECTOR_SECTIONS: readonly InspectorSection[] = [
  { id: "character.header", entity: "character", title: "", order: 0, requires: ["characters"], component: CharacterHeaderSection },
  { id: "character.now", entity: "character", title: "Now", order: 10, requires: ["status"], component: CharacterNowSection },
  { id: "character.recent", entity: "character", title: "Recent", order: 20, requires: ["timeline"], component: CharacterRecentSection },
  { id: "character.conversations", entity: "character", title: "Conversations", order: 30, requires: ["chats"], component: CharacterConversationsSection },
  { id: "character.profile", entity: "character", title: "Profile", order: 40, requires: ["characters"], component: CharacterProfileSection },
  { id: "chat.summary", entity: "chat", title: "", order: 0, requires: [], component: ChatSummarySection },
].sort((a, b) => a.order - b.order) as InspectorSection[];
