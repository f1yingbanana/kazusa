'use client'

import { RefreshCwIcon } from 'lucide-react'
import type { ModelProviderStatus } from '@kazusa/client'
import { Unavailable } from '@/components/entities/source-state'
import {
  PROVIDER_STATUS_LABELS,
  providerLabel,
  refName,
} from '@/components/models/model-labels'
import { ModelPicker } from '@/components/models/model-picker'
import { ThinkingPicker } from '@/components/models/thinking-picker'
import { Button } from '@/components/ui/button'
import { Field, FieldDescription, FieldGroup, FieldLabel } from '@/components/ui/field'
import { Spinner } from '@/components/ui/spinner'
import { useModels } from '@/hooks/use-models'
import { cn } from '@/lib/utils'
import { SettingsSection } from './settings-section'

const INHERITANCE = [
  'Every character runs on this model and reasoning level until you choose otherwise for them, from Model in their inspector.',
  'Characters that follow the default switch the moment it changes. A character with its own choice keeps it until you set them back to the world default.',
  'Model and reasoning are inherited separately, so a character can keep its own model and still follow the default reasoning level.',
  'A turn already running finishes on the model it started with.',
] as const

function ProviderRow({
  provider,
  status,
  total,
  available,
}: {
  provider: string
  status: ModelProviderStatus['status'] | undefined
  total: number
  available: number
}) {
  const ready = status === undefined || status === 'ready'
  return (
    <li className="flex items-center gap-3 px-3 py-2.5">
      <span aria-hidden className={cn('size-2 shrink-0 rounded-full', ready ? 'bg-online' : 'bg-destructive')} />
      <span className="min-w-0 flex-1 truncate text-sm font-medium">{providerLabel(provider)}</span>
      <span className="font-mono text-xs text-muted-foreground tabular-nums">{`${available}/${total} usable`}</span>
      <span className="w-24 text-right text-xs text-muted-foreground">{PROVIDER_STATUS_LABELS[status ?? 'ready']}</span>
    </li>
  )
}

/**
 * World defaults for the models characters think with. Only the chat model
 * exists so far; embedding and decision models get their own sections here
 * once the backend has them.
 */
export function ModelSettings() {
  const { enabled, data, error, refreshing, refresh } = useModels()

  if (!enabled) {
    return <Unavailable requires={['models']} title="Model settings need a live Gateway" />
  }

  const models = data?.models ?? []
  const current = models.find((model) => model.ref === data?.current)
  const overridesConfigured = Boolean(data?.configured && data.configured !== data.current)

  const providers = new Map<string, { total: number; available: number }>()
  for (const model of models) {
    const entry = providers.get(model.provider) ?? { total: 0, available: 0 }
    entry.total += 1
    if (model.available) entry.available += 1
    providers.set(model.provider, entry)
  }
  const statusOf = new Map(data?.providers.map((entry) => [entry.provider, entry.status]))

  return (
    <div className="flex flex-col">
      <SettingsSection
        title="Chat model"
        description="Writes every character's turns: what they say, do and decide when something reaches them. This is the default for the whole world."
      >
        {error && !data ? (
          <p className="text-sm text-destructive">{error.message}</p>
        ) : null}
        <FieldGroup>
          <Field>
            <FieldLabel htmlFor="world-model">Default model</FieldLabel>
            <ModelPicker id="world-model" className="max-w-md" />
            <FieldDescription>
              {overridesConfigured && data?.configured
                ? `Replaces OpenClaw's configured primary, ${refName(models, data.configured)}, without reloading the Gateway. OpenClaw's own tools still show that one.`
                : "OpenClaw's configured primary. Pick another to replace it for every character without reloading the Gateway."}
            </FieldDescription>
          </Field>
          {current && current.thinkingLevels.length >= 2 ? (
            <Field>
              <FieldLabel htmlFor="world-thinking">Reasoning level</FieldLabel>
              <ThinkingPicker id="world-thinking" className="max-w-md" />
              <FieldDescription>
                How hard characters think before they answer. A level a model lacks is mapped to its nearest one.
              </FieldDescription>
            </Field>
          ) : null}
        </FieldGroup>

        <aside aria-labelledby="inheritance-title" className="flex flex-col gap-2 rounded-lg border bg-card px-4 py-3">
          <h4 id="inheritance-title" className="text-sm font-medium">
            How characters use this default
          </h4>
          <ul className="flex list-disc flex-col gap-1.5 pl-4 text-sm leading-relaxed text-muted-foreground marker:text-muted-foreground/60">
            {INHERITANCE.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        </aside>
      </SettingsSection>

      <SettingsSection
        title="Providers"
        description="Catalogs come from the Gateway's provider plugins. Models whose provider has no working key can't be picked."
        action={
          <Button variant="outline" size="sm" disabled={refreshing} onClick={() => void refresh()}>
            {refreshing ? <Spinner /> : <RefreshCwIcon />}
            {refreshing ? 'Asking providers…' : 'Refresh catalog'}
          </Button>
        }
      >
        {providers.size > 0 ? (
          <ul className="flex flex-col divide-y rounded-lg border bg-card">
            {[...providers].map(([provider, counts]) => (
              <ProviderRow
                key={provider}
                provider={provider}
                status={statusOf.get(provider)}
                total={counts.total}
                available={counts.available}
              />
            ))}
          </ul>
        ) : (
          <p className="text-sm text-muted-foreground">{data ? 'No providers reported any models.' : 'Loading providers…'}</p>
        )}
      </SettingsSection>
    </div>
  )
}
