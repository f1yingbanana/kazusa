import { CharacterConversationsSection } from "@/components/inspector/sections/character-conversations";
import { CharacterDesiresSection } from "@/components/inspector/sections/character-desires";
import { CharacterHeaderSection } from "@/components/inspector/sections/character-header";
import { CharacterNowSection } from "@/components/inspector/sections/character-now";
import { CharacterProfileSection } from "@/components/inspector/sections/character-profile";
import { CharacterRecentSection } from "@/components/inspector/sections/character-recent";
import { CharacterLocationSection } from "@/components/inspector/sections/character-location";
import { ChatSummarySection } from "@/components/inspector/sections/chat-summary";
import { PlaceHeaderSection } from "@/components/inspector/sections/place-header";
import { PlacePeopleSection } from "@/components/inspector/sections/place-people";
import { PlaceWaysSection } from "@/components/inspector/sections/place-ways";
import type { InspectorSection } from "./types";

/** Header sections render without a title. Later: Attention, Relationships. */
export const INSPECTOR_SECTIONS: readonly InspectorSection[] = [
  { id: "character.header", entity: "character", title: "", order: 0, requires: ["characters"], component: CharacterHeaderSection },
  { id: "character.now", entity: "character", title: "Now", order: 10, requires: ["status"], component: CharacterNowSection },
  { id: "character.location", entity: "character", title: "Location", order: 12, requires: ["places", "location"], component: CharacterLocationSection },
  { id: "character.desires", entity: "character", title: "Desires", order: 15, requires: ["characters", "desires"], component: CharacterDesiresSection },
  { id: "character.recent", entity: "character", title: "Recent", order: 20, requires: ["timeline"], component: CharacterRecentSection },
  { id: "character.conversations", entity: "character", title: "Conversations", order: 30, requires: ["chats"], component: CharacterConversationsSection },
  { id: "character.profile", entity: "character", title: "Profile", order: 40, requires: ["characters"], component: CharacterProfileSection },
  { id: "chat.summary", entity: "chat", title: "", order: 0, requires: [], component: ChatSummarySection },
  { id: "place.header", entity: "place", title: "", order: 0, requires: ["places"], component: PlaceHeaderSection },
  { id: "place.people", entity: "place", title: "People", order: 10, requires: ["places", "location", "characters"], component: PlacePeopleSection },
  { id: "place.ways", entity: "place", title: "Getting around", order: 20, requires: ["places"], component: PlaceWaysSection },
].sort((a, b) => a.order - b.order) as InspectorSection[];
