"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ResponsiveDialogContent } from "@/components/ui/responsive-dialog";
import { Spinner } from "@/components/ui/spinner";
import { isRunning, useSaves } from "@/hooks/use-saves";
import { useWorldUpdate } from "@/hooks/use-world-update";
import { closeUpdateSaveDialog, useUiStore } from "@/lib/state/ui-store";

/** The save this browser made before asking the system agent to update. */
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
 * Before the system agent brings a new version of the world in, asks whether to
 * save first: into the slot kept for before an update, which the player loads
 * to go back, the system agent's only way back too. The Saves dialog shows the
 * save; once it's done, the system agent is asked. Asking them in a chat
 * instead updates without saving.
 */
export function UpdateSaveDialog() {
  const open = useUiStore((state) => state.updateSaveDialog.open);
  const { admin, ask } = useWorldUpdate();
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

  // Once the save asked for here is made, the system agent is asked.
  useEffect(() => {
    const pending = pendingAsk();
    if (!request || !pending || request.id !== pending || isRunning(request))
      return;
    setPendingAsk(null);
    if (request.phase === "done") void askNow();
    else
      toast.error("Couldn't save before the update", {
        description: request.error,
        duration: 30_000,
        action: { label: `Ask ${admin} anyway`, onClick: () => void askNow() },
      });
    // Once per save: `askNow` and the name change identity, not meaning.
  }, [request]);

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
      onOpenChange={(next) => {
        if (!next && !busy) close();
      }}
    >
      <ResponsiveDialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Save before updating?</DialogTitle>
          <DialogDescription>
            If the update goes wrong, load this save to go back. It replaces
            your last one from before an update.
          </DialogDescription>
        </DialogHeader>
        {!supervised && (
          <Alert>
            <AlertDescription>
              Saving needs Kazusa&apos;s app or <code>npm run dev</code>.
            </AlertDescription>
          </Alert>
        )}
        {failure && (
          <Alert variant="destructive">
            <AlertDescription>{failure}</AlertDescription>
          </Alert>
        )}
        <DialogFooter>
          <Button variant="ghost" disabled={busy !== null} onClick={close}>
            Cancel
          </Button>
          <Button
            variant="outline"
            disabled={busy !== null}
            onClick={() => void askWithoutSaving()}
          >
            {busy === "ask" ? <Spinner /> : null}
            Update without saving
          </Button>
          <Button
            disabled={busy !== null || !supervised || isRunning(request)}
            onClick={() => void saveFirst()}
          >
            {busy === "save" ? <Spinner /> : null}
            Save, then update
          </Button>
        </DialogFooter>
      </ResponsiveDialogContent>
    </Dialog>
  );
}
