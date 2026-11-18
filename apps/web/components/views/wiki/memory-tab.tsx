"use client";

import Link from "next/link";
import { BookOpenIcon, MoonIcon } from "lucide-react";
import type { WikiCharacterResponse } from "@kazusa/client";
import { Button } from "@/components/ui/button";
import { saveMemory } from "@/lib/source/wiki/editor";
import { DocumentField } from "./parts";

/**
 * What they carry: `MEMORY.md`, which their nights rewrite, and pointers to
 * what they think of each person and place, which lives in their wiki.
 */
export function MemoryTab({
  character,
  onSaved,
}: {
  character: WikiCharacterResponse;
  onSaved: () => Promise<unknown>;
}) {
  const wiki = `?view=wiki&wiki.agent=${encodeURIComponent(character.id)}`;
  return (
    <div className="flex flex-col gap-8">
      <DocumentField
        id="wiki-memory"
        label="What they remember"
        description={`What ${character.name} keeps in mind about their life, the people in it and what they hope for. Each night's sleep rewrites it from the day, so an edit here is something they now remember. Saved to their MEMORY.md.`}
        value={character.memory}
        rows={16}
        onSave={async (text, base) => {
          const next = await saveMemory({ id: character.id, text, base });
          await onSaved();
          return next;
        }}
        onReload={onSaved}
      />
      <section className="flex flex-col gap-3">
        <div className="flex flex-col gap-1">
          <h2 className="text-sm font-semibold">People, places and days</h2>
          <p className="max-w-prose text-sm text-pretty text-muted-foreground">
            What {character.name} thinks of each person and place, and their
            notes on each day, are pages in their wiki, beside what is true.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            variant="outline"
            size="sm"
            nativeButton={false}
            render={<Link href={wiki} />}
          >
            <BookOpenIcon />
            Open their wiki
          </Button>
          <Button
            variant="outline"
            size="sm"
            nativeButton={false}
            render={<Link href={`${wiki}&wiki.tab=nights`} />}
          >
            <MoonIcon />
            What their nights changed
          </Button>
        </div>
      </section>
    </div>
  );
}
