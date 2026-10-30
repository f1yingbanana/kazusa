'use client'

import { ArrowUpRightIcon } from 'lucide-react'
import { refName, thinkingLabel } from '@/components/models/model-labels'
import { ModelPicker } from '@/components/models/model-picker'
import { ThinkingPicker } from '@/components/models/thinking-picker'
import { Button } from '@/components/ui/button'
import { useCharacter } from '@/hooks/use-characters'
import { useModels } from '@/hooks/use-models'
import { useNavigate } from '@/hooks/use-url-state'
import type { EntityRef } from '@/lib/state/entity-ref'

function FieldHeader({
  htmlFor,
  label,
  onReset,
}: {
  htmlFor: string
  label: string
  /** Shown only while the character has a choice of its own. */
  onReset?: () => void
}) {
  return (
    <div className="flex h-6 items-center justify-between gap-2">
      <label htmlFor={htmlFor} className="text-sm font-medium">
        {label}
      </label>
      {onReset ? (
        <Button variant="ghost" size="xs" className="text-muted-foreground" onClick={onReset}>
          Use world default
        </Button>
      ) : null}
    </div>
  )
}

/**
 * This character's own chat model and reasoning level. Each falls back to the
 * world default (Settings → Models) on its own, so a character can pin a
 * model and still follow the world's reasoning level, or the other way round.
 */
export function CharacterModelSection({ entity }: { entity: EntityRef }) {
  const character = useCharacter(entity.id)
  const navigate = useNavigate()
  const { data, select, setThinking } = useModels(entity.id)
  const world = useModels()
  const name = character?.name ?? entity.id
  const overrides = data?.overrides ?? {}
  const model = data?.models.find((option) => option.ref === data.current)

  const worldModel = world.data?.current ? refName(world.data.models, world.data.current) : undefined
  const worldThinking = thinkingLabel(model, world.data?.thinking)
  const modelId = `model-${entity.id}`
  const thinkingId = `thinking-${entity.id}`

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-1.5">
        <FieldHeader
          htmlFor={modelId}
          label="Chat model"
          onReset={overrides.model ? () => void select(null) : undefined}
        />
        <ModelPicker agentId={entity.id} id={modelId} />
        <p className="text-xs leading-relaxed text-muted-foreground">
          {overrides.model
            ? `Chosen for ${name}. Changing the world default won’t move them.`
            : worldModel
              ? `Follows the world default, ${worldModel}.`
              : 'Follows the world default.'}
        </p>
      </div>

      {model && model.thinkingLevels.length >= 2 ? (
        <div className="flex flex-col gap-1.5">
          <FieldHeader
            htmlFor={thinkingId}
            label="Reasoning"
            onReset={overrides.thinking ? () => void setThinking(null) : undefined}
          />
          <ThinkingPicker agentId={entity.id} id={thinkingId} />
          {!overrides.thinking ? (
            <p className="text-xs leading-relaxed text-muted-foreground">
              {worldThinking ? `Follows the world default, ${worldThinking}.` : 'Follows the model’s own default.'}
            </p>
          ) : null}
        </div>
      ) : null}

      <Button
        variant="link"
        size="xs"
        className="self-start px-0 text-muted-foreground"
        onClick={() => navigate({ view: 'settings', 'settings.tab': 'models' })}
      >
        World defaults in Settings
        <ArrowUpRightIcon />
      </Button>
    </div>
  )
}
