'use client'

import { MockTag } from '@/components/entities/source-state'
import { useCharacter, useCharacterDetail } from '@/hooks/use-characters'
import type { EntityRef } from '@/lib/state/entity-ref'

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[6rem_1fr] gap-2 text-sm">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="min-w-0">{children}</dd>
    </div>
  )
}

/**
 * Frontmatter fields as facts (affiliation is already in the header);
 * `bodyMarkdown` shown verbatim and never mined (D4).
 */
export function CharacterProfileSection({ entity }: { entity: EntityRef }) {
  const character = useCharacter(entity.id)
  const { detail, available } = useCharacterDetail(entity.id)
  if (!character) return null

  // An alias equal to the id or the name says nothing new.
  const aliases = (detail?.aliases ?? character.aliases).filter(
    (alias) => alias !== character.id && alias.toLowerCase() !== character.name.toLowerCase(),
  )
  const traits = detail?.personalityTraits ?? []
  if (available && !aliases.length && !detail?.role && !traits.length && !detail?.bodyMarkdown) {
    return <p className="text-sm text-muted-foreground">No profile written yet.</p>
  }

  return (
    <div className="flex flex-col gap-3">
      <dl className="flex flex-col gap-1.5">
        {aliases.length ? <Row label="Aliases">{aliases.join(', ')}</Row> : null}
        {detail?.role ? <Row label="Role">{detail.role}</Row> : null}
        {traits.length ? <Row label="Traits">{traits.join(', ')}</Row> : null}
      </dl>
      {detail?.bodyMarkdown ? (
        <details className="group rounded-lg border">
          <summary className="flex cursor-pointer items-center justify-between px-3 py-2 text-sm font-medium">
            Card
            <MockTag requires={['characters']} />
          </summary>
          <pre className="px-3 pb-3 font-sans text-sm leading-relaxed whitespace-pre-wrap text-muted-foreground">
            {detail.bodyMarkdown}
          </pre>
        </details>
      ) : null}
      {!available ? (
        <p className="text-xs leading-relaxed text-muted-foreground">
          Full profile (role, traits, card body) needs{' '}
          <span className="font-mono">GET /kazusa/character</span>.
        </p>
      ) : null}
    </div>
  )
}
