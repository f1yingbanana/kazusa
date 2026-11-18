"use client";

import { useEffect, useId, useState } from "react";
import {
  ArrowDownIcon,
  ArrowUpIcon,
  FileCodeIcon,
  PlusIcon,
  XIcon,
} from "lucide-react";
import { toast } from "sonner";
import type {
  WikiKind,
  WikiPageForm,
  WikiPageFormFields,
  WikiSourceResponse,
} from "@kazusa/client";
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
import { Textarea } from "@/components/ui/textarea";
import { useCharacters } from "@/hooks/use-characters";
import { useWikiList } from "@/hooks/use-wiki";
import {
  useWikiBackdrops,
  useWikiForm,
  useWikiReach,
} from "@/hooks/use-wiki-editor";
import { saveWikiForm } from "@/lib/source/wiki/editor";
import { WikiConflictError } from "@/lib/source/wiki/http";
import { cn } from "@/lib/utils";
import {
  REACH,
  Rail,
  TINT,
  audienceLabel,
  audienceOf,
  peopleIn,
  type Audience,
  type Reach,
} from "./levels";
import { failureText } from "./parts";

const NONE = "__none";

/**
 * Lines a source wrapped by hand, joined back into paragraphs for editing: a
 * list item, a quote or a heading still starts its own line.
 */
export function unwrap(text: string): string {
  const out: string[] = [];
  for (const line of text.split(/\r?\n/)) {
    const last = out.at(-1);
    const starts = /^\s*([-*+] |\d+\. |>|#|\||```)/.test(line);
    if (
      last !== undefined &&
      last.trim() !== "" &&
      line.trim() !== "" &&
      !starts &&
      !/^\s*```/.test(last)
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

/** A part as the form edits it: who it is for is its own choice. */
interface Part {
  readonly title: string;
  readonly text: string;
  readonly audience: Exclude<Audience, "heard" | "knows">;
  /** For `named`: who. */
  readonly named: readonly string[];
}

interface Draft {
  readonly fields: WikiPageFormFields;
  readonly lead: string;
  readonly parts: readonly Part[];
}

function draftOf(
  form: WikiPageForm,
  name: string,
  self: string | undefined,
): Draft {
  return {
    fields: { ...form.fields, name: form.fields.name ?? name },
    lead: unwrap(form.lead),
    parts: form.sections.map((section) => {
      const audience = audienceOf(section.knownBy, self);
      return {
        title: section.title,
        text: unwrap(section.text),
        audience:
          audience === "heard" || audience === "knows" ? "close" : audience,
        named: audience === "named" ? section.knownBy : [],
      };
    }),
  };
}

/** A small list of names with a field to add one. */
function Names({
  id,
  items,
  label,
  placeholder,
  options,
  onChange,
  extra,
}: {
  id: string;
  items: readonly string[];
  label: string;
  placeholder: string;
  options: readonly { value: string; label: string }[];
  onChange: (items: string[]) => void;
  extra?: (item: string, index: number) => React.ReactNode;
}) {
  const [text, setText] = useState("");
  const nameOf = (value: string) =>
    options.find((option) => option.value === value)?.label ?? value;
  const add = () => {
    const typed = text.trim();
    if (!typed) return;
    const match = options.find(
      (option) =>
        option.label.toLowerCase() === typed.toLowerCase() ||
        option.value === typed,
    );
    const value = match?.value ?? typed;
    if (!items.includes(value)) onChange([...items, value]);
    setText("");
  };
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {items.map((item, index) => (
        <span
          key={item}
          className="flex h-7 items-center gap-1.5 rounded-full border bg-muted/40 pr-1 pl-2.5 text-sm"
        >
          {nameOf(item)}
          {extra?.(item, index)}
          <button
            type="button"
            className="grid size-5 place-items-center rounded-full text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none"
            aria-label={`Take out ${nameOf(item)}`}
            onClick={() => onChange(items.filter((_, at) => at !== index))}
          >
            <XIcon className="size-3" />
          </button>
        </span>
      ))}
      <Input
        id={id}
        value={text}
        list={`${id}-list`}
        placeholder={placeholder}
        aria-label={label}
        className="h-7 w-44 text-sm"
        onChange={(event) => setText(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            add();
          }
        }}
        onBlur={add}
      />
      <datalist id={`${id}-list`}>
        {options.map((option) => (
          <option key={option.value} value={option.label} />
        ))}
      </datalist>
    </div>
  );
}

/** A labelled row of the "Who knows" block: label left, control right. */
function Row({
  label,
  htmlFor,
  hint,
  children,
}: {
  label: string;
  htmlFor?: string;
  hint?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="grid gap-x-6 gap-y-1.5 sm:grid-cols-[6rem_minmax(0,1fr)]">
      <label htmlFor={htmlFor} className="pt-1.5 text-sm text-muted-foreground">
        {label}
      </label>
      <div className="flex min-w-0 flex-col gap-1.5">
        {children}
        {hint ? (
          <p className="text-xs text-pretty text-muted-foreground">{hint}</p>
        ) : null}
      </div>
    </div>
  );
}

/** A choice in a trigger as quiet as the label it stands in for. */
function QuietSelect<T extends string>({
  value,
  options,
  label,
  className,
  onChange,
}: {
  value: T;
  options: readonly { value: T; label: string }[];
  label: string;
  className?: string;
  onChange: (value: T) => void;
}) {
  return (
    <Select
      items={options}
      value={value}
      onValueChange={(next) => next && onChange(next)}
    >
      <SelectTrigger
        size="sm"
        aria-label={label}
        className={cn(
          "-ml-2 h-7 border-none bg-transparent px-2 text-xs font-medium shadow-none hover:bg-accent dark:bg-transparent dark:hover:bg-accent",
          className,
        )}
      >
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
  );
}

/**
 * A page as a form, in the same parts as reading it: the summary line, the
 * opening, then each part, which says who it is for in one choice; then who
 * knows the page at all. A bar pinned to the bottom saves it, over the version
 * opened.
 */
export function PageForm({
  id,
  agent,
  kind,
  name,
  self,
  onDone,
  onRaw,
}: {
  id: string;
  agent?: string | undefined;
  kind?: WikiKind | undefined;
  /** For a page not written yet. */
  name: string;
  /** The character the page is about, when it is one of the cast. */
  self?: { id: string; name: string } | undefined;
  onDone: (saved?: WikiSourceResponse) => void;
  onRaw: () => void;
}) {
  const source = useWikiForm(id, agent, kind);
  const [opened, setOpened] = useState<WikiPageForm>();
  useEffect(() => {
    if (!opened && source.data) setOpened(source.data);
  }, [opened, source.data]);
  const [draft, setDraft] = useState<Draft>();
  const [moveOther, setMoveOther] = useState(false);
  const [secret, setSecret] = useState(false);
  const [saving, setSaving] = useState(false);
  const [conflict, setConflict] = useState(false);
  const { characters } = useCharacters();
  const { data: list } = useWikiList();
  const personal = agent !== undefined;
  const { data: reach } = useWikiReach(personal ? undefined : id);
  const pageKind = opened?.kind ?? kind;
  const { data: backdrops } = useWikiBackdrops(pageKind === "place");
  const formId = useId();

  if (!opened)
    return source.error ? (
      <p className="text-sm text-destructive">{failureText(source.error)}</p>
    ) : (
      <p className="text-sm text-muted-foreground">Opening…</p>
    );

  const initial = draftOf(opened, name, self?.id);
  const current = draft ?? initial;
  const { fields } = current;
  const subject = fields.name?.trim() || name;
  const dirty =
    moveOther || JSON.stringify(current) !== JSON.stringify(initial);
  const set = (patch: Partial<Draft>) => setDraft({ ...current, ...patch });
  const setField = (patch: Partial<WikiPageFormFields>) =>
    set({ fields: { ...fields, ...patch } });
  const setPart = (index: number, patch: Partial<Part>) =>
    set({
      parts: current.parts.map((part, at) =>
        at === index ? { ...part, ...patch } : part,
      ),
    });
  const move = (index: number, by: -1 | 1) => {
    const parts = [...current.parts];
    const [moved] = parts.splice(index, 1);
    parts.splice(index + by, 0, moved);
    set({ parts });
  };
  const cast = characters
    .filter((one) => one.kind === "agent" && !one.isSystemAgent)
    .map((one) => ({ value: one.id, label: one.name }));
  const pages = (list?.pages ?? []).map((page) => ({
    value: page.id,
    label: page.name,
  }));
  const places = (list?.pages ?? []).filter((page) => page.kind === "place");
  const how: Reach =
    secret || fields.knownBy.length
      ? "secret"
      : (fields.renown ?? (pageKind === "concept" ? "known" : "local"));
  // Who a part can be for. Naming others isn't offered: a secret some of
  // them know goes in their own wikis. An older part that names people keeps
  // them, so opening and saving changes nothing.
  const audiencesFor = (part: Part) => [
    { value: "close" as const, label: audienceLabel("close", subject) },
    ...(self
      ? [{ value: "self" as const, label: audienceLabel("self", self.name) }]
      : []),
    ...(part.audience === "named"
      ? [{ value: "named" as const, label: "Only certain people" }]
      : []),
  ];
  const reaches = REACH.filter(
    (option) => option.value !== "secret" || how === "secret",
  );

  const save = async () => {
    setSaving(true);
    try {
      const saved = await saveWikiForm({
        id,
        ...(agent ? { agent } : {}),
        kind: opened.kind,
        base: opened.hash,
        fields: current.fields,
        lead: current.lead,
        sections: current.parts.map((part) => ({
          title: part.title,
          text: part.text,
          knownBy:
            part.audience === "self" && self
              ? [self.id]
              : part.audience === "named"
                ? [...part.named]
                : [],
        })),
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
      </div>

      <section className="flex max-w-3xl flex-col gap-7">
        <h2 className="text-sm font-semibold">
          {personal ? "What they think" : `What people know about ${subject}`}
        </h2>
        <Rail
          audience="heard"
          label={personal ? "In a line" : audienceLabel("heard", subject)}
          people={personal ? undefined : peopleIn("heard", reach)}
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
          people={personal ? undefined : peopleIn("knows", reach)}
        >
          <Textarea
            value={current.lead}
            aria-label="Opening"
            placeholder={`Who ${subject} is, plainly.`}
            className="field-sizing-content min-h-24 text-sm leading-relaxed"
            onChange={(event) => set({ lead: event.target.value })}
          />
        </Rail>
        {current.parts.map((part, index) => (
          <Rail
            key={index}
            audience={personal ? "close" : part.audience}
            label={
              personal ? (
                "A part"
              ) : (
                <QuietSelect
                  value={part.audience}
                  options={audiencesFor(part)}
                  label="Who knows this part"
                  className={TINT[part.audience]}
                  onChange={(audience) => setPart(index, { audience })}
                />
              )
            }
            people={
              // Said once for a run of parts with the same audience.
              !personal &&
              part.audience === "close" &&
              current.parts[index - 1]?.audience !== "close"
                ? peopleIn("close", reach)
                : undefined
            }
          >
            <div className="flex flex-col gap-2">
              {!personal && part.audience === "named" ? (
                <Names
                  id={`${formId}-named-${index}`}
                  items={part.named}
                  label="Name someone who knows this part"
                  placeholder="Add a name"
                  options={cast}
                  onChange={(named) => setPart(index, { named })}
                />
              ) : null}
              <div className="flex items-center gap-1">
                <Input
                  value={part.title}
                  aria-label="Part heading"
                  placeholder="Heading"
                  className="h-8 flex-1 font-medium"
                  onChange={(event) =>
                    setPart(index, { title: event.target.value })
                  }
                />
                <Button
                  variant="ghost"
                  size="icon-sm"
                  disabled={index === 0}
                  aria-label="Move up"
                  onClick={() => move(index, -1)}
                >
                  <ArrowUpIcon />
                </Button>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  disabled={index === current.parts.length - 1}
                  aria-label="Move down"
                  onClick={() => move(index, 1)}
                >
                  <ArrowDownIcon />
                </Button>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label={`Remove ${part.title || "this part"}`}
                  onClick={() =>
                    set({
                      parts: current.parts.filter((_, at) => at !== index),
                    })
                  }
                >
                  <XIcon />
                </Button>
              </div>
              <Textarea
                value={part.text}
                aria-label={`${part.title || "Part"} text`}
                className="field-sizing-content min-h-20 text-sm leading-relaxed"
                onChange={(event) =>
                  setPart(index, { text: event.target.value })
                }
              />
            </div>
          </Rail>
        ))}
        <Button
          variant="outline"
          size="sm"
          className="self-start"
          onClick={() =>
            set({
              parts: [
                ...current.parts,
                { title: "", text: "", audience: "close", named: [] },
              ],
            })
          }
        >
          <PlusIcon />
          Add a part
        </Button>
      </section>

      {personal ? null : (
        <section className="flex max-w-3xl flex-col gap-5">
          <h2 className="text-sm font-semibold">Who knows {subject}</h2>
          <Row
            label="Known"
            htmlFor={`${formId}-reach`}
            hint={REACH.find((option) => option.value === how)?.hint(subject)}
          >
            <Select
              items={reaches.map(({ value, label }) => ({ value, label }))}
              value={how}
              onValueChange={(next) => {
                if (!next) return;
                setSecret(next === "secret");
                if (next === "secret") setField({ renown: undefined });
                else setField({ renown: next, knownBy: [] });
              }}
            >
              <SelectTrigger id={`${formId}-reach`} className="w-full max-w-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {reaches.map(({ value, label }) => (
                  <SelectItem key={value} value={value}>
                    {label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {how === "secret" ? (
              <Names
                id={`${formId}-known-by`}
                items={fields.knownBy}
                label="Name someone who knows it"
                placeholder="Add a name"
                options={cast}
                onChange={(knownBy) => setField({ knownBy })}
              />
            ) : null}
          </Row>
          <Row
            label="Groups"
            htmlFor={`${formId}-groups`}
            hint={
              pageKind === "person"
                ? `${subject} and everyone in a group know each other; in a close one, well. The first is the nearest.`
                : `Everyone in its groups knows ${subject}. The first is the nearest.`
            }
          >
            <Names
              id={`${formId}-groups`}
              items={fields.groups.map(({ ref }) => ref)}
              label="Add a group"
              placeholder="Add a group"
              options={pages}
              onChange={(refs) =>
                setField({
                  groups: refs.map(
                    (ref) =>
                      fields.groups.find((group) => group.ref === ref) ?? {
                        ref,
                        close: false,
                      },
                  ),
                })
              }
              {...(pageKind === "person"
                ? {
                    extra: (ref: string, index: number) => (
                      <label className="flex items-center gap-1 text-xs text-muted-foreground">
                        <Checkbox
                          checked={fields.groups[index]?.close ?? false}
                          aria-label={`Close in ${ref}`}
                          onCheckedChange={(checked) =>
                            setField({
                              groups: fields.groups.map((group, at) =>
                                at === index
                                  ? { ...group, close: checked === true }
                                  : group,
                              ),
                            })
                          }
                        />
                        close
                      </label>
                    ),
                  }
                : {})}
            />
          </Row>
          {pageKind === "person" ? (
            <Row
              label="Home"
              htmlFor={`${formId}-home`}
              hint="Where they live; they know it and what is around it well."
            >
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
                <SelectTrigger
                  id={`${formId}-home`}
                  className="w-full max-w-xs"
                >
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
            </Row>
          ) : null}
          {pageKind === "place" ? (
            <Row
              label="Backdrop"
              htmlFor={`${formId}-backdrop`}
              hint="The picture a scene here is drawn in front of. Without one, its area's."
            >
              <Select
                items={[
                  { value: NONE, label: "The area's" },
                  ...(backdrops?.sets ?? []).map((set) => ({
                    value: set.name,
                    label: set.name,
                  })),
                ]}
                value={fields.backdrop ?? NONE}
                onValueChange={(value) =>
                  setField({
                    backdrop: value && value !== NONE ? value : undefined,
                  })
                }
              >
                <SelectTrigger
                  id={`${formId}-backdrop`}
                  className="w-full max-w-xs"
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NONE}>The area&apos;s</SelectItem>
                  {(backdrops?.sets ?? []).map((set) => (
                    <SelectItem key={set.name} value={set.name}>
                      {set.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Row>
          ) : null}
        </section>
      )}

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
            Move them into a Details part when saving, so characters read them
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
        <Button variant="ghost" size="sm" onClick={onRaw}>
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
            <Button variant="outline" size="sm" onClick={() => onDone()}>
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
    </div>
  );
}
