/*
  Everything the new UI still borrows from the old one in components/. Port a
  piece into ui/ or features/ (or its logic into lib/ and hooks/), then delete
  its line here. When this file is empty, components/ can go.
*/

export { PlaceChip, chatIcon, useChatTitle } from "@/components/entities/chips";
export { CharacterBrainSheet } from "@/components/inspector/sections/character-brain";
export {
  CharacterContextSection,
  CharacterContextSummary,
} from "@/components/inspector/sections/character-context";
export { CharacterMemorySheet } from "@/components/inspector/sections/character-memory";
export {
  CharacterModelSection,
  CharacterModelSummary,
} from "@/components/inspector/sections/character-model";
export { CharacterNowSection } from "@/components/inspector/sections/character-now";
export {
  CharacterRecentSection,
  CharacterRecentSummary,
} from "@/components/inspector/sections/character-recent";
export {
  CharacterStatesSection,
  CharacterStatesSummary,
} from "@/components/inspector/sections/character-states";
export { useStopBrain } from "@/components/inspector/sections/character-stop";
export { PlacePeopleSection } from "@/components/inspector/sections/place-people";
export { PlaceWaysSection } from "@/components/inspector/sections/place-ways";
export { PlayAsDialog } from "@/components/play/play-as-dialog";
export { Stage } from "@/components/shell/stage";
export { StatusBar } from "@/components/shell/status-bar";
export { VisitorWelcome } from "@/components/shell/visitor-welcome";
export { WorldUpdateNotice } from "@/components/shell/world-update-notice";
export {
  CastDialog,
  type CastRequest,
} from "@/components/views/characters/cast-dialog";
export { NewChatDialog } from "@/components/views/chats/new-chat-dialog";
export { chatsParsers } from "@/components/views/chats/search-params";
export { timelineParsers } from "@/components/views/timeline/search-params";
export { RichText } from "@/components/views/wiki/page-link";
export { wikiParsers } from "@/components/views/wiki/search-params";
export { worldParsers } from "@/components/views/world/search-params";
export {
  PLACE_PREFIX,
  usePlacesAvailable,
  useWorldNow,
} from "@/components/views/world/world-state";
