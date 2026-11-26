"use client";

import type { ContextOverrides, ContextSettingsResponse } from "@kazusa/client";
import { ArrowUpRightIcon } from "lucide-react";
import { useContextSettings } from "@/hooks/use-context-settings";
import { Note } from "@/ui/note";
import { Callout, SaveBar, SettingsPage } from "@/ui/settings";
import {
  CONTEXT_DOCS_URL,
  ContextFields,
  useContextDraft,
} from "./context-form";
import { Unavailable } from "./unavailable";

function ContextForm({
  data,
  onSave,
}: {
  data: ContextSettingsResponse;
  onSave: (overrides: ContextOverrides) => Promise<boolean>;
}) {
  const draft = useContextDraft({ data, onSave });
  return (
    <form
      noValidate
      onSubmit={(event) => void draft.submit(event)}
      className="flex flex-col gap-7"
    >
      <ContextFields draft={draft} />
      <SaveBar
        dirty={draft.dirty}
        saving={draft.saving}
        discardLabel="Reset"
        onDiscard={draft.discard}
      />
    </form>
  );
}

export function ContextSettings() {
  const { enabled, data, error, save } = useContextSettings();

  return (
    <SettingsPage
      title="Context"
      description="How much characters remember and send each turn."
    >
      <div className="-mt-5">
        <a
          href={CONTEXT_DOCS_URL}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-1 text-xs font-bold text-ui-soft underline-offset-4 hover:text-ui-ink hover:underline"
        >
          How context works
          <ArrowUpRightIcon aria-hidden className="size-3.5" />
        </a>
      </div>
      {!enabled ? (
        <Unavailable
          requires={["context"]}
          title="Context settings need a live Gateway"
        />
      ) : error ? (
        <Callout tone="danger" title="Couldn't load context settings">
          {error.message}
        </Callout>
      ) : !data ? (
        <Note>Loading context settings…</Note>
      ) : (
        <ContextForm data={data} onSave={save} />
      )}
    </SettingsPage>
  );
}
