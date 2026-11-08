"use client";

import { useQueryStates, parseAsString } from "nuqs";
import { settingsParsers } from "@/components/views/settings/search-params";
import { useShallow } from "zustand/react/shallow";
import { CircleAlertIcon, XIcon } from "lucide-react";
import {
  Alert,
  AlertAction,
  AlertDescription,
  AlertTitle,
} from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { useCharacters } from "@/hooks/use-characters";
import { useLiveStore } from "@/lib/live/state";

import { useUiStore, dismissFailures } from "@/lib/state/ui-store";

const keyOf = (id: string, error: string): string => `${id}\n${error}`;

/**
 * Says why nobody is answering, for as long as that stays true, until the
 * player closes it.
 */
export function ChatFailure({ members }: { members: readonly string[] }) {
  const closed = useUiStore((state) => state.dismissedFailures);
  const { byId } = useCharacters();
  const [, setParams] = useQueryStates({
    view: parseAsString,
    "settings.tab": settingsParsers["settings.tab"],
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
          <p>{first[1]}</p>
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
              dismissFailures(failing.map(([id, error]) => keyOf(id, error)))
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
