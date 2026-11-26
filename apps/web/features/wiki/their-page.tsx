"use client";

import type {
  Knowledge,
  WikiKind,
  WikiPage,
  WikiSourceResponse,
} from "@kazusa/client";
import { GlobeIcon, PencilIcon, PlusIcon } from "lucide-react";
import { useQueryStates } from "nuqs";
import type { ReactNode } from "react";
import { useAccess } from "@/hooks/use-access";
import { useCharacters } from "@/hooks/use-characters";
import { usePageLookup, usePageName, useWikiPage } from "@/hooks/use-wiki";
import { firstName } from "@/lib/format";
import { Button, IconButton } from "@/ui/button";
import { cx } from "@/ui/cx";
import { Note } from "@/ui/note";
import { CharacterAvatar } from "../characters/character-avatar";
import { Prose } from "../entities/prose";
import { PageArticle } from "./article";
import { RichText, WikiLink } from "./links";
import { BODY_TRANSITION, withTransition } from "./motion";
import { PageEditor } from "./page-editor";
import { Eyebrow, PageHead, PageProblems, Sheet } from "./page-header";
import { PageMenu } from "./page-menu";
import { wikiPatch } from "./open";
import { wikiParsers, type WikiSide } from "./search-params";
import { useRefreshWiki } from "./refresh";

const DEPTH_WORD: Readonly<Record<Knowledge["depth"], string>> = {
  none: "Never heard of",
  "heard of": "Heard of",
  familiar: "Knows",
  intimate: "Knows well",
};

/** Where a note came from, the person who told it a link. */
function NoteSource({ source }: { source: string }) {
  const who = /^(told by|overheard) (.+)$/.exec(source);
  return who ? (
    <>
      {`${who[1]} `}
      <WikiLink id={who[2].replace(/^user:/, "")} />
    </>
  ) : (
    <>{source}</>
  );
}

/**
 * What a character makes of something, in their own voice: the line they'd say
 * first, their impression, what they guess the other thinks of them, what is
 * still open between them, and the notes they've taken, dated and sourced.
 */
function TheirNotes({
  page,
  by,
  about,
}: {
  page: WikiPage;
  by: string;
  about: string;
}) {
  const summary = page.summary.trim();
  const lead = page.lead.trim();
  return (
    <div className="flex flex-col gap-5">
      {page.relation ? (
        <span className="-mt-1 self-start rounded-full bg-ui-surface px-2.5 py-0.5 text-xs font-bold text-ui-accent-ink">
          {page.relation}
        </span>
      ) : null}
      {summary && !lead.startsWith(summary) ? (
        <p className="text-[1.0625rem] leading-[1.55] font-bold text-pretty italic">
          <RichText text={`“${summary}”`} />
        </p>
      ) : null}
      {lead ? <Prose text={lead} /> : null}
      {page.theyThinkOfMe ? (
        <div className="flex flex-col gap-1 rounded-[1rem] bg-ui-surface px-3.5 py-3 shadow-[0_1px_0_var(--ui-line)]">
          <span className="text-xs font-extrabold text-ui-accent-ink">
            {`${by} guesses ${about} thinks`}
          </span>
          <span className="text-[0.9375rem] leading-relaxed italic">
            <RichText text={page.theyThinkOfMe} />
          </span>
        </div>
      ) : null}
      {page.openThreads.length ? (
        <div className="flex flex-col gap-1.5">
          <h3 className="text-xs font-extrabold text-ui-soft">Still open</h3>
          <ul className="flex list-disc flex-col gap-1 ps-5 text-[0.9375rem] leading-relaxed marker:text-ui-accent">
            {page.openThreads.map((thread) => (
              <li key={thread}>
                <RichText text={thread} />
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      {page.sections.map((section) => (
        <section
          key={section.title}
          aria-label={section.title}
          className="flex flex-col gap-1.5"
        >
          <h3 className="text-[0.9375rem] font-extrabold">{section.title}</h3>
          <Prose text={section.text} />
        </section>
      ))}
      {page.notes.length ? (
        <div className="flex flex-col gap-2">
          <h3 className="text-xs font-extrabold text-ui-soft">Notes</h3>
          <ol className="flex flex-col gap-3">
            {page.notes.map((note) => (
              <li
                key={`${note.date}${note.text}`}
                className="flex flex-col gap-0.5 border-s-2 border-ui-accent ps-3"
              >
                <span className="text-[0.9375rem] leading-relaxed">
                  <RichText text={note.text} />
                </span>
                <span className="text-xs text-ui-soft">
                  <span className="font-bold tabular-nums">{note.date}</span>
                  {" · "}
                  <NoteSource source={note.source} />
                  {note.certainty ? ` · ${note.certainty}` : null}
                </span>
              </li>
            ))}
          </ol>
        </div>
      ) : null}
    </div>
  );
}

function Column({
  label,
  face,
  tone,
  action,
  className,
  children,
}: {
  label: string;
  face: ReactNode;
  tone: "world" | "own";
  action?: ReactNode;
  className?: string;
  children: ReactNode;
}) {
  return (
    <section
      aria-label={label}
      className={cx(
        "flex min-w-0 flex-col gap-4",
        tone === "own" &&
          "rounded-[1.5rem] bg-ui-accent-tint p-5 max-md:p-4 [--ui-line:color-mix(in_oklch,var(--ui-accent)_25%,var(--ui-surface))]",
        className,
      )}
    >
      <div className="flex min-h-7.5 items-center gap-2">
        {face}
        <h2
          className={cx(
            "min-w-0 flex-1 truncate text-sm font-extrabold",
            tone === "own" ? "text-ui-accent-ink" : "text-ui-soft",
          )}
        >
          {label}
        </h2>
        {action}
      </div>
      {children}
    </section>
  );
}

/**
 * A page in one character's own wiki, beside the world's: what is true on one
 * side, what they make of it on the other, as notes in a margin. What they
 * don't know of the world's page is out of focus, so the gap shows. Either side
 * opens to be written while the other stays in view.
 */
export function TheirPage({ id, agent }: { id: string; agent: string }) {
  const read = useWikiPage(id, agent);
  const { byId } = useCharacters();
  const [params, setParams] = useQueryStates(wikiParsers);
  const { canManage } = useAccess();
  const refresh = useRefreshWiki();
  const viewer = byId.get(agent);
  const pageName = usePageName();
  const lookup = usePageLookup();
  const called = firstName(viewer?.name ?? pageName(agent));
  const world = read.data?.world;
  const own = read.data?.personal;
  const knowledge = read.data?.knowledge;
  const listed = lookup(id);
  const title =
    world?.name ?? own?.name ?? listed?.name ?? params["wiki.name"] ?? id;
  const about = firstName(title);
  const kind: WikiKind | undefined =
    params["wiki.kind"] ?? world?.kind ?? own?.kind;
  const raw = params["wiki.raw"] === "1";
  const editing: WikiSide | undefined = canManage
    ? (params["wiki.edit"] ?? undefined)
    : undefined;

  const edit = (side: WikiSide | null, asRaw = false) =>
    withTransition(
      () =>
        void setParams({
          "wiki.edit": side,
          "wiki.raw": side && asRaw ? "1" : null,
          ...(side ? {} : { "wiki.kind": null, "wiki.name": null }),
        }),
    );
  const done = (saved?: WikiSourceResponse) => {
    if (saved) void refresh();
    if (saved && saved.id !== id)
      void setParams(wikiPatch(saved.id, { agent }));
    else edit(null);
  };

  const editor = (side: WikiSide) => (
    <PageEditor
      key={`${id}:${side}:${raw ? "raw" : "form"}`}
      id={id}
      agent={side === "own" ? agent : undefined}
      kind={kind}
      name={title}
      side={side}
      owner={viewer?.name}
      raw={raw}
      compact
      onRaw={(on) =>
        withTransition(() => void setParams({ "wiki.raw": on ? "1" : null }))
      }
      onDone={done}
    />
  );

  const reader = knowledge
    ? { id: agent, name: called, depth: knowledge.depth }
    : undefined;

  const worldColumn = (
    <Column
      label="The world"
      tone="world"
      face={
        <span className="grid size-7 shrink-0 place-items-center rounded-full bg-ui-tint text-ui-primary [&_svg]:size-4">
          <GlobeIcon aria-hidden />
        </span>
      }
      action={
        world && canManage && editing !== "world" ? (
          <IconButton
            label="Edit the world's page"
            size="sm"
            onClick={() => edit("world")}
          >
            <PencilIcon aria-hidden />
          </IconButton>
        ) : null
      }
    >
      {editing === "world" ? (
        editor("world")
      ) : world ? (
        <PageArticle
          page={world}
          subject={world.kind === "person" ? id : undefined}
          subjectName={world.kind === "person" ? about : undefined}
          reader={reader}
        />
      ) : (
        <Note>Not in the World Wiki.</Note>
      )}
    </Column>
  );

  const ownColumn = (
    <Column
      label={`${called}'s notes`}
      tone="own"
      face={
        viewer ? (
          <CharacterAvatar
            id={viewer.id}
            name={viewer.name}
            avatarUrl={viewer.avatarUrl}
            kind={viewer.kind}
            size="sm"
            decorative
          />
        ) : null
      }
      action={
        <>
          {own && canManage && editing !== "own" ? (
            <>
              <IconButton
                label={`Edit ${called}'s notes`}
                size="sm"
                className="text-current"
                onClick={() => edit("own")}
              >
                <PencilIcon aria-hidden />
              </IconButton>
              <PageMenu
                id={id}
                name={`${called}'s page on ${title}`}
                agent={agent}
                kind={kind}
                onDeleted={() => void read.mutate()}
              />
            </>
          ) : null}
        </>
      }
      className="motion-safe:animate-ui-enter motion-safe:fill-mode-[both] motion-safe:[animation-delay:80ms]"
    >
      {editing === "own" ? (
        editor("own")
      ) : own ? (
        <TheirNotes page={own} by={called} about={about} />
      ) : (
        <Note
          action={
            canManage ? (
              <Button
                tone="soft"
                size="sm"
                icon={<PlusIcon aria-hidden />}
                onClick={() => edit("own")}
              >
                Write notes
              </Button>
            ) : undefined
          }
        >
          {`${called} keeps no page on ${about}.`}
        </Note>
      )}
    </Column>
  );

  return (
    <Sheet label={`${title}, as ${called} knows it`} wide>
      <PageHead
        eyebrow={
          <Eyebrow
            page={world ?? own ?? listed ?? { id, kind: kind ?? "concept" }}
            lead={
              <span className="inline-flex items-center gap-1.5 text-ui-accent-ink">
                {`In ${called}'s wiki`}
                <span aria-hidden>·</span>
              </span>
            }
          />
        }
        title={title}
        under={
          <div className="min-h-7">
            {knowledge ? (
              <KnowledgeLine knowledge={knowledge} called={called} />
            ) : null}
          </div>
        }
      />
      <PageProblems pages={[`${agent}/${id}`, `world/${id}`]} />
      {read.error ? (
        <Note>{"Couldn't read this page."}</Note>
      ) : read.isLoading ? null : (
        <div
          style={BODY_TRANSITION}
          className={cx(
            "grid items-start gap-5",
            editing === "own"
              ? "@min-[35rem]:grid-cols-2"
              : "@min-[35rem]:grid-cols-[minmax(0,1fr)_minmax(14rem,18rem)] @min-[52rem]:grid-cols-[minmax(0,1fr)_minmax(18rem,24rem)] @min-[52rem]:gap-6",
          )}
        >
          <div className="order-2 min-w-0 @min-[35rem]:order-1">
            {worldColumn}
          </div>
          <div className="order-1 min-w-0 @min-[35rem]:sticky @min-[35rem]:top-4 @min-[35rem]:order-2">
            {ownColumn}
          </div>
        </div>
      )}
    </Sheet>
  );
}

function KnowledgeLine({
  knowledge,
  called,
}: {
  knowledge: Knowledge;
  called: string;
}) {
  return (
    <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[0.8125rem] text-ui-soft">
      <span className="rounded-full bg-ui-accent-tint px-2.5 py-0.5 font-bold text-ui-accent-ink">
        {`${called} · ${DEPTH_WORD[knowledge.depth]}`}
      </span>
      {knowledge.why ? <span>{knowledge.why}</span> : null}
    </p>
  );
}
