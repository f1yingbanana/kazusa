"use client";

import { useEffect, useId, useState } from "react";
import {
  FileCodeIcon,
  MapPinIcon,
  PlusIcon,
  UsersRoundIcon,
  XIcon,
} from "lucide-react";
import { toast } from "sonner";
import type {
  WikiGroup,
  WikiKind,
  WikiLevel,
  WikiMember,
  WikiPageForm,
  WikiPageFormFields,
  WikiSourceResponse,
} from "@kazusa/client";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import { useSaveWikiPage, useWikiList } from "@/hooks/use-wiki";
import { useWikiForm, useWikiReach } from "@/hooks/use-wiki-editor";
import { saveWikiForm } from "@/lib/source/wiki/editor";
import { WikiConflictError } from "@/lib/source/wiki/http";
import { cn } from "@/lib/utils";
import {
  EVERYONE,
  levelsFor,
  Rail,
  audienceLabel,
  everyoneFirst,
  groupName,
  peopleIn,
} from "./levels";
import { LinkTextarea } from "./link-textarea";
import { pageId } from "@/lib/wiki/page-id";
import { failureText } from "./parts";
import { WhereItIs } from "./place-fields";

const NONE = "__none";

/**
 * Lines a source wrapped by hand, joined back into paragraphs for editing: a
 * list item, a quote or a heading still starts its own line, and a fenced code
 * block is kept line for line. Only what is edited is saved this way.
 */
export function unwrap(text: string): string {
  const out: string[] = [];
  /** The fence a code block opened with, while inside one. */
  let fence: string | undefined;
  for (const line of text.split(/\r?\n/)) {
    const marker = /^\s*(`{3,}|~{3,})/.exec(line)?.[1];
    if (fence !== undefined) {
      // A code block is kept line for line, up to the fence that closes it.
      out.push(line);
      if (
        marker &&
        marker[0] === fence[0] &&
        marker.length >= fence.length &&
        line.trim() === marker
      )
        fence = undefined;
      continue;
    }
    if (marker) {
      fence = marker;
      out.push(line);
      continue;
    }
    const last = out.at(-1);
    const starts = /^\s*([-*+] |\d+\. |>|#|\|)/.test(line);
    if (
      last !== undefined &&
      last.trim() !== "" &&
      line.trim() !== "" &&
      !starts &&
      !/^\s*(`{3,}|~{3,})/.test(last)
    )
      out[out.length - 1] = `${last} ${line.trim()}`;
    else out.push(line);
  }
  return out.join("\n");
}

const firstSentence = (text: string): string => {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.match(/^.+?[.!?。！？](?=\s|$)/u)?.[0] ?? flat;
};

interface Draft {
  readonly fields: WikiPageFormFields;
  readonly lead: string;
  readonly close: string;
  readonly only: string;
  readonly members: readonly WikiMember[];
}

function draftOf(form: WikiPageForm, name: string): Draft {
  return {
    fields: {
      ...form.fields,
      name: form.fields.name ?? name,
      groups: everyoneFirst(form.fields.groups),
    },
    lead: unwrap(form.lead),
    close: unwrap(form.close),
    only: unwrap(form.only),
    members: form.members ?? [],
  };
}

/**
 * Who is in a group: each character with how closely, and a field to add one.
 * Saving writes it onto each character's page.
 */
function MemberRows({
  id,
  members,
  characters,
  onChange,
}: {
  id: string;
  members: readonly WikiMember[];
  characters: readonly { id: string; name: string }[];
  onChange: (members: WikiMember[]) => void;
}) {
  const [text, setText] = useState("");
  const choices = characters.filter(
    (one) => !members.some((member) => member.id === one.id),
  );
  const add = (value: string) => {
    const found = choices.find(
      (one) => one.name.toLowerCase() === value.trim().toLowerCase(),
    );
    if (!found) return setText(value);
    onChange(
      [
        ...members,
        { id: found.id, name: found.name, level: "knows" as const },
      ].sort((a, b) => a.name.localeCompare(b.name)),
    );
    setText("");
  };
  return (
    <div className="flex flex-col gap-1">
      {members.length ? (
        members.map((member, index) => (
          <div
            key={member.id}
            className="grid grid-cols-[minmax(0,12rem)_10rem_2rem] items-center gap-x-4"
          >
            <span className="truncate text-sm">{member.name}</span>
            <Select
              items={MEMBER_LEVELS}
              value={member.level}
              onValueChange={(level) =>
                level &&
                onChange(
                  members.map((one, at) =>
                    at === index ? { ...one, level } : one,
                  ),
                )
              }
            >
              <SelectTrigger
                size="sm"
                aria-label={`How close ${member.name} is in it`}
                className="w-full"
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent
                align="end"
                alignItemWithTrigger={false}
                className="w-auto"
              >
                {MEMBER_LEVELS.map(({ value, label }) => (
                  <SelectItem key={value} value={value}>
                    {label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label={`Take ${member.name} out`}
              onClick={() => onChange(members.filter((_, at) => at !== index))}
            >
              <XIcon />
            </Button>
          </div>
        ))
      ) : (
        <p className="text-sm text-muted-foreground">No one yet.</p>
      )}
      <Input
        value={text}
        list={`${id}-list`}
        placeholder="Add a character"
        aria-label="Add a character"
        className="mt-1 h-8 w-56 text-sm"
        onChange={(event) =>
          pickedFromList(event)
            ? add(event.target.value)
            : setText(event.target.value)
        }
        onKeyDown={(event) => {
          if (event.key === "Enter" && !event.nativeEvent.isComposing) {
            event.preventDefault();
            add(text);
          }
        }}
      />
      <datalist id={`${id}-list`}>
        {choices.map((one) => (
          <option key={one.id} value={one.name} />
        ))}
      </datalist>
    </div>
  );
}

/**
 * Whether an input's change came from choosing a suggestion, not from typing: a
 * typed name that happens to match goes in only on Enter.
 */
const pickedFromList = (
  event: React.ChangeEvent<HTMLInputElement>,
): boolean => {
  const type = (event.nativeEvent as InputEvent).inputType;
  return type === undefined || type === "insertReplacementText";
};

/** How involved someone is in a group: what they get through it. */
const MEMBER_LEVELS = [
  { value: "heard of" as const, label: "Associate" },
  { value: "knows" as const, label: "Member" },
  { value: "close" as const, label: "Close member" },
];

/**
 * The groups that know a page, each with how well, and a field to add one.
 * Everyone is the group every character is in.
 */
function GroupRows({
  id,
  groups,
  options,
  nameOf,
  onChange,
  onCreate,
  levels = levelsFor(false),
  everyone = true,
}: {
  id: string;
  groups: readonly WikiGroup[];
  options: readonly { value: string; label: string }[];
  /** The level choices, and whether Everyone is offered. */
  levels?: readonly { value: WikiLevel; label: string }[];
  everyone?: boolean;
  /** Any page's name, for groups already listed. */
  nameOf: (ref: string) => string | undefined;
  onChange: (groups: WikiGroup[]) => void;
  /** Makes a group page by that name; resolves to its id. */
  onCreate: (name: string) => Promise<string>;
}) {
  const [text, setText] = useState("");
  const [creating, setCreating] = useState(false);
  const listed = (ref: string) =>
    groups.some((group) => group.ref.toLowerCase() === ref.toLowerCase());
  const choices = [
    ...(!everyone || listed(EVERYONE)
      ? []
      : [{ value: EVERYONE, label: "Everyone" }]),
    ...options.filter((option) => !listed(option.value)),
  ];
  const typed = text.trim();
  const match = choices.find(
    (option) =>
      option.label.toLowerCase() === typed.toLowerCase() ||
      option.value === typed,
  );
  const put = (ref: string) => {
    if (!listed(ref))
      onChange(
        everyoneFirst([
          ...groups,
          { ref, level: ref === EVERYONE ? "heard of" : "knows" },
        ]),
      );
    setText("");
  };
  // A name no page has is only made into a group when asked, not on a typo.
  const add = () => {
    if (match) put(match.value);
  };
  const create = () => {
    if (!typed || match || creating) return;
    setCreating(true);
    void onCreate(typed)
      .then(put)
      .catch((failure: unknown) => toast.error(failureText(failure)))
      .finally(() => setCreating(false));
  };
  const setLevel = (index: number, level: WikiLevel) =>
    onChange(
      groups.map((group, at) => (at === index ? { ...group, level } : group)),
    );
  return (
    <div className="flex flex-col gap-1">
      {groups.map((group, index) => {
        const name = groupName(group.ref, nameOf);
        return (
          <div
            key={group.ref}
            className="grid grid-cols-[minmax(0,12rem)_10rem_2rem] items-center gap-x-4"
          >
            <span className="truncate text-sm">{name}</span>
            <Select
              items={levels.map(({ value, label }) => ({ value, label }))}
              value={group.level}
              onValueChange={(next) => next && setLevel(index, next)}
            >
              <SelectTrigger
                size="sm"
                aria-label={`How well ${name} ${levels === MEMBER_LEVELS ? "takes part" : "knows the page"}`}
                className="w-full"
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent
                align="end"
                alignItemWithTrigger={false}
                className="w-auto"
              >
                {levels.map(({ value, label }) => (
                  <SelectItem key={value} value={value}>
                    {label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label={`Take out ${name}`}
              onClick={() => onChange(groups.filter((_, at) => at !== index))}
            >
              <XIcon />
            </Button>
          </div>
        );
      })}
      <div className="mt-1 flex flex-wrap items-center gap-2">
        <Input
          id={id}
          value={text}
          list={`${id}-list`}
          placeholder={groups.length ? "Add a group" : "Everyone, or a group"}
          aria-label="Add a group"
          className="h-8 w-56 text-sm"
          onChange={(event) => {
            const value = event.target.value;
            // Picked from the list: in at once; typed, only on Enter.
            const picked = pickedFromList(event)
              ? choices.find((option) => option.label === value)
              : undefined;
            if (picked) put(picked.value);
            else setText(value);
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.nativeEvent.isComposing) {
              event.preventDefault();
              if (match) add();
              else create();
            }
          }}
        />
        {typed && !match ? (
          <Button
            variant="outline"
            size="sm"
            disabled={creating}
            onClick={create}
          >
            {creating ? <Spinner /> : <PlusIcon />}
            New group “{typed}”
          </Button>
        ) : null}
      </div>
      <datalist id={`${id}-list`}>
        {choices.map((option) => (
          <option key={option.value} value={option.label} />
        ))}
      </datalist>
    </div>
  );
}

/**
 * A page as a form, in the same order as reading it: who knows it, then one
 * field per level of detail (the summary line, the opening, what those close to
 * it know and, on a character's own page, what only they know). A bar pinned to
 * the bottom saves it, over the version opened.
 */

export function PageForm({
  id,
  agent,
  kind,
  name,
  onDone,
  onRaw,
}: {
  id: string;
  agent?: string | undefined;
  kind?: WikiKind | undefined;
  /** For a page not written yet. */
  name: string;
  onDone: (saved?: WikiSourceResponse) => void;
  onRaw: () => void;
}) {
  const source = useWikiForm(id, agent, kind);
  const [opened, setOpened] = useState<WikiPageForm>();
  // Only what was just read: never a cached copy older than the page.
  useEffect(() => {
    if (!opened && source.data && !source.isValidating) setOpened(source.data);
  }, [opened, source.data, source.isValidating]);
  const [leaving, setLeaving] = useState<"close" | "raw">();
  const [draft, setDraft] = useState<Draft>();
  const [moveOther, setMoveOther] = useState(false);
  const [saving, setSaving] = useState(false);
  const [conflict, setConflict] = useState(false);
  const { data: list } = useWikiList();
  const savePage = useSaveWikiPage();
  const personal = agent !== undefined;
  const { data: reach } = useWikiReach(personal ? undefined : id);
  const pageKind = opened?.kind ?? kind;
  const formId = useId();

  if (!opened)
    return source.error ? (
      <p className="text-sm text-destructive">{failureText(source.error)}</p>
    ) : (
      <p className="text-sm text-muted-foreground">Opening…</p>
    );

  const initial = draftOf(opened, name);
  const current = draft ?? initial;
  const { fields } = current;
  const subject = fields.name?.trim() || name;
  const dirty =
    moveOther || JSON.stringify(current) !== JSON.stringify(initial);
  const set = (patch: Partial<Draft>) => setDraft({ ...current, ...patch });
  const setField = (patch: Partial<WikiPageFormFields>) =>
    set({ fields: { ...fields, ...patch } });
  // A world not yet upgraded shows who knows pages, but ARONA rewrites it.
  const upgraded = list?.upgraded !== false;
  const groupPages = (list?.pages ?? [])
    .filter((page) => page.group)
    .filter((page) => page.id !== id)
    .map((page) => ({ value: page.id, label: page.name }));
  const pageName = (ref: string) =>
    list?.pages.find(
      (page) =>
        page.id === ref || page.name.toLowerCase() === ref.toLowerCase(),
    )?.name;
  const newGroup = async (groupName: string): Promise<string> => {
    const taken = new Set((list?.pages ?? []).map((page) => page.id));
    const groupId = pageId(groupName, taken, { fallback: "group" });
    await savePage({
      id: groupId,
      kind: "concept",
      base: null,
      text: `---\nname: ${JSON.stringify(groupName)}\ngroup: true\n---\n\n# ${groupName}\n`,
    });
    return groupId;
  };
  const places = (list?.pages ?? []).filter((page) => page.place);
  const isPlace = pageKind === "concept" && !personal && fields.place === true;
  const isGroup = pageKind === "concept" && !personal && fields.group === true;
  const cast = (list?.pages ?? [])
    .filter((page) => page.kind === "person")
    .map((page) => ({ id: page.id, name: page.name }));
  const ownVoice = pageKind === "person" && !personal;

  const save = async () => {
    setSaving(true);
    try {
      const saved = await saveWikiForm({
        id,
        ...(agent ? { agent } : {}),
        kind: opened.kind,
        base: opened.hash,
        fields: current.fields,
        // A text left as it opened is saved as written, line breaks and all:
        // the form shows it joined up only to read.
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
      toast.success(`Saved ${subject}.`);
      onDone(saved);
    } catch (failure) {
      if (failure instanceof WikiConflictError) setConflict(true);
      else toast.error(failureText(failure));
    } finally {
      setSaving(false);
    }
  };

  const field = (
    value: string,
    label: string,
    placeholder: string,
    onChange: (value: string) => void,
  ) => (
    <LinkTextarea
      value={value}
      aria-label={label}
      placeholder={placeholder}
      pages={list?.pages ?? []}
      className="field-sizing-content min-h-24 text-sm leading-relaxed"
      onChange={onChange}
    />
  );

  return (
    <div className="flex flex-col gap-10">
      <div className="grid max-w-3xl gap-x-4 gap-y-3 sm:grid-cols-2">
        <div className="flex flex-col gap-1.5">
          <label htmlFor={`${formId}-name`} className="text-sm font-medium">
            Name
          </label>
          <Input
            id={`${formId}-name`}
            value={fields.name ?? ""}
            onChange={(event) => setField({ name: event.target.value })}
          />
          <p className="text-xs text-muted-foreground">
            Id <code className="font-mono">{id}</code>
          </p>
        </div>

        <div className="flex flex-col gap-1.5">
          <label htmlFor={`${formId}-aliases`} className="text-sm font-medium">
            Also called
          </label>
          <Input
            id={`${formId}-aliases`}
            value={fields.aliases.join(", ")}
            placeholder="Other names, separated by commas"
            onChange={(event) =>
              setField({
                aliases: event.target.value
                  .split(",")
                  .map((alias) => alias.trimStart()),
              })
            }
            onBlur={() =>
              setField({
                aliases: fields.aliases
                  .map((alias) => alias.trim())
                  .filter(Boolean),
              })
            }
          />
        </div>
        {personal ? (
          <div className="flex flex-col gap-1.5 sm:col-span-2">
            <label
              htmlFor={`${formId}-relation`}
              className="text-sm font-medium"
            >
              Who they are to them
            </label>
            <Input
              id={`${formId}-relation`}
              value={fields.relation ?? ""}
              placeholder="little brother, rival, mentor"
              onChange={(event) => setField({ relation: event.target.value })}
            />
          </div>
        ) : null}
        {pageKind === "person" && !personal ? (
          <div className="flex flex-col gap-1.5">
            <label htmlFor={`${formId}-home`} className="text-sm font-medium">
              Home
            </label>
            <Select
              items={[
                { value: NONE, label: "None" },
                ...places.map((place) => ({
                  value: place.id,
                  label: place.name,
                })),
              ]}
              value={fields.home ?? NONE}
              onValueChange={(value) =>
                setField({
                  home: value && value !== NONE ? value : undefined,
                })
              }
            >
              <SelectTrigger id={`${formId}-home`} className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NONE}>None</SelectItem>
                {places.map((place) => (
                  <SelectItem key={place.id} value={place.id}>
                    {place.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        ) : null}
        {pageKind === "concept" && !personal ? (
          <div className="flex flex-wrap items-center gap-1.5 sm:col-span-2">
            {(
              [
                [
                  "place",
                  MapPinIcon,
                  "A place",
                  "On the map: somewhere to be.",
                ],
                [
                  "group",
                  UsersRoundIcon,
                  "A group",
                  "Something people are in.",
                ],
              ] as const
            ).map(([key, Icon, label, title]) => (
              <button
                key={key}
                type="button"
                title={title}
                aria-pressed={fields[key] === true}
                className={cn(
                  "flex h-7 items-center gap-1.5 rounded-full border px-3 text-xs text-muted-foreground transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none",
                  fields[key] === true &&
                    "border-foreground/20 bg-accent text-accent-foreground",
                )}
                onClick={() => setField({ [key]: fields[key] !== true })}
              >
                <Icon className="size-3.5" />
                {label}
              </button>
            ))}
            {opened.fields.place && !fields.place ? (
              <p className="basis-full text-xs text-destructive">
                Saving takes it off the map: places in it move to its area,
                homes and anyone there go there too, routes to it go.
              </p>
            ) : null}
          </div>
        ) : null}
      </div>

      {isPlace ? (
        <WhereItIs id={id} fields={fields} onChange={setField} />
      ) : null}

      {pageKind === "person" && !personal && upgraded ? (
        <section className="flex max-w-3xl flex-col gap-5">
          <div className="flex flex-col gap-1">
            <h2 className="text-sm font-semibold">In</h2>
            <p className="text-xs text-muted-foreground">
              Close members get all a group knows, members its openings,
              associates its summaries.
            </p>
          </div>
          <GroupRows
            id={`${formId}-in`}
            groups={fields.in ?? []}
            options={groupPages}
            nameOf={pageName}
            levels={MEMBER_LEVELS}
            everyone={false}
            onChange={(groups) => setField({ in: groups })}
            onCreate={newGroup}
          />
        </section>
      ) : null}

      {personal ? null : (
        <section className="flex max-w-3xl flex-col gap-5">
          <div className="flex flex-col gap-1">
            <h2 className="text-sm font-semibold">
              {pageKind === "person"
                ? `Who else knows ${subject}`
                : `Who knows ${subject}`}
            </h2>
            {pageKind === "person" ? (
              <p className="text-xs text-muted-foreground">
                Besides the groups they&apos;re in.
              </p>
            ) : null}
          </div>
          {upgraded ? (
            <GroupRows
              id={`${formId}-groups`}
              groups={fields.groups}
              options={groupPages}
              nameOf={pageName}
              levels={levelsFor(pageKind === "person")}
              onChange={(groups) => setField({ groups })}
              onCreate={newGroup}
            />
          ) : (
            <p className="text-sm text-muted-foreground">
              This world is in the older format, where who knows {subject} is
              set by hand in Markdown. A new release of its template brings it
              into the new one.
            </p>
          )}
        </section>
      )}

      {isGroup && upgraded ? (
        <section className="flex max-w-3xl flex-col gap-5">
          <div className="flex flex-col gap-1">
            <h2 className="text-sm font-semibold">In {subject}</h2>
            <p className="text-xs text-muted-foreground">
              A close member gets all {subject} knows, a member its pages&apos;
              openings, an associate their summaries.
            </p>
          </div>
          <MemberRows
            id={`${formId}-members`}
            members={current.members}
            characters={cast}
            onChange={(members) => set({ members })}
          />
        </section>
      ) : null}

      <section className="flex max-w-3xl flex-col gap-7">
        <h2 className="text-sm font-semibold">
          {personal ? "What they think" : "What people know"}
        </h2>
        <Rail
          audience="heard"
          label={personal ? "In a line" : audienceLabel("heard", subject)}
          people={personal ? undefined : peopleIn("heard", reach, true)}
        >
          <Input
            value={fields.summary ?? ""}
            aria-label="Summary line"
            placeholder={
              current.lead.trim()
                ? `From the opening: ${firstSentence(current.lead)}`
                : "One line"
            }
            onChange={(event) => setField({ summary: event.target.value })}
          />
        </Rail>
        <Rail
          audience="knows"
          label={
            personal ? "Their impression" : audienceLabel("knows", subject)
          }
          people={personal ? undefined : peopleIn("knows", reach, true)}
        >
          {field(
            current.lead,
            "Opening",
            `Who ${subject} is, plainly.`,
            (lead) => set({ lead }),
          )}
        </Rail>
        <Rail
          audience="close"
          label={personal ? "The rest" : audienceLabel("close", subject)}
          people={personal ? undefined : peopleIn("close", reach, true)}
        >
          {field(
            current.close,
            personal ? "The rest" : "What those close know",
            "## Habits\n\nWhat only those close would know.",
            (close) => set({ close }),
          )}
        </Rail>
        {ownVoice ? (
          <Rail audience="self" label={audienceLabel("self", subject)}>
            {field(
              current.only,
              `What only ${subject} knows`,
              "How they think and speak, what they want, what they hide.",
              (only) => set({ only }),
            )}
          </Rail>
        ) : null}
      </section>

      {opened.other.length ? (
        <section className="flex max-w-3xl flex-col gap-2">
          <h2 className="text-sm font-semibold">
            Fields characters can&apos;t read
          </h2>
          <dl className="grid gap-x-6 gap-y-1 text-sm sm:grid-cols-[6rem_minmax(0,1fr)]">
            {opened.other.map(({ key, value }) => (
              <div key={key} className="contents">
                <dt className="text-muted-foreground">{key}</dt>
                <dd className="min-w-0 truncate">{value}</dd>
              </div>
            ))}
          </dl>
          <label className="flex items-center gap-2 text-sm">
            <Checkbox
              checked={moveOther}
              onCheckedChange={(checked) => setMoveOther(checked === true)}
            />
            Move them into the text when saving
          </label>
        </section>
      ) : null}

      <div
        role="region"
        aria-label="Saving"
        className="sticky bottom-0 z-10 -mx-4 flex items-center gap-2 border-t bg-background/95 px-4 py-3 backdrop-blur lg:-mx-8 lg:px-8"
      >
        <p
          className={cn(
            "flex-1 text-sm text-pretty",
            conflict ? "text-destructive" : "text-muted-foreground",
          )}
        >
          {conflict
            ? "This page changed since you opened it. Copy what you need, then reload."
            : dirty
              ? "Unsaved changes"
              : "No changes yet"}
        </p>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => (dirty ? setLeaving("raw") : onRaw())}
        >
          <FileCodeIcon />
          Edit as Markdown
        </Button>
        {conflict ? (
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              setConflict(false);
              setDraft(undefined);
              setOpened(undefined);
              void source.mutate();
            }}
          >
            Reload
          </Button>
        ) : (
          <>
            <Button
              variant="outline"
              size="sm"
              onClick={() => (dirty ? setLeaving("close") : onDone())}
            >
              {dirty ? "Discard" : "Close"}
            </Button>
            <Button
              size="sm"
              disabled={!dirty || saving}
              onClick={() => void save()}
            >
              {saving ? <Spinner /> : null}
              Save
            </Button>
          </>
        )}
      </div>
      <AlertDialog
        open={leaving !== undefined}
        onOpenChange={(open) => !open && setLeaving(undefined)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Discard your changes?</AlertDialogTitle>
            <AlertDialogDescription>
              {leaving === "raw"
                ? "The Markdown editor opens on the page as it was saved, without what you changed here."
                : "What you changed here won't be saved."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep editing</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={() => {
                const next = leaving;
                setLeaving(undefined);
                if (next === "raw") onRaw();
                else onDone();
              }}
            >
              Discard
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
