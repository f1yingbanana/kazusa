'use client'

import { useState } from 'react'
import { toast } from 'sonner'
import type { ProfileResponse } from '@kazusa/client'
import { Unavailable } from '@/components/entities/source-state'
import { Button } from '@/components/ui/button'
import { Field, FieldDescription, FieldGroup, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { Spinner } from '@/components/ui/spinner'
import { Textarea } from '@/components/ui/textarea'
import { useProfile } from '@/hooks/use-profile'
import { SettingsSection } from './settings-section'

function ProfileForm({ profile }: { profile: ProfileResponse }) {
  const { save } = useProfile()
  const [edit, setEdit] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  const about = edit ?? profile.about
  const dirty = about.trim() !== profile.about.trim()

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!dirty) return
    setSaving(true)
    try {
      await save(about)
      setEdit(null)
      toast.success('Description saved')
    } catch (error) {
      toast.error("Couldn't save your description", {
        description: error instanceof Error ? error.message : String(error),
      })
    } finally {
      setSaving(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-6" noValidate>
      <FieldGroup>
        <Field>
          <FieldLabel htmlFor="profile-about">About you</FieldLabel>
          <Textarea id="profile-about" rows={6} value={about} onChange={(event) => setEdit(event.target.value)} />
          <FieldDescription>
            Markdown. Saved straight to <code className="font-mono text-xs">{profile.wikiPage}</code> in the World Wiki.
          </FieldDescription>
        </Field>
        <div className="flex flex-col gap-6 sm:flex-row">
          <Field>
            <FieldLabel htmlFor="profile-name">Display name</FieldLabel>
            <Input id="profile-name" value={profile.name} readOnly />
          </Field>
          <Field>
            <FieldLabel htmlFor="profile-id">User ID</FieldLabel>
            <Input id="profile-id" className="font-mono" value={profile.id} readOnly />
          </Field>
        </div>
        <FieldDescription>Your name and ID come from this world's config and can't be edited here.</FieldDescription>
      </FieldGroup>
      <div className="flex items-center gap-2">
        <Button type="submit" disabled={!dirty || saving}>
          {saving ? <Spinner /> : null}
          {saving ? 'Saving…' : 'Save'}
        </Button>
        <Button type="button" variant="ghost" disabled={!dirty || saving} onClick={() => setEdit(null)}>
          Discard
        </Button>
      </div>
    </form>
  )
}

/** Who the player is in this world. Saving writes their World Wiki page straight away. */
export function ProfileSettings() {
  const { enabled, data, error } = useProfile()

  if (!enabled) {
    return <Unavailable requires={['profile']} title="Your profile needs a live Gateway" />
  }

  return (
    <SettingsSection title="You">
      {data ? (
        <ProfileForm profile={data} />
      ) : error ? (
        <p className="text-sm text-destructive">{error.message}</p>
      ) : (
        <p className="text-sm text-muted-foreground">Loading your profile…</p>
      )}
    </SettingsSection>
  )
}
