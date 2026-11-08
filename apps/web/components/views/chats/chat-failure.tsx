"use client";

import { useQueryStates, parseAsString } from "nuqs";
import { settingsParsers } from "@/components/views/settings/search-params";
import { useMemo, useSyncExternalStore } from "react";
import { CircleAlertIcon, XIcon } from "lucide-react";
import {
  Alert,
  AlertAction,
  AlertDescription,
  AlertTitle,
} from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { useCharacters, useStatusVersion } from "@/hooks/use-characters";
import { statusStore } from "@/lib/live/state";

/*
 * Failures the player closed, by who and what went wrong: the same error on a
 * later retry stays closed, a different one shows again. Kept for the session,
 * so it stays closed in every chat they share.
 */
let dismissed: ReadonlySet<string> = new Set();
const listeners = new Set<() => void>();
const keyOf = (id: string, error: string) => `${id}\n${error}`;

function dismiss(keys: readonly string[]) {
  dismissed = new Set([...dismissed, ...keys]);
  for (const listener of listeners) listener();
}

function useDismissed(): ReadonlySet<string> {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    () => dismissed,
    () => dismissed,
  );
}

/**
 * Says why nobody is answering, for as long as that stays true, until the
 * player closes it.
 */
export function ChatFailure({ members }: { members: readonly string[] }) {
  const version = useStatusVersion();
  const closed = useDismissed();
  const { byId } = useCharacters();
  const [, setParams] = useQueryStates({
    view: parseAsString,
    "settings.tab": settingsParsers["settings.tab"],
  });
  const failing = useMemo(
    () =>
      members.flatMap((id) => {
        const status = statusStore.get(id);
        return status?.failure &&
          status.brain !== "thinking" &&
          !closed.has(keyOf(id, status.failure.error))
          ? [{ id, error: status.failure.error }]
          : [];
      }),
    // `version` changes on every live status write.
    [members, version, closed],
  );
  const first = failing[0];
  if (!first) return null;
  const name = byId.get(first.id)?.name ?? first.id;

  return (
    <div className="mx-auto w-full max-w-3xl px-4 pb-2">
      <Alert variant="destructive" role="status">
        <CircleAlertIcon />
        <AlertTitle>
          {failing.length > 1
            ? `${failing.length} people here couldn't respond`
            : `${name} couldn't respond`}
        </AlertTitle>
        <AlertDescription className="wrap-anywhere">
          <p>{first.error}</p>
          <Button
            variant="link"
            size="xs"
            className="h-auto px-0"
            onClick={() =>
              void setParams({ view: "settings", "settings.tab": "models" })
            }
          >
            Check model settings
          </Button>
        </AlertDescription>
        <AlertAction>
          <Button
            variant="ghost"
            size="icon-xs"
            onClick={() =>
              dismiss(failing.map(({ id, error }) => keyOf(id, error)))
            }
          >
            <XIcon />
            <span className="sr-only">Dismiss</span>
          </Button>
        </AlertAction>
      </Alert>
    </div>
  );
}
