"use client";

import { isRunning } from "@kazusa/client";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { useSaves } from "@/hooks/use-saves";
import { useWorldUpdate } from "@/hooks/use-world-update";
import { closeUpdateSaveDialog, useUiStore } from "@/lib/state/ui-store";
import { Button } from "@/ui/button";
import { Dialog, DialogPanel } from "@/ui/dialog";
import { Callout } from "@/ui/settings";

const PENDING_KEY = "kazusa.saves.ask-after";

function pendingAsk(): string | null {
  try {
    return window.localStorage.getItem(PENDING_KEY);
  } catch {
    return null;
  }
}

function setPendingAsk(id: string | null): void {
  try {
    if (id) window.localStorage.setItem(PENDING_KEY, id);
    else window.localStorage.removeItem(PENDING_KEY);
  } catch {
    // Without storage the ask is lost on a reload; the save still happens.
  }
}

/**
 * Before the system agent brings a new version of the world in, offers a save
 * into the before-an-update slot, the only way back if it goes wrong. Once the
 * save is done, the system agent is asked, even after a reload.
 */
export function UpdateSaveDialog() {
  const open = useUiStore((state) => state.updateSaveDialog.open);
  const { update, admin, ask } = useWorldUpdate();
  const { enabled, supervised, request, saveBeforeUpdate } = useSaves();
  const [busy, setBusy] = useState<"save" | "ask" | null>(null);
  const [failure, setFailure] = useState<string | null>(null);

  async function askNow() {
    try {
      await ask();
    } catch (caught) {
      toast.error(`Couldn't message ${admin}`, {
        description: caught instanceof Error ? caught.message : undefined,
      });
    }
  }

  useEffect(() => {
    const pending = pendingAsk();
    if (!request || !pending || request.id !== pending || isRunning(request))
      return;
    if (request.phase === "done" && !update) return;
    setPendingAsk(null);
    if (request.phase === "done") void askNow();
    else
      toast.error("Couldn't save before the update", {
        description: request.error,
        duration: 30_000,
        action: { label: `Ask ${admin} anyway`, onClick: () => void askNow() },
      });
    // Once per save: `askNow` and the name change identity, not meaning.
  }, [request, update]);

  if (!enabled) return null;

  function close() {
    setFailure(null);
    closeUpdateSaveDialog();
  }

  async function saveFirst() {
    setFailure(null);
    setBusy("save");
    try {
      const result = await saveBeforeUpdate();
      if (result.request) setPendingAsk(result.request.id);
      closeUpdateSaveDialog();
    } catch (caught) {
      setFailure(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setBusy(null);
    }
  }

  async function askWithoutSaving() {
    setBusy("ask");
    try {
      await askNow();
      close();
    } finally {
      setBusy(null);
    }
  }

  return (
    <Dialog
      open={open}
      dismissible={busy === null}
      onOpenChange={(next) => {
        if (!next && busy === null) close();
      }}
    >
      <DialogPanel
        title="Save before updating?"
        description="If the update goes wrong, load this save to go back. It replaces your last one from before an update."
        footer={
          <>
            <Button tone="ghost" disabled={busy !== null} onClick={close}>
              Cancel
            </Button>
            <Button
              tone="soft"
              pending={busy === "ask"}
              disabled={busy === "save"}
              onClick={() => void askWithoutSaving()}
            >
              Update without saving
            </Button>
            <Button
              tone="primary"
              pending={busy === "save"}
              disabled={busy === "ask" || !supervised || isRunning(request)}
              onClick={() => void saveFirst()}
            >
              Save, then update
            </Button>
          </>
        }
      >
        {supervised ? null : (
          <Callout>
            Saving needs Kazusa's app or{" "}
            <code className="font-[ui-monospace,monospace] text-xs text-ui-ink">
              npm run dev
            </code>
            .
          </Callout>
        )}
        {failure ? (
          <Callout tone="danger" title="Couldn't save">
            {failure}
          </Callout>
        ) : null}
      </DialogPanel>
    </Dialog>
  );
}
