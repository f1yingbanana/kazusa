"use client";

import type { WikiKind } from "@kazusa/client";
import { parseAsString, useQueryStates } from "nuqs";
import { useState } from "react";
import { toast } from "@/ui/toast";
import { useCastChange } from "@/hooks/use-characters";
import { useSaveWikiPage } from "@/hooks/use-wiki";
import { createCharacter } from "@/lib/source/characters/http";
import { saveWikiForm } from "@/lib/source/wiki/editor";
import { idProblem, pageId } from "@/lib/wiki/page-id";
import { Button } from "@/ui/button";
import { OnePicker } from "@/ui/combobox";
import { Dialog, DialogClose, DialogFoot, DialogPanel } from "@/ui/dialog";
import { TextField } from "@/ui/field";
import { Segmented, SegmentedItem } from "@/ui/segmented";
import { SwitchRow } from "@/ui/switch";
import { charactersParsers, profilePatch } from "../characters/search-params";
import { failureText } from "./failure";
import { wikiPatch } from "./open";
import { usePlaceOptions } from "./place-editor";
import { useRefreshWiki } from "./refresh";

/** A page's first words: its name as title, nothing else yet. */
export const firstDraft = (name: string) =>
  `---\nname: ${JSON.stringify(name)}\n---\n\n# ${name}\n`;

/** What a new page is, as the index shelves it. */
export type NewKind = "place" | "group" | "concept" | "person";

export interface NewPagePreset {
  readonly kind?: NewKind;
  /** The area a new place is inside. */
  readonly parent?: string;
}

const LABEL: Readonly<Record<NewKind, string>> = {
  place: "Place",
  group: "Group",
  concept: "Concept",
  person: "Character",
};

/**
 * Names a page and makes it at once, so it is there to find and link even left
 * empty, then opens it to be written. A place can go inside another. A person
 * in the World Wiki can instead be simulated: they join the world offstage, and
 * their profile opens.
 */
export function NewPageDialog({
  open,
  onOpenChange,
  agent,
  ownerName,
  existing,
  preset,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Whose own wiki it goes in; the World Wiki without one. */
  agent?: string | undefined;
  ownerName?: string | undefined;
  existing: ReadonlySet<string>;
  preset?: NewPagePreset | undefined;
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
          preset={preset}
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
  preset,
  busy,
  setBusy,
  onDone,
  onCreated,
}: {
  agent: string | undefined;
  ownerName: string | undefined;
  existing: ReadonlySet<string>;
  preset: NewPagePreset | undefined;
  busy: boolean;
  setBusy: (busy: boolean) => void;
  onDone: () => void;
  onCreated: (page: { id: string; kind: WikiKind; name: string }) => void;
}) {
  const save = useSaveWikiPage();
  const change = useCastChange();
  const refresh = useRefreshWiki();
  const { options: places } = usePlaceOptions();
  const [, setParams] = useQueryStates({
    ...charactersParsers,
    view: parseAsString,
  });
  const kinds: readonly NewKind[] = agent
    ? ["concept", "person"]
    : ["place", "group", "concept", "person"];
  const [kind, setKind] = useState<NewKind>(
    preset?.kind && kinds.includes(preset.kind) ? preset.kind : kinds[0],
  );
  const [name, setName] = useState("");
  const [parent, setParent] = useState(preset?.parent);
  const [simulated, setSimulated] = useState(false);
  const [typedId, setTypedId] = useState<string | undefined>();
  const named = name.trim();
  const person = kind === "person";
  const character = !agent && person && simulated;
  const auto = named
    ? pageId(named, existing, {
        separator: person ? "-" : "_",
        fallback: person ? "person" : kind,
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
    const wikiKind: WikiKind = person ? "person" : "concept";
    try {
      if (character) {
        await change(() => createCharacter({ id, name: named }));
        toast.success(`${named} joined the world, offstage`);
        onDone();
        void setParams({ ...wikiPatch(null), ...profilePatch(id) });
        return;
      }
      if (agent)
        await save({
          id,
          kind: wikiKind,
          base: null,
          text: firstDraft(named),
          agent,
        });
      else {
        await saveWikiForm({
          id,
          kind: wikiKind,
          base: null,
          fields: {
            name: named,
            aliases: [],
            groups: [],
            ...(kind === "place" ? { place: true, parent } : {}),
            ...(kind === "group" ? { group: true } : {}),
          },
          lead: "",
          close: "",
          only: "",
        });
        await refresh();
      }
      onDone();
      onCreated({ id, kind: wikiKind, name: named });
    } catch (failure) {
      toast.error("Couldn't make it", { description: failureText(failure) });
    } finally {
      setBusy(false);
    }
  }

  return (
    <DialogPanel
      title="New page"
      description={agent ? `In ${ownerName ?? "their"}'s wiki.` : undefined}
    >
      <form
        noValidate
        className="flex flex-col gap-4"
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
      >
        <Segmented<NewKind>
          aria-label="What it is"
          stretch
          value={kind}
          onValueChange={(next) => next && setKind(next)}
        >
          {kinds.map((one) => (
            <SegmentedItem key={one} value={one}>
              {LABEL[one]}
            </SegmentedItem>
          ))}
        </Segmented>
        <TextField
          label="Name"
          value={name}
          autoFocus
          autoComplete="off"
          onChange={(event) => setName(event.target.value)}
        />
        {kind === "place" && !agent ? (
          <div className="flex flex-col gap-1.5">
            <span className="text-sm font-bold">Inside</span>
            <OnePicker
              label="Inside"
              placeholder="Nowhere"
              options={places}
              value={parent}
              onChange={setParent}
            />
          </div>
        ) : null}
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
          description="Links use it. It can't change later."
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
        {!agent && person ? (
          <SwitchRow
            label="Simulated"
            hint={simulated ? "Lives and acts on their own." : "Only a page."}
            checked={simulated}
            onCheckedChange={setSimulated}
          />
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
            Create
          </Button>
        </DialogFoot>
      </form>
    </DialogPanel>
  );
}
