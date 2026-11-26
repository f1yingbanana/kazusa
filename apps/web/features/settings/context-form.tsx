"use client";

import type {
  ContextOverrides,
  ContextSettings as ContextConfig,
  ContextSettingsResponse,
} from "@kazusa/client";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { z } from "zod";
import { Button } from "@/ui/button";
import { NumberField } from "@/ui/field";
import { Fold, Folds } from "@/ui/fold";
import { SettingsSection } from "@/ui/settings";
import { SwitchRow } from "@/ui/switch";

export const CONTEXT_DOCS_URL =
  "https://github.com/f1yingbanana/kazusa/blob/main/.agents/skills/kazusa/references/context_engine.md#settings";

const numbers = new Intl.NumberFormat("en-US");

type SettingKey = keyof ContextConfig;

const whole = (min: number, max: number, unit: string) =>
  z
    .number({ error: "Enter a number." })
    .int({ error: "Use a whole number." })
    .min(min, { error: `At least ${numbers.format(min)} ${unit}.` })
    .max(max, { error: `At most ${numbers.format(max)} ${unit}.` });

const maxContextSchema = whole(16_000, 10_000_000, "tokens");
const memoryLimitSchema = whole(0, 10_000_000, "tokens");

const FormSchema = z
  .object({
    contextUnlimited: z.boolean(),
    maxContextTokens: z.number().nullable(),
    shortTermHours: whole(1, 720, "hours"),
    memoryUnlimited: z.boolean(),
    memoryLimit: z.number().nullable(),
    toolHistoryTokens: whole(0, 32_000, "tokens"),
    onYourMindTokens: whole(0, 32_000, "tokens"),
    peopleLimit: whole(0, 200, "people"),
    placesLimit: whole(0, 50, "places"),
    ledgerGridHours: whole(1, 24, "hours"),
    ledgerTrimPercent: whole(10, 100, "percent"),
  })
  .superRefine((values, ctx) => {
    if (!values.contextUnlimited) {
      const check = maxContextSchema.safeParse(values.maxContextTokens);
      if (!check.success) {
        ctx.addIssue({
          code: "custom",
          path: ["maxContextTokens"],
          message: check.error.issues[0]?.message ?? "Enter a number.",
        });
      }
    }
    if (!values.memoryUnlimited) {
      const check = memoryLimitSchema.safeParse(values.memoryLimit);
      if (!check.success) {
        ctx.addIssue({
          code: "custom",
          path: ["memoryLimit"],
          message: check.error.issues[0]?.message ?? "Enter a number.",
        });
      } else if (
        !values.contextUnlimited &&
        values.maxContextTokens !== null &&
        check.data > values.maxContextTokens
      ) {
        ctx.addIssue({
          code: "custom",
          path: ["memoryLimit"],
          message: "Keep it within the maximum context.",
        });
      }
    }
  });

type FormValues = z.infer<typeof FormSchema>;
type FieldName = keyof FormValues;
type SwitchName = "contextUnlimited" | "memoryUnlimited";
type NumberName = Exclude<FieldName, SwitchName>;
type DraftValues = {
  [K in FieldName]: K extends NumberName ? number | null : boolean;
};

const SETTING_OF: Record<FieldName, SettingKey> = {
  contextUnlimited: "maxContextTokens",
  maxContextTokens: "maxContextTokens",
  shortTermHours: "shortTermHours",
  memoryUnlimited: "ledgerMaxTokens",
  memoryLimit: "ledgerMaxTokens",
  toolHistoryTokens: "toolHistoryTokens",
  onYourMindTokens: "onYourMindTokens",
  peopleLimit: "peopleLimit",
  placesLimit: "placesLimit",
  ledgerGridHours: "ledgerGridHours",
  ledgerTrimPercent: "ledgerTrimTo",
};

export const SETTING_LABELS: Record<SettingKey, string> = {
  maxContextTokens: "Maximum context",
  shortTermHours: "Memory window",
  ledgerMaxTokens: "Memory size",
  toolHistoryTokens: "Tool calls",
  onYourMindTokens: "Wiki memories",
  peopleLimit: "People",
  placesLimit: "Places",
  ledgerGridHours: "Granularity",
  ledgerTrimTo: "Slack",
};

const NUMBERS: Record<
  NumberName,
  {
    unit: string;
    min: number;
    max: number;
    step?: number;
    description: string;
  }
> = {
  maxContextTokens: {
    unit: "tokens",
    min: 16_000,
    max: 10_000_000,
    step: 1000,
    description: "Hard ceiling on tokens sent per prompt.",
  },
  onYourMindTokens: {
    unit: "tokens",
    min: 0,
    max: 32_000,
    step: 250,
    description:
      "Room reserved for relevant wiki notes about people, places, and things.",
  },
  peopleLimit: {
    unit: "people",
    min: 0,
    max: 200,
    description: "Maximum familiar people listed each turn.",
  },
  placesLimit: {
    unit: "places",
    min: 0,
    max: 50,
    description: "Maximum familiar and nearby places listed each turn.",
  },
  memoryLimit: {
    unit: "tokens",
    min: 0,
    max: 10_000_000,
    step: 1000,
    description: "Token budget for recent conversation and activity history.",
  },
  shortTermHours: {
    unit: "hours",
    min: 1,
    max: 720,
    description:
      "How far back recent history reaches before older events require recall.",
  },
  ledgerGridHours: {
    unit: "hours",
    min: 1,
    max: 24,
    description:
      "Drops older entries in fixed hour steps to keep prompt caches aligned.",
  },
  ledgerTrimPercent: {
    unit: "% kept",
    min: 10,
    max: 100,
    description:
      "Share of the context budget kept when trimming old turns for cache hits.",
  },
  toolHistoryTokens: {
    unit: "tokens",
    min: 0,
    max: 32_000,
    step: 250,
    description:
      "Short digest of recent tool calls to avoid repeating mistakes.",
  },
};

export function describeSetting(
  key: SettingKey,
  value: ContextConfig[SettingKey],
): string {
  switch (key) {
    case "shortTermHours":
    case "ledgerGridHours":
      return `${value} hours`;
    case "ledgerTrimTo":
      return `${Math.round(Number(value) * 100)}% kept`;
    case "peopleLimit":
      return `${value} people`;
    case "placesLimit":
      return `${value} places`;
    case "maxContextTokens":
      if (value === "unlimited") return "The model's whole window";
      return `${numbers.format(Number(value))} tokens`;
    case "ledgerMaxTokens":
      if (value === "unlimited") return "All remaining room";
      return `${numbers.format(Number(value))} tokens`;
    default:
      return `${numbers.format(Number(value))} tokens`;
  }
}

function valuesOf(settings: ContextConfig): FormValues {
  const maximum =
    settings.maxContextTokens === "unlimited"
      ? 64_000
      : settings.maxContextTokens;
  return {
    contextUnlimited: settings.maxContextTokens === "unlimited",
    maxContextTokens: maximum,
    shortTermHours: settings.shortTermHours,
    memoryUnlimited: settings.ledgerMaxTokens === "unlimited",
    memoryLimit:
      settings.ledgerMaxTokens === "unlimited"
        ? Math.min(16_000, maximum)
        : settings.ledgerMaxTokens,
    toolHistoryTokens: settings.toolHistoryTokens,
    onYourMindTokens: settings.onYourMindTokens,
    peopleLimit: settings.peopleLimit,
    placesLimit: settings.placesLimit,
    ledgerGridHours: settings.ledgerGridHours,
    ledgerTrimPercent: Math.round(settings.ledgerTrimTo * 100),
  };
}

function settingsOf(values: FormValues): ContextConfig {
  return {
    maxContextTokens: values.contextUnlimited
      ? "unlimited"
      : (values.maxContextTokens ?? 64_000),
    shortTermHours: values.shortTermHours,
    ledgerMaxTokens: values.memoryUnlimited
      ? "unlimited"
      : (values.memoryLimit ?? 16_000),
    toolHistoryTokens: values.toolHistoryTokens,
    onYourMindTokens: values.onYourMindTokens,
    peopleLimit: values.peopleLimit,
    placesLimit: values.placesLimit,
    ledgerGridHours: values.ledgerGridHours,
    ledgerTrimTo: values.ledgerTrimPercent / 100,
  };
}

type Own = Partial<Record<SettingKey, true>>;

interface Draft {
  readonly values: DraftValues;
  readonly own: Own;
}

function ownOf(overrides: ContextOverrides): Own {
  return Object.fromEntries(
    (Object.keys(overrides) as SettingKey[])
      .filter((key) => overrides[key] !== undefined)
      .map((key) => [key, true]),
  );
}

function sameDraft(a: Draft, b: Draft): boolean {
  const ownKeys = (own: Own) => Object.keys(own).sort().join();
  return (
    JSON.stringify(a.values) === JSON.stringify(b.values) &&
    ownKeys(a.own) === ownKeys(b.own)
  );
}

export interface ContextDraft {
  readonly values: DraftValues;
  readonly errors: Partial<Record<FieldName, string>>;
  readonly dirty: boolean;
  readonly saving: boolean;
  readonly character: boolean;
  readonly inherited: ContextConfig;
  readonly isOwn: (setting: SettingKey) => boolean;
  readonly update: <K extends FieldName>(
    name: K,
    value: DraftValues[K],
  ) => void;
  readonly followWorld: (setting: SettingKey) => void;
  readonly discard: () => void;
  readonly submit: (
    event: React.FormEvent<HTMLFormElement>,
  ) => Promise<boolean>;
}

/**
 * The world's settings keep only what differs from the built-in defaults; a
 * character's keep only the ones they own, and changing a field makes it
 * theirs.
 */
export function useContextDraft({
  data,
  characterName,
  onSave,
}: {
  data: ContextSettingsResponse;
  characterName?: string;
  onSave: (overrides: ContextOverrides) => Promise<boolean>;
}): ContextDraft {
  const character = characterName !== undefined;
  const saved = useMemo<Draft>(
    () => ({
      values: valuesOf(data.effective),
      own: character ? ownOf(data.overrides) : {},
    }),
    [data, character],
  );
  const [edited, setEdited] = useState<Draft | null>(null);
  const [tried, setTried] = useState(false);
  const [saving, setSaving] = useState(false);

  const draft = edited ?? saved;
  const parsed = FormSchema.safeParse(draft.values);
  const errors: Partial<Record<FieldName, string>> = {};
  if (tried && !parsed.success) {
    for (const issue of parsed.error.issues) {
      const key = issue.path[0] as FieldName | undefined;
      if (key && !errors[key]) errors[key] = issue.message;
    }
  }

  return {
    values: draft.values,
    errors,
    dirty: !sameDraft(draft, saved),
    saving,
    character,
    inherited: data.inherited,
    isOwn: (setting) => draft.own[setting] === true,
    update: (name, value) => {
      setEdited((current) => {
        const base = current ?? saved;
        return {
          values: { ...base.values, [name]: value },
          own: character ? { ...base.own, [SETTING_OF[name]]: true } : base.own,
        };
      });
    },
    followWorld: (setting) => {
      const world = valuesOf(data.inherited);
      setEdited((current) => {
        const base = current ?? saved;
        const values = { ...base.values };
        for (const name of Object.keys(SETTING_OF) as FieldName[]) {
          if (SETTING_OF[name] === setting)
            Object.assign(values, { [name]: world[name] });
        }
        const own = { ...base.own };
        delete own[setting];
        return { values, own };
      });
    },
    discard: () => {
      setEdited(null);
      setTried(false);
    },
    submit: async (event) => {
      event.preventDefault();
      setTried(true);
      if (!parsed.success || saving) return false;
      const chosen = settingsOf(parsed.data);
      const keys = Object.keys(chosen) as SettingKey[];
      const overrides = Object.fromEntries(
        keys
          .filter((key) =>
            character
              ? draft.own[key] === true
              : chosen[key] !== data.inherited[key],
          )
          .map((key) => [key, chosen[key]]),
      ) as ContextOverrides;
      const submitted = edited;
      setSaving(true);
      try {
        if (!(await onSave(overrides))) return false;
        setEdited((current) => (current === submitted ? null : current));
        setTried(false);
        toast.success(
          character
            ? `Saved ${characterName}'s settings`
            : "Context settings saved",
        );
        return true;
      } finally {
        setSaving(false);
      }
    },
  };
}

function FollowWorld({
  draft,
  setting,
}: {
  draft: ContextDraft;
  setting: SettingKey;
}) {
  if (!draft.character || !draft.isOwn(setting)) return null;
  return (
    <Button
      type="button"
      tone="link"
      size="sm"
      className="text-xs text-ui-soft hover:text-ui-ink"
      onClick={() => draft.followWorld(setting)}
    >
      Use world default ({describeSetting(setting, draft.inherited[setting])})
    </Button>
  );
}

function NumberSetting({
  draft,
  name,
}: {
  draft: ContextDraft;
  name: NumberName;
}) {
  const setting = SETTING_OF[name];
  const spec = NUMBERS[name];
  return (
    <NumberField
      horizontal
      label={SETTING_LABELS[setting]}
      unit={spec.unit}
      min={spec.min}
      max={spec.max}
      step={spec.step}
      value={draft.values[name]}
      error={draft.errors[name]}
      muted={draft.character && !draft.isOwn(setting)}
      action={<FollowWorld draft={draft} setting={setting} />}
      onValueChange={(next) => {
        if (next !== draft.values[name]) draft.update(name, next);
      }}
      description={spec.description}
    />
  );
}

function UnlimitedSetting({
  draft,
  name,
  label,
  hint,
}: {
  draft: ContextDraft;
  name: SwitchName;
  label: string;
  hint: string;
}) {
  const on = draft.values[name];
  return (
    <div className="flex flex-col items-end gap-1">
      <div className="self-stretch">
        <SwitchRow
          label={label}
          hint={hint}
          checked={on}
          onCheckedChange={(checked) => draft.update(name, checked)}
        />
      </div>
      {on ? <FollowWorld draft={draft} setting={SETTING_OF[name]} /> : null}
    </div>
  );
}

export function ContextFields({ draft }: { draft: ContextDraft }) {
  return (
    <>
      <SettingsSection
        title="Prompt size"
        description="Total tokens a character can send each turn. Every memory budget below fits inside this limit."
      >
        <div className="flex flex-col gap-4">
          <UnlimitedSetting
            draft={draft}
            name="contextUnlimited"
            label="Use the model's whole window"
            hint="Fill as much context as the selected model allows."
          />
          {draft.values.contextUnlimited ? null : (
            <NumberSetting draft={draft} name="maxContextTokens" />
          )}
        </div>
      </SettingsSection>

      <SettingsSection
        title="Long-term memory"
        description="Wiki facts brought to mind from who they're with, where they are, and what they're doing."
      >
        <div className="flex flex-col gap-4">
          <NumberSetting draft={draft} name="onYourMindTokens" />
          <NumberSetting draft={draft} name="peopleLimit" />
          <NumberSetting draft={draft} name="placesLimit" />
        </div>
      </SettingsSection>

      <SettingsSection
        title="Short-term memory"
        description="Recent actions, encounters, and messages kept in the prompt."
      >
        <div className="flex flex-col gap-4">
          <UnlimitedSetting
            draft={draft}
            name="memoryUnlimited"
            label="Use all the room left"
            hint="Recent memory takes whatever space the maximum context leaves."
          />
          {draft.values.memoryUnlimited ? null : (
            <NumberSetting draft={draft} name="memoryLimit" />
          )}
          <NumberSetting draft={draft} name="shortTermHours" />
        </div>
      </SettingsSection>

      <Folds>
        <Fold value="advanced" title="Prompt caching & tool digest">
          <div className="flex flex-col gap-4 pt-2">
            <NumberSetting draft={draft} name="ledgerGridHours" />
            <NumberSetting draft={draft} name="ledgerTrimPercent" />
            <NumberSetting draft={draft} name="toolHistoryTokens" />
          </div>
        </Fold>
      </Folds>
    </>
  );
}
