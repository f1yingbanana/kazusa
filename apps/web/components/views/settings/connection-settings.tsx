'use client'

import { useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import {
  Field,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
} from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { useRealtime } from '@/lib/live/realtime-provider'
import type { MockMode } from '@/lib/source/capabilities'
import { useSources } from '@/lib/source/provider'
import {
  DEFAULT_CONFIG,
  saveConfig,
  useKazusaConfig,
  type KazusaConfig,
} from '@/lib/state/config-store'
import { cn } from '@/lib/utils'
import { SettingsSection } from './settings-section'

const MOCK_OPTIONS = [
  { value: 'auto', label: 'Auto', description: 'Live where the backend serves a domain; placeholder data elsewhere.' },
  { value: 'all', label: 'All', description: 'Placeholder data for every mockable domain, even when live.' },
  { value: 'off', label: 'Off', description: 'Never mock. Missing domains show as unavailable.' },
] as const satisfies readonly { value: MockMode; label: string; description: string }[]

const STREAM_LABELS = {
  open: 'Connected',
  connecting: 'Reconnecting…',
  error: 'Offline',
} as const

function isValidUrl(value: string) {
  if (!value) return true
  try {
    const url = new URL(value)
    return url.protocol === 'http:' || url.protocol === 'https:'
  } catch {
    return false
  }
}

function normalize(draft: KazusaConfig, config: KazusaConfig): KazusaConfig {
  return {
    baseUrl: draft.baseUrl.trim().replace(/\/+$/, ''),
    token: draft.token?.trim() || undefined,
    userId: config.userId,
    userName: config.userName,
    mocks: draft.mocks,
  }
}

function sameConnection(a: KazusaConfig, b: KazusaConfig) {
  return a.baseUrl === b.baseUrl && (a.token || undefined) === (b.token || undefined) && a.mocks === b.mocks
}

function GatewayStatus() {
  const { status } = useRealtime()
  const { reachable, backendError, retryBackend } = useSources()
  const { baseUrl } = useKazusaConfig()
  const down = !reachable || status === 'error'

  return (
    <div className="flex items-center gap-3 rounded-lg border bg-card px-3 py-2.5">
      <span
        aria-hidden
        className={cn(
          'size-2 shrink-0 rounded-full',
          down ? 'bg-destructive' : status === 'open' ? 'bg-online' : 'animate-pulse bg-muted-foreground motion-reduce:animate-none',
        )}
      />
      <div className="flex min-w-0 flex-1 flex-col">
        <span role="status" className="text-sm font-medium">
          {!reachable ? "Can't reach the server" : STREAM_LABELS[status]}
        </span>
        <span className="truncate font-mono text-xs text-muted-foreground">
          {!reachable && backendError ? backendError.message : baseUrl || 'Same origin'}
        </span>
      </div>
      {down ? (
        <Button size="sm" variant="outline" onClick={retryBackend}>
          Retry
        </Button>
      ) : null}
    </div>
  )
}

/** Where the client finds the Gateway, and how much of the world is placeholder. */
export function ConnectionSettings() {
  const config = useKazusaConfig()
  const [draft, setDraft] = useState<KazusaConfig>(config)
  const [submitted, setSubmitted] = useState(false)

  const urlInvalid = submitted && !isValidUrl(draft.baseUrl.trim())
  const dirty = !sameConnection(normalize(draft, config), config)

  function update<K extends keyof KazusaConfig>(key: K, value: KazusaConfig[K]) {
    setDraft((current) => ({ ...current, [key]: value }))
  }

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setSubmitted(true)
    if (!isValidUrl(draft.baseUrl.trim())) return
    const next = normalize(draft, config)
    saveConfig(next)
    setDraft(next)
    setSubmitted(false)
    toast.success('Connection saved')
  }

  return (
    <div className="flex flex-col">
      <SettingsSection title="Gateway" description="The client talks to your Kazusa server through this app's proxy. The server supplies your player identity.">
        <GatewayStatus />
        <form onSubmit={handleSubmit} className="flex flex-col gap-6" noValidate>
          <FieldGroup>
            <Field data-invalid={urlInvalid || undefined}>
              <FieldLabel htmlFor="base-url">Server URL</FieldLabel>
              <Input
                id="base-url"
                type="url"
                inputMode="url"
                className="font-mono"
                value={draft.baseUrl}
                onChange={(event) => update('baseUrl', event.target.value)}
                placeholder="Same origin (default)"
                aria-invalid={urlInvalid || undefined}
              />
              {urlInvalid ? (
                <FieldError>Enter a full http(s) URL or leave blank.</FieldError>
              ) : (
                <FieldDescription>Leave blank to use this app’s Gateway connection.</FieldDescription>
              )}
            </Field>
            <Field>
              <FieldLabel htmlFor="gateway-token">Gateway token</FieldLabel>
              <Input
                id="gateway-token"
                type="password"
                className="font-mono"
                value={draft.token ?? ''}
                onChange={(event) => update('token', event.target.value)}
                placeholder="Bearer token (optional for localhost)"
                autoComplete="off"
              />
              <FieldDescription>Required when connecting to a remote or tunneled OpenClaw Gateway.</FieldDescription>
            </Field>
            <Field>
              <FieldLabel id="mock-mode-label">Mock data</FieldLabel>
              <div role="radiogroup" aria-labelledby="mock-mode-label" className="flex max-w-sm gap-1 rounded-lg border p-0.5">
                {MOCK_OPTIONS.map((option) => (
                  <Button
                    key={option.value}
                    type="button"
                    role="radio"
                    aria-checked={draft.mocks === option.value}
                    variant={draft.mocks === option.value ? 'secondary' : 'ghost'}
                    size="sm"
                    className="flex-1"
                    onClick={() => update('mocks', option.value)}
                  >
                    {option.label}
                  </Button>
                ))}
              </div>
              <FieldDescription>{MOCK_OPTIONS.find((option) => option.value === draft.mocks)?.description}</FieldDescription>
            </Field>
          </FieldGroup>
          <div className="flex items-center gap-2">
            <Button type="submit" disabled={!dirty}>
              Save
            </Button>
            <Button
              type="button"
              variant="ghost"
              disabled={sameConnection(normalize(draft, config), normalize(DEFAULT_CONFIG, config))}
              onClick={() => setDraft({ ...DEFAULT_CONFIG, userId: config.userId, userName: config.userName })}
            >
              Reset to defaults
            </Button>
          </div>
        </form>
      </SettingsSection>

      <SettingsSection title="You" description="Your player identity comes from the server and can't be edited here.">
        <FieldGroup className="sm:flex-row">
          <Field>
            <FieldLabel htmlFor="user-name">Display name</FieldLabel>
            <Input id="user-name" value={config.userName} readOnly />
          </Field>
          <Field>
            <FieldLabel htmlFor="user-id">User ID</FieldLabel>
            <Input id="user-id" className="font-mono" value={config.userId} readOnly />
          </Field>
        </FieldGroup>
      </SettingsSection>
    </div>
  )
}
