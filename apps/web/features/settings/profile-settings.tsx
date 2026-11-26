"use client";

import type { ProfileResponse } from "@kazusa/client";
import { useState } from "react";
import { toast } from "sonner";
import { useAccess } from "@/hooks/use-access";
import { useProfile } from "@/hooks/use-profile";
import { Button } from "@/ui/button";
import { TextareaField, TextField } from "@/ui/field";
import { Fold, Folds } from "@/ui/fold";
import { Note } from "@/ui/note";
import { Callout, SettingsPage, SettingsSection } from "@/ui/settings";
import { Unavailable } from "./unavailable";

function ProfileForm({ profile }: { profile: ProfileResponse }) {
  const { save } = useProfile();
  const { canManage } = useAccess();
  const [edit, setEdit] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string>();

  const about = edit ?? profile.about;
  const dirty = about.trim() !== profile.about.trim();
  const edited = about !== profile.about;

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canManage || !dirty || saving) return;
    setSaving(true);
    setError(undefined);
    try {
      await save(about);
      setEdit(null);
      toast.success("Description saved");
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : String(caught);
      setError(message);
      toast.error("Couldn't save your description", {
        description: message,
      });
    } finally {
      setSaving(false);
    }
  }

  return (
    <form
      onSubmit={(event) => void handleSubmit(event)}
      className="flex flex-col gap-5"
      noValidate
    >
      <TextareaField
        label="What the system agent knows about you"
        rows={6}
        value={about}
        error={error}
        disabled={!canManage || saving}
        onValueChange={(next) => {
          setEdit(next);
          setError(undefined);
        }}
        description={
          <>
            Who you are to her and how she should address you. Only the system
            agent reads this—saved to her{" "}
            <code className="font-[ui-monospace,monospace] text-xs">
              USER.md
            </code>
            .
          </>
        }
      />
      <div className="flex items-center gap-2">
        <Button
          type="submit"
          tone="primary"
          size="sm"
          pending={saving}
          disabled={!canManage || !dirty}
        >
          Save
        </Button>
        <Button
          type="button"
          tone="ghost"
          size="sm"
          disabled={!edited || saving}
          onClick={() => {
            setEdit(null);
            setError(undefined);
          }}
        >
          Discard
        </Button>
      </div>

      <Folds>
        <Fold value="identity" title="World config identity">
          <div className="flex flex-col gap-3 pt-1">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <TextField label="Display name" value={profile.name} readOnly />
              <TextField label="User ID" value={profile.id} mono readOnly />
            </div>
            <p className="text-xs text-ui-soft">
              Your name and ID come from this world&apos;s config and can&apos;t
              be edited here.
            </p>
          </div>
        </Fold>
      </Folds>
    </form>
  );
}

export function ProfileSettings() {
  const { enabled, data, error } = useProfile();

  return (
    <SettingsPage
      title="Profile"
      description="How the system agent knows you. You stay out of the world itself, whoever you play."
    >
      {!enabled ? (
        <Unavailable
          requires={["profile"]}
          title="Your profile needs a live Gateway"
        />
      ) : (
        <SettingsSection title="About you">
          {data ? (
            <ProfileForm profile={data} />
          ) : error ? (
            <Callout tone="danger" title="Couldn't load your profile">
              {error.message}
            </Callout>
          ) : (
            <Note>Loading your profile…</Note>
          )}
        </SettingsSection>
      )}
    </SettingsPage>
  );
}
