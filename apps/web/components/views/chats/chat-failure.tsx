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
import { SCRIM } from "./scene/scrim";

const keyOf = (id: string, error: string): string => `${id}\n${error}`;

/**
 * Says why nobody is answering, for as long as that stays true, until the
 * player closes it. Under a transcript, a card; over a scene (`slim`), one row
 * directly above the dialogue panel, on the scene's own surface.
 */
export function ChatFailure({
  members,
  slim = false,
}: {
  members: readonly string[];
  slim?: boolean;
}) {
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
  const title =
    failing.length > 1
      ? `${failing.length} people here couldn't respond`
      : `${name} couldn't respond`;
  const settings = () =>
    void setParams({ view: "settings", "settings.tab": "models" });
  const dismiss = () =>
    dismissFailures(failing.map(([id, error]) => keyOf(id, error)));

  if (slim)
    return (
      <div
        role="status"
        className="flex min-w-0 items-center gap-2 rounded-lg border border-destructive/30 py-1 pr-1 pl-2.5 text-sm"
        style={{ backgroundColor: SCRIM }}
      >
        <CircleAlertIcon
          aria-hidden
          className="size-4 shrink-0 text-destructive"
        />
        <span className="shrink-0 font-medium text-destructive">{title}</span>
        <span
          className="min-w-0 truncate text-muted-foreground"
          title={first[1]}
        >
          {first[1]}
        </span>
        <Button
          variant="link"
          size="xs"
          className="ml-auto h-auto shrink-0 px-1"
          onClick={settings}
        >
          Check model settings
        </Button>
        <Button variant="ghost" size="icon-xs" onClick={dismiss}>
          <XIcon />
          <span className="sr-only">Dismiss</span>
        </Button>
      </div>
    );

  return (
    <div className="mx-auto w-full max-w-3xl px-4 pb-2">
      <Alert variant="destructive" role="status">
        <CircleAlertIcon />
        <AlertTitle>{title}</AlertTitle>
        <AlertDescription className="wrap-anywhere">
          <p>{first[1]}</p>
          <Button
            variant="link"
            size="xs"
            className="h-auto px-0"
            onClick={settings}
          >
            Check model settings
          </Button>
        </AlertDescription>
        <AlertAction>
          <Button variant="ghost" size="icon-xs" onClick={dismiss}>
            <XIcon />
            <span className="sr-only">Dismiss</span>
          </Button>
        </AlertAction>
      </Alert>
    </div>
  );
}
