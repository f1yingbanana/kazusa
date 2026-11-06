"use client";

import { useState } from "react";
import { FileTextIcon } from "lucide-react";
import { toast } from "sonner";
import type { WikiKind, WikiSourceResponse } from "@kazusa/client";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupText,
  InputGroupTextarea,
} from "@/components/ui/input-group";
import { useSaveWikiPage, useWikiSource } from "@/hooks/use-wiki";
import { WikiConflictError } from "@/lib/source/wiki/http";
import { describeSaving, type WikiSide } from "./page-roles";

/** What a page nobody has written yet starts as. */
export function pageTemplate(name: string): string {
  return `---\nname: ${JSON.stringify(name)}\n---\n\n# ${name}\n\n`;
}

interface PageEditorProps {
  readonly id: string;
  readonly agent?: string;
  /** Where a new page goes; an existing one stays where it is. */
  readonly kind?: WikiKind;
  readonly side: WikiSide;
  /** Whose wiki it is, for their own. */
  readonly owner?: string;
  /** The page's name, for a page not written yet. */
  readonly name: string;
  /** With what was saved; a place saved under a new id comes back renamed. */
  readonly onDone: (saved?: WikiSourceResponse) => void;
}

/** A page's Markdown, edited in place of the page; the file is the truth. */
export function PageEditor(props: PageEditorProps) {
  const source = useWikiSource(props.id, props.agent, props.kind);
  if (source.isLoading)
    return <p className="text-sm text-muted-foreground">Opening…</p>;
  if (!source.data)
    return (
      <div className="space-y-2">
        <p className="text-sm text-muted-foreground">
          Couldn&apos;t open this page.
        </p>
        <Button variant="outline" size="sm" onClick={() => props.onDone()}>
          Back to the page
        </Button>
      </div>
    );
  return (
    <EditorBody
      // A newer version starts the draft over from what it says.
      key={source.data.hash ?? "new"}
      {...props}
      source={source.data}
      reload={() => void source.mutate()}
    />
  );
}

function EditorBody({
  id,
  agent,
  kind,
  side,
  owner,
  name,
  onDone,
  source,
  reload,
}: PageEditorProps & {
  readonly source: WikiSourceResponse;
  readonly reload: () => void;
}) {
  const initial = source.exists ? source.text : pageTemplate(name);
  const [draft, setDraft] = useState(initial);
  const [saving, setSaving] = useState(false);
  const [conflict, setConflict] = useState(false);
  const [discarding, setDiscarding] = useState(false);
  const save = useSaveWikiPage();
  const dirty = draft !== initial || !source.exists;

  const submit = async (overwrite = false) => {
    if (saving) return;
    setSaving(true);
    try {
      const saved = await save({
        id,
        text: draft,
        ...(agent ? { agent } : {}),
        ...(kind ? { kind } : {}),
        ...(overwrite ? {} : { base: source.hash }),
      });
      toast.success(
        saved.id !== id
          ? `Saved, and renamed to ${saved.id}`
          : source.exists
            ? "Page saved"
            : "Page created",
      );
      onDone(saved);
    } catch (error) {
      if (error instanceof WikiConflictError) setConflict(true);
      else
        toast.error("Couldn't save the page", {
          description: error instanceof Error ? error.message : String(error),
        });
    } finally {
      setSaving(false);
    }
  };

  const cancel = () => {
    if (dirty && source.exists) setDiscarding(true);
    else onDone();
  };

  return (
    <form
      className="space-y-3"
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
    >
      {conflict ? (
        <Alert>
          <AlertTitle>This page changed since you opened it</AlertTitle>
          <AlertDescription>
            {source.exists
              ? "A night's sleep or a character's note may have written to it. Load their version to start over from it, or save yours over it."
              : "Someone wrote a page with this name meanwhile. Load it to edit it instead, or save yours over it."}
          </AlertDescription>
        </Alert>
      ) : null}
      {conflict ? (
        <div className="flex gap-2">
          <Button size="sm" variant="outline" onClick={reload}>
            Load their version
          </Button>
          <Button
            size="sm"
            variant="destructive"
            onClick={() => void submit(true)}
          >
            Save mine anyway
          </Button>
        </div>
      ) : null}
      <InputGroup>
        <InputGroupAddon align="block-start" className="border-b">
          <FileTextIcon aria-hidden />
          <InputGroupText className="min-w-0">
            <span className="whitespace-nowrap text-foreground">
              {side === "own" ? `${owner ?? "Their"}'s wiki` : "World Wiki"}
            </span>
            <span className="truncate font-mono">{source.path}</span>
          </InputGroupText>
          {source.exists ? null : (
            <Badge variant="outline" className="ml-auto">
              New page
            </Badge>
          )}
        </InputGroupAddon>
        <InputGroupTextarea
          aria-label={`Markdown of ${name}`}
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if ((event.metaKey || event.ctrlKey) && event.key === "s") {
              event.preventDefault();
              if (dirty) void submit();
            }
          }}
          autoFocus
          spellCheck
          className="min-h-96 font-mono"
        />
        <InputGroupAddon align="block-end" className="border-t">
          <InputGroupText>
            {dirty ? "Unsaved changes" : "No changes"}
          </InputGroupText>
          <InputGroupButton className="ml-auto" onClick={cancel}>
            Cancel
          </InputGroupButton>
          <InputGroupButton
            type="submit"
            variant="default"
            disabled={!dirty || saving}
          >
            {saving ? "Saving…" : source.exists ? "Save page" : "Create page"}
          </InputGroupButton>
        </InputGroupAddon>
      </InputGroup>
      <p className="text-xs text-muted-foreground">
        {describeSaving(side, owner)} Front matter goes between the{" "}
        <code className="font-mono">---</code> lines, then Markdown; ⌘S saves.
        Problems lists anything that doesn&apos;t parse.
      </p>
      <AlertDialog open={discarding} onOpenChange={setDiscarding}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Discard your changes?</AlertDialogTitle>
            <AlertDialogDescription>
              The page stays as it was before you started editing.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep editing</AlertDialogCancel>
            <AlertDialogAction variant="destructive" onClick={() => onDone()}>
              Discard changes
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </form>
  );
}
