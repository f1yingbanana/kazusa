"use client";

import type { EditedText } from "@kazusa/client";
import { useState } from "react";
import { toast } from "sonner";
import { saveMemory } from "@/lib/source/wiki/editor";
import { Button } from "@/ui/button";
import { cx } from "@/ui/cx";
import { TextArea } from "@/ui/input";
import { failureText, isConflict } from "../wiki/failure";

/**
 * Their `MEMORY.md`, written in place. It saves only over the version opened,
 * so a night's sleep that rewrote it meanwhile is never lost: the bar says so
 * and loads the new one instead.
 */
export function MemoryEditor({
  id,
  memory,
  onSaved,
}: {
  id: string;
  memory: EditedText;
  onSaved: () => Promise<unknown>;
}) {
  const [draft, setDraft] = useState<{ base: string | null; text: string }>();
  const [saving, setSaving] = useState(false);
  const [conflict, setConflict] = useState(false);
  const text = draft?.text ?? memory.text;
  const dirty = draft !== undefined && draft.text !== memory.text;

  const save = async () => {
    if (!draft || saving) return;
    setSaving(true);
    try {
      await saveMemory({ id, text: draft.text, base: draft.base });
      await onSaved();
      setDraft(undefined);
      toast.success("Saved what they keep in mind");
    } catch (failure) {
      if (isConflict(failure)) setConflict(true);
      else toast.error("Couldn't save", { description: failureText(failure) });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="flex flex-col gap-3">
      <TextArea
        aria-label="What they keep in mind"
        value={text}
        rows={14}
        spellCheck
        autoFocus
        onChange={(event) =>
          setDraft({
            base: draft?.base ?? memory.hash,
            text: event.target.value,
          })
        }
        onKeyDown={(event) => {
          if ((event.metaKey || event.ctrlKey) && event.key === "s") {
            event.preventDefault();
            void save();
          }
        }}
        className="min-h-64"
      />
      {dirty || conflict ? (
        <div
          role="region"
          aria-label="Saving"
          className={cx(
            "sticky bottom-3 z-20 flex flex-wrap items-center gap-2 rounded-[1.25rem] ui-raised px-3 py-2 motion-safe:animate-ui-rise",
          )}
        >
          <p
            role="status"
            className={cx(
              "min-w-0 flex-1 px-1 text-[0.8125rem] font-semibold",
              conflict ? "text-ui-danger" : "text-ui-soft",
            )}
          >
            {conflict
              ? "Their sleep rewrote this meanwhile. Copy your words, then load it."
              : "Unsaved changes"}
          </p>
          {conflict ? (
            <Button
              tone="soft"
              size="sm"
              onClick={() => {
                setConflict(false);
                setDraft(undefined);
                void onSaved();
              }}
            >
              Load the new version
            </Button>
          ) : (
            <>
              <Button
                tone="ghost"
                size="sm"
                disabled={saving}
                onClick={() => setDraft(undefined)}
              >
                Revert
              </Button>
              <Button
                tone="primary"
                size="sm"
                pending={saving}
                onClick={() => void save()}
              >
                Save
              </Button>
            </>
          )}
        </div>
      ) : null}
    </div>
  );
}
