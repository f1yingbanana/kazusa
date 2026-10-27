'use client'

import type { ComponentType } from 'react'
import { CharacterChip, ChatChip, PlaceChip } from '@/components/entities/chips'
import type { EntityKind } from '@/lib/state/entity-ref'

export interface EntityRenderer {
  /** Glance level. Hover cards (peek) are on the roadmap. */
  readonly chip: ComponentType<{ readonly id: string; readonly className?: string }>
}

export const ENTITY_RENDERERS: Record<EntityKind, EntityRenderer> = {
  character: { chip: CharacterChip },
  chat: { chip: ChatChip },
  place: { chip: PlaceChip },
}
