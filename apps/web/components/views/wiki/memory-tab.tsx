"use client";

import type { WikiCharacterResponse } from "@kazusa/client";
import { saveMemory } from "@/lib/source/wiki/editor";
import { DocumentField } from "./parts";

/**
 * What they carry: `MEMORY.md`, which their nights rewrite. What they think of
 * each person and place is in their own wiki ("<name>'s view").
 */
export function MemoryTab({
  character,
  onSaved,
  headed = true,
  readOnly = false,
}: {
  character: WikiCharacterResponse;
  onSaved: () => Promise<unknown>;
  /** Off in a panel whose header already names it. */
  headed?: boolean;
  /** For someone who can read it but not edit it. */
  readOnly?: boolean;
}) {
  return (
    <div className="flex flex-col gap-8">
      <DocumentField
        id="wiki-memory"
        label="What they remember"
        description={`${character.name}'s notes on their life and plans. Their sleep rewrites it each night.`}
        value={character.memory}
        rows={16}
        onSave={async (text, base) => {
          const next = await saveMemory({ id: character.id, text, base });
          await onSaved();
          return next;
        }}
        onReload={onSaved}
        headed={headed}
        readOnly={readOnly}
      />
    </div>
  );
}
