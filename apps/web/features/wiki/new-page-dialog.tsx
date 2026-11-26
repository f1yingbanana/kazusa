"use client";

import type { WikiKind } from "@kazusa/client";
import { parseAsString, useQueryStates } from "nuqs";
import { useState } from "react";
import { toast } from "sonner";
import { useCastChange } from "@/hooks/use-characters";
import { useSaveWikiPage } from "@/hooks/use-wiki";
import { createCharacter } from "@/lib/source/characters/http";
import { idProblem, pageId } from "@/lib/wiki/page-id";
import { Button } from "@/ui/button";
import { Dialog, DialogClose, DialogFoot, DialogPanel } from "@/ui/dialog";
import { TextField } from "@/ui/field";
import { Segmented, SegmentedItem } from "@/ui/segmented";
import { SwitchRow } from "@/ui/switch";
import { charactersParsers, profilePatch } from "../characters/search-params";
import { wikiPatch } from "./open";

/** A page's first words: its name as title, nothing else yet. */
export const firstDraft = (name: string) =>
  `---\nname: ${JSON.stringify(name)}\n---\n\n# ${name}\n`;

/**
 * Names a page and makes it at once, so it is there to find and link even left
 * empty, then opens it to be written. A person in the World Wiki can instead be
 * simulated: they join the cast offstage, and their profile opens.
 */
export function NewPageDialog({
  open,
  onOpenChange,
  agent,
  ownerName,
  existing,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Whose own wiki it goes in; the World Wiki without one. */
  agent?: string | undefined;
  ownerName?: string | undefined;
  existing: ReadonlySet<string>;
  onCreated: (page: { id: string; kind: WikiKind; name: string }) => void;
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
        <NewPageForm
          agent={agent}
          ownerName={ownerName}
          existing={existing}
          busy={busy}
          setBusy={setBusy}
          onDone={() => onOpenChange(false)}
          onCreated={onCreated}
        />
      ) : null}
    </Dialog>
  );
}

function NewPageForm({
  agent,
  ownerName,
  existing,
  busy,
  setBusy,
  onDone,
  onCreated,
}: {
  agent: string | undefined;
  ownerName: string | undefined;
  existing: ReadonlySet<string>;
  busy: boolean;
  setBusy: (busy: boolean) => void;
  onDone: () => void;
  onCreated: (page: { id: string; kind: WikiKind; name: string }) => void;
}) {
  const save = useSaveWikiPage();
  const change = useCastChange();
  const [, setParams] = useQueryStates({
    ...charactersParsers,
    view: parseAsString,
  });
  const [name, setName] = useState("");
  const [kind, setKind] = useState<WikiKind>("concept");
  const [simulated, setSimulated] = useState(false);
  const [typedId, setTypedId] = useState<string | undefined>();
  const named = name.trim();
  const character = !agent && kind === "person" && simulated;
  const auto = named
    ? pageId(named, existing, {
        separator: kind === "person" ? "-" : "_",
        fallback: kind === "person" ? "person" : "page",
      })
    : "";
  const id = typedId ?? auto;
  const problem =
    typedId === undefined && !named
      ? undefined
      : idProblem(id, existing, { character });

  async function submit() {
    if (busy || !named || problem) return;
    setBusy(true);
    try {
      if (character) {
        await change(() => createCharacter({ id, name: named }));
        toast.success(`${named} joined the cast, offstage`, {
          description:
            "Bring them onstage when they're ready to start thinking.",
        });
        onDone();
        void setParams({ ...wikiPatch(null), ...profilePatch(id) });
        return;
      }
      await save({
        id,
        kind,
        base: null,
        text: firstDraft(named),
        ...(agent ? { agent } : {}),
      });
      onDone();
      onCreated({ id, kind, name: named });
    } catch (failure) {
      toast.error(
        character ? "Couldn't add the character" : "Couldn't make the page",
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
    <DialogPanel
      title="New page"
      description={
        agent
          ? `In ${ownerName ?? "their"}'s own wiki: what they make of it.`
          : undefined
      }
    >
      <form
        noValidate
        className="flex flex-col gap-4"
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
      >
        <Segmented<WikiKind>
          aria-label="What it is about"
          stretch
          value={kind}
          onValueChange={(next) => next && setKind(next)}
        >
          <SegmentedItem value="concept">A place or thing</SegmentedItem>
          <SegmentedItem value="person">A person</SegmentedItem>
        </Segmented>
        <TextField
          label="Name"
          value={name}
          autoFocus
          autoComplete="off"
          placeholder={
            kind === "person" ? "Hoshino Takanashi" : "Abydos High School"
          }
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
          onChange={(event) => setTypedId(event.target.value.toLowerCase())}
          error={problem}
          description="Links and files use it, so it can't change later."
          action={
            <Button
              type="button"
              tone="link"
              size="sm"
              className="text-xs"
              onClick={() =>
                setTypedId(typedId === undefined ? auto : undefined)
              }
            >
              {typedId === undefined ? "Customize" : "Use the name's"}
            </Button>
          }
        />
        {!agent && kind === "person" ? (
          <SwitchRow
            label="Simulated"
            hint={
              simulated
                ? "They think, talk and live on their own, starting offstage."
                : "Only a page: others can know of them, but they never act."
            }
            checked={simulated}
            onCheckedChange={setSimulated}
          />
        ) : kind === "concept" && !agent ? (
          <p className="text-xs leading-normal text-ui-soft">
            Make it a place on the map or a group people are in as you write it.
          </p>
        ) : null}
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
