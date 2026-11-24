"use client";

import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandGroupLabel,
  CommandInput,
  CommandItem,
  CommandList,
} from "@ui-sdk/react/command";
import {
  Dialog,
  DialogBackdrop,
  DialogContent,
  DialogTitle,
} from "@ui-sdk/react/dialog";
import {
  FastForwardIcon,
  MessagesSquareIcon,
  PaletteIcon,
  PauseIcon,
  PlayIcon,
  SearchIcon,
} from "lucide-react";
import { parseAsString, useQueryStates } from "nuqs";
import { chatsParsers } from "@/components/views/chats/search-params";
import { useCharacters } from "@/hooks/use-characters";
import { useChats } from "@/hooks/use-chats";
import { useClockActions, useClockAnchor } from "@/hooks/use-clock";
import { useObservedChats } from "@/hooks/use-observed-chats";
import { useSelfIn } from "@/hooks/use-self";
import { openChatPatch } from "@/lib/source/chats/display";
import type { ChatInfo } from "@/lib/source/chats/types";
import { entityRefParser, serializeEntityRef } from "@/lib/state/entity-ref";
import { markQuietSelection } from "@/lib/state/ui-store";
import { HaloFace } from "./halo-face";
import { useHaloSections } from "./halo-nav";
import { HALO_PALETTES, type HaloPalette } from "./palettes";

/** One box for everything: a person, a chat, a section, the clock, the palette. */
export function HaloCommand({
  open,
  onOpenChange,
  onPaletteChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onPaletteChange: (palette: HaloPalette) => void;
}) {
  const sections = useHaloSections();
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
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogBackdrop className="halo-backdrop" />
      <DialogContent className="halo-command-dialog">
        <DialogTitle className="sr-only">Search Kazusa</DialogTitle>
        <Command className="halo-command" loop>
          <div className="halo-command-search">
            <SearchIcon aria-hidden className="size-5" />
            <CommandInput
              aria-label="Search people, chats and actions"
              placeholder="A name, a chat, or what you want to do…"
            />
          </div>
          <CommandList className="halo-command-list">
            <CommandEmpty className="halo-command-empty">
              Nothing in Kivotos by that name.
            </CommandEmpty>

            <CommandGroup className="halo-command-group">
              <CommandGroupLabel className="halo-command-label">Go to</CommandGroupLabel>
              {sections.map((view) => (
                <CommandItem
                  key={view.id}
                  value={`view:${view.id}`}
                  label={view.label}
                  className="halo-command-item"
                  onSelect={run(() => void setParams({ view: view.id }))}
                >
                  <view.icon aria-hidden className="size-4" />
                  <span>{view.label}</span>
                </CommandItem>
              ))}
            </CommandGroup>

            {anchor ? (
              <CommandGroup className="halo-command-group">
                <CommandGroupLabel className="halo-command-label">Clock</CommandGroupLabel>
                <CommandItem
                  value="clock:toggle"
                  label={paused ? "Resume time" : "Pause time"}
                  keywords={["pause", "play", "stop", "time"]}
                  disabled={!enabled}
                  className="halo-command-item"
                  onSelect={run(() =>
                    apply({ action: "set_speed", speed: paused ? 1 : 0 }),
                  )}
                >
                  {paused ? (
                    <PlayIcon aria-hidden className="size-4" />
                  ) : (
                    <PauseIcon aria-hidden className="size-4" />
                  )}
                  <span>{paused ? "Resume time" : "Pause time"}</span>
                </CommandItem>
                {[10, 60].map((speed) => (
                  <CommandItem
                    key={speed}
                    value={`clock:speed:${speed}`}
                    label={`Run at ${speed}× speed`}
                    keywords={["speed", "fast", "time"]}
                    disabled={!enabled}
                    className="halo-command-item"
                    onSelect={run(() => apply({ action: "set_speed", speed }))}
                  >
                    <FastForwardIcon aria-hidden className="size-4" />
                    <span>{`Run at ${speed}× speed`}</span>
                  </CommandItem>
                ))}
                {[
                  { minutes: 60, label: "Skip ahead an hour" },
                  { minutes: 360, label: "Skip ahead six hours" },
                ].map((a) => (
                  <CommandItem
                    key={a.minutes}
                    value={`clock:advance:${a.minutes}`}
                    label={a.label}
                    keywords={["advance", "skip", "time"]}
                    disabled={!enabled}
                    className="halo-command-item"
                    onSelect={run(() => apply({ action: "advance", minutes: a.minutes }))}
                  >
                    <FastForwardIcon aria-hidden className="size-4" />
                    <span>{a.label}</span>
                  </CommandItem>
                ))}
              </CommandGroup>
            ) : null}

            {chats.length > 0 ? (
              <CommandGroup className="halo-command-group">
                <CommandGroupLabel className="halo-command-label">Chats</CommandGroupLabel>
                {chats.map((chat) => (
                  <CommandItem
                    key={chat.id}
                    value={`chat:${chat.id}`}
                    label={chat.name}
                    className="halo-command-item"
                    onSelect={run(() => openChat(chat))}
                  >
                    <MessagesSquareIcon aria-hidden className="size-4" />
                    <span>{chat.name}</span>
                  </CommandItem>
                ))}
              </CommandGroup>
            ) : null}

            <CommandGroup className="halo-command-group">
              <CommandGroupLabel className="halo-command-label">People</CommandGroupLabel>
              {people.map((c) => (
                <CommandItem
                  key={c.id}
                  value={`person:${c.id}`}
                  label={c.name}
                  keywords={[...(c.groups ?? []), c.summary ?? ""]}
                  className="halo-command-item halo-command-person"
                  onSelect={run(
                    () => void setParams({ sel: { kind: "character", id: c.id } }),
                  )}
                >
                  <HaloFace id={c.id} name={c.name} avatarUrl={c.avatarUrl} kind={c.kind} size="sm" />
                  <span className="halo-command-person-text">
                    <span>{c.name}</span>
                    {c.groups?.[0] ? (
                      <span className="halo-command-hint">{c.groups[0]}</span>
                    ) : null}
                  </span>
                </CommandItem>
              ))}
            </CommandGroup>

            <CommandGroup className="halo-command-group">
              <CommandGroupLabel className="halo-command-label">Palette</CommandGroupLabel>
              {HALO_PALETTES.map((p) => (
                <CommandItem
                  key={p.value}
                  value={`palette:${p.value}`}
                  label={`${p.label} palette`}
                  keywords={["theme", "colour", "color"]}
                  className="halo-command-item"
                  onSelect={run(() => onPaletteChange(p.value))}
                >
                  <PaletteIcon aria-hidden className="size-4" />
                  <span>{`${p.label} palette`}</span>
                  <span className="halo-duo halo-duo-sm" data-swatch={p.value} aria-hidden="true" />
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </DialogContent>
    </Dialog>
  );
}
