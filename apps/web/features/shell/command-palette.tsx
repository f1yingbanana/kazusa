"use client";

import {
  FastForwardIcon,
  MessagesSquareIcon,
  PaletteIcon,
  PauseIcon,
  PlayIcon,
} from "lucide-react";
import { parseAsString, useQueryStates } from "nuqs";
import { useCharacters } from "@/hooks/use-characters";
import { useChats } from "@/hooks/use-chats";
import { useClockActions, useClockAnchor } from "@/hooks/use-clock";
import { useObservedChats } from "@/hooks/use-observed-chats";
import { useSelfIn } from "@/hooks/use-self";
import { openChatPatch } from "@/lib/source/chats/display";
import type { ChatInfo } from "@/lib/source/chats/types";
import { entityRefParser, serializeEntityRef } from "@/lib/state/entity-ref";
import { markQuietSelection } from "@/lib/state/ui-store";
import { CommandDialog, CommandGroup, CommandItem } from "@/ui/command";
import { PaletteSwatch } from "@/ui/palette-swatch";
import { PALETTES, type Palette } from "@/ui/palettes";
import { CharacterAvatar } from "../characters/character-avatar";
import { chatsParsers } from "../legacy";
import { useSections } from "./sections";

const SKIPS = [
  { minutes: 60, label: "Skip ahead an hour" },
  { minutes: 360, label: "Skip ahead six hours" },
] as const;

/** One box for everything: a person, a chat, a section, the clock, the palette. */
export function CommandPalette({
  open,
  onOpenChange,
  onPaletteChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onPaletteChange: (palette: Palette) => void;
}) {
  const sections = useSections();
  const { byId } = useCharacters();
  const { chats: mine } = useChats();
  const observed = useObservedChats();
  const selfOf = useSelfIn();
  const anchor = useClockAnchor();
  const { apply, enabled } = useClockActions();
  const [, setParams] = useQueryStates({
    view: parseAsString,
    "chats.id": chatsParsers["chats.id"],
    "chats.member": chatsParsers["chats.member"],
    sel: entityRefParser,
  });

  const run = (action: () => void) => () => {
    action();
    onOpenChange(false);
  };

  const mineIds = new Set(mine.map((c) => c.id));
  const chats: ChatInfo[] = [
    ...mine,
    ...observed.chats.filter((c) => !mineIds.has(c.id)),
  ];
  const people = Array.from(byId.values());
  const paused = anchor?.clock.speed === 0;

  const openChat = (chat: ChatInfo) => {
    const patch = openChatPatch(chat, selfOf(chat));
    if (patch.sel) markQuietSelection(serializeEntityRef(patch.sel));
    void setParams(patch);
  };

  return (
    <CommandDialog
      open={open}
      onOpenChange={onOpenChange}
      title="Search"
      label="Search people, chats and actions"
      placeholder="A name, a chat, or what you want to do…"
      empty="Nothing by that name."
    >
      <CommandGroup label="Go to">
        {sections.map((view) => (
          <CommandItem
            key={view.id}
            value={`view:${view.id}`}
            label={view.label}
            icon={<view.icon aria-hidden />}
            onSelect={run(() => void setParams({ view: view.id }))}
          >
            {view.label}
          </CommandItem>
        ))}
      </CommandGroup>

      {anchor ? (
        <CommandGroup label="Clock">
          <CommandItem
            value="clock:toggle"
            label={paused ? "Resume time" : "Pause time"}
            keywords={["pause", "play", "stop", "time"]}
            disabled={!enabled}
            icon={paused ? <PlayIcon aria-hidden /> : <PauseIcon aria-hidden />}
            onSelect={run(() =>
              apply({ action: "set_speed", speed: paused ? 1 : 0 }),
            )}
          >
            {paused ? "Resume time" : "Pause time"}
          </CommandItem>
          {[10, 60].map((speed) => (
            <CommandItem
              key={speed}
              value={`clock:speed:${speed}`}
              label={`Run at ${speed}× speed`}
              keywords={["speed", "fast", "time"]}
              disabled={!enabled}
              icon={<FastForwardIcon aria-hidden />}
              onSelect={run(() => apply({ action: "set_speed", speed }))}
            >
              {`Run at ${speed}× speed`}
            </CommandItem>
          ))}
          {SKIPS.map((skip) => (
            <CommandItem
              key={skip.minutes}
              value={`clock:advance:${skip.minutes}`}
              label={skip.label}
              keywords={["advance", "skip", "time"]}
              disabled={!enabled}
              icon={<FastForwardIcon aria-hidden />}
              onSelect={run(() =>
                apply({ action: "advance", minutes: skip.minutes }),
              )}
            >
              {skip.label}
            </CommandItem>
          ))}
        </CommandGroup>
      ) : null}

      {chats.length > 0 ? (
        <CommandGroup label="Chats">
          {chats.map((chat) => (
            <CommandItem
              key={chat.id}
              value={`chat:${chat.id}`}
              label={chat.name}
              icon={<MessagesSquareIcon aria-hidden />}
              onSelect={run(() => openChat(chat))}
            >
              {chat.name}
            </CommandItem>
          ))}
        </CommandGroup>
      ) : null}

      <CommandGroup label="People">
        {people.map((c) => (
          <CommandItem
            key={c.id}
            value={`person:${c.id}`}
            label={c.name}
            keywords={[...(c.groups ?? []), c.summary ?? ""]}
            icon={
              <CharacterAvatar
                id={c.id}
                name={c.name}
                avatarUrl={c.avatarUrl}
                kind={c.kind}
                size="sm"
              />
            }
            hint={c.groups?.[0]}
            onSelect={run(
              () => void setParams({ sel: { kind: "character", id: c.id } }),
            )}
          >
            {c.name}
          </CommandItem>
        ))}
      </CommandGroup>

      <CommandGroup label="Palette">
        {PALETTES.map((p) => (
          <CommandItem
            key={p.value}
            value={`palette:${p.value}`}
            label={`${p.label} palette`}
            keywords={["theme", "colour", "color"]}
            icon={<PaletteIcon aria-hidden />}
            trailing={<PaletteSwatch palette={p.value} size="sm" />}
            onSelect={run(() => onPaletteChange(p.value))}
          >
            {`${p.label} palette`}
          </CommandItem>
        ))}
      </CommandGroup>
    </CommandDialog>
  );
}
