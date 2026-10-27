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
import {
  DEFAULT_CONFIG,
  saveConfig,
  useKazusaConfig,
  type KazusaConfig,
} from '@/lib/kazusa/config-store'

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
      userId: config.userId,
      userName: config.userName,
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
