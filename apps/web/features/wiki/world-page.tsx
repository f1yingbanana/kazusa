"use client";

import type {
  WikiKind,
  WikiListItem,
  WikiSourceResponse,
} from "@kazusa/client";
import { CheckIcon, PencilIcon } from "lucide-react";
import { parseAsString, useQueryStates } from "nuqs";
import { type ReactNode, useEffect, useState } from "react";
import { useAccess } from "@/hooks/use-access";
import { isCast, useCharacters } from "@/hooks/use-characters";
import { useSelection } from "@/hooks/use-selection";
import { useWikiReach } from "@/hooks/use-wiki-editor";
import { usePageLookup, useWikiList, useWikiPage } from "@/hooks/use-wiki";
import { serializeEntityRef } from "@/lib/state/entity-ref";
import { markQuietSelection } from "@/lib/state/ui-store";
import { isOwnSection } from "@/lib/wiki/layers";
import { Button } from "@/ui/button";
import { cx } from "@/ui/cx";
import { Note } from "@/ui/note";
import { Tabs, TabsList, TabsPanel, TabsTab } from "@/ui/tabs";
import { LooksTab } from "../characters/looks-tab";
import { MemoryTab } from "../characters/memory-tab";
import { PeopleTab } from "../characters/people-tab";
import { PageArticle } from "./article";
import { BackdropPanel } from "./backdrop";
import { NewPageDialog } from "./new-page-dialog";
import { PageEditor } from "./page-editor";
import { PageDetails, PageFacts } from "./page-facts";
import { Eyebrow, PageHead, PageProblems, Sheet } from "./page-header";
import { PageMenu } from "./page-menu";
import { withTransition, BODY_TRANSITION } from "./motion";
import { wikiPatch } from "./open";
import { ReachLine } from "./reach";
import { useRefreshWiki } from "./refresh";
import { wikiParsers, type PagePart } from "./search-params";
import { CastNotes, WhoKnows } from "./who-knows";

const PART_LABEL: Readonly<Record<PagePart, string>> = {
  page: "Page",
  people: "People",
  looks: "Looks",
  memory: "Memory",
  backdrop: "Backdrop",
};

/**
 * A World Wiki page, read or written in place. Reading, it is an article with
 * the box of facts beside it, under a line of tabs that also holds what can be
 * done to it; a character of the cast also shows their Relationships, Looks and
 * Memory, and a place has its backdrop. Writing, the same page becomes its
 * form. The head comes from the index at once, so opening a page never flashes
 * a loading line.
 */
export function WorldPage({
  id,
  castNav,
}: {
  id: string;
  /**
   * Navigation back to the cast and between cast members, when opened from
   * Characters.
   */
  castNav?: ReactNode;
}) {
  const read = useWikiPage(id);
  const { data: reach } = useWikiReach(id);
  const [params, setParams] = useQueryStates({
    ...wikiParsers,
    character: parseAsString,
    "chars.look": parseAsString,
    view: parseAsString,
  });
  const { canManage } = useAccess();
  const { byId } = useCharacters();
  const lookup = usePageLookup();
  const { data: list } = useWikiList();
  const [, select] = useSelection();
  const refresh = useRefreshWiki();
  const [creating, setCreating] = useState(false);
  const character = byId.get(id);
  const cast = isCast(character) ? character : undefined;
  const listed = lookup(id);
  const page = read.data?.world;
  const editing = canManage && params["wiki.edit"] === "world";
  const raw = params["wiki.raw"] === "1";
  const name =
    page?.name ?? listed?.name ?? params["wiki.name"] ?? character?.name ?? id;
  const kind: WikiKind | undefined =
    page?.kind ??
    listed?.kind ??
    params["wiki.kind"] ??
    (character ? "person" : undefined);
  const head:
    Pick<WikiListItem, "id" | "kind" | "place" | "group"> | undefined =
    page ?? listed ?? (kind ? { id, kind } : undefined);

  // The details panel follows what the page is about, without opening over it.
  const subject = head?.place ? "place" : character ? "character" : undefined;
  useEffect(() => {
    if (!subject) return;
    const ref = { kind: subject, id } as const;
    markQuietSelection(serializeEntityRef(ref));
    void select(ref, { history: "replace" });
  }, [id, subject, select]);

  const edit = (on: boolean, asRaw = false) =>
    withTransition(
      () =>
        void setParams({
          "wiki.edit": on ? "world" : null,
          "wiki.raw": on && asRaw ? "1" : null,
          ...(on ? {} : { "wiki.kind": null, "wiki.name": null }),
        }),
    );
  const done = (saved?: WikiSourceResponse) => {
    if (saved) void refresh();
    if (saved && saved.id !== id) void setParams(wikiPatch(saved.id));
    else edit(false);
  };

  const parts: PagePart[] = [
    "page",
    "people",
    ...(cast
      ? ([
          "looks",
          ...(cast.kind === "agent" ? (["memory"] as const) : []),
        ] as const)
      : []),
    ...(head?.place ? (["backdrop"] as const) : []),
  ];
  const part: PagePart =
    params["wiki.part"] && parts.includes(params["wiki.part"])
      ? params["wiki.part"]
      : "page";

  if (editing && part === "page")
    return (
      <Sheet label={`Editing ${name}`}>
        <PageEditor
          key={`${id}:world:${raw ? "raw" : "form"}`}
          id={id}
          kind={kind}
          name={name}
          side="world"
          raw={raw}
          onRaw={(on) =>
            withTransition(
              () => void setParams({ "wiki.raw": on ? "1" : null }),
            )
          }
          onDone={done}
        />
      </Sheet>
    );

  const hasOwn = Boolean(page?.sections.some((s) => isOwnSection(s, id)));

  const editButton = editing ? (
    <Button
      tone="primary"
      size="sm"
      icon={<CheckIcon aria-hidden />}
      onClick={() => edit(false)}
    >
      Done
    </Button>
  ) : (
    <Button
      tone="ghost"
      size="sm"
      icon={<PencilIcon aria-hidden />}
      onClick={() => edit(true)}
    >
      Edit
    </Button>
  );

  const actions = (
    <>
      {part === "looks" || part === "memory"
        ? canManage
          ? editButton
          : null
        : part === "backdrop"
          ? canManage && !editing
            ? editButton
            : null
          : part === "page" && canManage && page && !editing
            ? editButton
            : null}
      {page ? (
        <PageMenu
          id={id}
          name={name}
          kind={kind}
          place={page.place === true}
          onNewInside={page.place ? () => setCreating(true) : undefined}
          onDeleted={() => {
            void select(null);
            if (params.view === "characters") {
              void setParams({
                character: null,
                "wiki.part": null,
                "wiki.edit": null,
                "wiki.raw": null,
                "chars.look": null,
              });
            } else {
              void setParams(wikiPatch(null));
            }
          }}
        />
      ) : null}
    </>
  );

  const body = read.isLoading ? null : read.error ? (
    <Note>{"Couldn't read this page."}</Note>
  ) : page ? (
    <PageArticle
      page={page}
      subject={page.kind === "person" ? id : undefined}
      reach={reach}
    />
  ) : (
    <Note
      action={
        canManage ? (
          <Button
            tone="primary"
            size="sm"
            icon={<PencilIcon aria-hidden />}
            onClick={() => edit(true)}
          >
            Write it
          </Button>
        ) : undefined
      }
    >
      Nothing written yet.
    </Note>
  );

  const showFacts = Boolean(page || (cast && !read.isLoading));

  return (
    <Sheet label={name}>
      {castNav}
      <PageHead
        eyebrow={head ? <Eyebrow page={head} /> : null}
        title={name}
        under={
          page && reach ? (
            <ReachLine page={page} reach={reach} hasOwn={hasOwn} />
          ) : page || read.isLoading ? (
            <div className="min-h-7" />
          ) : null
        }
      />
      <Tabs<PagePart>
        value={part}
        className="-mt-4"
        onValueChange={(next) =>
          next &&
          void setParams(
            {
              "wiki.part": next === "page" ? null : next,
              "wiki.edit": null,
              "wiki.raw": null,
            },
            { history: "replace" },
          )
        }
      >
        <TabsList
          label={`Parts of ${name}`}
          end={actions}
          className="sticky top-0 z-10 -mx-8 bg-ui-surface px-8 pt-2 max-lg:-mx-6 max-lg:px-6 max-md:-mx-4 max-md:px-4"
        >
          {parts.map((one) => (
            <TabsTab key={one} value={one}>
              {one === "people" && cast ? "Relationships" : PART_LABEL[one]}
            </TabsTab>
          ))}
        </TabsList>
        <div
          style={BODY_TRANSITION}
          className={cx(
            "grid items-start gap-6 pt-6 motion-safe:animate-ui-enter @min-[34rem]:grid-cols-[minmax(0,1fr)_14rem] @min-[48rem]:grid-cols-[minmax(0,40rem)_16rem] @min-[48rem]:gap-10",
            part === "backdrop" && "hidden",
          )}
        >
          <div className="min-w-0">
            <TabsPanel value="page">
              <div className="flex flex-col gap-6">
                <PageProblems pages={[`world/${id}`]} />
                {body}
                {page ? <PageDetails page={page} reach={reach} /> : null}
              </div>
            </TabsPanel>
            {cast ? (
              <>
                <TabsPanel value="people">
                  <PeopleTab character={cast} />
                </TabsPanel>
                <TabsPanel value="looks">
                  <LooksTab character={cast} editing={editing} />
                </TabsPanel>
                {cast.kind === "agent" ? (
                  <TabsPanel value="memory">
                    <MemoryTab character={cast} editing={editing} />
                  </TabsPanel>
                ) : null}
              </>
            ) : (
              <TabsPanel value="people">
                <div className="flex flex-col gap-8">
                  <CastNotes id={id} />
                  <WhoKnows id={id} />
                </div>
              </TabsPanel>
            )}
          </div>
          {showFacts ? (
            <PageFacts
              page={page}
              fallback={{ id, name, kind }}
              reach={reach}
              className="@max-[34rem]:max-w-80 @min-[34rem]:sticky @min-[34rem]:top-16"
            />
          ) : null}
        </div>
        {parts.includes("backdrop") ? (
          <TabsPanel value="backdrop" className="pt-6">
            <BackdropPanel
              id={id}
              editing={editing}
              onDone={() => edit(false)}
            />
          </TabsPanel>
        ) : null}
      </Tabs>
      {canManage ? (
        <NewPageDialog
          open={creating}
          onOpenChange={setCreating}
          existing={new Set((list?.pages ?? []).map((one) => one.id))}
          preset={{ kind: "place", parent: id }}
          onCreated={(created) =>
            void setParams(
              wikiPatch(created.id, {
                edit: "world",
                kind: created.kind,
                name: created.name,
              }),
            )
          }
        />
      ) : null}
    </Sheet>
  );
}
