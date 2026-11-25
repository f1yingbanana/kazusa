"use client";

import { useEffect } from "react";
import { useSelection } from "@/hooks/use-selection";
import { useSources } from "@/lib/source/provider";
import {
  serializeEntityRef,
  type EntityKind,
  type EntityRef,
} from "@/lib/state/entity-ref";
import {
  closeInspectorTab,
  markQuietSelection,
  openInspectorTab,
  setInspectorTab,
  useUiStore,
} from "@/lib/state/ui-store";
import { Note } from "@/ui/note";
import { Segmented, SegmentedItem } from "@/ui/segmented";
import { CharacterDetail } from "../characters/character-detail";
import { ChatDetail } from "../chats/chat-detail";
import { PlaceDetail } from "../places/place-detail";

const KIND_LABEL = {
  character: "Character",
  place: "Place",
  chat: "Chat",
} as const;
const KIND_ORDER = ["character", "place", "chat"] as const;
type Tab = "you" | EntityKind;

/**
 * You (whoever you play) is always there, plus the last character, place and
 * chat picked. Docked, closing a tab falls back to the next one; in a drawer,
 * closing dismisses the drawer.
 */
export function DetailsPanel({ docked }: { docked: boolean }) {
  const [selection, select] = useSelection();
  const { player } = useSources();
  const tab = useUiStore((state) => state.inspectorTab);
  const tabs = useUiStore((state) => state.inspectorTabs);
  const key = selection ? serializeEntityRef(selection) : null;

  // biome-ignore lint/correctness/useExhaustiveDependencies: `key` names the selection
  useEffect(() => {
    const { inspectorTabs } = useUiStore.getState();
    if (player.id && inspectorTabs.character === player.id)
      closeInspectorTab("character");
    if (!selection) return;
    if (selection.kind === "character" && selection.id === player.id)
      setInspectorTab("you");
    else openInspectorTab(selection.kind, selection.id);
  }, [key, player.id]);

  const kinds = KIND_ORDER.filter(
    (kind) =>
      tabs[kind] !== undefined &&
      !(kind === "character" && tabs[kind] === player.id),
  );
  const open: Tab[] = [...(player.id ? (["you"] as const) : []), ...kinds];
  if (!open.length) {
    return (
      <Note inset="panel">Pick someone or somewhere to see them here.</Note>
    );
  }
  const showing = open.includes(tab) ? tab : open[0];

  const show = (next: Tab) => {
    setInspectorTab(next);
    const id = next === "you" ? player.id : tabs[next];
    if (id === undefined) return;
    const ref: EntityRef = { kind: next === "you" ? "character" : next, id };
    markQuietSelection(serializeEntityRef(ref));
    void select(ref);
  };
  const close = (kind: EntityKind) => {
    closeInspectorTab(kind);
    if (!docked) {
      void select(null);
      return;
    }
    const next = open.find((other) => other !== kind);
    if (next) show(next);
    else void select(null);
  };

  const shownId = showing === "you" ? player.id : tabs[showing]!;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {open.length > 1 ? (
        <Segmented<Tab>
          aria-label="Details"
          className="mx-4 mt-3"
          value={showing}
          onValueChange={(value) => value && show(value)}
        >
          {open.map((one) => (
            <SegmentedItem key={one} value={one}>
              {one === "you" ? "You" : KIND_LABEL[one]}
            </SegmentedItem>
          ))}
        </Segmented>
      ) : null}
      <div
        className="flex min-h-0 flex-1 flex-col motion-safe:animate-ui-enter"
        key={`${showing}:${shownId}`}
      >
        {showing === "you" ? (
          <CharacterDetail
            id={player.id}
            onClose={docked ? undefined : () => void select(null)}
          />
        ) : showing === "character" ? (
          <CharacterDetail id={shownId} onClose={() => close("character")} />
        ) : showing === "place" ? (
          <PlaceDetail id={shownId} onClose={() => close("place")} />
        ) : (
          <ChatDetail id={shownId} onClose={() => close("chat")} />
        )}
      </div>
    </div>
  );
}
