"use client";

import type {
  WikiKind,
  WikiMember,
  WikiPageForm,
  WikiPageFormFields,
  WikiSourceResponse,
} from "@kazusa/client";
import { GlobeIcon, MapPinIcon, UsersRoundIcon } from "lucide-react";
import { useEffect, useId, useState, type ReactNode } from "react";
import { toast } from "@/ui/toast";
import { useCharacters } from "@/hooks/use-characters";
import { useSaveWikiPage, useWikiList } from "@/hooks/use-wiki";
import { PersonOptionAvatar } from "../characters/character-picker";
import { useWikiForm, useWikiReach } from "@/hooks/use-wiki-editor";
import { saveWikiForm } from "@/lib/source/wiki/editor";
import { WikiConflictError } from "@/lib/source/wiki/http";
import { readerWords, readersOf, type Layer } from "@/lib/wiki/layers";
import { pageId } from "@/lib/wiki/page-id";
import { firstSentence, splitAliases, unwrap } from "@/lib/wiki/text";
import { Button } from "@/ui/button";
import { CheckRow } from "@/ui/checkbox";
import { cx } from "@/ui/cx";
import { AlertDialog, AlertPanel } from "@/ui/dialog";
import { TextInput } from "@/ui/input";
import { Note } from "@/ui/note";
import { Segmented, SegmentedItem } from "@/ui/segmented";
import { Callout } from "@/ui/settings";
import { LAYER_NAME } from "./article";
import {
  EditorSection,
  KNOWING_LEVELS,
  LayerField,
  LevelRows,
  MEMBER_LEVELS,
} from "./editor-parts";
import { failureText } from "./failure";
import { useLeaveGuard } from "./leave-guard";
import { LinkField } from "./link-field";
import { BODY_TRANSITION, TITLE_TRANSITION } from "./motion";
import { OnePicker } from "@/ui/combobox";
import { ToggleChip } from "@/ui/toggle";
import { usePlaceOptions, WhereItIs } from "./place-editor";
import type { WikiSide } from "./search-params";
import { SourceEditor } from "./source-editor";

const EVERYONE = "everyone";

interface Draft {
  readonly fields: WikiPageFormFields;
  readonly aliases: string;
  readonly lead: string;
  readonly close: string;
  readonly only: string;
  readonly members: readonly WikiMember[];
}

const everyoneFirst = <T extends { ref: string }>(groups: readonly T[]) => [
  ...groups.filter(({ ref }) => ref.toLowerCase() === EVERYONE),
  ...groups.filter(({ ref }) => ref.toLowerCase() !== EVERYONE),
];

function draftOf(form: WikiPageForm, name: string): Draft {
  return {
    fields: {
      ...form.fields,
      name: form.fields.name ?? name,
      groups: everyoneFirst(form.fields.groups),
    },
    aliases: form.fields.aliases.join(", "),
    lead: unwrap(form.lead),
    close: unwrap(form.close),
    only: unwrap(form.only),
    members: form.members ?? [],
  };
}

interface BarState {
  dirty: boolean;
  saving: boolean;
  conflict: boolean;
  save: () => void;
  reload: () => void;
}

/**
 * A page opened to be written, in the form or as its Markdown. Either way a bar
 * at the foot says what changed, switches between the two, and saves over the
 * version opened; leaving with changes asks first.
 */
export function PageEditor({
  id,
  agent,
  kind,
  name,
  side,
  owner,
  raw,
  compact = false,
  onRaw,
  onDone,
}: {
  id: string;
  /** Their own wiki; the World Wiki without it. */
  agent?: string | undefined;
  /** Where a new page goes; an existing one stays where it is. */
  kind?: WikiKind | undefined;
  /** For a page not written yet. */
  name: string;
  side: WikiSide;
  owner?: string | undefined;
  raw: boolean;
  /** In a column beside another page: one field to a row. */
  compact?: boolean;
  onRaw: (raw: boolean) => void;
  onDone: (saved?: WikiSourceResponse) => void;
}) {
  const [leaving, setLeaving] = useState<"close" | "switch">();

  const bar = ({ dirty, saving, conflict, save, reload }: BarState) => (
    <EditorBar
      dirty={dirty}
      saving={saving}
      conflict={conflict}
      raw={raw}
      onSave={save}
      onReload={reload}
      onSwitch={() => {
        if (saving) return;
        if (dirty) setLeaving("switch");
        else onRaw(!raw);
      }}
      onClose={() => {
        if (saving) return;
        if (dirty) setLeaving("close");
        else onDone();
      }}
    />
  );

  return (
    <>
      {raw ? (
        <SourceEditor
          id={id}
          agent={agent}
          kind={kind}
          name={name}
          side={side}
          owner={owner}
          bar={bar}
          onDone={onDone}
        />
      ) : (
        <FormEditor
          id={id}
          agent={agent}
          kind={kind}
          name={name}
          side={side}
          owner={owner}
          compact={compact}
          bar={bar}
          onDone={onDone}
        />
      )}
      <AlertDialog
        open={leaving !== undefined}
        onOpenChange={(open) => !open && setLeaving(undefined)}
      >
        <AlertPanel
          danger
          title="Discard your changes?"
          description={
            leaving === "switch"
              ? "Your changes won't carry over."
              : "Your changes won't be saved."
          }
          onConfirm={() => {
            const next = leaving;
            setLeaving(undefined);
            if (next === "switch") onRaw(!raw);
            else onDone();
          }}
        />
      </AlertDialog>
    </>
  );
}

function EditorBar({
  dirty,
  saving,
  conflict,
  raw,
  onSave,
  onReload,
  onSwitch,
  onClose,
}: {
  dirty: boolean;
  saving: boolean;
  conflict: boolean;
  raw: boolean;
  onSave: () => void;
  onReload: () => void;
  onSwitch: () => void;
  onClose: () => void;
}) {
  return (
    <div
      role="region"
      aria-label="Saving"
      className="sticky bottom-3 z-20 mt-2 flex flex-wrap items-center gap-2 rounded-[1.25rem] ui-raised px-3 py-2 motion-safe:animate-ui-rise"
    >
      <Segmented<"form" | "raw">
        aria-label="Edit with"
        value={raw ? "raw" : "form"}
        disabled={saving}
        onValueChange={(next) =>
          !saving && next && (next === "raw") !== raw && onSwitch()
        }
      >
        <SegmentedItem
          value="form"
          disabled={saving}
          className="h-7 px-3 text-[0.8125rem]"
        >
          Form
        </SegmentedItem>
        <SegmentedItem
          value="raw"
          disabled={saving}
          className="h-7 px-3 text-[0.8125rem]"
        >
          Markdown
        </SegmentedItem>
      </Segmented>
      <p
        role="status"
        className={cx(
          "min-w-0 flex-1 px-1 text-[0.8125rem] font-semibold max-sm:order-first max-sm:basis-full",
          conflict ? "text-ui-danger" : "text-ui-soft",
        )}
      >
        {conflict
          ? "Changed since you opened it"
          : dirty
            ? "Unsaved changes"
            : "No changes yet"}
      </p>
      {conflict ? (
        <Button tone="soft" size="sm" onClick={onReload}>
          Load the new version
        </Button>
      ) : null}
      <Button tone="ghost" size="sm" disabled={saving} onClick={onClose}>
        Cancel
      </Button>
      <Button
        tone="primary"
        size="sm"
        pending={saving}
        disabled={!dirty || conflict}
        onClick={onSave}
      >
        Save
      </Button>
    </div>
  );
}

/**
 * A page as a form, in the order it is read: its name and what it is, who knows
 * it, where it is, then one field per layer, each on the rail that marks it on
 * the page and with who reads it.
 */
function FormEditor({
  id,
  agent,
  kind,
  name,
  side,
  owner,
  compact,
  bar,
  onDone,
}: {
  id: string;
  agent: string | undefined;
  kind: WikiKind | undefined;
  name: string;
  side: WikiSide;
  owner: string | undefined;
  compact: boolean;
  bar: (state: BarState) => ReactNode;
  onDone: (saved?: WikiSourceResponse) => void;
}) {
  const source = useWikiForm(id, agent, kind);
  const [opened, setOpened] = useState<WikiPageForm | undefined>(() =>
    source.data && !source.isValidating ? source.data : undefined,
  );
  useEffect(() => {
    if (!opened && source.data && !source.isValidating) setOpened(source.data);
  }, [opened, source.data, source.isValidating]);
  const personal = side === "own";
  const { data: reach } = useWikiReach(personal ? undefined : id);
  const { data: list } = useWikiList();
  const { byId } = useCharacters();
  const savePage = useSaveWikiPage();
  const [draft, setDraft] = useState<Draft>();
  const [moveOther, setMoveOther] = useState(false);
  const [saving, setSaving] = useState(false);
  const [conflict, setConflict] = useState(false);
  const formId = useId();
  const guard = useLeaveGuard(
    opened !== undefined &&
      (moveOther ||
        !opened.exists ||
        (draft !== undefined &&
          JSON.stringify(draft) !== JSON.stringify(draftOf(opened, name)))),
  );
  const { options: places } = usePlaceOptions();

  if (!opened) {
    return (
      <div className={cx("flex min-w-0 flex-col", compact ? "gap-5" : "gap-6")}>
        <div className="flex flex-col gap-1">
          <TextInput
            aria-label="Name"
            value={name}
            readOnly
            style={compact ? undefined : TITLE_TRANSITION}
            className={cx(
              "h-auto w-full px-3.5 py-2 leading-tight font-extrabold",
              compact ? "text-xl" : "text-[1.75rem]",
            )}
          />
          <p
            title="Page id (linked to filename; can't change)"
            className="px-1 font-[ui-monospace,monospace] text-xs text-ui-soft"
          >
            {id}
          </p>
        </div>
        <div style={compact ? undefined : BODY_TRANSITION}>
          {source.error ? (
            <Note>{failureText(source.error)}</Note>
          ) : (
            <div className="flex flex-col gap-3" aria-busy="true">
              <div className="h-9 w-full rounded-[0.875rem] bg-ui-tint motion-safe:animate-ui-pulse" />
              <div className="h-28 w-full rounded-[1rem] bg-ui-tint motion-safe:animate-ui-pulse" />
            </div>
          )}
        </div>
      </div>
    );
  }

  const initial = draftOf(opened, name);
  const current = draft ?? initial;
  const { fields } = current;
  const pageKind = opened.kind;
  const subject = fields.name?.trim() || name;
  const dirty =
    moveOther ||
    !opened.exists ||
    JSON.stringify(current) !== JSON.stringify(initial);
  const set = (patch: Partial<Draft> | ((cur: Draft) => Partial<Draft>)) =>
    setDraft((cur) => {
      const base = cur ?? initial;
      return {
        ...base,
        ...(typeof patch === "function" ? patch(base) : patch),
      };
    });
  const setField = (
    patch:
      | Partial<WikiPageFormFields>
      | ((cur: WikiPageFormFields) => Partial<WikiPageFormFields>),
  ) =>
    set((cur) => ({
      fields: {
        ...cur.fields,
        ...(typeof patch === "function" ? patch(cur.fields) : patch),
      },
    }));
  const upgraded = list?.upgraded !== false;
  const person = pageKind === "person";
  const isPlace = pageKind === "concept" && !personal && fields.place === true;
  const isGroup = pageKind === "concept" && !personal && fields.group === true;
  const ownVoice = person && !personal;
  const pages = list?.pages ?? [];
  const pageByRef = (ref: string) =>
    pages.find(
      (page) =>
        page.id === ref || page.name.toLowerCase() === ref.toLowerCase(),
    );
  const nameOf = (ref: string) =>
    ref.toLowerCase() === EVERYONE
      ? "Everyone"
      : (byId.get(ref)?.name ?? pageByRef(ref)?.name ?? ref);
  const groupMedia = (
    <span className="grid size-6 shrink-0 place-items-center rounded-full bg-ui-tint text-ui-soft [&_svg]:size-3.5">
      <UsersRoundIcon aria-hidden />
    </span>
  );
  const audienceMedia = (ref: string): ReactNode => {
    if (ref.toLowerCase() === EVERYONE)
      return (
        <span className="grid size-6 shrink-0 place-items-center rounded-full bg-ui-tint text-ui-primary [&_svg]:size-3.5">
          <GlobeIcon aria-hidden />
        </span>
      );
    const matched = pageByRef(ref);
    const personEntry = byId.get(matched?.id ?? ref);
    if (personEntry || matched?.kind === "person")
      return (
        <PersonOptionAvatar
          name={personEntry?.name ?? matched?.name ?? ref}
          person={personEntry}
          size="xs"
        />
      );
    return groupMedia;
  };
  const groupOptions = pages
    .filter((page) => page.group && page.id !== id)
    .map((page) => ({
      value: page.id,
      label: page.name,
      keywords: [page.id, ...page.aliases],
      hint: "Group",
      media: groupMedia,
    }));
  const people = pages
    .filter((page) => page.kind === "person" && page.id !== id)
    .toSorted((a, b) => a.name.localeCompare(b.name))
    .map((page) => {
      const char = byId.get(page.id);
      return {
        value: page.id,
        label: char?.name ?? page.name,
        keywords: [page.id, ...page.aliases, ...(char?.aliases ?? [])],
        media: (
          <PersonOptionAvatar
            name={char?.name ?? page.name}
            person={char}
            size="xs"
          />
        ),
      };
    });

  const newGroup = async (groupName: string): Promise<string> => {
    const groupId = pageId(groupName, new Set(pages.map((page) => page.id)), {
      fallback: "group",
    });
    await savePage({
      id: groupId,
      kind: "concept",
      base: null,
      text: `---\nname: ${JSON.stringify(groupName)}\ngroup: true\n---\n\n# ${groupName}\n`,
    });
    return groupId;
  };

  const save = async () => {
    setSaving(true);
    try {
      const aliases = splitAliases(current.aliases);
      const saved = await saveWikiForm({
        id,
        ...(agent ? { agent } : {}),
        kind: opened.kind,
        base: opened.hash,
        fields: { ...current.fields, aliases },
        // A text left as it opened is saved as written, line breaks and all.
        lead: current.lead === initial.lead ? opened.lead : current.lead,
        close: current.close === initial.close ? opened.close : current.close,
        only: !ownVoice
          ? ""
          : current.only === initial.only
            ? opened.only
            : current.only,
        ...(isGroup && upgraded
          ? {
              members: current.members.map(({ id: who, level }) => ({
                id: who,
                level,
              })),
            }
          : {}),
        ...(moveOther ? { moveOther: true } : {}),
      });
      toast.success(`Saved ${subject}`);
      onDone(saved);
    } catch (failure) {
      if (failure instanceof WikiConflictError) setConflict(true);
      else
        toast.error("Couldn't save the page", {
          description: failureText(failure),
        });
    } finally {
      setSaving(false);
    }
  };

  const readers = (layer: Layer) =>
    reach
      ? readerWords(layer, readersOf(layer, reach).length, subject)
      : undefined;
  const text = (
    key: "lead" | "close" | "only",
    label: string,
    placeholder: string,
    rows = 3,
  ) => (
    <LinkField
      id={`${formId}-${key}`}
      aria-label={label}
      value={current[key]}
      placeholder={placeholder}
      pages={pages}
      minRows={rows}
      onChange={(value) => set({ [key]: value })}
    />
  );

  return (
    <form
      ref={guard.scope}
      noValidate
      className={cx("flex min-w-0 flex-col", compact ? "gap-5" : "gap-6")}
      onSubmit={(event) => {
        event.preventDefault();
        if (dirty && !saving) void save();
      }}
      onKeyDown={(event) => {
        if ((event.metaKey || event.ctrlKey) && event.key === "s") {
          event.preventDefault();
          if (dirty && !saving) void save();
        }
      }}
    >
      <fieldset
        disabled={saving}
        className={cx(
          "m-0 flex min-w-0 flex-col border-0 p-0",
          compact ? "gap-5" : "gap-6",
        )}
      >
        <div className="flex flex-col gap-2">
          <div className="flex flex-col gap-1">
            <TextInput
              aria-label="Name"
              value={fields.name ?? ""}
              style={compact ? undefined : TITLE_TRANSITION}
              placeholder={name}
              onChange={(event) => setField({ name: event.target.value })}
              className={cx(
                "h-auto w-full px-3.5 py-2 leading-tight font-extrabold",
                compact ? "text-xl" : "text-[1.75rem]",
              )}
            />
            <p
              title="Page id (linked to filename; can't change)"
              className="px-1 font-[ui-monospace,monospace] text-xs text-ui-soft"
            >
              {id}
            </p>
          </div>
          <TextInput
            aria-label="Also called"
            value={current.aliases}
            placeholder="Also called…"
            className="h-9 w-full"
            onChange={(event) => set({ aliases: event.target.value })}
          />
          {pageKind === "concept" && !personal ? (
            <div className="flex flex-wrap items-center gap-1.5 pt-1">
              {(
                [
                  [
                    "place",
                    <MapPinIcon key="p" aria-hidden />,
                    "A place",
                    "On the map: somewhere to be",
                  ],
                  [
                    "group",
                    <UsersRoundIcon key="g" aria-hidden />,
                    "A group",
                    "Something people are in",
                  ],
                ] as const
              ).map(([key, icon, label, title]) => (
                <ToggleChip
                  key={key}
                  title={title}
                  pressed={fields[key] === true}
                  onPressedChange={(pressed) => setField({ [key]: pressed })}
                >
                  {icon}
                  {label}
                </ToggleChip>
              ))}
              {opened.fields.place && !fields.place ? (
                <p className="basis-full pt-1 text-xs font-semibold text-ui-danger">
                  Saving takes it off the map: places in it move to its area,
                  and anyone there goes too.
                </p>
              ) : null}
            </div>
          ) : null}
          {personal ? (
            <div className="flex flex-col gap-1.5 pt-1">
              <label
                htmlFor={`${formId}-relation`}
                className="text-sm font-bold"
              >
                {`Who ${subject} is to ${owner ?? "them"}`}
              </label>
              <TextInput
                id={`${formId}-relation`}
                value={fields.relation ?? ""}
                placeholder="little sister, rival, mentor"
                className="h-9"
                onChange={(event) =>
                  setField({ relation: event.target.value || undefined })
                }
              />
            </div>
          ) : null}
        </div>

        {isPlace ? (
          <WhereItIs id={id} fields={fields} onChange={setField} />
        ) : null}

        {person && !personal ? (
          <EditorSection title="Home">
            <OnePicker
              label="Home"
              placeholder="No home"
              options={places}
              value={fields.home}
              onChange={(home) => setField({ home })}
            />
          </EditorSection>
        ) : null}

        {!personal && upgraded ? (
          <EditorSection title={person ? "Who knows them" : "Who knows it"}>
            {person ? (
              <div className="flex flex-col gap-1.5">
                <span className="text-xs font-bold text-ui-soft">{`${subject} is in`}</span>
                <LevelRows
                  rows={fields.in ?? []}
                  keyOf={(row) => row.ref}
                  nameOf={(row) => nameOf(row.ref)}
                  mediaOf={() => groupMedia}
                  levels={MEMBER_LEVELS}
                  levelLabel={(row) =>
                    `How involved ${subject} is in ${nameOf(row.ref)}`
                  }
                  onChange={(rows) => setField({ in: rows })}
                  add={{
                    label: "Add a group they're in",
                    placeholder: "Add a group they're in",
                    options: groupOptions.filter(
                      (g) => !(fields.in ?? []).some((r) => r.ref === g.value),
                    ),
                    onAdd: (ref) =>
                      setField({
                        in: [...(fields.in ?? []), { ref, level: "knows" }],
                      }),
                    onCreate: async (groupName) => {
                      const ref = await newGroup(groupName);
                      setField((cur) => ({
                        in: [...(cur.in ?? []), { ref, level: "knows" }],
                      }));
                    },
                  }}
                />
              </div>
            ) : null}
            <div className="flex flex-col gap-1.5">
              {person ? (
                <span className="text-xs font-bold text-ui-soft">
                  Also known by
                </span>
              ) : null}
              <LevelRows
                rows={fields.groups}
                keyOf={(row) => row.ref}
                nameOf={(row) => nameOf(row.ref)}
                mediaOf={(row) => audienceMedia(row.ref)}
                levels={KNOWING_LEVELS}
                levelLabel={(row) =>
                  `How well ${nameOf(row.ref)} knows ${subject}`
                }
                onChange={(rows) => setField({ groups: everyoneFirst(rows) })}
                add={{
                  label: "Add who knows it",
                  placeholder: fields.groups.length
                    ? "Add group or someone"
                    : "Everyone, a group, or someone",
                  options: [
                    {
                      value: EVERYONE,
                      label: "Everyone",
                      media: audienceMedia(EVERYONE),
                    },
                    ...groupOptions,
                    ...people.map((p) => ({ ...p, hint: "Character" })),
                  ].filter(
                    (option) =>
                      !fields.groups.some(
                        (r) =>
                          r.ref.toLowerCase() === option.value.toLowerCase(),
                      ),
                  ),
                  onAdd: (ref) =>
                    setField({
                      groups: everyoneFirst([
                        ...fields.groups,
                        { ref, level: ref === EVERYONE ? "heard of" : "knows" },
                      ]),
                    }),
                  onCreate: async (groupName) => {
                    const ref = await newGroup(groupName);
                    setField((cur) => ({
                      groups: everyoneFirst([
                        ...cur.groups,
                        { ref, level: "knows" },
                      ]),
                    }));
                  },
                }}
              />
            </div>
            {isGroup ? (
              <div className="flex flex-col gap-1.5">
                <span className="text-xs font-bold text-ui-soft">{`In ${subject}`}</span>
                <LevelRows
                  rows={current.members}
                  keyOf={(row) => row.id}
                  nameOf={(row) => row.name}
                  mediaOf={(row) => audienceMedia(row.id)}
                  levels={MEMBER_LEVELS}
                  levelLabel={(row) => `How involved ${row.name} is`}
                  onChange={(members) => set({ members })}
                  add={{
                    label: "Add a member",
                    placeholder: "Add someone",
                    options: people.filter(
                      (p) => !current.members.some((m) => m.id === p.value),
                    ),
                    onAdd: (who) =>
                      set({
                        members: [
                          ...current.members,
                          {
                            id: who,
                            name: nameOf(who),
                            level: "knows" as const,
                          },
                        ].sort((a, b) => a.name.localeCompare(b.name)),
                      }),
                  }}
                />
              </div>
            ) : null}
          </EditorSection>
        ) : !personal ? (
          <Callout title="Who knows it is set in Markdown">
            This world is in an older format.
          </Callout>
        ) : null}

        <EditorSection
          title={
            personal
              ? `What ${owner ?? "they"} make${owner ? "s" : ""} of it`
              : "The page"
          }
        >
          <div className="flex flex-col gap-5">
            <LayerField
              layer={personal ? "self" : "summary"}
              name={personal ? "In a line" : undefined}
              htmlFor={`${formId}-summary`}
              readers={personal ? undefined : readers("summary")}
            >
              <TextInput
                id={`${formId}-summary`}
                value={fields.summary ?? ""}
                placeholder={
                  current.lead.trim()
                    ? `From the opening: ${firstSentence(current.lead)}`
                    : "One line"
                }
                onChange={(event) => setField({ summary: event.target.value })}
              />
            </LayerField>
            <LayerField
              layer={personal ? "self" : "opening"}
              name={personal ? "Their impression" : undefined}
              htmlFor={`${formId}-lead`}
              readers={personal ? undefined : readers("opening")}
            >
              {text(
                "lead",
                "Opening",
                personal
                  ? "What they think of it, plainly."
                  : `Who or what ${subject} is, plainly.`,
                4,
              )}
            </LayerField>
            <LayerField
              layer={personal ? "self" : "close"}
              name={personal ? "The rest" : undefined}
              htmlFor={`${formId}-close`}
              readers={personal ? undefined : readers("close")}
            >
              {text(
                "close",
                personal ? "The rest" : LAYER_NAME.close,
                "## Habits\n\nWhat only those close would know.",
                5,
              )}
            </LayerField>
            {ownVoice ? (
              <LayerField
                layer="self"
                htmlFor={`${formId}-only`}
                readers={`Only ${subject}`}
              >
                {text(
                  "only",
                  "Inner voice",
                  "How they think and speak, what they want, what they hide.",
                  5,
                )}
              </LayerField>
            ) : null}
          </div>
        </EditorSection>

        {opened.other.length ? (
          <EditorSection title="Unread fields">
            <dl className="grid grid-cols-[8rem_minmax(0,1fr)] gap-x-4 gap-y-1 text-[0.8125rem]">
              {opened.other.map(({ key, value }) => (
                <div key={key} className="contents">
                  <dt className="font-[ui-monospace,monospace] text-ui-soft">
                    {key}
                  </dt>
                  <dd className="min-w-0 truncate">{value}</dd>
                </div>
              ))}
            </dl>
            <CheckRow
              checked={moveOther}
              onCheckedChange={(checked) => setMoveOther(checked === true)}
              label="Move into the text on save"
              className="-mx-2.5"
            />
          </EditorSection>
        ) : null}
      </fieldset>

      {bar({
        dirty,
        saving,
        conflict,
        save: () => void save(),
        reload: () => {
          setConflict(false);
          setDraft(undefined);
          setOpened(undefined);
          void source.mutate();
        },
      })}
      {guard.dialog}
    </form>
  );
}
