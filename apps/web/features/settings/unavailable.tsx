"use client";

import type { Domain } from "@kazusa/client";
import { PlugZapIcon, UnplugIcon } from "lucide-react";
import { useSources } from "@/lib/source/provider";
import { Button } from "@/ui/button";
import { Callout } from "@/ui/settings";
import { useOpenSettings } from "./search-params";

export function Unavailable({
  requires,
  title = "Not available from this backend yet",
}: {
  requires: readonly Domain[];
  title?: string;
}) {
  const { resolved, reachable, backendError, retryBackend } = useSources();
  const openSettings = useOpenSettings();
  const missing = requires.filter(
    (domain) => resolved[domain] === "unavailable",
  );

  if (!reachable) {
    return (
      <Callout
        tone="danger"
        icon={<UnplugIcon />}
        title="Can't reach the Kazusa server"
        action={
          <div className="flex flex-wrap gap-2">
            <Button size="sm" tone="soft" onClick={retryBackend}>
              Retry
            </Button>
            <Button
              size="sm"
              tone="ghost"
              onClick={() => openSettings("connection")}
            >
              Connection
            </Button>
          </div>
        }
      >
        {backendError?.message ?? "The Gateway did not answer."} Start the
        Gateway, or point Connection settings at a running one.
      </Callout>
    );
  }

  return (
    <Callout icon={<PlugZapIcon />} title={title}>
      Needs:{" "}
      <span className="font-[ui-monospace,monospace] text-xs">
        {(missing.length ? missing : requires).join(", ")}
      </span>
    </Callout>
  );
}
