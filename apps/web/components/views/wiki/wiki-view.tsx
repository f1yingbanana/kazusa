"use client";

import { parseAsString, useQueryStates, useQueryState } from "nuqs";
import {
  BookOpenIcon,
  CameraIcon,
  EyeIcon,
  GlobeIcon,
  MenuIcon,
  PencilIcon,
  UserRoundIcon,
} from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { useSWRConfig } from "swr";
import type {
  Knowledge,
  WikiKind,
  WikiPage,
  WikiSourceResponse,
} from "@kazusa/client";
import { Unavailable } from "@/components/entities/source-state";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { Spinner } from "@/components/ui/spinner";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useAccess } from "@/hooks/use-access";
import { isCast, useCharacter, useCharacters } from "@/hooks/use-characters";
import { useMemoryRuns, useWikiLint, useWikiPage } from "@/hooks/use-wiki";
import { useWikiCharacter, useWikiReach } from "@/hooks/use-wiki-editor";
import { CHARACTERS_KEY, useSources } from "@/lib/source/provider";
import { uploadPicture } from "@/lib/source/wiki/editor";
import { WIKI_KEY } from "@/lib/source/wiki/http";
import {
  entityRefParser,
  serializeEntityRef,
  type EntityKind,
} from "@/lib/state/entity-ref";
import { markQuietSelection, requestSidebar } from "@/lib/state/ui-store";
import { formatSimTime } from "@/lib/time/sim";
import { changedOnly, diffLines } from "@/lib/wiki/diff";
import { cn } from "@/lib/utils";
import { PlaceBackdrop } from "./backdrop-editor";
import { LooksTab } from "./looks-tab";
import { MemoryTab } from "./memory-tab";
import { PageMenu, ShowOnMapButton } from "./page-actions";
import { PageEditor } from "./page-editor";
import { PageForm } from "./page-form";
import { RichText, WikiLink, usePlainText } from "./page-link";
import { PageLayers, Prose } from "./page-layers";
import type { WikiSide } from "./page-roles";
import { failureText, usePicturePicker } from "./parts";

/** Where a note came from, with the person who told it as a link. */
function NoteSource({ source }: { source: string }) {
  const who = /^(told by|overheard) (.+)$/.exec(source);
  return who ? (
    <>
      {who[1]} <WikiLink id={who[2].replace(/^user:/, "")} />
    </>
  ) : (
    <>{source}</>
  );
}

import { StickersTab } from "./stickers-tab";
import {
  CHARACTER_PARTS,
  PLACE_PARTS,
  wikiParsers,
  type PagePart,
} from "./search-params";

const PART_LABELS: Readonly<Record<PagePart, string>> = {
  page: "Page",
  memory: "Memory",
  looks: "Looks",
  stickers: "Stickers",
  backdrop: "Backdrop",
};

/** A character's page on someone, read as what they think. */
function PersonalBody({
  page,
  guessHeading,
}: {
  page: WikiPage;
  guessHeading: string;
}) {
  return (
    <div className="space-y-4">
      {page.lead ? (
        <Prose text={page.lead} className="italic" />
      ) : (
        <p className="text-sm text-muted-foreground">
          {page.summary ? (
            <RichText text={page.summary} />
          ) : (
            "Nothing written yet."
          )}
        </p>
      )}
      {page.relation ? (
        <p className="text-xs text-muted-foreground">
          Relation: <span className="text-foreground">{page.relation}</span>
        </p>
      ) : null}
      {page.theyThinkOfMe ? (
        <div>
          <h4 className="mb-1 text-xs font-medium text-muted-foreground">
            {guessHeading}
          </h4>
          <p className="text-sm italic">
            <RichText text={page.theyThinkOfMe} />
          </p>
        </div>
      ) : null}
      {page.openThreads.length ? (
        <div>
          <h4 className="mb-1 text-xs font-medium text-muted-foreground">
            Open threads
          </h4>
          <ul className="list-disc space-y-1 pl-4 text-sm">
            {page.openThreads.map((thread) => (
              <li key={thread}>
                <RichText text={thread} />
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      {page.sections.map((section) => (
        <div key={section.title}>
          <h4 className="mb-1 text-xs font-medium text-muted-foreground">
            {section.title}
          </h4>
          <Prose text={section.text} />
        </div>
      ))}
      {page.notes.length ? (
        <div>
          <h4 className="mb-1 text-xs font-medium text-muted-foreground">
            Notes
          </h4>
          <ul className="space-y-2 text-sm">
            {page.notes.map((note) => (
              <li key={`${note.date}${note.text}`}>
                <span className="italic">
                  <RichText text={note.text} />
                </span>
                <span className="block text-xs text-muted-foreground">
                  {note.date}, <NoteSource source={note.source} />,{" "}
                  {note.certainty}
                </span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}

const DEPTH_WORDS: Readonly<Record<Knowledge["depth"], string>> = {
  none: "doesn't know it",
  "heard of": "has heard of it",
  familiar: "knows it",
  intimate: "knows it well",
};

/** How the form or the Markdown edits a page; the form unless asked. */
function PageEditing({
  id,
  agent,
  kind,
  name,
  side,
  owner,
  onDone,
}: {
  id: string;
  agent?: string | undefined;
  kind?: WikiKind | undefined;
  name: string;
  side: WikiSide;
  owner?: string | undefined;
  onDone: (saved?: WikiSourceResponse) => void;
}) {
  const [params, setParams] = useQueryStates(wikiParsers);
  const { mutate } = useSWRConfig();
  // After a save, read again without passing data: even `undefined` would
  // empty every wiki list, the sidebar's too, until it came back.
  const done = (saved?: WikiSourceResponse) => {
    if (saved)
      void mutate(
        (key) => Array.isArray(key) && String(key[0]).startsWith("kazusa/wiki"),
      );
    void setParams({ "wiki.raw": null });
    onDone(saved);
  };
  return params["wiki.raw"] ? (
    <PageEditor
      id={id}
      {...(agent ? { agent } : {})}
      {...(kind ? { kind } : {})}
      side={side}
      {...(owner ? { owner } : {})}
      name={name}
      onDone={done}
    />
  ) : (
    <PageForm
      id={id}
      agent={agent}
      kind={kind}
      name={name}
      onDone={done}
      onRaw={() => void setParams({ "wiki.raw": "1" })}
    />
  );
}

/** Their face in the header; choosing a picture replaces it at once. */
function AvatarButton({
  id,
  name,
  url,
}: {
  id: string;
  name: string;
  url: string | undefined;
}) {
  const [busy, setBusy] = useState(false);
  const { canManage } = useAccess();
  const { mutate } = useSWRConfig();
  const { pick, input } = usePicturePicker(([file]) => {
    if (!file) return;
    setBusy(true);
    void uploadPicture({ kind: "avatar", owner: id }, file)
      .then(() =>
        mutate(
          (key) =>
            Array.isArray(key) &&
            (key[0] === CHARACTERS_KEY[0] || key[0] === WIKI_KEY),
        ),
      )
      .then(() => toast.success(`Changed ${name}'s avatar.`))
      .catch((failure: unknown) => toast.error(failureText(failure)))
      .finally(() => setBusy(false));
  });
  return (
    <button
      type="button"
      onClick={pick}
      disabled={!canManage}
      className="group/avatar relative shrink-0 rounded-full focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none"
      aria-label={`Change ${name}'s avatar`}
    >
      <Avatar className="size-12">
        {url ? <AvatarImage src={url} alt="" /> : null}
        <AvatarFallback>{name.slice(0, 1)}</AvatarFallback>
      </Avatar>
      <span className="absolute inset-0 grid place-items-center rounded-full bg-background/70 opacity-0 transition-opacity group-hover/avatar:opacity-100 group-focus-visible/avatar:opacity-100 group-disabled/avatar:hidden">
        {busy ? <Spinner /> : <CameraIcon className="size-4" />}
      </span>
      {input}
    </button>
  );
}

/** A character's memory, looks or stickers. */
function CharacterPart({ id, part }: { id: string; part: PagePart }) {
  const { data, error, mutate } = useWikiCharacter(id);
  if (error)
    return <p className="text-sm text-destructive">{failureText(error)}</p>;
  if (!data) return <p className="text-sm text-muted-foreground">Loading…</p>;
  const reload = () => mutate();
  if (part === "memory") return <MemoryTab character={data} onSaved={reload} />;
  if (part === "looks") return <LooksTab character={data} onChanged={reload} />;
  return <StickersTab character={data} onChanged={reload} />;
}

/**
 * A World Wiki page; a character's has tabs for their memory, looks and
 * stickers.
 */
export function WorldPage({ id }: { id: string }) {
  const read = useWikiPage(id);
  const { data, isLoading } = read;
  const [params, setParams] = useQueryStates(wikiParsers);
  const [, setView] = useQueryState("view", parseAsString);
  const [, setCharacter] = useQueryState("character", parseAsString);
  const { canManage } = useAccess();
  const character = useCharacter(id);
  const cast = isCast(character) ? character : undefined;
  const editing = canManage && params["wiki.edit"] === "world";
  const plain = usePlainText();
  const { data: reach } = useWikiReach(id);
  // The inspector follows: the character or place this page is.
  const [, setSelection] = useQueryState("sel", entityRefParser);
  const subject: EntityKind | undefined = character
    ? "character"
    : data?.world?.place
      ? "place"
      : undefined;
  useEffect(() => {
    if (!subject) return;
    const ref = { kind: subject, id } as const;
    // Quietly: on a narrow screen it doesn't open over the page.
    markQuietSelection(serializeEntityRef(ref));
    void setSelection(ref, { history: "replace" });
  }, [id, subject, setSelection]);
  const parts = cast
    ? CHARACTER_PARTS
    : data?.world?.place
      ? PLACE_PARTS
      : undefined;
  const asked = params["wiki.part"];
  const part: PagePart = asked && parts?.includes(asked) ? asked : "page";
  const open = (page: string | null) =>
    void setParams({
      "wiki.page": page,
      "wiki.edit": null,
      "wiki.kind": null,
      "wiki.name": null,
      "wiki.raw": null,
    });
  const edit = (on: boolean) =>
    void setParams({
      "wiki.edit": on ? "world" : null,
      "wiki.raw": null,
      ...(on ? {} : { "wiki.kind": null, "wiki.name": null }),
    });

  if (isLoading)
    return <p className="p-6 text-sm text-muted-foreground">Loading…</p>;
  if (read.error)
    return (
      <p className="p-6 text-sm text-muted-foreground">
        Couldn&apos;t read this page.
      </p>
    );
  const page = data?.world;
  // A new page's name and kind, until it is written; never over a real page.
  const name = page?.name ?? cast?.name ?? params["wiki.name"] ?? id;
  const kind: WikiKind | undefined =
    page?.kind ?? params["wiki.kind"] ?? undefined;

  const pageTab = editing ? (
    <PageEditing
      key={id}
      id={id}
      kind={kind}
      name={name}
      side="world"
      onDone={(saved) =>
        saved && saved.id !== id ? open(saved.id) : edit(false)
      }
    />
  ) : page ? (
    <PageLayers page={page} reach={reach} />
  ) : (
    <div className="flex flex-col items-start gap-2">
      <p className="text-sm text-muted-foreground">Nothing written yet.</p>
      <Button
        variant="outline"
        size="sm"
        disabled={!canManage}
        onClick={() => edit(true)}
      >
        <PencilIcon />
        Write it
      </Button>
    </div>
  );

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-5 p-4 lg:p-8">
      <header className="flex items-center gap-4">
        {cast ? (
          <AvatarButton id={id} name={cast.name} url={cast.avatarUrl} />
        ) : null}
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <h1 className="truncate text-xl font-semibold tracking-tight">
            {name}
          </h1>
          {page?.summary ? (
            <p className="line-clamp-1 text-sm text-muted-foreground">
              {/* While editing, a link would leave the edit. */}
              {editing ? plain(page.summary) : <RichText text={page.summary} />}
            </p>
          ) : null}
        </div>
        <div
          className={cn(
            "flex shrink-0 items-center gap-1",
            editing && "hidden",
          )}
        >
          {page?.place ? <ShowOnMapButton id={id} /> : null}
          {cast ? (
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                // Their own wiki, in the Wiki tab.
                void setParams({
                  "wiki.agent": id,
                  "wiki.page": null,
                  "wiki.part": null,
                  "wiki.edit": null,
                  "wiki.tab": null,
                });
                void setView("wiki");
              }}
            >
              <EyeIcon />
              {cast.name}&apos;s view
            </Button>
          ) : null}
          {part === "page" && !editing && page ? (
            <>
              <Button
                variant="outline"
                size="sm"
                disabled={!canManage}
                onClick={() => edit(true)}
              >
                <PencilIcon />
                Edit
              </Button>
              <PageMenu
                id={id}
                name={name}
                kind={kind}
                place={page.place === true}
                // The system agent stays: switching to another comes later.
                canDelete={canManage && !character?.isSystemAgent}
                character={Boolean(cast)}
                onDeleted={() => {
                  // Gone: neither page nor inspector points at them.
                  void setSelection(null);
                  if (cast) void setCharacter(null);
                  open(null);
                }}
              />
            </>
          ) : null}
        </div>
      </header>
      {parts ? (
        <Tabs
          value={part}
          onValueChange={(next: PagePart) =>
            void setParams({
              "wiki.part": next === "page" ? null : next,
              "wiki.edit": null,
              "wiki.raw": null,
            })
          }
        >
          <TabsList
            variant="line"
            className="w-full justify-start gap-4 border-b"
          >
            {parts.map((value) => (
              <TabsTrigger key={value} value={value} className="flex-none px-0">
                {PART_LABELS[value]}
              </TabsTrigger>
            ))}
          </TabsList>
          <TabsContent value="page" className="pt-5">
            {pageTab}
          </TabsContent>
          {parts
            .filter((value) => value !== "page")
            .map((value) => (
              <TabsContent key={value} value={value} className="pt-5">
                {part !== value ? null : value === "backdrop" ? (
                  <PlaceBackdrop id={id} />
                ) : (
                  <CharacterPart id={id} part={value} />
                )}
              </TabsContent>
            ))}
        </Tabs>
      ) : (
        pageTab
      )}
    </div>
  );
}

function Column({
  icon: Icon,
  title,
  onEdit,
  actions,
  children,
}: {
  icon: typeof GlobeIcon;
  title: string;
  onEdit?: (() => void) | undefined;
  actions?: React.ReactNode;
  children: React.ReactNode;
}) {
  const { canManage } = useAccess();
  return (
    <section className="min-w-0 flex-1">
      <div className="flex h-6 items-center gap-2">
        <h3 className="flex flex-1 items-center gap-2 text-xs font-medium text-muted-foreground">
          <Icon aria-hidden className="size-3.5" />
          {title}
        </h3>
        {onEdit ? (
          <Button
            variant="outline"
            size="xs"
            disabled={!canManage}
            onClick={onEdit}
            aria-label={`Edit ${title.toLowerCase()}`}
          >
            <PencilIcon />
            Edit
          </Button>
        ) : null}
        {canManage && onEdit ? actions : null}
      </div>
      <div className="mt-3 space-y-4">{children}</div>
    </section>
  );
}

/**
 * In a character's view: what they make of a thing beside what is true, and how
 * well they know it.
 */
function TheirPage({ id, agent }: { id: string; agent: string }) {
  const read = useWikiPage(id, agent);
  const { data, isLoading } = read;
  const character = useCharacter(agent);
  const [params, setParams] = useQueryStates(wikiParsers);
  const { canManage } = useAccess();
  const name = character?.name ?? agent;
  const editParam = params["wiki.edit"];
  const editing: WikiSide | undefined =
    canManage && (editParam === "world" || editParam === "own")
      ? editParam
      : undefined;
  const open = (page: string | null) =>
    void setParams({
      "wiki.page": page,
      "wiki.edit": null,
      "wiki.kind": null,
      "wiki.name": null,
      "wiki.raw": null,
    });
  const edit = (side: WikiSide | null) =>
    void setParams({
      "wiki.edit": side,
      "wiki.raw": null,
      ...(side ? {} : { "wiki.kind": null, "wiki.name": null }),
    });

  if (isLoading)
    return <p className="p-6 text-sm text-muted-foreground">Loading…</p>;
  if (read.error)
    return (
      <p className="p-6 text-sm text-muted-foreground">
        Couldn&apos;t read this page.
      </p>
    );
  const title = data?.world?.name ?? data?.personal?.name ?? id;
  const kind: WikiKind | undefined =
    params["wiki.kind"] ?? data?.world?.kind ?? data?.personal?.kind;
  const subject = params["wiki.name"] ?? title;
  const editor = (side: WikiSide) => (
    <PageEditing
      key={`${id}:${side}`}
      id={id}
      agent={side === "own" ? agent : undefined}
      kind={kind}
      name={subject}
      side={side}
      owner={name}
      onDone={(saved) =>
        saved && saved.id !== id ? open(saved.id) : edit(null)
      }
    />
  );
  return (
    <div className="mx-auto w-full max-w-5xl space-y-4 p-4 lg:p-6">
      <header className="space-y-1">
        <h2 className="text-lg font-semibold">{subject}</h2>
        {data?.knowledge ? (
          <p className="text-xs text-muted-foreground">
            {name} {DEPTH_WORDS[data.knowledge.depth]}: {data.knowledge.why}.
          </p>
        ) : null}
      </header>
      <div className={cn("flex flex-col gap-8", editing ? "" : "lg:flex-row")}>
        {editing !== "world" ? (
          <Column
            icon={UserRoundIcon}
            title={`What ${name} makes of it`}
            onEdit={
              editing === "own" || !data?.personal
                ? undefined
                : () => edit("own")
            }
            actions={
              <PageMenu
                id={id}
                name={`${name}'s page on ${subject}`}
                agent={agent}
                place={false}
                canDelete
                size="xs"
                onDeleted={() => void read.mutate()}
              />
            }
          >
            {editing === "own" ? (
              editor("own")
            ) : data?.personal ? (
              <PersonalBody
                page={data.personal}
                guessHeading={`What ${subject} thinks of ${name} (${name}'s guess)`}
              />
            ) : (
              <div className="space-y-2">
                <p className="text-sm text-muted-foreground">
                  No page of their own.
                </p>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={!canManage}
                  onClick={() => edit("own")}
                >
                  <PencilIcon />
                  Write what they make of it
                </Button>
              </div>
            )}
          </Column>
        ) : null}
        {editing !== "own" ? (
          <Column
            icon={GlobeIcon}
            title="The world"
            onEdit={
              editing === "world" || !data?.world
                ? undefined
                : () => edit("world")
            }
          >
            {editing === "world" ? (
              editor("world")
            ) : data?.world ? (
              <PageLayers page={data.world} />
            ) : (
              <p className="text-sm text-muted-foreground">
                Only in their own wiki.
              </p>
            )}
          </Column>
        ) : null}
      </div>
    </div>
  );
}

function NightsPane({ agent }: { agent: string }) {
  const { data, isLoading } = useMemoryRuns(agent);
  if (isLoading)
    return <p className="p-6 text-sm text-muted-foreground">Loading…</p>;
  if (!data?.runs.length)
    return (
      <p className="p-6 text-sm text-muted-foreground">
        They haven&apos;t slept on anything yet.
      </p>
    );
  return (
    <div className="mx-auto w-full max-w-3xl space-y-6 p-4 lg:p-6">
      {data.runs.map((run) => (
        <section key={run.id} className="space-y-3">
          <h2 className="font-mono text-sm">{formatSimTime(run.at)}</h2>
          {run.files.map((file) => (
            <div key={file.path} className="overflow-hidden rounded-md border">
              <h3 className="border-b bg-muted/40 px-3 py-1.5 font-mono text-xs">
                {file.path}
              </h3>
              <pre className="overflow-x-auto p-3 font-mono text-xs leading-relaxed">
                {changedOnly(
                  diffLines(file.before ?? "", file.after ?? ""),
                ).map((line, index) => (
                  <div
                    key={index}
                    className={cn(
                      line.kind === "added" && "bg-primary/10",
                      line.kind === "removed" &&
                        "text-muted-foreground line-through",
                    )}
                  >
                    {line.kind === "added"
                      ? "+ "
                      : line.kind === "removed"
                        ? "- "
                        : "  "}
                    {line.text}
                  </div>
                ))}
              </pre>
            </div>
          ))}
        </section>
      ))}
    </div>
  );
}

function LintPane({ agent }: { agent?: string }) {
  const { data, isLoading } = useWikiLint(agent);
  if (isLoading)
    return <p className="p-6 text-sm text-muted-foreground">Loading…</p>;
  if (!data?.findings.length)
    return <p className="p-6 text-sm text-muted-foreground">No problems.</p>;
  return (
    <ul className="mx-auto w-full max-w-3xl divide-y p-4 lg:p-6">
      {[...data.findings]
        .sort((a, b) => a.level.localeCompare(b.level))
        .map((finding) => (
          <li
            key={`${finding.page}${finding.message}`}
            className="py-2 text-sm"
          >
            <span
              className={cn(
                "font-mono text-xs",
                finding.level === "error"
                  ? "text-destructive"
                  : "text-muted-foreground",
              )}
            >
              {finding.level}
            </span>{" "}
            <span className="font-mono text-xs">{finding.page}</span>
            <span className="block">{finding.message}</span>
          </li>
        ))}
    </ul>
  );
}

/**
 * The world's pages and each character's view of them. A character's page is
 * who they are; its tabs hold their memory, looks and stickers.
 */
export function WikiView() {
  const { resolved } = useSources();
  const [agent] = useQueryState("wiki.agent", wikiParsers["wiki.agent"]);
  const [page] = useQueryState("wiki.page", wikiParsers["wiki.page"]);
  const [tab] = useQueryState("wiki.tab", wikiParsers["wiki.tab"]);
  const { byId } = useCharacters();
  const agentName = agent ? (byId.get(agent)?.name ?? agent) : undefined;

  if (resolved.wiki !== "live")
    return <Unavailable requires={["wiki"]} className="m-auto" />;
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <header className="flex h-12 shrink-0 items-center gap-2 border-b px-4 lg:hidden">
        <Button variant="outline" size="sm" onClick={requestSidebar}>
          <MenuIcon />
          Pages
        </Button>
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto">
        {tab === "lint" ? (
          <LintPane {...(agent ? { agent } : {})} />
        ) : tab === "nights" && agent ? (
          <NightsPane agent={agent} />
        ) : page && agent ? (
          <TheirPage id={page} agent={agent} />
        ) : page ? (
          <WorldPage key={page} id={page} />
        ) : (
          <Empty className="h-full">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <BookOpenIcon />
              </EmptyMedia>
              <EmptyTitle>
                {agentName ? `${agentName}'s view` : "Pick a page"}
              </EmptyTitle>
              {agentName ? (
                <EmptyDescription>
                  Pick a page to see what {agentName} makes of it.
                </EmptyDescription>
              ) : null}
            </EmptyHeader>
          </Empty>
        )}
      </div>
    </div>
  );
}
