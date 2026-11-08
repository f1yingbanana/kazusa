"use client";

import { useQueryStates, parseAsString } from "nuqs";
import { entityRefParser, serializeEntityRef } from "@/lib/state/entity-ref";
import { chatsParsers } from "@/components/views/chats/search-params";
import { useEffect, useMemo } from "react";
import { MapPinIcon } from "lucide-react";
import { chatIcon } from "@/components/entities/chips";
import { PresenceAvatar } from "@/components/entities/presence-avatar";
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  Command,
} from "@/components/ui/command";
import { useCharacters } from "@/hooks/use-characters";
import { useChats } from "@/hooks/use-chats";
import { useObservedChats } from "@/hooks/use-observed-chats";
import { usePlaces } from "@/hooks/use-location";
import { useAccess } from "@/hooks/use-access";
import { placeName } from "@/lib/location/places";
import { STAGE_VIEWS } from "@/lib/registry/views";
import { openChatPatch } from "@/lib/source/chats/display";
import type { ChatInfo } from "@/lib/source/chats/types";
import { useKazusaConfig } from "@/lib/state/config-store";
import { markQuietSelection } from "@/lib/state/inspector-request";

/** The palette isn't virtualized; only the latest of others' chats are listed. */
const MAX_OBSERVED = 100;

/**
 * ⌘K: jump to any section, chat, or character from anywhere. This is what
 * replaces the always-visible roster: picking a character selects it (the
 * inspector opens) without leaving the current section.
 */
export function CommandPalette({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [, setParams] = useQueryStates({
    view: parseAsString,
    sel: entityRefParser,
    "chats.id": chatsParsers["chats.id"],
  });
  const { characters } = useCharacters();
  const { chats } = useChats();
  const { chats: observed } = useObservedChats();
  const places = usePlaces();
  const config = useKazusaConfig();
  const { hasPermission } = useAccess();

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (
        event.key?.toLowerCase() === "k" &&
        (event.metaKey || event.ctrlKey)
      ) {
        event.preventDefault();
        onOpenChange(!open);
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, onOpenChange]);

  function go(patch: Parameters<typeof setParams>[0]) {
    void setParams(patch);
    onOpenChange(false);
  }

  // As from the chat list: the inspector follows without covering the chat.
  function openChat(chat: ChatInfo) {
    const patch = openChatPatch(chat, config.userId);
    if (patch.sel) markQuietSelection(serializeEntityRef(patch.sel));
    go(patch);
  }

  const people = useMemo(
    () =>
      characters
        .filter((c) => c.kind !== "player")
        .sort((a, b) => a.name.localeCompare(b.name)),
    [characters],
  );

  return (
    <CommandDialog
      open={open}
      onOpenChange={onOpenChange}
      title="Jump to anything"
      description="Search sections, chats, places, and characters."
    >
      <Command>
        <CommandInput placeholder="Search characters, places, chats, sections" />
        <CommandList className="max-h-96">
          <CommandEmpty>Nothing matches.</CommandEmpty>
          <CommandGroup heading="Sections">
            {STAGE_VIEWS.filter(
              (view) =>
                !view.requiresPermission ||
                hasPermission(view.requiresPermission),
            ).map((view) => (
              <CommandItem
                key={view.id}
                value={`section ${view.label}`}
                onSelect={() => go({ view: view.id })}
              >
                <view.icon />
                {view.label}
              </CommandItem>
            ))}
          </CommandGroup>
          {chats.length > 0 ? (
            <CommandGroup heading="Chats">
              {chats.map((chat) => {
                const Icon = chatIcon(chat.type);
                return (
                  <CommandItem
                    key={chat.id}
                    value={`chat ${chat.name} ${chat.id}`}
                    onSelect={() => openChat(chat)}
                  >
                    <Icon />
                    <span className="truncate">{chat.name}</span>
                  </CommandItem>
                );
              })}
            </CommandGroup>
          ) : null}
          {observed.length > 0 ? (
            <CommandGroup heading="Other chats">
              {observed.slice(0, MAX_OBSERVED).map((chat) => {
                const Icon = chatIcon(chat.type);
                return (
                  <CommandItem
                    key={chat.id}
                    value={`chat ${chat.name} ${chat.id}`}
                    onSelect={() => openChat(chat)}
                  >
                    <Icon />
                    <span className="truncate">{chat.name}</span>
                  </CommandItem>
                );
              })}
            </CommandGroup>
          ) : null}
          {places && places.places.length > 0 ? (
            <CommandGroup heading="Places">
              {places.places.map((place) => (
                <CommandItem
                  key={place.id}
                  value={`place ${place.name} ${place.aliases.join(" ")} ${place.id}`}
                  onSelect={() =>
                    go({
                      sel: { kind: "place", id: place.id },
                    })
                  }
                >
                  <MapPinIcon />
                  <span className="truncate">{place.name}</span>
                  {place.parent ? (
                    <span className="ml-auto truncate text-xs text-muted-foreground">
                      {placeName(places, place.parent)}
                    </span>
                  ) : null}
                </CommandItem>
              ))}
            </CommandGroup>
          ) : null}
          {people.length > 0 ? (
            <CommandGroup heading="Characters">
              {people.map((character) => (
                <CommandItem
                  key={character.id}
                  value={`character ${character.name} ${character.aliases.join(" ")} ${character.affiliation ?? ""}`}
                  onSelect={() =>
                    go({
                      sel: {
                        kind: "character",
                        id: character.id,
                      },
                    })
                  }
                >
                  <PresenceAvatar
                    id={character.id}
                    name={character.name}
                    avatarUrl={character.avatarUrl}
                    kind={character.kind}
                    size="xs"
                  />
                  <span className="truncate">{character.name}</span>
                  {character.affiliation ? (
                    <span className="ml-auto truncate text-xs text-muted-foreground">
                      {character.affiliation}
                    </span>
                  ) : null}
                </CommandItem>
              ))}
            </CommandGroup>
          ) : null}
        </CommandList>
      </Command>
    </CommandDialog>
  );
}
