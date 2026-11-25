"use client";

import { useState } from "react";
import { toast } from "sonner";
import { useCastChange } from "@/hooks/use-characters";
import { useSaveWikiPage } from "@/hooks/use-wiki";
import { createCharacter } from "@/lib/source/characters/http";
import { idProblem, pageId } from "@/lib/wiki/page-id";
import { Button } from "@/ui/button";
import { Dialog, DialogClose, DialogFoot, DialogPanel } from "@/ui/dialog";
import { TextField } from "@/ui/field";
import { SwitchRow } from "@/ui/switch";

/**
 * Someone new, by name. Simulated, they join the cast at once, offstage, and
 * their profile opens; otherwise they are only a page in the World Wiki, opened
 * there to be written. The id follows the name until Customize, since links and
 * files keep it for good.
 */
export function NewCharacterDialog({
  open,
  onOpenChange,
  existing,
  onCharacter,
  onPage,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Every id a page or a character already has. */
  existing: ReadonlySet<string>;
  /** A simulated character, made. */
  onCharacter: (id: string) => void;
  /** A person's page, made, not simulated. */
  onPage: (page: { id: string; name: string }) => void;
}) {
  const [busy, setBusy] = useState(false);
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (next || !busy) onOpenChange(next);
      }}
    >
      {open ? (
        <NewCharacterForm
          existing={existing}
          busy={busy}
          setBusy={setBusy}
          onDone={() => onOpenChange(false)}
          onCharacter={onCharacter}
          onPage={onPage}
        />
      ) : null}
    </Dialog>
  );
}

function NewCharacterForm({
  existing,
  busy,
  setBusy,
  onDone,
  onCharacter,
  onPage,
}: {
  existing: ReadonlySet<string>;
  busy: boolean;
  setBusy: (busy: boolean) => void;
  onDone: () => void;
  onCharacter: (id: string) => void;
  onPage: (page: { id: string; name: string }) => void;
}) {
  const change = useCastChange();
  const savePage = useSaveWikiPage();
  const [name, setName] = useState("");
  const [simulated, setSimulated] = useState(true);
  const [typedId, setTypedId] = useState<string | undefined>();
  const [idEdited, setIdEdited] = useState(false);
  const named = name.trim();
  const auto = named
    ? pageId(named, existing, {
        separator: "-",
        fallback: simulated ? "character" : "person",
      })
    : "";
  const id = typedId ?? auto;
  const problem =
    (typedId === undefined || (!idEdited && !id)) && !named
      ? undefined
      : idProblem(id, existing, { character: simulated });

  async function submit() {
    if (busy || !named || problem) return;
    setBusy(true);
    try {
      if (simulated) {
        await change(() => createCharacter({ id, name: named }));
        toast.success(`${named} joined the cast, offstage`, {
          description:
            "Bring them onstage when they're ready to start thinking.",
        });
        onDone();
        onCharacter(id);
        return;
      }
      // Made now, so it is there to find, open and delete even left empty.
      await savePage({
        id,
        kind: "person",
        base: null,
        text: `---\nname: ${JSON.stringify(named)}\n---\n\n# ${named}\n`,
      });
      onDone();
      onPage({ id, name: named });
    } catch (failure) {
      toast.error(
        simulated ? "Couldn't add the character" : "Couldn't make the page",
        {
          description:
            failure instanceof Error ? failure.message : String(failure),
        },
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <DialogPanel title="New character">
      <form
        noValidate
        className="flex flex-col gap-4"
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
      >
        <TextField
          label="Name"
          value={name}
          autoFocus
          autoComplete="off"
          onChange={(event) => setName(event.target.value)}
        />
        <TextField
          label="Id"
          mono
          value={id}
          disabled={typedId === undefined}
          spellCheck={false}
          autoCapitalize="off"
          autoComplete="off"
          onChange={(event) => {
            setIdEdited(true);
            setTypedId(event.target.value.toLowerCase());
          }}
          error={problem}
          description="Links and files use it, so it can't change later."
          action={
            <Button
              type="button"
              tone="link"
              size="sm"
              className="text-xs"
              onClick={() => {
                setIdEdited(false);
                setTypedId(typedId === undefined ? auto : undefined);
              }}
            >
              {typedId === undefined ? "Customize" : "Use the name's"}
            </Button>
          }
        />
        <SwitchRow
          label="Simulated"
          hint={
            simulated
              ? "They think, talk and live on their own. They start offstage, costing nothing until brought on."
              : "Only a page in the World Wiki: others can know of them, but they never act."
          }
          checked={simulated}
          onCheckedChange={setSimulated}
        />
        <DialogFoot>
          <DialogClose render={<Button tone="ghost" disabled={busy} />}>
            Cancel
          </DialogClose>
          <Button
            type="submit"
            tone="primary"
            disabled={!named || Boolean(problem)}
            pending={busy}
          >
            Confirm
          </Button>
        </DialogFoot>
      </form>
    </DialogPanel>
  );
}
