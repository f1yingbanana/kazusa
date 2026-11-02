"use client";

import { useState } from "react";
import type { EmbeddingModelOption } from "@kazusa/client";
import { RolePicker } from "@/components/models/role-picker";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { FieldDescription } from "@/components/ui/field";
import { useDecisionModels, useEmbeddingModels } from "@/hooks/use-model-roles";
import { useProviderLabel } from "@/hooks/use-providers";
import { SettingsSection } from "./settings-section";

const count = new Intl.NumberFormat("en");

/** Judges what reaches a character, with no text written. */
export function DecisionSettings() {
  const { data, error, select } = useDecisionModels();
  const providerLabel = useProviderLabel();
  const options = data?.options ?? [];
  const current = options.find((option) => option.ref === data?.current);

  const missing =
    current && !current.available
      ? `Add a ${providerLabel(current.provider)} key under Providers to use this.`
      : undefined;

  return (
    <SettingsSection
      title="Decision model"
      description="Model used to make quick decisions on whether a character should respond to something. Without one a character responds to everything, resulting in slower responses and more token usage."
    >
      {error && !data ? (
        <p className="text-sm text-destructive">{error.message}</p>
      ) : null}
      <RolePicker
        title="Decision model"
        options={options}
        current={data?.current}
        loading={!data && !error}
        onSelect={(ref) => void select(ref)}
        className="max-w-md"
      />
      {missing ? <FieldDescription>{missing}</FieldDescription> : null}
    </SettingsSection>
  );
}

/**
 * Lets characters recall by meaning. A model with other vectors means embedding
 * every passage again, which is said before it happens.
 */
export function MemorySearchSettings() {
  const { data, error, select } = useEmbeddingModels();
  const providerLabel = useProviderLabel();
  const [pending, setPending] = useState<EmbeddingModelOption>();
  const options = data?.options ?? [];
  const current = options.find((option) => option.ref === data?.current);

  const choose = (ref: string) => {
    const next = options.find((option) => option.ref === ref);
    if (!next) return;
    if (current && next.vectors !== current.vectors) setPending(next);
    else void select(next.ref);
  };

  const progress = data?.progress;
  const status = !current
    ? undefined
    : !current.available
      ? `Add a ${providerLabel(current.provider)} key under Providers to use this.`
      : progress && progress.embedded < progress.total
        ? `Indexing ${count.format(progress.embedded)} of ${count.format(progress.total)} passages.`
        : undefined;

  return (
    <SettingsSection
      title="Vector embedding model"
      description="Models that enable much higher accuracy for memory search and context recall results. Without one searches are keyword-only."
    >
      {error && !data ? (
        <p className="text-sm text-destructive">{error.message}</p>
      ) : null}
      <RolePicker
        title="Memory model"
        options={options}
        current={data?.current}
        loading={!data && !error}
        onSelect={choose}
        className="max-w-md"
      />
      {status ? <FieldDescription>{status}</FieldDescription> : null}

      <AlertDialog
        open={pending !== undefined}
        onOpenChange={(open) => {
          if (!open) setPending(undefined);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {pending ? `Switch to ${pending.name}?` : "Switch model?"}
            </AlertDialogTitle>
            <AlertDialogDescription>
              Memories are indexed again in the background. Until that finishes,
              characters recall by keywords. Switching back is instant.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (pending) void select(pending.ref);
                setPending(undefined);
              }}
            >
              Switch
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </SettingsSection>
  );
}
