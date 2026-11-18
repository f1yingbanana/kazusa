"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { ChevronRightIcon, PlusIcon } from "lucide-react";
import { toast } from "sonner";
import type {
  StatCatalog,
  StatChangedBy,
  StatDefinition,
  StatShown,
  StatSubject,
} from "@kazusa/client";
import { Unavailable } from "@/components/entities/source-state";
import { BandScale } from "@/components/stats/band-scale";
import { statLabel } from "@/components/stats/stat-control";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Field,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";
import { useStats } from "@/hooks/use-stats";
import {
  EMPTY_DRAFT,
  STAT_EXAMPLES,
  editConflict,
  STATS_ADVISED,
  statsCharactersSee,
  fromDraft,
  toDraft,
  withLinesKept,
  type StatDraft,
} from "@/lib/stats/draft";
import { catalogAdvice, statAdvice, type StatAdvice } from "@/lib/stats/advice";
import { SettingsSection } from "./settings-section";

const ON: readonly { value: StatSubject; label: string; hint: string }[] = [
  {
    value: "character",
    label: "Each character",
    hint: "Every character has their own value.",
  },
  {
    value: "pair",
    label: "One character toward another",
    hint: "Each character has a private value toward each other person.",
  },
  {
    value: "world",
    label: "The world",
    hint: "One value everyone shares.",
  },
  {
    value: "player",
    label: "You, the player",
    hint: "A value only you have and set, like how tired you are.",
  },
];

const CHANGED_BY: readonly {
  value: StatChangedBy;
  label: string;
  /** How the list says it. */
  summary: string;
  hint: string;
}[] = [
  {
    value: "manual",
    label: "Only you",
    summary: "set by hand",
    hint: "It changes when you or the system agent set it.",
  },
  {
    value: "character",
    label: "The character",
    summary: "chosen by the character",
    hint: "They change it themselves as they act, going by what you wrote above.",
  },
  {
    value: "reviewed",
    label: "Their night's sleep",
    summary: "reviewed each night",
    hint: "Each night they look back on the day and move it a step if something that mattered happened. For values that build slowly.",
  },
];

const SHOWN: readonly { value: StatShown; label: string; hint: string }[] = [
  {
    value: "self",
    label: "The character",
    hint: "They read it each turn.",
  },
  {
    value: "everyone",
    label: "The character and people with them",
    hint: "People in the same place can see it too, like clothes.",
  },
  {
    value: "nobody",
    label: "Nobody",
    hint: "Kept for you to see; characters never read it.",
  },
];

/** A state of the player has no character on it to read it. */
const SHOWN_OF_PLAYER: typeof SHOWN = [
  {
    value: "everyone",
    label: "People with you",
    hint: "Characters in the same place as you read it each turn.",
  },
  {
    value: "nobody",
    label: "Nobody",
    hint: "Kept for you to see; characters never read it.",
  },
];

const labelOf = <T extends string>(
  options: readonly { value: T; label: string }[],
  value: T,
): string => options.find((option) => option.value === value)?.label ?? value;

/** Advice on one field, under its hint: never an error, the state still saves. */
function Advice({ advice }: { advice: readonly StatAdvice[] }) {
  return advice.map(({ tone, text }) => (
    <p
      key={text}
      className={
        tone === "warn"
          ? "border-l-2 border-foreground/40 pl-2 text-sm text-foreground"
          : "border-l-2 border-border pl-2 text-sm text-muted-foreground"
      }
    >
      {text}
    </p>
  ));
}

/** What a state is, in one line, for the list. */
function summary(stat: StatDefinition): string {
  const values =
    stat.kind === "choice"
      ? stat.values.map(({ name }) => name).join(", ")
      : stat.bands?.length
        ? stat.bands.map(({ name }) => name).join(", ")
        : `${stat.min} to ${stat.max}`;
  const changed = CHANGED_BY.find(({ value }) => value === stat.changedBy);
  return `${labelOf(ON, stat.on)} · ${values} · ${changed?.summary ?? ""}`;
}

/**
 * The world's states: what each one is. Their values are set where they belong:
 * the world's beside the clock, a character's and the player's in the
 * inspector.
 */
export function StateSettings() {
  const { enabled, data, error, saveCatalog, stale, refresh } = useStats();
  const [editing, setEditing] = useState<
    | {
        readonly draft: StatDraft;
        /** The state being edited, as it was when the form opened. */
        readonly opened?: StatDefinition;
      }
    | undefined
  >();
  // What the states are by the time an Undo is pressed.
  const latest = useRef<{ catalog: StatCatalog; revision: string }>({
    catalog: [],
    revision: "",
  });
  useEffect(() => {
    if (data) latest.current = data;
  });

  if (!enabled) {
    return (
      <Unavailable requires={["stats"]} title="States need a live Gateway" />
    );
  }
  if (!data) {
    return (
      <SettingsSection title="States">
        <p
          className={
            error ? "text-sm text-destructive" : "text-sm text-muted-foreground"
          }
        >
          {error ? error.message : "Loading states…"}
        </p>
      </SettingsSection>
    );
  }

  const { catalog, revision } = data;
  const seen = statsCharactersSee(catalog);

  /** `base`: the revision of the states `next` was made from. */
  const save = async (
    next: StatCatalog,
    base: string,
    done: string,
    undo?: () => void,
  ): Promise<boolean> => {
    try {
      await saveCatalog(next, base);
      toast.success(
        done,
        undo ? { action: { label: "Undo", onClick: undo } } : undefined,
      );
      return true;
    } catch (cause) {
      toast.error("Couldn't save the states", {
        description: cause instanceof Error ? cause.message : String(cause),
      });
      return false;
    }
  };

  /**
   * Says so, and is true, when the state a form was opened on is no longer as
   * the form found it: the states here follow the stream while the form is
   * open, and the form does not.
   */
  const changedElsewhere = (
    opened: StatDefinition,
    doing: "save" | "delete",
  ): boolean => {
    const conflict = editConflict(catalog, opened);
    if (!conflict) return false;
    const label = statLabel(opened.name);
    toast.error(`Couldn't ${doing} ${label.toLowerCase()}`, {
      description:
        conflict === "deleted"
          ? `${label} was deleted somewhere else while this was open. Close this, and add it again if you still want it.`
          : `${label} was changed somewhere else while this was open. Close this and open it again to see it as it is now.`,
    });
    return true;
  };

  /** Values set under the name are kept, so a delete can be taken back. */
  const remove = (stat: StatDefinition) => {
    const at = catalog.findIndex(({ name }) => name === stat.name);
    return save(
      catalog.filter(({ name }) => name !== stat.name),
      revision,
      "State deleted",
      () => {
        const now = latest.current;
        // A state made under the name since is not this one's to replace.
        if (now.catalog.some(({ name }) => name === stat.name)) {
          toast.error(
            `Couldn't restore ${statLabel(stat.name).toLowerCase()}`,
            {
              description: "Another state has that name now.",
            },
          );
          return;
        }
        void save(
          [...now.catalog.slice(0, at), stat, ...now.catalog.slice(at)],
          now.revision,
          "State restored",
        );
      },
    );
  };

  return (
    <>
      <SettingsSection
        title="States"
        description="Values the world keeps. Characters act on a fact, like money, an outfit or the week it is. A feeling is a meter: it follows what they remember, and is yours to watch. Set the world's beside the clock, and a character's or your own in the inspector."
        action={
          <Button size="sm" onClick={() => setEditing({ draft: EMPTY_DRAFT })}>
            <PlusIcon data-icon="inline-start" aria-hidden />
            New state
          </Button>
        }
      >
        {stale ? (
          <p role="status" className="flex items-center gap-3 text-sm">
            <span className="border-l-2 border-foreground/40 pl-2">
              These may be out of date: the states could not be read again.
            </span>
            <Button
              size="sm"
              variant="outline"
              onClick={() =>
                void refresh().catch(() =>
                  toast.error("Couldn't read the states", {
                    description: "The server did not answer. Try again soon.",
                  }),
                )
              }
            >
              Read again
            </Button>
          </p>
        ) : null}
        {catalog.length ? (
          <ul className="flex flex-col divide-y overflow-hidden rounded-lg border">
            {catalog.map((stat) => (
              <li key={stat.name}>
                <button
                  type="button"
                  aria-label={`Edit ${stat.name}`}
                  onClick={() =>
                    setEditing({ draft: toDraft(stat), opened: stat })
                  }
                  className="flex w-full items-center gap-3 px-3 py-2.5 text-left outline-none hover:bg-accent/40 focus-visible:bg-accent/40 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring"
                >
                  <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                    <span className="text-sm font-medium">
                      {statLabel(stat.name)}
                    </span>
                    <span className="truncate text-sm text-muted-foreground">
                      {summary(stat)}
                    </span>
                    {statAdvice(stat).map(({ brief }) =>
                      brief ? (
                        <span
                          key={brief}
                          className="mt-1 border-l-2 border-foreground/40 pl-2 text-sm"
                        >
                          {brief}
                        </span>
                      ) : null,
                    )}
                  </span>
                  <ChevronRightIcon
                    aria-hidden
                    className="size-4 shrink-0 text-muted-foreground"
                  />
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-muted-foreground">
            No states yet. New state starts one, from an example if you like.
          </p>
        )}
        {catalog.length ? (
          <p
            className={
              seen > STATS_ADVISED
                ? "text-sm font-medium"
                : "text-sm text-muted-foreground"
            }
          >
            {seen > STATS_ADVISED
              ? `Characters keep track of ${seen} of these each turn, more than the ${STATS_ADVISED} or so that work well, so each gets less care.`
              : `Characters keep track of ${seen} of these each turn. About ${STATS_ADVISED} is the most that works well.`}
          </p>
        ) : null}
        {catalogAdvice(catalog).map((text) => (
          <p key={text} className="text-sm text-muted-foreground">
            {text}
          </p>
        ))}
      </SettingsSection>

      {editing ? (
        <StateDialog
          initial={editing.draft}
          replaces={editing.opened?.name}
          taken={
            new Set(
              catalog
                .map(({ name }) => name)
                .filter((name) => name !== editing.opened?.name),
            )
          }
          onClose={() => setEditing(undefined)}
          onSave={async (stat) => {
            const { opened } = editing;
            if (!opened)
              return save([...catalog, stat], revision, "State added");
            if (changedElsewhere(opened, "save")) return false;
            const made = withLinesKept(stat, opened);
            return save(
              catalog.map((entry) =>
                entry.name === opened.name ? made : entry,
              ),
              revision,
              "State saved",
            );
          }}
          onDelete={async () => {
            const { opened } = editing;
            if (!opened || changedElsewhere(opened, "delete")) return false;
            return remove(opened);
          }}
        />
      ) : null}
    </>
  );
}

function Choice<T extends string>({
  id,
  label,
  options,
  value,
  onChange,
  error,
  advice,
}: {
  id: string;
  label: string;
  options: readonly { value: T; label: string; hint: string }[];
  value: T;
  onChange: (value: T) => void;
  error?: string;
  advice?: readonly StatAdvice[];
}) {
  return (
    <Field data-invalid={error ? true : undefined}>
      <FieldLabel htmlFor={id}>{label}</FieldLabel>
      <Select
        items={options}
        value={value}
        onValueChange={(next) => next && onChange(next)}
      >
        <SelectTrigger id={id} className="w-full">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {options.map((option) => (
            <SelectItem key={option.value} value={option.value}>
              {option.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {error ? (
        <FieldError>{error}</FieldError>
      ) : (
        <FieldDescription>
          {options.find((option) => option.value === value)?.hint}
        </FieldDescription>
      )}
      {advice?.length ? <Advice advice={advice} /> : null}
    </Field>
  );
}

function Text({
  id,
  label,
  value,
  onChange,
  error,
  hint,
  advice,
  rows,
  mono,
  placeholder,
  children,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  error?: string;
  hint?: string;
  advice?: readonly StatAdvice[];
  /** A multi-line box of this many rows. */
  rows?: number;
  mono?: boolean;
  placeholder?: string;
  /** Drawn under the hint: what the box's text comes to. */
  children?: ReactNode;
}) {
  const shared = {
    id,
    value,
    placeholder,
    className: mono ? "font-mono text-xs" : undefined,
    "aria-invalid": error ? (true as const) : undefined,
  };
  return (
    <Field data-invalid={error ? true : undefined}>
      <FieldLabel htmlFor={id}>{label}</FieldLabel>
      {rows ? (
        <Textarea
          {...shared}
          rows={rows}
          onChange={(event) => onChange(event.target.value)}
        />
      ) : (
        <Input {...shared} onChange={(event) => onChange(event.target.value)} />
      )}
      {error ? (
        <FieldError>{error}</FieldError>
      ) : hint ? (
        <FieldDescription>{hint}</FieldDescription>
      ) : null}
      {children}
      {advice?.length ? <Advice advice={advice} /> : null}
    </Field>
  );
}

/** Defines one state. Nothing is saved until Save. */
function StateDialog({
  initial,
  replaces,
  taken,
  onClose,
  onSave,
  onDelete,
}: {
  initial: StatDraft;
  /** The state being edited; absent for a new one. */
  replaces?: string;
  taken: ReadonlySet<string>;
  onClose: () => void;
  onSave: (stat: StatDefinition) => Promise<boolean>;
  onDelete: () => Promise<boolean>;
}) {
  const [draft, setDraft] = useState(initial);
  const [tried, setTried] = useState(false);
  const [saving, setSaving] = useState(false);
  const result = fromDraft(draft, taken);
  const errors = tried ? (result.errors ?? {}) : {};
  // Advice is about a state that could be saved as it stands.
  const advice = result.stat ? statAdvice(result.stat) : [];
  const adviceOn = (field: StatAdvice["field"]) =>
    advice.filter((entry) => entry.field === field);
  const put = <K extends keyof StatDraft>(key: K, value: StatDraft[K]) =>
    setDraft((current) => ({ ...current, [key]: value }));

  // What a state sits on limits who can change it and who can see it.
  const changedBy = CHANGED_BY.filter(
    ({ value }) =>
      draft.on === "character" ||
      (draft.on === "pair" ? value !== "character" : value === "manual"),
  );
  const shown =
    draft.on === "player"
      ? SHOWN_OF_PLAYER
      : SHOWN.filter(
          ({ value }) => draft.on !== "pair" || value !== "everyone",
        );
  const setOn = (on: StatSubject) =>
    setDraft((current) => ({
      ...current,
      on,
      changedBy:
        on === "world" ||
        on === "player" ||
        (on === "pair" && current.changedBy === "character")
          ? "manual"
          : current.changedBy,
      shown:
        on === "pair" && current.shown === "everyone"
          ? "self"
          : on === "player" && current.shown === "self"
            ? "everyone"
            : current.shown,
    }));

  const number = draft.kind === "number";

  return (
    // Held open while a save is under way: its result belongs to this form.
    <Dialog open onOpenChange={(open) => !open && !saving && onClose()}>
      <DialogContent className="flex max-h-[90dvh] flex-col sm:max-w-xl">
        <form
          className="flex min-h-0 flex-col gap-4"
          noValidate
          onSubmit={(event) => {
            event.preventDefault();
            setTried(true);
            if (!result.stat) return;
            setSaving(true);
            void onSave(result.stat).then((saved) => {
              setSaving(false);
              if (saved) onClose();
            });
          }}
        >
          {/* What was sent is what is saved: nothing is typed over it meanwhile. */}
          <fieldset disabled={saving} className="contents">
            <DialogHeader>
              <DialogTitle>{replaces ? "Edit state" : "New state"}</DialogTitle>
              <DialogDescription>
                Characters read the name and the words you write here, so write
                them as you would say them to the character.
              </DialogDescription>
            </DialogHeader>
            <FieldGroup className="min-h-0 overflow-y-auto pr-1">
              {replaces ? null : (
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="mr-1 text-sm text-muted-foreground">
                    Start from
                  </span>
                  {STAT_EXAMPLES.map(({ label, stat }) => (
                    <Button
                      key={stat.name}
                      type="button"
                      variant="outline"
                      size="xs"
                      onClick={() => {
                        setDraft(toDraft(stat));
                        setTried(false);
                      }}
                    >
                      {label}
                    </Button>
                  ))}
                </div>
              )}
              <Text
                id="state-name"
                label="Name"
                value={draft.name}
                onChange={(value) => put("name", value)}
                error={errors.name}
                mono
                placeholder="mood"
                hint={
                  replaces && draft.name.trim() !== replaces
                    ? "A new name starts from the initial value; values set under the old name stay with it."
                    : "Lowercase, with _ between words. Shown to characters as written."
                }
              />
              <Text
                id="state-description"
                label="What it is, and when it changes"
                value={draft.description}
                onChange={(value) => put("description", value)}
                error={errors.description}
                rows={3}
                placeholder="Your mood right now. It changes only when something clearly shifts it."
                hint={
                  draft.on === "player"
                    ? "The one thing characters with you are told about it, so write it about you as they would see it."
                    : "The one thing a character is told about it. If they or their sleep change it, this is the rule they go by."
                }
              />
              <Choice
                id="state-on"
                label="Who has it"
                options={ON}
                value={draft.on}
                onChange={setOn}
              />
              <Choice
                id="state-kind"
                label="Kind of value"
                options={[
                  {
                    value: "choice",
                    label: "One of a list",
                    hint: "A named value, like an outfit or the chapter of a story.",
                  },
                  {
                    value: "number",
                    label: "A number",
                    hint: "A value in a range, like health, money or trust.",
                  },
                ]}
                value={draft.kind}
                advice={adviceOn("kind")}
                onChange={(kind) =>
                  setDraft((current) => ({ ...current, kind, initial: "" }))
                }
              />
              {number ? (
                <>
                  <div className="grid grid-cols-3 gap-3">
                    <Text
                      id="state-min"
                      label="Lowest"
                      value={draft.min}
                      onChange={(value) => put("min", value)}
                      error={errors.min}
                      mono
                    />
                    <Text
                      id="state-max"
                      label="Highest"
                      value={draft.max}
                      onChange={(value) => put("max", value)}
                      error={errors.max}
                      mono
                    />
                    <Text
                      id="state-initial"
                      label="Starts at"
                      value={draft.initial}
                      onChange={(value) => put("initial", value)}
                      error={errors.initial}
                      mono
                    />
                  </div>
                  <Text
                    id="state-bands"
                    label="Words for ranges (optional)"
                    value={draft.bands}
                    onChange={(value) => put("bands", value)}
                    error={errors.bands}
                    rows={3}
                    mono
                    placeholder={
                      "cold: 0: You would rather avoid them\nfriendly: 4\nclose: 7"
                    }
                    hint="One per line as name: from, then what it means if you like. Characters read the word, and move it a step up or down."
                    advice={adviceOn("bands")}
                  >
                    {result.stat?.kind === "number" ? (
                      <BandScale stat={result.stat} />
                    ) : null}
                  </Text>
                  {draft.bands.trim() || draft.step.trim() ? (
                    <Text
                      id="state-step"
                      label="One step (optional)"
                      value={draft.step}
                      onChange={(value) => put("step", value)}
                      error={errors.step}
                      mono
                      placeholder="1"
                      hint="How far one move up or down takes it."
                    />
                  ) : null}
                </>
              ) : (
                <>
                  <Text
                    id="state-values"
                    label="Values"
                    value={draft.values}
                    onChange={(value) => put("values", value)}
                    error={errors.values}
                    rows={4}
                    mono
                    placeholder={
                      "calm: Settled, nothing weighing on them\ncheerful: Light and pleased"
                    }
                    hint="One per line as name: what it means. The meaning is optional."
                  />
                  <Text
                    id="state-initial"
                    label="Starts at"
                    value={draft.initial}
                    onChange={(value) => put("initial", value)}
                    error={errors.initial}
                    mono
                    placeholder="calm"
                    hint="The value everyone has until it changes."
                  />
                </>
              )}
              <Choice
                id="state-changed-by"
                label="What changes it"
                options={changedBy}
                value={draft.changedBy}
                onChange={(value) => put("changedBy", value)}
                error={errors.changedBy}
              />
              <Choice
                id="state-shown"
                label="Who reads it"
                options={shown}
                value={draft.shown}
                onChange={(value) => put("shown", value)}
                error={errors.shown}
                advice={adviceOn("shown")}
              />
              {errors[""] ? <FieldError>{errors[""]}</FieldError> : null}
            </FieldGroup>
            <DialogFooter>
              {replaces ? (
                <Button
                  type="button"
                  variant="ghost"
                  className="text-destructive sm:mr-auto"
                  disabled={saving}
                  onClick={() => {
                    setSaving(true);
                    void onDelete().then((deleted) => {
                      setSaving(false);
                      if (deleted) onClose();
                    });
                  }}
                >
                  Delete state
                </Button>
              ) : null}
              <DialogClose
                render={<Button variant="outline" disabled={saving} />}
              >
                Cancel
              </DialogClose>
              <Button type="submit" disabled={saving}>
                {saving ? <Spinner /> : null}
                {replaces ? "Save state" : "Add state"}
              </Button>
            </DialogFooter>
          </fieldset>
        </form>
      </DialogContent>
    </Dialog>
  );
}
