"use client";

import { CircleAlertIcon, XIcon } from "lucide-react";
import { parseAsString, useQueryStates } from "nuqs";
import { useShallow } from "zustand/react/shallow";
import { useCharacters } from "@/hooks/use-characters";
import { useLiveStore } from "@/lib/live/state";
import type { Chat } from "@/lib/source/chats/types";
import { dismissFailures, useUiStore } from "@/lib/state/ui-store";
import { Button, IconButton } from "@/ui/button";
import { cx } from "@/ui/cx";
import { EmptySeats } from "@/ui/empty-seats";
import { AddPeople, aloneCopy } from "./chat-controls";

const keyOf = (id: string, error: string): string => `${id}\n${error}`;

/**
 * Why nobody is answering, for as long as that stays true, until it's closed.
 * `onScene` draws it on a scene's scrim instead of the page.
 */
export function ChatFailure({
  members,
  onScene = false,
}: {
  members: readonly string[];
  onScene?: boolean;
}) {
  const closed = useUiStore((state) => state.dismissedFailures);
  const { byId } = useCharacters();
  const [, setParams] = useQueryStates({
    view: parseAsString,
    "settings.tab": parseAsString,
  });
  const failures = useLiveStore(
    useShallow(
      (state) =>
        new Map(
          members.flatMap((id) => {
            const status = state.statuses.get(id);
            return status?.failure &&
              status.brain !== "thinking" &&
              !closed.has(keyOf(id, status.failure.error))
              ? [[id, status.failure.error] as const]
              : [];
          }),
        ),
    ),
  );
  const failing = [...failures];
  const first = failing[0];
  if (!first) return null;
  const name = byId.get(first[0])?.name ?? first[0];
  const title =
    failing.length > 1
      ? `${failing.length} people here couldn't respond`
      : `${name} couldn't respond`;

  return (
    <div
      role="status"
      className={cx(
        "flex min-w-0 flex-wrap items-center gap-x-2.5 gap-y-1 rounded-[1.125rem] py-2 ps-3.5 pe-1.5 text-[0.8125rem] motion-safe:animate-ui-enter",
        onScene
          ? "bg-ui-surface/88 inset-ring inset-ring-ui-danger/40"
          : "mx-auto mb-2 w-[calc(100%-2rem)] max-w-3xl bg-ui-surface inset-ring inset-ring-ui-danger/40",
      )}
    >
      <CircleAlertIcon aria-hidden className="size-4 shrink-0 text-ui-danger" />
      <span className="font-bold text-ui-danger">{title}</span>
      <span
        className="min-w-0 flex-1 basis-40 truncate text-ui-soft"
        title={first[1]}
      >
        {first[1]}
      </span>
      <Button
        tone="link"
        size="sm"
        onClick={() =>
          void setParams({ view: "settings", "settings.tab": "models" })
        }
      >
        Check model settings
      </Button>
      <IconButton
        label="Dismiss"
        size="sm"
        onClick={() =>
          dismissFailures(failing.map(([id, error]) => keyOf(id, error)))
        }
      >
        <XIcon aria-hidden />
      </IconButton>
    </div>
  );
}

/**
 * Nobody else in a group or a talk you're in: said once, at the end of the
 * conversation, with the way to bring someone in.
 */
export function ChatAlone({
  chat,
  canAdd,
  placeName,
  onScene = false,
}: {
  chat: Chat;
  canAdd: boolean;
  placeName?: string;
  onScene?: boolean;
}) {
  const copy = aloneCopy(chat, canAdd);
  return (
    <aside
      aria-label="No one else here"
      className={cx(
        "motion-safe:animate-ui-enter",
        onScene
          ? "rounded-[1.125rem] bg-ui-surface/88"
          : "mx-auto mt-2 w-full max-w-md rounded-[1.25rem] bg-ui-tint/60",
      )}
    >
      <EmptySeats
        slim
        title={copy.title}
        action={
          canAdd ? <AddPeople chat={chat} placeName={placeName} /> : undefined
        }
      >
        {copy.body}
      </EmptySeats>
    </aside>
  );
}

/** A talk you're watching that everyone has left. */
export function EmptyRoom({ slim = false }: { slim?: boolean }) {
  return (
    <aside
      aria-label="No one here"
      className={slim ? "rounded-[1.125rem] bg-ui-surface/88" : "m-auto"}
    >
      <EmptySeats slim={slim} title="The room is empty">
        Everyone has left. Wait for someone to wander in.
      </EmptySeats>
    </aside>
  );
}
