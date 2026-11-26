"use client";

import type { CharacterSummary, WikiSourceResponse } from "@kazusa/client";
import { useState } from "react";
import { useWikiReach } from "@/hooks/use-wiki-editor";
import { useWikiPage } from "@/hooks/use-wiki";
import { firstName } from "@/lib/format";
import { Note } from "@/ui/note";
import { PageArticle } from "../wiki/article";
import { BODY_TRANSITION, withTransition } from "../wiki/motion";
import { PageEditor } from "../wiki/page-editor";
import { useRefreshWiki } from "../wiki/refresh";

/**
 * Their World Wiki page below the head, read in its layers; opened to be
 * written, the same page becomes its form in place.
 */
export function AboutTab({
  character,
  editing = false,
  onDone,
}: {
  character: CharacterSummary;
  editing?: boolean;
  onDone?: () => void;
}) {
  const read = useWikiPage(character.id);
  const { data: reach } = useWikiReach(character.id);
  const refresh = useRefreshWiki();
  const [raw, setRaw] = useState(false);
  const page = read.data?.world;
  const called = firstName(character.name);

  if (editing)
    return (
      <PageEditor
        key={raw ? "raw" : "form"}
        id={character.id}
        kind="person"
        name={character.name}
        side="world"
        raw={raw}
        titled={false}
        onRaw={(next) => withTransition(() => setRaw(next))}
        onDone={(saved?: WikiSourceResponse) => {
          if (saved) void refresh();
          setRaw(false);
          onDone?.();
        }}
      />
    );
  if (read.isLoading) return null;
  if (read.error) return <Note>{"Couldn't read their page."}</Note>;
  if (!page) return <Note>{`Nothing is written about ${called} yet.`}</Note>;
  return (
    <div style={BODY_TRANSITION} className="max-w-160">
      <PageArticle
        page={page}
        subject={character.id}
        subjectName={called}
        reach={reach}
      />
    </div>
  );
}
