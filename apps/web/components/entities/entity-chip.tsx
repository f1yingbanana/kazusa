'use client'

import { ENTITY_RENDERERS } from '@/lib/registry/entities'
import type { EntityRef } from '@/lib/state/entity-ref'

/** Works anywhere: timeline rows, chat headers, inspector sections. */
export function EntityChip({ entity, className }: { entity: EntityRef; className?: string }) {
  const Chip = ENTITY_RENDERERS[entity.kind].chip
  return <Chip id={entity.id} className={className} />
}
