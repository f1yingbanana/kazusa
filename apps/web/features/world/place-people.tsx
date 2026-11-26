"use client";

import type { CharacterSummary } from "@kazusa/client";
import { useQueryStates } from "nuqs";
import { useSelfIn } from "@/hooks/use-self";
import { firstName } from "@/lib/format";
import { useRealtimeStore } from "@/lib/live/realtime-state";
import { actionLine, listNames } from "@/lib/source/chats/display";
import { serializeEntityRef } from "@/lib/state/entity-ref";
import { taskIcon, taskLabel } from "@/lib/state/task-icon";
import { markQuietSelection } from "@/lib/state/ui-store";
import { ListRow } from "@/ui/list";
import { TalkGroup } from "@/ui/talk-group";
import { CharacterAvatar } from "../characters/character-avatar";
import { usePresence } from "../characters/presence";
import { conversationParsers, conversationPatch } from "../chats/open";
import { usePlainText } from "../wiki/links";
import { rememberTalkOrigin } from "./talk-origin";
import type { Talk } from "./talks";

/**
 * Who is at a place, the way the room is laid out: each talk as a group of the
 * people in it (nobody is in two), its latest line opening it, then everyone
 * else. `talkingOnly` leaves out those not talking.
 */
export function PlacePeople({
  people,
  talks,
  talkingOnly = false,
  selectedId,
  onPick,
}: {
  people: readonly CharacterSummary[];
  talks: readonly Talk[];
  talkingOnly?: boolean;
  selectedId?: string | null;
  onPick: (character: CharacterSummary) => void;
}) {
  const byId = new Map(people.map((c) => [c.id, c]));
  const talking = new Set(talks.flatMap((t) => t.chat.members));
  const loose = talkingOnly ? [] : people.filter((c) => !talking.has(c.id));
  const row = (c: CharacterSummary) => (
    <li key={c.id}>
      <PersonRow
        character={c}
        current={selectedId === c.id}
        onPick={() => onPick(c)}
      />
    </li>
  );
  return (
    <ul className="flex flex-col gap-1">
      {talks.map((talk) => (
        <li key={talk.chat.id}>
          <TalkGroupOf
            talk={talk}
            people={talk.chat.members
              .map((m) => byId.get(m))
              .filter((c): c is CharacterSummary => Boolean(c))}
          >
            {(c) => row(c)}
          </TalkGroupOf>
        </li>
      ))}
      {loose.map(row)}
    </ul>
  );
}

function TalkGroupOf({
  talk,
  people,
  children,
}: {
  talk: Talk;
  people: readonly CharacterSummary[];
  children: (character: CharacterSummary) => React.ReactNode;
}) {
  const selfOf = useSelfIn();
  const [params, setParams] = useQueryStates(conversationParsers);
  const speakers = useRealtimeStore(
    (state) => state.typingByChat[talk.chat.id],
  );
  const self = talk.mine ? selfOf(talk.chat) : "";
  const last = talk.chat.lastMessage;
  const who = (id: string | undefined, name: string | undefined) =>
    id && id === self ? "You" : firstName(name ?? "");
  const line = last
    ? last.type === "action"
      ? (() => {
          const told = actionLine(
            who(last.senderId, last.senderName),
            last.text,
          );
          return `${told.subject}${told.rest}`;
        })()
      : `${who(last.senderId, last.senderName)}: ${last.text}`
    : undefined;
  const speaking = speakers?.length
    ? `${listNames(speakers.map((s) => (s.senderId === self ? "You" : firstName(s.senderName))))} ${speakers.length > 1 ? "are" : "is"} speaking`
    : undefined;
  const names = listNames(people.map((c) => firstName(c.name)));

  return (
    <TalkGroup
      label={names ? `${names}, talking` : talk.chat.name}
      line={line}
      speaking={speaking}
      openLabel={talk.mine ? "Join the talk" : "Listen in"}
      current={params["world.talk"] === talk.chat.id}
      onOpen={(event) => {
        rememberTalkOrigin(event.currentTarget);
        const patch = conversationPatch(talk.chat, self || selfOf(talk.chat));
        if (patch.sel) markQuietSelection(serializeEntityRef(patch.sel));
        void setParams(patch);
      }}
    >
      {people.map(children)}
    </TalkGroup>
  );
}

function PersonRow({
  character,
  current,
  onPick,
}: {
  character: CharacterSummary;
  current: boolean;
  onPick: () => void;
}) {
  return (
    <ListRow
      current={current}
      onClick={onPick}
      leading={
        <CharacterAvatar
          id={character.id}
          name={character.name}
          avatarUrl={character.avatarUrl}
          kind={character.kind}
        />
      }
      title={character.name}
      sub={<Activity character={character} />}
    />
  );
}

/**
 * What someone is doing, by its category's icon and their own words; their
 * summary when they're doing nothing in particular.
 */
function Activity({ character }: { character: CharacterSummary }) {
  const { status } = usePresence(character);
  const plain = usePlainText();
  const task = status?.onstage === false ? undefined : status?.task;
  if (!task) return character.summary ? plain(character.summary) : null;
  const Icon = taskIcon(task.type);
  return (
    <>
      <Icon
        aria-label={taskLabel(task.type)}
        className="me-1 inline size-3 align-[-0.125em]"
      />
      {task.description}
    </>
  );
}
