"use client";

import { useMemo } from "react";
import { CircleAlertIcon } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { useCharacters, useStatusVersion } from "@/hooks/use-characters";
import { useNavigate } from "@/hooks/use-url-state";
import { statusStore } from "@/lib/live/state";

/** Says why nobody is answering, for as long as that stays true. */
export function ChatFailure({ members }: { members: readonly string[] }) {
  const version = useStatusVersion();
  const { byId } = useCharacters();
  const navigate = useNavigate();
  const failing = useMemo(
    () =>
      members.flatMap((id) => {
        const status = statusStore.get(id);
        return status?.failure && status.brain !== "thinking"
          ? [{ id, error: status.failure.error }]
          : [];
      }),
    // `version` changes on every live status write.
    [members, version],
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
              navigate({ view: "settings", "settings.tab": "models" })
            }
          >
            Check model settings
          </Button>
        </AlertDescription>
      </Alert>
    </div>
  );
}
