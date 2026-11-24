"use client";

import { LoaderCircle } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import type { WikiKind } from "@kazusa/client";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ResponsiveDialogContent } from "@/components/ui/responsive-dialog";
import {
  Field,
  FieldContent,
  FieldDescription,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { useCastChange } from "@/hooks/use-characters";
import { useSaveWikiPage } from "@/hooks/use-wiki";
import { createCharacter } from "@/lib/source/characters/http";
import { pageId } from "@/lib/wiki/page-id";
import { IdField, idProblem } from "./id-field";

const KINDS: ReadonlyArray<{
  readonly value: WikiKind;
  readonly label: string;
}> = [
  { value: "concept", label: "Concept" },
  { value: "person", label: "Character" },
];

/**
 * Names a page and makes it at once (a title and nothing else), then opens it
 * in the editor. A person in the World Wiki can instead be simulated: they join
 * the cast at once, offstage, and open in Characters. Characters opens this as
 * a person, simulated by default.
 */
export function NewPageDialog({
  open,
  onOpenChange,
  whose,
  personal = false,
  existing,
  onCreate,
  onCharacter,
  person = false,
  agent,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** "the World Wiki" or "Airi's wiki". */
  whose: string;
  /** A character's own wiki: its people are only ever pages. */
  personal?: boolean;
  existing: ReadonlySet<string>;
  /** A page just made: opened in the editor. */
  onCreate: (page: { id: string; kind: WikiKind; name: string }) => void;
  /** A simulated character, already made. Without it, nobody is simulated. */
  onCharacter?: (id: string) => void;
  /** Opened from Characters: a person, simulated unless turned off. */
  person?: boolean;
  /** Whose own wiki the page goes in; the World Wiki without one. */
  agent?: string;
}) {
  const change = useCastChange();
  const savePage = useSaveWikiPage();
  const [name, setName] = useState("");
  const [kind, setKind] = useState<WikiKind>(person ? "person" : "concept");
  const [simulated, setSimulated] = useState(person);
  const [typedId, setTypedId] = useState<string | undefined>();
  const [busy, setBusy] = useState(false);
  const canSimulate = Boolean(onCharacter) && !personal && kind === "person";
  const character = canSimulate && simulated;
  const auto = name.trim()
    ? pageId(name, existing, {
        separator: kind === "person" ? "-" : "_",
        fallback: character
          ? "character"
          : kind === "person"
            ? "person"
            : "page",
      })
    : "";
  const id = typedId ?? auto;
  const problem =
    typedId === undefined && !name.trim()
      ? undefined
      : idProblem(id, existing, { character });

  const reset = () => {
    setName("");
    setKind(person ? "person" : "concept");
    setSimulated(person);
    setTypedId(undefined);
  };
  const close = () => {
    onOpenChange(false);
    reset();
  };

  async function submit() {
    if (busy || !name.trim() || problem) return;
    const named = name.trim();
    setBusy(true);
    try {
      if (!character) {
        // Made now, so it is there to find, open and delete even left empty.
        await savePage({
          id,
          kind,
          base: null,
          text: `---\nname: ${JSON.stringify(named)}\n---\n\n# ${named}\n`,
          ...(agent ? { agent } : {}),
        });
        close();
        onCreate({ id, kind, name: named });
        return;
      }
      await change(() => createCharacter({ id, name: named }));
      toast.success(`${named} joined the cast, offstage`, {
        description: "Bring them onstage when they're ready to start thinking.",
      });
      close();
      onCharacter?.(id);
    } catch (failure) {
      toast.error(
        character ? "Couldn't make the character" : "Couldn't make the page",
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
    <Dialog
      open={open}
      onOpenChange={(next) => {
        onOpenChange(next);
        if (!next) reset();
      }}
    >
      <ResponsiveDialogContent>
        <form
          className="space-y-4"
          onSubmit={(event) => {
            event.preventDefault();
            void submit();
          }}
        >
          <DialogHeader>
            <DialogTitle>{person ? "New character" : "New page"}</DialogTitle>
            {personal ? (
              <DialogDescription>In {whose}.</DialogDescription>
            ) : null}
          </DialogHeader>
          <FieldGroup>
            <Field>
              <FieldLabel htmlFor="new-page-name">Name</FieldLabel>
              <Input
                id="new-page-name"
                value={name}
                autoFocus
                onChange={(event) => setName(event.target.value)}
              />
            </Field>
            <IdField
              inputId="new-page-id"
              value={id}
              custom={typedId !== undefined}
              onCustom={(custom) => setTypedId(custom ? auto : undefined)}
              onChange={setTypedId}
              problem={problem}
            />
            {person ? null : (
              <Field>
                <FieldLabel htmlFor="new-page-kind">Kind</FieldLabel>
                <Select
                  items={KINDS}
                  value={kind}
                  onValueChange={(value) => value && setKind(value)}
                >
                  <SelectTrigger id="new-page-kind" className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent alignItemWithTrigger={false}>
                    {KINDS.map((option) => (
                      <SelectItem key={option.value} value={option.value}>
                        {option.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
            )}
            {canSimulate ? (
              <Field orientation="horizontal">
                <FieldContent>
                  <FieldLabel htmlFor="new-page-simulated">Simulate</FieldLabel>
                  <FieldDescription>
                    For interactable, autonomous characters in the world.
                    Otherwise, only a page is made.
                  </FieldDescription>
                </FieldContent>
                <Switch
                  id="new-page-simulated"
                  checked={simulated}
                  onCheckedChange={setSimulated}
                />
              </Field>
            ) : null}
          </FieldGroup>
          <DialogFooter>
            <DialogClose render={<Button variant="outline" />}>
              Cancel
            </DialogClose>
            <Button
              type="submit"
              disabled={busy || !name.trim() || Boolean(problem)}
            >
              {busy && <LoaderCircle className="animate-spin" />}
              Create
            </Button>
          </DialogFooter>
        </form>
      </ResponsiveDialogContent>
    </Dialog>
  );
}
