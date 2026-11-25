"use client";

import type { CharacterSummary } from "@kazusa/client";
import { useWikiPage } from "@/hooks/use-wiki";
import { firstName } from "@/lib/format";
import { Note } from "@/ui/note";
import { WikiPageBody } from "../wiki/page-body";

/** Their World Wiki page below the head, which already gave its summary. */
export function AboutTab({ character }: { character: CharacterSummary }) {
  const read = useWikiPage(character.id);
  const page = read.data?.world;
  const called = firstName(character.name);
  if (read.isLoading) return <Note>Reading their page…</Note>;
  if (read.error) return <Note>{"Couldn't read their page."}</Note>;
  if (!page) return <Note>{`Nothing is written about ${called} yet.`}</Note>;
  return (
    <WikiPageBody page={page} subject={character.id} subjectName={called} />
  );
}
