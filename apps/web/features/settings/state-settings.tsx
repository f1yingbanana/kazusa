"use client";

import type {
  StatCatalog,
  StatChangedBy,
  StatDefinition,
  StatShown,
  StatSubject,
} from "@kazusa/client";
import { ChevronRightIcon, PlusIcon } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { toast } from "@/ui/toast";
import { useStats } from "@/hooks/use-stats";
import { catalogAdvice, statAdvice, type StatAdvice } from "@/lib/stats/advice";
import {
  EMPTY_DRAFT,
  STAT_EXAMPLES,
  STATS_ADVISED,
  editConflict,
  fromDraft,
  statsCharactersSee,
  toDraft,
  withLinesKept,
  type StatDraft,
} from "@/lib/stats/draft";
import { Button } from "@/ui/button";
import { cx } from "@/ui/cx";
import {
  AlertDialog,
  AlertPanel,
  Dialog,
  DialogClose,
  DialogPanel,
} from "@/ui/dialog";
import { TextareaField, TextField } from "@/ui/field";
import { Note } from "@/ui/note";
import { SelectField } from "@/ui/select";
import {
  Callout,
  SettingsGroup,
  SettingsPage,
  SettingsRowButton,
  SettingsSection,
} from "@/ui/settings";
import { BandScale } from "./band-scale";
import { Unavailable } from "./unavailable";

function statLabel(name: string): string {
  const spaced = name.replace(/_/g, " ");
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

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
];

const CHANGED_BY: readonly {
  value: StatChangedBy;
  label: string;
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

const labelOf = <T extends string>(
  options: readonly { value: T; label: string }[],
  value: T,
): string => options.find((option) => option.value === value)?.label ?? value;

function Advice({ advice }: { advice: readonly StatAdvice[] }) {
  return advice.map(({ tone, text }) => (
    <p
      key={text}
      className={cx(
        "border-s-2 ps-2.5 text-xs leading-relaxed",
        tone === "warn"
          ? "border-ui-primary font-medium text-ui-ink"
          : "border-ui-line text-ui-soft",
      )}
    >
      {text}
    </p>
  ));
}

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

function Choice<T extends string>({
  label,
  options,
  value,
  onChange,
  error,
  advice,
}: {
  label: string;
  options: readonly { value: T; label: string; hint: string }[];
  value: T;
  onChange: (value: T) => void;
  error?: string;
  advice?: readonly StatAdvice[];
}) {
  return (
    <SelectField<T>
      label={label}
      options={options}
      value={value}
      onValueChange={onChange}
      error={error}
      description={options.find((option) => option.value === value)?.hint}
    >
      {advice?.length ? <Advice advice={advice} /> : null}
    </SelectField>
  );
}

function StateDialog({
  initial,
  replaces,
  taken,
  onClose,
  onSave,
  onDelete,
}: {
  initial: StatDraft;
  replaces?: string;
  taken: ReadonlySet<string>;
  onClose: () => void;
  onSave: (stat: StatDefinition) => Promise<boolean>;
  onDelete: () => Promise<boolean>;
}) {
  const [draft, setDraft] = useState(initial);
  const [tried, setTried] = useState(false);
  const [saving, setSaving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const result = fromDraft(draft, taken);
  const errors = tried ? (result.errors ?? {}) : {};
  const advice = result.stat ? statAdvice(result.stat) : [];
  const adviceOn = (field: StatAdvice["field"]) =>
    advice.filter((entry) => entry.field === field);
  const put = <K extends keyof StatDraft>(key: K, value: StatDraft[K]) =>
    setDraft((current) => ({ ...current, [key]: value }));

  const changedBy = CHANGED_BY.filter(
    ({ value }) =>
      draft.on === "character" ||
      (draft.on === "pair" ? value !== "character" : value === "manual"),
  );
  const shown = SHOWN.filter(
    ({ value }) => draft.on !== "pair" || value !== "everyone",
  );
  const setOn = (on: StatSubject) =>
    setDraft((current) => ({
      ...current,
      on,
      changedBy:
        on === "world" || (on === "pair" && current.changedBy === "character")
          ? "manual"
          : current.changedBy,
      shown:
        on === "pair" && current.shown === "everyone" ? "self" : current.shown,
    }));

  const number = draft.kind === "number";
  const formId = "state-editor-form";

  return (
    <>
      <Dialog
        open
        dismissible={!saving}
        onOpenChange={(open) => !open && !saving && onClose()}
      >
        <DialogPanel
          size="lg"
          title={replaces ? "Edit state" : "New state"}
          description="Characters read the name and rules you write here, so phrase them plainly."
          footer={
            <>
              {replaces ? (
                <Button
                  type="button"
                  tone="danger"
                  disabled={saving}
                  className="sm:me-auto"
                  onClick={() => setConfirmDelete(true)}
                >
                  Delete
                </Button>
              ) : null}
              <DialogClose
                render={<Button type="button" tone="soft" disabled={saving} />}
              >
                Cancel
              </DialogClose>
              <Button
                type="submit"
                form={formId}
                tone="primary"
                pending={saving}
              >
                Confirm
              </Button>
            </>
          }
        >
          <form
            id={formId}
            className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto pe-1"
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
            {replaces ? null : (
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="me-1 text-xs font-semibold text-ui-soft">
                  Start from
                </span>
                {STAT_EXAMPLES.map(({ label, stat }) => (
                  <Button
                    key={stat.name}
                    type="button"
                    tone="soft"
                    size="sm"
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

            <TextField
              label="Name"
              value={draft.name}
              onValueChange={(value) => put("name", value)}
              error={errors.name}
              mono
              disabled={saving}
              placeholder="mood"
              description={
                replaces && draft.name.trim() !== replaces
                  ? "A new name starts from the initial value; values set under the old name stay with it."
                  : "Lowercase with _ between words."
              }
            />

            <TextareaField
              label="What it is, and when it changes"
              value={draft.description}
              onValueChange={(value) => put("description", value)}
              error={errors.description}
              rows={3}
              disabled={saving}
              placeholder="Your mood right now. It changes only when something clearly shifts it."
              description="The rule characters follow if they or their sleep update it."
            />

            <Choice
              label="Who has it"
              options={ON}
              value={draft.on}
              onChange={setOn}
            />

            <Choice
              label="Kind of value"
              options={[
                {
                  value: "choice",
                  label: "One of a list",
                  hint: "A named value, like an outfit or chapter.",
                },
                {
                  value: "number",
                  label: "A number",
                  hint: "A value in a range, like health, money, or trust.",
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
                  <TextField
                    label="Lowest"
                    value={draft.min}
                    onValueChange={(value) => put("min", value)}
                    error={errors.min}
                    mono
                    disabled={saving}
                  />
                  <TextField
                    label="Highest"
                    value={draft.max}
                    onValueChange={(value) => put("max", value)}
                    error={errors.max}
                    mono
                    disabled={saving}
                  />
                  <TextField
                    label="Starts at"
                    value={draft.initial}
                    onValueChange={(value) => put("initial", value)}
                    error={errors.initial}
                    mono
                    disabled={saving}
                  />
                </div>
                <div className="flex flex-col gap-1.5">
                  <TextareaField
                    label="Words for ranges (optional)"
                    value={draft.bands}
                    onValueChange={(value) => put("bands", value)}
                    error={errors.bands}
                    rows={3}
                    mono
                    disabled={saving}
                    placeholder={
                      "cold: 0: You would rather avoid them\nfriendly: 4\nclose: 7"
                    }
                    description="One per line as name: from, then optional meaning."
                  />
                  {result.stat?.kind === "number" ? (
                    <BandScale stat={result.stat} />
                  ) : null}
                  {adviceOn("bands").length ? (
                    <Advice advice={adviceOn("bands")} />
                  ) : null}
                </div>
                {draft.bands.trim() || draft.step.trim() ? (
                  <TextField
                    label="One step (optional)"
                    value={draft.step}
                    onValueChange={(value) => put("step", value)}
                    error={errors.step}
                    mono
                    disabled={saving}
                    placeholder="1"
                    description="How far one move up or down takes it."
                  />
                ) : null}
              </>
            ) : (
              <>
                <TextareaField
                  label="Values"
                  value={draft.values}
                  onValueChange={(value) => put("values", value)}
                  error={errors.values}
                  rows={4}
                  mono
                  disabled={saving}
                  placeholder={
                    "calm: Settled, nothing weighing on them\ncheerful: Light and pleased"
                  }
                  description="One per line as name: meaning (meaning is optional)."
                />
                <TextField
                  label="Starts at"
                  value={draft.initial}
                  onValueChange={(value) => put("initial", value)}
                  error={errors.initial}
                  mono
                  disabled={saving}
                  placeholder="calm"
                  description="The value everyone starts with."
                />
              </>
            )}

            <Choice
              label="What changes it"
              options={changedBy}
              value={draft.changedBy}
              onChange={(value) => put("changedBy", value)}
              error={errors.changedBy}
            />

            <Choice
              label="Who reads it"
              options={shown}
              value={draft.shown}
              onChange={(value) => put("shown", value)}
              error={errors.shown}
              advice={adviceOn("shown")}
            />

            {errors[""] ? (
              <p className="text-xs font-semibold text-ui-danger">
                {errors[""]}
              </p>
            ) : null}
          </form>
        </DialogPanel>
      </Dialog>

      <AlertDialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <AlertPanel
          danger
          title={replaces ? `Delete ${statLabel(replaces)}?` : "Delete state?"}
          description="Removes this state definition from the world. Values already recorded are kept if you add it again later."
          agentConfirm={
            replaces
              ? `Deletes the ${replaces} state from the world`
              : "Deletes this state"
          }
          onConfirm={() => {
            setConfirmDelete(false);
            setSaving(true);
            void onDelete().then((deleted) => {
              setSaving(false);
              if (deleted) onClose();
            });
          }}
        />
      </AlertDialog>
    </>
  );
}

export function StateSettings() {
  const { enabled, canManage, data, error, saveCatalog, stale, refresh } =
    useStats();
  const [editing, setEditing] = useState<
    | {
        readonly draft: StatDraft;
        readonly opened?: StatDefinition;
      }
    | undefined
  >();
  const latest = useRef<{ catalog: StatCatalog; revision: string }>({
    catalog: [],
    revision: "",
  });
  useEffect(() => {
    if (data) latest.current = data;
  });

  if (!enabled) {
    return (
      <SettingsPage
        title="States"
        description="Values tracked on characters, relationships, and the world."
      >
        <Unavailable requires={["stats"]} title="States need a live Gateway" />
      </SettingsPage>
    );
  }

  if (!data) {
    return (
      <SettingsPage
        title="States"
        description="Values tracked on characters, relationships, and the world."
      >
        {error ? (
          <Callout tone="danger" title="Couldn't load states">
            {error.message}
          </Callout>
        ) : (
          <Note>Loading states…</Note>
        )}
      </SettingsPage>
    );
  }

  const { catalog, revision } = data;
  const seen = statsCharactersSee(catalog);

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
        undo ? { action: { label: "Undo", onAction: undo } } : undefined,
      );
      return true;
    } catch (cause) {
      toast.error("Couldn't save the states", {
        description: cause instanceof Error ? cause.message : String(cause),
      });
      return false;
    }
  };

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
          ? `${label} was deleted elsewhere while this was open.`
          : `${label} changed elsewhere while this was open. Reopen it to see the latest version.`,
    });
    return true;
  };

  const remove = (stat: StatDefinition) => {
    const at = catalog.findIndex(({ name }) => name === stat.name);
    return save(
      catalog.filter(({ name }) => name !== stat.name),
      revision,
      "State deleted",
      () => {
        const now = latest.current;
        if (now.catalog.some(({ name }) => name === stat.name)) {
          toast.error(
            `Couldn't restore ${statLabel(stat.name).toLowerCase()}`,
            { description: "Another state has that name now." },
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
    <SettingsPage
      title="States"
      description="Values tracked on characters, relationships, and the world."
    >
      <SettingsSection
        title="Tracked states"
        action={
          canManage ? (
            <Button
              tone="primary"
              size="sm"
              icon={<PlusIcon aria-hidden />}
              onClick={() => setEditing({ draft: EMPTY_DRAFT })}
            >
              New state
            </Button>
          ) : null
        }
      >
        {stale ? (
          <Callout
            title="States may be out of date"
            action={
              <Button
                size="sm"
                tone="soft"
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
            }
          >
            The latest states could not be refreshed automatically.
          </Callout>
        ) : null}

        {catalog.length ? (
          <SettingsGroup>
            {catalog.map((stat) => (
              <li key={stat.name}>
                <SettingsRowButton
                  aria-label={`Edit ${stat.name}`}
                  disabled={!canManage}
                  onClick={() =>
                    setEditing({ draft: toDraft(stat), opened: stat })
                  }
                >
                  <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                    <span className="text-sm font-bold text-ui-ink">
                      {statLabel(stat.name)}
                    </span>
                    <span className="truncate text-xs text-ui-soft">
                      {summary(stat)}
                    </span>
                    {statAdvice(stat).map(({ brief }) =>
                      brief ? (
                        <span
                          key={brief}
                          className="mt-1 border-s-2 border-ui-primary ps-2 text-xs text-ui-ink"
                        >
                          {brief}
                        </span>
                      ) : null,
                    )}
                  </span>
                  <ChevronRightIcon
                    aria-hidden
                    className="size-4 shrink-0 text-ui-soft"
                  />
                </SettingsRowButton>
              </li>
            ))}
          </SettingsGroup>
        ) : (
          <div className="rounded-[1rem] border border-dashed border-ui-line p-4">
            <Note>
              No states yet. New state starts one, from an example if you like.
            </Note>
          </div>
        )}

        {catalog.length ? (
          <p
            className={cx(
              "text-xs",
              seen > STATS_ADVISED
                ? "font-semibold text-ui-ink"
                : "text-ui-soft",
            )}
          >
            {seen > STATS_ADVISED
              ? `Characters track ${seen} of these each turn—more than the ${STATS_ADVISED} or so that work best, so each gets less attention.`
              : `Characters track ${seen} of these each turn. Keeping ${STATS_ADVISED} or fewer works best.`}
          </p>
        ) : null}

        {catalogAdvice(catalog).map((text) => (
          <p key={text} className="text-xs text-ui-soft">
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
            if (!opened) {
              return save([...catalog, stat], revision, "State added");
            }
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
    </SettingsPage>
  );
}
