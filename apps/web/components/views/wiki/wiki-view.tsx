"use client";

import {
  BookOpenIcon,
  GlobeIcon,
  MenuIcon,
  PencilIcon,
  UserRoundIcon,
} from "lucide-react";
import {
  WikiKindSchema,
  type Knowledge,
  type WikiKind,
  type WikiPage,
} from "@kazusa/client";
import { Unavailable } from "@/components/entities/source-state";
import { Button } from "@/components/ui/button";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { useCharacter } from "@/hooks/use-characters";
import { useNavigate, useParam } from "@/hooks/use-url-state";
import { useMemoryRuns, useWikiLint, useWikiPage } from "@/hooks/use-wiki";
import { useSources } from "@/lib/source/provider";
import { requestSidebar } from "@/lib/state/sidebar-request";
import { formatSimTime } from "@/lib/time/sim";
import { changedOnly, diffLines } from "@/lib/wiki/diff";
import { cn } from "@/lib/utils";
import { DeletePageButton, RenamePlaceButton } from "./page-actions";
import { PageEditor } from "./page-editor";
import { describePage, type WikiSide } from "./page-roles";

function Column({
  icon: Icon,
  title,
  description,
  onEdit,
  actions,
  children,
}: {
  icon: typeof GlobeIcon;
  title: string;
  /** Which page this is, so nobody edits the wrong one. */
  description: string;
  /** Absent while this column is the one being edited. */
  onEdit?: (() => void) | undefined;
  /** Rename, delete: shown beside Edit, and only with it. */
  actions?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="min-w-0 flex-1">
      <div className="flex h-6 items-center gap-2">
        <h3 className="flex flex-1 items-center gap-2 text-xs font-medium text-muted-foreground">
          <Icon aria-hidden className="size-3.5" />
          {title}
        </h3>
        {onEdit ? (
          <Button
            variant="ghost"
            size="xs"
            onClick={onEdit}
            aria-label={`Edit ${title.toLowerCase()}`}
          >
            <PencilIcon />
            Edit
          </Button>
        ) : null}
        {onEdit ? actions : null}
      </div>
      <p className="mt-1 mb-4 text-xs text-muted-foreground">{description}</p>
      <div className="space-y-4">{children}</div>
    </section>
  );
}

/** Markdown wraps lines for its source; only blank lines separate paragraphs. */
function Prose({ text, className }: { text: string; className?: string }) {
  return (
    <div className={cn("space-y-3 text-sm leading-relaxed", className)}>
      {text.split(/\n\s*\n/).map((paragraph) => (
        <p key={paragraph}>{paragraph}</p>
      ))}
    </div>
  );
}

/** Canon reads upright; a character's page reads as what they think (D7). */
function PageBody({
  page,
  subjective,
  guessHeading = "What they think of me (a guess)",
}: {
  page: WikiPage;
  subjective: boolean;
  /** Whose guess about whom, so it isn't read as the other's own view. */
  guessHeading?: string;
}) {
  return (
    <>
      {page.lead ? (
        <Prose text={page.lead} className={subjective ? "italic" : undefined} />
      ) : (
        <p className="text-sm text-muted-foreground">
          {page.summary || "Nothing written yet."}
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
          <p className="text-sm italic">{page.theyThinkOfMe}</p>
        </div>
      ) : null}
      {page.openThreads.length ? (
        <div>
          <h4 className="mb-1 text-xs font-medium text-muted-foreground">
            Open threads
          </h4>
          <ul className="list-disc space-y-1 pl-4 text-sm">
            {page.openThreads.map((thread) => (
              <li key={thread}>{thread}</li>
            ))}
          </ul>
        </div>
      ) : null}
      {page.sections.map((section) => (
        <div key={section.title}>
          <h4 className="mb-1 text-xs font-medium text-muted-foreground">
            {section.title}
            {section.knownBy.length ? (
              <span className="ml-2 font-normal">
                Known by {section.knownBy.join(", ")}
              </span>
            ) : null}
          </h4>
          <Prose text={section.text} />
        </div>
      ))}
      {page.history.length ? (
        <div>
          <h4 className="mb-1 text-xs font-medium text-muted-foreground">
            History
          </h4>
          <ul className="space-y-1 text-sm">
            {page.history.map((line) => (
              <li key={`${line.date}${line.text}`}>
                <span className="font-mono text-xs text-muted-foreground">
                  {line.date}
                </span>
                {line.news ? (
                  <span className="ml-1 text-xs text-muted-foreground">
                    news
                  </span>
                ) : null}{" "}
                {line.text}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      {page.notes.length ? (
        <div>
          <h4 className="mb-1 text-xs font-medium text-muted-foreground">
            Notes
          </h4>
          <ul className="space-y-2 text-sm">
            {page.notes.map((note) => (
              <li key={`${note.date}${note.text}`}>
                <span className="italic">{note.text}</span>
                <span className="block font-mono text-xs text-muted-foreground">
                  {note.date} · {note.source} · {note.certainty}
                </span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </>
  );
}

function DepthLine({
  knowledge,
  name,
}: {
  knowledge: Knowledge;
  name: string;
}) {
  return (
    <p className="text-xs text-muted-foreground">
      {name} knows this at{" "}
      <span className="font-medium text-foreground">{knowledge.depth}</span>:{" "}
      {knowledge.why}.
    </p>
  );
}

function PagePane({ id, agent }: { id: string; agent?: string }) {
  const read = useWikiPage(id, agent);
  const { data, isLoading } = read;
  const character = useCharacter(agent);
  const navigate = useNavigate();
  const editParam = useParam("wiki.edit");
  const kindParam = WikiKindSchema.safeParse(useParam("wiki.kind"));
  const newName = useParam("wiki.name");
  const name = character?.name ?? agent ?? "";
  // Their own page only exists with a character chosen.
  const editing: WikiSide | undefined =
    editParam === "world" || (editParam === "own" && agent)
      ? editParam
      : undefined;
  const open = (page: string | null) =>
    navigate({
      "wiki.page": page,
      "wiki.edit": null,
      "wiki.kind": null,
      "wiki.name": null,
    });
  const edit = (side: WikiSide | null) =>
    navigate({
      "wiki.edit": side,
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
  const kind: WikiKind | undefined = kindParam.success
    ? kindParam.data
    : (data?.world?.kind ?? data?.personal?.kind);
  const subject = newName ?? title;
  const editor = (side: WikiSide) => (
    <PageEditor
      id={id}
      {...(side === "own" && agent ? { agent } : {})}
      {...(kind ? { kind } : {})}
      side={side}
      {...(agent ? { owner: name } : {})}
      name={subject}
      onDone={(saved) =>
        // A place saved under a new id was renamed: follow it.
        saved && saved.id !== id ? open(saved.id) : edit(null)
      }
    />
  );
  return (
    <div className="mx-auto w-full max-w-5xl space-y-4 p-4 lg:p-6">
      <header className="space-y-1">
        <h2 className="text-lg font-semibold">{subject}</h2>
        {data?.knowledge ? (
          <DepthLine knowledge={data.knowledge} name={name} />
        ) : null}
      </header>
      <div className="flex flex-col gap-8 lg:flex-row">
        {agent ? (
          <Column
            icon={UserRoundIcon}
            title={`What ${name} makes of it`}
            description={describePage("own", kind, {
              owner: name,
              subject,
            })}
            onEdit={
              editing === "own" || !data?.personal
                ? undefined
                : () => edit("own")
            }
            actions={
              agent ? (
                <DeletePageButton
                  id={id}
                  name={`${name}'s page on ${subject}`}
                  agent={agent}
                  place={false}
                  onDeleted={() => void read.mutate()}
                />
              ) : null
            }
          >
            {editing === "own" ? (
              editor("own")
            ) : data?.personal ? (
              <PageBody
                page={data.personal}
                subjective
                guessHeading={`What ${subject} thinks of ${name} (${name}'s guess)`}
              />
            ) : (
              <div className="space-y-2">
                <p className="text-sm text-muted-foreground">
                  No page of their own.
                </p>
                <Button variant="outline" size="sm" onClick={() => edit("own")}>
                  <PencilIcon />
                  Write what they make of it
                </Button>
              </div>
            )}
          </Column>
        ) : null}
        <Column
          icon={GlobeIcon}
          title="The world"
          description={describePage("world", kind, { subject })}
          onEdit={
            editing === "world" || (!data?.world && agent)
              ? undefined
              : () => edit("world")
          }
          actions={
            data?.world ? (
              <>
                {data.world.kind === "place" ? (
                  <RenamePlaceButton id={id} name={subject} onRenamed={open} />
                ) : null}
                <DeletePageButton
                  id={id}
                  name={subject}
                  place={data.world.kind === "place"}
                  onDeleted={() =>
                    data.personal ? void read.mutate() : open(null)
                  }
                />
              </>
            ) : null
          }
        >
          {editing === "world" ? (
            editor("world")
          ) : data?.world ? (
            <PageBody page={data.world} subjective={false} />
          ) : agent ? (
            <p className="text-sm text-muted-foreground">
              Not in the world wiki: this is theirs alone.
            </p>
          ) : (
            <p className="text-sm text-muted-foreground">
              Nothing written yet.
            </p>
          )}
        </Column>
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

/** Canon next to each character's mind, what sleep changed, and what is broken. */
export function WikiView() {
  const { resolved } = useSources();
  const agent = useParam("wiki.agent") ?? undefined;
  const page = useParam("wiki.page") ?? undefined;
  const tab = useParam("wiki.tab");

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
        ) : page ? (
          <PagePane id={page} {...(agent ? { agent } : {})} />
        ) : (
          <Empty className="h-full">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <BookOpenIcon />
              </EmptyMedia>
              <EmptyTitle>Pick a page</EmptyTitle>
              <EmptyDescription>
                Choose the world or a character on the left. With a character
                chosen, each page shows what they make of it next to what is
                true.
              </EmptyDescription>
            </EmptyHeader>
          </Empty>
        )}
      </div>
    </div>
  );
}
