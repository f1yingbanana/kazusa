"use client";

import { useState } from "react";
import type { ContextSettings } from "@kazusa/client";
import {
  CONTEXT_DOCS_URL,
  ContextSettingsForm,
  describeSetting,
  SETTING_LABELS,
} from "@/components/context/context-form";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { useCharacter } from "@/hooks/use-characters";
import { useContextSettings } from "@/hooks/use-context-settings";
import type { EntityRef } from "@/lib/state/entity-ref";

/**
 * Only what differs from the world, so the inspector stays short; Customize
 * opens the Settings page's form for this character.
 */
export function CharacterContextSection({ entity }: { entity: EntityRef }) {
  const character = useCharacter(entity.id);
  const { data, error } = useContextSettings(entity.id);
  // Controlled only so a save can close it.
  const [open, setOpen] = useState(false);
  const name = character?.name ?? entity.id;

  if (error)
    return (
      <p className="text-sm text-muted-foreground">
        Couldn’t load their settings: {error.message}
      </p>
    );
  if (!data) return <Skeleton className="h-16 w-full" />;
  const own = (Object.keys(data.overrides) as (keyof ContextSettings)[]).filter(
    (key) => data.overrides[key] !== undefined,
  );

  return (
    <div className="flex flex-col gap-3">
      {own.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          Follows the world’s settings.
        </p>
      ) : (
        <dl className="flex flex-col gap-1.5 text-sm">
          {own.map((key) => (
            <div
              key={key}
              className="flex items-baseline justify-between gap-3"
            >
              <dt className="text-muted-foreground">{SETTING_LABELS[key]}</dt>
              <dd className="font-mono tabular-nums">
                {describeSetting(key, data.effective[key])}
              </dd>
            </div>
          ))}
        </dl>
      )}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogTrigger
          render={<Button variant="outline" size="sm" className="self-start" />}
        >
          Customize
        </DialogTrigger>
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>Memory and context for {name}</DialogTitle>
            <DialogDescription>
              Each setting follows the world until you change it here.{" "}
              <a
                href={CONTEXT_DOCS_URL}
                target="_blank"
                rel="noreferrer"
                className="underline underline-offset-4 hover:text-foreground"
              >
                How memory and context work
              </a>
            </DialogDescription>
          </DialogHeader>
          <ContextSettingsForm
            agentId={entity.id}
            inDialog
            onDone={() => setOpen(false)}
          />
        </DialogContent>
      </Dialog>
    </div>
  );
}
