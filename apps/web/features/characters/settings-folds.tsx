"use client";

import type { ContextSettings, ContextSettingsResponse } from "@kazusa/client";
import { useId, useState } from "react";
import { useCharacter } from "@/hooks/use-characters";
import { useContextSettings } from "@/hooks/use-context-settings";
import { useModels } from "@/hooks/use-models";
import type { EntityRef } from "@/lib/state/entity-ref";
import { Button } from "@/ui/button";
import { Dialog, DialogClose, DialogPanel, DialogTrigger } from "@/ui/dialog";
import { Note } from "@/ui/note";
import {
  CONTEXT_DOCS_URL,
  ContextFields,
  SETTING_LABELS,
  describeSetting,
  useContextDraft,
} from "../settings/context-form";
import { ModelPicker, ThinkingPicker } from "../settings/model-pickers";
import { refName, thinkingLabel } from "../settings/model-labels";
import { useOpenSettings } from "../settings/search-params";

const LABEL = "text-sm font-bold text-ui-ink";
const HINT = "text-xs leading-relaxed text-ui-soft";

/**
 * Model and reasoning each follow the world on their own, so a character can
 * pin a model and keep the world's reasoning level.
 */
export function CharacterModelSection({ entity }: { entity: EntityRef }) {
  const character = useCharacter(entity.id);
  const openSettings = useOpenSettings();
  const { data, error, select } = useModels(entity.id);
  const world = useModels();
  const name = character?.name ?? entity.id;
  const overrides = data?.overrides ?? {};
  const model = data?.models.find((option) => option.ref === data.current);
  const worldThinking = thinkingLabel(model, world.data?.thinking);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-1.5">
        <div className="flex items-center justify-between gap-2">
          <span className={LABEL}>Chat model</span>
          {overrides.model || (error && !data) ? (
            <Button
              tone="link"
              size="sm"
              className="text-xs text-ui-soft hover:text-ui-ink"
              onClick={() => void select(null)}
            >
              Use world default
            </Button>
          ) : null}
        </div>
        <ModelPicker agentId={entity.id} label={`Chat model for ${name}`} />
        <p className={HINT}>
          {error && !data
            ? "Couldn't load their model. Reset to the world default to recover."
            : overrides.model
              ? `Chosen for ${name}.`
              : "Follows the world default."}
        </p>
      </div>

      {model && model.thinkingLevels.length >= 2 ? (
        <div className="flex flex-col gap-1.5">
          <span className={LABEL}>Reasoning</span>
          <ThinkingPicker agentId={entity.id} label={`Reasoning for ${name}`} />
          <p className={HINT}>
            {overrides.thinking
              ? `Chosen for ${name}.`
              : worldThinking
                ? `Follows the world default.`
                : "Follows the model's own default."}
          </p>
        </div>
      ) : null}

      <Button
        tone="link"
        size="sm"
        className="self-start"
        onClick={() => openSettings("models")}
      >
        World defaults
      </Button>
    </div>
  );
}

export function CharacterModelSummary({ entity }: { entity: EntityRef }) {
  const { data } = useModels(entity.id);
  if (!data?.current) return null;
  // Outside the catalog the ref is all there is: its last part reads best.
  const known = refName(data.models, data.current);
  const name =
    known === data.current ? (data.current.split("/").pop() ?? known) : known;
  return <>{data.overrides?.model ? name : `${name} (world)`}</>;
}

function ownSettings(data: ContextSettingsResponse): (keyof ContextSettings)[] {
  return (Object.keys(data.overrides) as (keyof ContextSettings)[]).filter(
    (key) => data.overrides[key] !== undefined,
  );
}

function ContextDialog({
  data,
  name,
  onSave,
  onClose,
}: {
  data: ContextSettingsResponse;
  name: string;
  onSave: ReturnType<typeof useContextSettings>["save"];
  onClose: () => void;
}) {
  const draft = useContextDraft({ data, characterName: name, onSave });
  const formId = useId();
  return (
    <DialogPanel
      size="lg"
      full
      title={`Memory and context for ${name}`}
      description={
        <>
          Each setting follows the world until you change it here.{" "}
          <a
            href={CONTEXT_DOCS_URL}
            target="_blank"
            rel="noreferrer"
            className="underline underline-offset-4 hover:text-ui-ink"
          >
            How context works
          </a>
        </>
      }
      footer={
        <>
          <DialogClose
            render={
              <Button type="button" tone="soft" disabled={draft.saving} />
            }
          >
            Cancel
          </DialogClose>
          <Button
            type="submit"
            form={formId}
            tone="primary"
            pending={draft.saving}
            disabled={!draft.dirty}
          >
            Save changes
          </Button>
        </>
      }
    >
      <form
        id={formId}
        noValidate
        className="-me-2 flex min-h-0 flex-1 flex-col gap-7 overflow-y-auto pe-2"
        onSubmit={(event) =>
          void draft.submit(event).then((saved) => saved && onClose())
        }
      >
        <ContextFields draft={draft} />
      </form>
    </DialogPanel>
  );
}

/** Only what differs from the world, so the fold stays short. */
export function CharacterContextSection({ entity }: { entity: EntityRef }) {
  const character = useCharacter(entity.id);
  const { data, error, save } = useContextSettings(entity.id);
  const [open, setOpen] = useState(false);
  const [session, setSession] = useState(0);
  const name = character?.name ?? entity.id;

  if (error)
    return <Note>{`Couldn't load their settings: ${error.message}`}</Note>;
  if (!data) return <Note>Loading their settings…</Note>;
  const own = ownSettings(data);

  return (
    <div className="flex flex-col gap-3">
      {own.length === 0 ? (
        <p className={HINT}>Follows the world's settings.</p>
      ) : (
        <dl className="flex flex-col gap-1.5 text-sm">
          {own.map((key) => (
            <div
              key={key}
              className="flex items-baseline justify-between gap-3"
            >
              <dt className="text-ui-soft">{SETTING_LABELS[key]}</dt>
              <dd className="font-semibold text-ui-ink tabular-nums">
                {describeSetting(key, data.effective[key])}
              </dd>
            </div>
          ))}
        </dl>
      )}
      <Dialog
        open={open}
        onOpenChange={(next) => {
          if (next) setSession((count) => count + 1);
          setOpen(next);
        }}
      >
        <DialogTrigger
          render={<Button tone="link" size="sm" className="self-start" />}
        >
          Customize
        </DialogTrigger>
        <ContextDialog
          key={session}
          data={data}
          name={name}
          onSave={save}
          onClose={() => setOpen(false)}
        />
      </Dialog>
    </div>
  );
}

export function CharacterContextSummary({ entity }: { entity: EntityRef }) {
  const { data } = useContextSettings(entity.id);
  if (!data) return null;
  const own = ownSettings(data).length;
  return (
    <>
      {own === 0
        ? "Follows the world"
        : own === 1
          ? "1 of their own"
          : `${own} of their own`}
    </>
  );
}
