"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useMemo, useState } from "react";
import {
  Controller,
  useForm,
  useWatch,
  type Control,
  type UseFormSetValue,
} from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";
import type {
  ContextOverrides,
  ContextSettings,
  ContextSettingsResponse,
} from "@kazusa/client";
import { Button } from "@/components/ui/button";
import {
  Field,
  FieldContent,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
  FieldLegend,
  FieldSeparator,
  FieldSet,
} from "@/components/ui/field";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
  InputGroupText,
} from "@/components/ui/input-group";
import { DialogClose, DialogFooter } from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { Unavailable } from "@/components/entities/source-state";
import { useCharacter } from "@/hooks/use-characters";
import { useContextSettings } from "@/hooks/use-context-settings";
import { cn } from "@/lib/utils";

/** Where the long version lives: what fills a turn, and how memory is trimmed. */
export const CONTEXT_DOCS_URL =
  "https://github.com/f1yingbanana/kazusa/blob/main/.agents/skills/kazusa/references/context_engine.md#settings";

const numbers = new Intl.NumberFormat("en-US");

type SettingKey = keyof ContextSettings;

/** A whole number in a range, with errors that say what to type instead. */
const whole = (min: number, max: number, unit: string) =>
  z
    .number({ error: "Enter a number." })
    .int({ error: "Use a whole number." })
    .min(min, { error: `At least ${numbers.format(min)} ${unit}.` })
    .max(max, { error: `At most ${numbers.format(max)} ${unit}.` });

const FormSchema = z
  .object({
    contextUnlimited: z.boolean(),
    maxContextTokens: whole(16_000, 10_000_000, "tokens"),
    shortTermHours: whole(24, 720, "hours"),
    memoryUnlimited: z.boolean(),
    memoryLimit: whole(0, 10_000_000, "tokens"),
    toolHistoryTokens: whole(0, 32_000, "tokens"),
    onYourMindTokens: whole(0, 32_000, "tokens"),
    peopleLimit: whole(0, 200, "people"),
    placesLimit: whole(0, 50, "places"),
    ledgerGridHours: whole(1, 24, "hours"),
    ledgerTrimPercent: whole(10, 100, "percent"),
    /** For a character: which settings are their own. */
    own: z.record(z.string(), z.boolean()),
  })
  .refine(
    (values) =>
      values.memoryUnlimited ||
      values.contextUnlimited ||
      values.memoryLimit <= values.maxContextTokens,
    {
      path: ["memoryLimit"],
      error: "Keep it within the maximum context.",
    },
  );
type FormValues = z.infer<typeof FormSchema>;
type SwitchName = "contextUnlimited" | "memoryUnlimited";
type NumberName = Exclude<keyof FormValues, SwitchName | "own">;

/** The switch that sets a setting to `"unlimited"`, where it has one. */
const SWITCH_OF: Partial<Record<SettingKey, SwitchName>> = {
  maxContextTokens: "contextUnlimited",
  ledgerMaxTokens: "memoryUnlimited",
};

/** Which setting each form field writes. */
const SETTING_OF: Record<Exclude<keyof FormValues, "own">, SettingKey> = {
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

function valuesOf(
  settings: ContextSettings,
  own: ContextOverrides,
): FormValues {
  const maximum =
    settings.maxContextTokens === "unlimited"
      ? 64_000
      : settings.maxContextTokens;
  return {
    contextUnlimited: settings.maxContextTokens === "unlimited",
    // What the number shows once the switch is off.
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
    own: Object.fromEntries(Object.keys(own).map((key) => [key, true])),
  };
}

function settingsOf(values: FormValues): ContextSettings {
  return {
    maxContextTokens: values.contextUnlimited
      ? "unlimited"
      : values.maxContextTokens,
    shortTermHours: values.shortTermHours,
    ledgerMaxTokens: values.memoryUnlimited ? "unlimited" : values.memoryLimit,
    toolHistoryTokens: values.toolHistoryTokens,
    onYourMindTokens: values.onYourMindTokens,
    peopleLimit: values.peopleLimit,
    placesLimit: values.placesLimit,
    ledgerGridHours: values.ledgerGridHours,
    ledgerTrimTo: values.ledgerTrimPercent / 100,
  };
}

/** A setting in a sentence: "24 hours", "Unlimited", "75% kept". */
export function describeSetting(
  key: SettingKey,
  value: ContextSettings[SettingKey],
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
      if (value === "unlimited") return "The model’s whole window";
      return `${numbers.format(Number(value))} tokens`;
    case "ledgerMaxTokens":
      if (value === "unlimited") return "All remaining room";
      return `${numbers.format(Number(value))} tokens`;
    default:
      return `${numbers.format(Number(value))} tokens`;
  }
}

/** What each setting is called, wherever it is listed. */
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

interface Scope {
  /** Set for a character: each field then says whether it follows the world. */
  readonly characterName?: string;
  readonly inherited: ContextSettings;
  readonly control: Control<FormValues>;
  readonly setValue: UseFormSetValue<FormValues>;
}

/**
 * For a character, under the control: either the world's value, or a way back
 * to it. Changing the field makes it theirs.
 */
function Inheritance({
  scope,
  setting,
  fields,
}: {
  scope: Scope;
  setting: SettingKey;
  fields: readonly NumberName[];
}) {
  const own = useWatch({ control: scope.control, name: `own.${setting}` });
  if (scope.characterName === undefined) return null;
  // A followed value says so by looking muted; only a changed one needs a way back.
  if (!own) return null;
  const world = describeSetting(setting, scope.inherited[setting]);
  return (
    <Button
      type="button"
      variant="link"
      size="xs"
      className="h-auto px-0 text-xs text-muted-foreground"
      onClick={() => {
        const values = valuesOf(scope.inherited, {});
        for (const name of fields)
          scope.setValue(name, values[name], {
            shouldDirty: true,
            shouldValidate: true,
          });
        const toggle = SWITCH_OF[setting];
        if (toggle)
          scope.setValue(toggle, values[toggle], { shouldDirty: true });
        scope.setValue(`own.${setting}`, false, { shouldDirty: true });
      }}
    >
      Use world default ({world})
    </Button>
  );
}

/** One number with its unit, its label (`SETTING_LABELS`) and description. */
function NumberField({
  scope,
  name,
  unit,
  children,
}: {
  scope: Scope;
  name: NumberName;
  unit: string;
  /** The description. */
  children: React.ReactNode;
}) {
  const setting = SETTING_OF[name];
  const id = `context-${scope.characterName ?? "world"}-${name}`;
  const own = useWatch({ control: scope.control, name: `own.${setting}` });
  const following = scope.characterName !== undefined && !own;
  // Grouped digits to read, plain ones to type.
  const [editing, setEditing] = useState(false);
  return (
    <Controller
      name={name}
      control={scope.control}
      render={({ field, fieldState }) => (
        <Field orientation="responsive" data-invalid={fieldState.invalid}>
          <FieldContent>
            <FieldLabel htmlFor={id}>{SETTING_LABELS[setting]}</FieldLabel>
            <FieldDescription>{children}</FieldDescription>
            {fieldState.invalid ? (
              <FieldError errors={[fieldState.error]} />
            ) : null}
          </FieldContent>
          <div className="flex shrink-0 flex-col items-start gap-1 @md/field-group:items-end">
            <InputGroup className="w-44">
              <InputGroupInput
                id={id}
                name={field.name}
                inputMode="numeric"
                autoComplete="off"
                className={cn(
                  "text-right font-mono tabular-nums",
                  following && "text-muted-foreground",
                )}
                aria-invalid={fieldState.invalid}
                value={
                  Number.isNaN(field.value)
                    ? ""
                    : editing
                      ? String(field.value)
                      : numbers.format(field.value)
                }
                onFocus={() => setEditing(true)}
                onBlur={() => {
                  setEditing(false);
                  field.onBlur();
                }}
                onChange={(event) => {
                  const text = event.target.value.replaceAll(",", "").trim();
                  field.onChange(text === "" ? Number.NaN : Number(text));
                  if (scope.characterName !== undefined)
                    scope.setValue(`own.${setting}`, true, {
                      shouldDirty: true,
                    });
                }}
              />
              <InputGroupAddon align="inline-end">
                <InputGroupText>{unit}</InputGroupText>
              </InputGroupAddon>
            </InputGroup>
            <Inheritance scope={scope} setting={setting} fields={[name]} />
          </div>
        </Field>
      )}
    />
  );
}

/**
 * "Unlimited" for a setting that has it; when on, the number beside it is
 * hidden. Changing it makes the setting a character's own.
 */
function UnlimitedSwitch({
  scope,
  name,
  limit,
  label,
  children,
}: {
  scope: Scope;
  name: SwitchName;
  /** The number it hides. */
  limit: NumberName;
  label: string;
  /** The description. */
  children: React.ReactNode;
}) {
  const setting = SETTING_OF[name];
  const id = `context-${scope.characterName ?? "world"}-${name}`;
  return (
    <Controller
      name={name}
      control={scope.control}
      render={({ field }) => (
        <Field orientation="horizontal">
          <FieldContent>
            <FieldLabel htmlFor={id}>{label}</FieldLabel>
            <FieldDescription>{children}</FieldDescription>
          </FieldContent>
          <div className="flex shrink-0 flex-col items-end gap-1">
            <Switch
              id={id}
              name={field.name}
              checked={field.value}
              onCheckedChange={(checked) => {
                field.onChange(checked);
                if (scope.characterName !== undefined)
                  scope.setValue(`own.${setting}`, true, { shouldDirty: true });
              }}
            />
            {field.value ? (
              <Inheritance scope={scope} setting={setting} fields={[limit]} />
            ) : null}
          </div>
        </Field>
      )}
    />
  );
}

interface ActionsState {
  readonly dirty: boolean;
  readonly submitting: boolean;
  readonly reset: () => void;
}

/** On a page: a sticky bar with Reset and Save changes. */
function PageActions({ dirty, submitting, reset }: ActionsState) {
  return (
    <div className="sticky bottom-0 mt-8 flex items-center justify-end gap-2 border-t bg-background py-4">
      {dirty ? (
        <p className="mr-auto text-sm text-muted-foreground">Unsaved changes</p>
      ) : null}
      <Button
        type="button"
        variant="outline"
        disabled={!dirty || submitting}
        onClick={reset}
      >
        Reset
      </Button>
      <Button type="submit" disabled={!dirty || submitting}>
        Save changes
      </Button>
    </div>
  );
}

/** In a dialog: its footer, with Cancel closing it. */
function DialogActions({ dirty, submitting }: ActionsState) {
  return (
    <DialogFooter className="mt-4">
      <DialogClose render={<Button type="button" variant="outline" />}>
        Cancel
      </DialogClose>
      <Button type="submit" disabled={!dirty || submitting}>
        Save changes
      </Button>
    </DialogFooter>
  );
}

/**
 * Memory, context and what comes to mind, for the world or one character. One
 * form: nothing is saved until Save changes. For the world only values that
 * differ from the built-in defaults are kept; for a character, only the ones
 * they own.
 */
function ContextForm({
  data,
  characterName,
  onSave,
  inDialog,
  onDone,
}: {
  data: ContextSettingsResponse;
  characterName?: string;
  onSave: (overrides: ContextOverrides) => Promise<boolean>;
  inDialog: boolean;
  onDone?: () => void;
}) {
  const Actions = inDialog ? DialogActions : PageActions;
  // Saved values: a new answer from the Gateway resets the form to it.
  const saved = useMemo(() => valuesOf(data.effective, data.overrides), [data]);
  const form = useForm<FormValues>({
    resolver: zodResolver(FormSchema),
    values: saved,
    mode: "onTouched",
  });
  const scope: Scope = {
    ...(characterName === undefined ? {} : { characterName }),
    inherited: data.inherited,
    control: form.control,
    setValue: form.setValue,
  };
  const [contextUnlimited, unlimited] = useWatch({
    control: form.control,
    name: ["contextUnlimited", "memoryUnlimited"],
  });
  const { isDirty, isSubmitting } = form.formState;

  const submit = async (values: FormValues) => {
    const chosen = settingsOf(values);
    const keys = Object.keys(chosen) as SettingKey[];
    const overrides = Object.fromEntries(
      keys
        .filter((key) =>
          characterName === undefined
            ? chosen[key] !== data.inherited[key]
            : values.own[key],
        )
        .map((key) => [key, chosen[key]]),
    ) as ContextOverrides;
    if (await onSave(overrides)) {
      toast.success(
        characterName
          ? `Saved ${characterName}’s settings`
          : "Context settings saved",
      );
      onDone?.();
    }
  };

  return (
    <form
      noValidate
      onSubmit={(event) => void form.handleSubmit(submit)(event)}
      className="flex flex-col"
    >
      {/* In a dialog only the fields scroll, between its header and footer. */}
      <FieldGroup
        className={cn(
          "gap-8",
          inDialog && "-mx-4 no-scrollbar max-h-[60vh] overflow-y-auto px-4",
        )}
      >
        <FieldSet>
          <FieldLegend>Prompt size</FieldLegend>
          <FieldDescription>
            Everything a character sends their model each time they think. Every
            setting below is restricted by this setting.
          </FieldDescription>
          <FieldGroup>
            <UnlimitedSwitch
              scope={scope}
              name="contextUnlimited"
              limit="maxContextTokens"
              label="Use the model’s whole window"
            >
              Fill as much context as the model allows.
            </UnlimitedSwitch>
            {contextUnlimited ? null : (
              <NumberField scope={scope} name="maxContextTokens" unit="tokens">
                Limit the maximum token sent per prompt.
              </NumberField>
            )}
          </FieldGroup>
        </FieldSet>

        <FieldSeparator />

        <FieldSet>
          <FieldLegend>Long-term memory</FieldLegend>
          <FieldDescription>
            Wiki entries injected into the prompt directly, based on their
            surroundings, task and conversations.
          </FieldDescription>
          <FieldGroup>
            <NumberField scope={scope} name="onYourMindTokens" unit="tokens">
              How much of what they know about the people, places and things in
              the moment comes to mind, from their wiki. The lists below are
              counted on their own.
            </NumberField>
            <NumberField scope={scope} name="peopleLimit" unit="people">
              Maximum number of people they know listed each turn: the ones most
              in their life, from what they do together.
            </NumberField>
            <NumberField scope={scope} name="placesLimit" unit="places">
              Maximum number of places they know listed each turn: home first,
              then the ones they go to most. Also caps the places around them.
            </NumberField>
          </FieldGroup>
        </FieldSet>

        <FieldSeparator />

        <FieldSet>
          <FieldLegend>Short-term memory</FieldLegend>
          <FieldDescription>
            A transcript of what tasks they performed, who they met and what
            messages they sent and received.
          </FieldDescription>
          <FieldGroup>
            <UnlimitedSwitch
              scope={scope}
              name="memoryUnlimited"
              limit="memoryLimit"
              label="Use all the room left"
            >
              Memory takes whatever the maximum leaves.
            </UnlimitedSwitch>
            {unlimited ? null : (
              <NumberField scope={scope} name="memoryLimit" unit="tokens">
                The amount of tokens memory may take in the prompt.
              </NumberField>
            )}
            <NumberField scope={scope} name="shortTermHours" unit="hours">
              Maximum number of hours to fetch. Anything older comes back only
              when something reminds them.
            </NumberField>
            <NumberField scope={scope} name="ledgerGridHours" unit="hours">
              Used for caching. When the context window is large enough, this
              only evicts the oldest message every interval specified, allowing
              more cache hits.
            </NumberField>
            <NumberField scope={scope} name="ledgerTrimPercent" unit="% kept">
              Used for caching. When the context window is not large enough,
              this shrinks the context window to ratio specified, allowing more
              cache hits.
            </NumberField>
            <NumberField scope={scope} name="toolHistoryTokens" unit="tokens">
              A short digest of their last tool calls, used to prevent incorrect
              tool calls.
            </NumberField>
          </FieldGroup>
        </FieldSet>
      </FieldGroup>

      <Actions
        dirty={isDirty}
        submitting={isSubmitting}
        reset={() => form.reset()}
      />
    </form>
  );
}

/**
 * The context settings of the world, or of one character (`agentId`): the same
 * form on the Settings page and in a character's dialog (`inDialog`, which puts
 * its buttons in the dialog's footer and calls `onDone` after a save).
 */
export function ContextSettingsForm({
  agentId,
  inDialog = false,
  onDone,
}: {
  agentId?: string;
  inDialog?: boolean;
  onDone?: () => void;
}) {
  const { enabled, data, error, save } = useContextSettings(agentId);
  const character = useCharacter(agentId);
  if (!enabled)
    return (
      <Unavailable
        requires={["context"]}
        title="Context settings need a live Gateway"
      />
    );
  if (error)
    return (
      <p className="text-sm text-destructive">
        Couldn’t load the settings: {error.message}
      </p>
    );
  if (!data) return <Skeleton className="h-96 w-full" />;
  return (
    <ContextForm
      data={data}
      {...(agentId === undefined
        ? {}
        : { characterName: character?.name ?? agentId })}
      onSave={save}
      inDialog={inDialog}
      {...(onDone ? { onDone } : {})}
    />
  );
}
