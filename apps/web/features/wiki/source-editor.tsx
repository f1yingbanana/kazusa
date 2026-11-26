"use client";

import type { WikiKind, WikiSourceResponse } from "@kazusa/client";
import { FileTextIcon } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { useSaveWikiPage, useWikiList, useWikiSource } from "@/hooks/use-wiki";
import { WikiConflictError } from "@/lib/source/wiki/http";
import { Button } from "@/ui/button";
import { Note } from "@/ui/note";
import { Callout } from "@/ui/settings";
import { failureText } from "./failure";
import { useLeaveGuard } from "./leave-guard";
import { LinkField } from "./link-field";
import { firstDraft } from "./new-page-dialog";
import type { WikiSide } from "./search-params";

/** What saving does, under the text. */
export function savingWords(side: WikiSide, owner?: string): string {
  return side === "world"
    ? "Dated events go under ## History."
    : `${owner ?? "They"} may rewrite this in their sleep.`;
}

/**
 * A page's Markdown, edited whole: the file is the truth, front matter and all.
 * It saves only over the version opened, unless asked to save over a newer
 * one.
 */
export function SourceEditor({
  id,
  agent,
  kind,
  name,
  side,
  owner,
  bar,
  onDone,
}: {
  id: string;
  agent?: string | undefined;
  kind?: WikiKind | undefined;
  name: string;
  side: WikiSide;
  owner?: string | undefined;
  /** The save bar, given what it needs; the form's and this share one. */
  bar: (state: {
    dirty: boolean;
    saving: boolean;
    conflict: boolean;
    save: () => void;
    reload: () => void;
  }) => React.ReactNode;
  onDone: (saved?: WikiSourceResponse) => void;
}) {
  const source = useWikiSource(id, agent, kind);
  const [opened, setOpened] = useState<WikiSourceResponse>();
  useEffect(() => {
    if (!opened && source.data && !source.isValidating && !source.error)
      setOpened(source.data);
  }, [opened, source.data, source.isValidating, source.error]);
  const { data: list } = useWikiList();
  const save = useSaveWikiPage();
  const [draft, setDraft] = useState<string>();
  const [saving, setSaving] = useState(false);
  const [conflict, setConflict] = useState(false);
  const guard = useLeaveGuard(
    opened !== undefined &&
      ((draft !== undefined &&
        draft !== (opened.exists ? opened.text : firstDraft(name))) ||
        !opened.exists),
  );

  if (!opened)
    return source.error ? <Note>{failureText(source.error)}</Note> : null;

  const initial = opened.exists ? opened.text : firstDraft(name);
  const text = draft ?? initial;
  const dirty = text !== initial || !opened.exists;

  const submit = async (overwrite = false) => {
    if (saving) return;
    setSaving(true);
    try {
      const saved = await save({
        id,
        text,
        ...(agent ? { agent } : {}),
        ...(kind ? { kind } : {}),
        ...(overwrite ? {} : { base: opened.hash }),
      });
      toast.success(
        saved.id !== id ? `Saved, and renamed to ${saved.id}` : `Saved ${name}`,
      );
      onDone(saved);
    } catch (failure) {
      if (failure instanceof WikiConflictError) setConflict(true);
      else
        toast.error("Couldn't save the page", {
          description: failureText(failure),
        });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div ref={guard.scope} className="flex flex-col gap-3">
      {conflict ? (
        <Callout
          tone="danger"
          title="Changed since you opened it"
          action={
            <Button
              tone="soft"
              size="sm"
              pending={saving}
              onClick={() => void submit(true)}
            >
              Save mine anyway
            </Button>
          }
        >
          Load the new version to start again from it, or save yours over it.
        </Callout>
      ) : null}
      <div className="flex items-center gap-2 text-xs font-semibold text-ui-soft">
        <FileTextIcon aria-hidden className="size-3.5" />
        <span className="text-ui-ink">
          {side === "own" ? `${owner ?? "Their"}'s wiki` : "World Wiki"}
        </span>
        <span className="min-w-0 truncate font-[ui-monospace,monospace]">
          {opened.path}
        </span>
        {opened.exists ? null : (
          <span className="rounded-full bg-ui-accent-tint px-2 py-px text-ui-accent-ink">
            New page
          </span>
        )}
      </div>
      <LinkField
        aria-label={`Markdown of ${name}`}
        value={text}
        pages={list?.pages ?? []}
        mono
        minRows={18}
        autoFocus
        disabled={saving}
        onChange={setDraft}
        onSubmit={() => dirty && !saving && void submit()}
      />
      <p className="text-xs leading-normal text-ui-soft">
        {savingWords(side, owner)}
      </p>
      {bar({
        dirty,
        saving,
        conflict,
        save: () => void submit(),
        reload: () => {
          setConflict(false);
          setDraft(undefined);
          setOpened(undefined);
          void source.mutate();
        },
      })}
      {guard.dialog}
    </div>
  );
}
