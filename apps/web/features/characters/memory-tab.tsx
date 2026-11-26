"use client";

import type { CharacterSummary } from "@kazusa/client";
import { BookOpenIcon } from "lucide-react";
import { parseAsString, useQueryStates } from "nuqs";
import { useWikiCharacter } from "@/hooks/use-wiki-editor";
import { useWikiList } from "@/hooks/use-wiki";
import { firstName } from "@/lib/format";
import { Button } from "@/ui/button";
import { Note } from "@/ui/note";
import { wikiParsers } from "../wiki/search-params";
import { Prose } from "../entities/prose";
import { wikiPatch } from "../wiki/open";
import { MemoryEditor } from "./memory-editor";

/**
 * What they carry from day to day, as their sleep last wrote it, and the wiki
 * of their own that holds the rest.
 */
export function MemoryTab({
  character,
  editing = false,
  onClose,
}: {
  character: CharacterSummary;
  editing?: boolean;
  onClose?: () => void;
}) {
  const { data, error, isLoading, mutate } = useWikiCharacter(character.id);
  const { data: own } = useWikiList(character.id);
  const [, setParams] = useQueryStates({
    view: parseAsString,
    ...wikiParsers,
  });
  const called = firstName(character.name);
  const pages = own?.pages ?? [];
  const people = pages.filter((p) => p.kind === "person").length;
  const days = pages.filter((p) => p.kind === "day").length;
  const concepts = pages.length - people - days;
  const counts = [
    people ? `${people} ${people === 1 ? "character" : "characters"}` : null,
    concepts ? `${concepts} ${concepts === 1 ? "concept" : "concepts"}` : null,
    days ? `${days} ${days === 1 ? "day" : "days"} in a diary` : null,
  ].filter(Boolean);

  return (
    <div className="flex flex-col gap-8">
      <section
        aria-label="Kept in mind"
        className="flex max-w-160 flex-col gap-3"
      >
        <div className="flex flex-col gap-0.5">
          <h3 className="text-[0.9375rem] font-extrabold">{`What ${called} keeps in mind`}</h3>
          <p className="text-[0.8125rem] text-ui-soft">
            Their notes on their life and plans, rewritten by each night’s
            sleep.
          </p>
        </div>
        {isLoading ? (
          <Note>Reading…</Note>
        ) : error || !data ? (
          <Note>{"Couldn't read their memory."}</Note>
        ) : editing ? (
          <MemoryEditor
            id={character.id}
            memory={data.memory}
            onSaved={() => mutate()}
            onClose={() => onClose?.()}
          />
        ) : data.memory.text.trim() ? (
          <Prose text={data.memory.text} />
        ) : (
          <Note>{`Nothing yet: ${called} hasn't slept on anything.`}</Note>
        )}
      </section>

      <section
        aria-label={`${called}'s wiki`}
        className="flex max-w-160 flex-col gap-3 border-t border-ui-line pt-4"
      >
        <div className="flex flex-col gap-0.5">
          <h3 className="text-[0.9375rem] font-extrabold">{`${called}'s own wiki`}</h3>
          <p className="text-[0.8125rem] text-ui-soft">
            {counts.length
              ? `Longer memories of ${counts.join(", ")}.`
              : "Longer memories of people, places and concepts, once they have some."}
          </p>
        </div>
        <Button
          tone="soft"
          size="sm"
          className="self-start"
          icon={<BookOpenIcon aria-hidden />}
          onClick={() =>
            void setParams(wikiPatch(null, { agent: character.id }))
          }
        >
          {`Open ${called}'s wiki`}
        </Button>
      </section>
    </div>
  );
}
