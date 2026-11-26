"use client";

import type { EditedText } from "@kazusa/client";
import { useState } from "react";
import { toast } from "@/ui/toast";
import { saveMemory } from "@/lib/source/wiki/editor";
import { Button } from "@/ui/button";
import { cx } from "@/ui/cx";
import { TextArea } from "@/ui/input";
import { failureText, isConflict } from "../wiki/failure";
import { useLeaveGuard } from "../wiki/leave-guard";

/**
 * Their `MEMORY.md`, written in place, with Cancel and Save at its foot as a
 * wiki's editor has them. It saves only over the version opened, so a night's
 * sleep that rewrote it meanwhile is never lost: the bar says so and loads the
 * new one instead.
 */
export function MemoryEditor({
  id,
  memory,
  onSaved,
  onClose,
}: {
  id: string;
  memory: EditedText;
  /** Back to reading: after a save, or on Cancel. */
  onClose: () => void;
  onSaved: () => Promise<unknown>;
}) {
  const [draft, setDraft] = useState<{ base: string | null; text: string }>();
  const [saving, setSaving] = useState(false);
  const [conflict, setConflict] = useState(false);
  const [discarding, setDiscarding] = useState(false);
  const text = draft?.text ?? memory.text;
  const dirty = draft !== undefined && draft.text !== memory.text;
  const guard = useLeaveGuard(dirty);

  const save = async () => {
    if (!draft || saving) return;
    setSaving(true);
    try {
      await saveMemory({ id, text: draft.text, base: draft.base });
      await onSaved();
      setDraft(undefined);
      toast.success("Saved what they keep in mind");
      onClose();
    } catch (failure) {
      if (isConflict(failure)) setConflict(true);
      else toast.error("Couldn't save", { description: failureText(failure) });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div ref={guard.scope} className="flex flex-col gap-3">
      <TextArea
        aria-label="What they keep in mind"
        value={text}
        rows={14}
        spellCheck
        autoFocus
        disabled={saving}
        onChange={(event) =>
          setDraft({
            base: draft ? draft.base : memory.hash,
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
      <div
        role="region"
        aria-label="Editing"
        className="sticky bottom-3 z-20 flex flex-wrap items-center gap-2 rounded-[1.25rem] ui-raised px-3 py-2"
      >
        <p
          role="status"
          className={cx(
            "min-w-0 flex-1 px-1 text-[0.8125rem] font-semibold",
            conflict ? "text-ui-danger" : "text-ui-soft",
          )}
        >
          {conflict
            ? "Rewritten by their sleep meanwhile."
            : dirty
              ? "Unsaved changes"
              : "No changes yet"}
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
              tone={discarding ? "danger" : "ghost"}
              size="sm"
              disabled={saving}
              onBlur={() => setDiscarding(false)}
              onClick={() => {
                // With changes, the first press only asks.
                if (dirty && !discarding) return setDiscarding(true);
                setDraft(undefined);
                onClose();
              }}
            >
              {discarding ? "Discard changes" : "Cancel"}
            </Button>
            <Button
              tone="primary"
              size="sm"
              pending={saving}
              disabled={!dirty}
              onClick={() => void save()}
            >
              Save
            </Button>
          </>
        )}
      </div>
      {guard.dialog}
    </div>
  );
}
