'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  Field,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
} from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import type { MockMode } from '@/lib/source/capabilities'
import {
  DEFAULT_CONFIG,
  saveConfig,
  useKazusaConfig,
  type KazusaConfig,
} from '@/lib/state/config-store'

const MOCK_OPTIONS = [
  { value: 'auto', label: 'Auto', description: 'Live where the backend serves a domain; placeholder data elsewhere.' },
  { value: 'all', label: 'All', description: 'Placeholder data for every mockable domain, even when live.' },
  { value: 'off', label: 'Off', description: 'Never mock. Missing domains show as unavailable.' },
] as const satisfies readonly { value: MockMode; label: string; description: string }[]

function isValidUrl(value: string) {
  if (!value) return true
  try {
    const url = new URL(value)
    return url.protocol === 'http:' || url.protocol === 'https:'
  } catch {
    return false
  }
}

export function SettingsDialog({
  open,
  onOpenChange,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        {open ? <SettingsForm onDone={() => onOpenChange(false)} /> : null}
      </DialogContent>
    </Dialog>
  )
}

function SettingsForm({ onDone }: { onDone: () => void }) {
  const config = useKazusaConfig()
  const [draft, setDraft] = useState<KazusaConfig>(config)
  const [submitted, setSubmitted] = useState(false)

  const urlInvalid = submitted && !isValidUrl(draft.baseUrl.trim())

  function update<K extends keyof KazusaConfig>(key: K, value: KazusaConfig[K]) {
    setDraft((current) => ({ ...current, [key]: value }))
  }

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setSubmitted(true)
    if (!isValidUrl(draft.baseUrl.trim())) return
    saveConfig({
      baseUrl: draft.baseUrl.trim().replace(/\/+$/, ''),
      token: draft.token?.trim() || undefined,
      userId: config.userId,
      userName: config.userName,
      mocks: draft.mocks,
    })
    onDone()
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-6" noValidate>
      <DialogHeader>
        <DialogTitle>Connection</DialogTitle>
        <DialogDescription>
          Point the client at your Kazusa server. The server supplies your player identity.
        </DialogDescription>
      </DialogHeader>

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
          <FieldLabel htmlFor="gateway-token">Gateway Token</FieldLabel>
          <Input
            id="gateway-token"
            type="password"
            className="font-mono"
            value={draft.token ?? ''}
            onChange={(event) => update('token', event.target.value)}
            placeholder="Bearer token (optional for localhost)"
            autoComplete="off"
          />
          <FieldDescription>
            Required when connecting to a remote or tunneled OpenClaw Gateway.
          </FieldDescription>
        </Field>
        <Field>
          <FieldLabel id="mock-mode-label">Mock data</FieldLabel>
          <div role="radiogroup" aria-labelledby="mock-mode-label" className="flex gap-1 rounded-lg border p-0.5">
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
          <FieldDescription>
            {MOCK_OPTIONS.find((option) => option.value === draft.mocks)?.description}
          </FieldDescription>
        </Field>
        <Field>
          <FieldLabel htmlFor="user-id">User ID</FieldLabel>
          <Input
            id="user-id"
            className="font-mono"
            value={draft.userId}
            readOnly
            placeholder="user_1"
            autoComplete="off"
          />
        </Field>
        <Field>
          <FieldLabel htmlFor="user-name">Display name</FieldLabel>
          <Input
            id="user-name"
            value={draft.userName}
            readOnly
            placeholder="User"
            autoComplete="name"
          />
        </Field>
      </FieldGroup>

      <DialogFooter>
        <Button
          type="button"
          variant="ghost"
          onClick={() => setDraft(DEFAULT_CONFIG)}
        >
          Reset
        </Button>
        <Button type="submit">Save</Button>
      </DialogFooter>
    </form>
  )
}
