"use client";

import { PlugZapIcon, UnplugIcon } from "lucide-react";
import type { Domain } from "@kazusa/client";
import { Button } from "@/components/ui/button";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { useNavigate } from "@/hooks/use-url-state";
import { useSources } from "@/lib/source/provider";
import { cn } from "@/lib/utils";

/**
 * Honest empty state for a domain the backend doesn't provide. Never a blank
 * panel.
 */
export function Unavailable({
  requires,
  title = "Not available from this backend yet",
  className,
}: {
  requires: readonly Domain[];
  title?: string;
  className?: string;
}) {
  const { resolved, reachable, backendError, retryBackend } = useSources();
  const navigate = useNavigate();
  const missing = requires.filter(
    (domain) => resolved[domain] === "unavailable",
  );
  if (!reachable) {
    return (
      <Empty className={cn("border-none", className)}>
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <UnplugIcon />
          </EmptyMedia>
          <EmptyTitle>{"Can't reach the Kazusa server"}</EmptyTitle>
          <EmptyDescription>
            {backendError?.message ?? "The Gateway did not answer."} Start the
            Gateway, or point Settings at it.
          </EmptyDescription>
        </EmptyHeader>
        <EmptyContent className="flex-row justify-center">
          <Button size="sm" variant="outline" onClick={retryBackend}>
            Retry
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={() =>
              navigate({ view: "settings", "settings.tab": "connection" })
            }
          >
            Connection settings
          </Button>
        </EmptyContent>
      </Empty>
    );
  }

  return (
    <Empty className={cn("border-none", className)}>
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <PlugZapIcon />
        </EmptyMedia>
        <EmptyTitle>{title}</EmptyTitle>
        <EmptyDescription>
          Needs:{" "}
          <span className="font-mono">
            {(missing.length ? missing : requires).join(", ")}
          </span>
        </EmptyDescription>
      </EmptyHeader>
    </Empty>
  );
}

/** Inline variant for small slots (inspector rows, list footers). */
export function NeedsLine({
  requires,
  children,
}: {
  requires: readonly Domain[];
  children?: React.ReactNode;
}) {
  return (
    <p className="text-xs leading-relaxed text-muted-foreground">
      {children ?? "Not available yet."} Needs:{" "}
      <span className="font-mono">{requires.join(", ")}</span>
    </p>
  );
}
