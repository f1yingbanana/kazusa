"use client";

import type {
  WikiKind,
  WikiListItem,
  WikiSourceResponse,
} from "@kazusa/client";
import { PencilIcon } from "lucide-react";
import { parseAsString, useQueryStates } from "nuqs";
import { useEffect, useState } from "react";
import { useAccess } from "@/hooks/use-access";
import { useCharacters } from "@/hooks/use-characters";
import { useSelection } from "@/hooks/use-selection";
import { useWikiReach } from "@/hooks/use-wiki-editor";
import { usePageLookup, useWikiList, useWikiPage } from "@/hooks/use-wiki";
import { serializeEntityRef } from "@/lib/state/entity-ref";
import { markQuietSelection } from "@/lib/state/ui-store";
import { isOwnSection } from "@/lib/wiki/layers";
import { Button } from "@/ui/button";
import { Note } from "@/ui/note";
import { Tabs, TabsList, TabsPanel, TabsTab } from "@/ui/tabs";
import { charactersParsers } from "../characters/search-params";
import { PageArticle } from "./article";
import { BackdropPanel } from "./backdrop";
import { NewPageDialog } from "./new-page-dialog";
import { PageEditor } from "./page-editor";
import { PageFacts } from "./page-facts";
import { Eyebrow, PageHead, Sheet } from "./page-header";
import { PageMenu } from "./page-menu";
import { withTransition, BODY_TRANSITION } from "./motion";
import { wikiPatch } from "./open";
import { ReachLine } from "./reach";
import { useRefreshWiki } from "./refresh";
import { wikiParsers, type PagePart } from "./search-params";

/**
 * A World Wiki page, read or written in place. Reading, it is an article with
 * the box of facts beside it, under a line of tabs that also holds what can be
 * done to it; a place has its backdrop as a second tab. Writing, the same page
 * becomes its form. The head comes from the index at once, so opening a page
 * never flashes a loading line.
 */
export function WorldPage({ id }: { id: string }) {
  const read = useWikiPage(id);
  const { data: reach } = useWikiReach(id);
  const [params, setParams] = useQueryStates({
    ...wikiParsers,
    ...charactersParsers,
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

  if (editing)
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

  const parts: PagePart[] = head?.place ? ["page", "backdrop"] : ["page"];
  const part: PagePart =
    params["wiki.part"] && parts.includes(params["wiki.part"])
      ? params["wiki.part"]
      : "page";
  const hasOwn = Boolean(page?.sections.some((s) => isOwnSection(s, id)));

  const actions = page ? (
    <>
      {canManage && part === "page" ? (
        <Button
          tone="ghost"
          size="sm"
          icon={<PencilIcon aria-hidden />}
          onClick={() => edit(true)}
        >
          Edit
        </Button>
      ) : null}
      <PageMenu
        id={id}
        name={name}
        kind={kind}
        place={page.place === true}
        onRaw={() => edit(true, true)}
        onNewInside={page.place ? () => setCreating(true) : undefined}
        onDeleted={() => {
          void select(null);
          void setParams(wikiPatch(null));
        }}
      />
    </>
  ) : null;

  const body = read.isLoading ? null : read.error ? (
    <Note>{"Couldn't read this page."}</Note>
  ) : page ? (
    <div
      style={BODY_TRANSITION}
      className="grid items-start gap-8 motion-safe:animate-ui-enter @min-[46rem]:grid-cols-[minmax(0,40rem)_16rem] @min-[46rem]:gap-10"
    >
      <div className="min-w-0">
        <PageArticle
          page={page}
          subject={page.kind === "person" ? id : undefined}
          reach={reach}
        />
      </div>
      <PageFacts
        page={page}
        reach={reach}
        className="@max-[46rem]:max-w-80 @min-[46rem]:sticky @min-[46rem]:top-4"
      />
    </div>
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

  return (
    <Sheet label={name}>
      <PageHead
        eyebrow={head ? <Eyebrow page={head} /> : null}
        title={name}
        aliases={(page ?? listed)?.aliases.filter((alias) => alias !== name)}
        under={
          <div className="min-h-7">
            {page && reach ? (
              <ReachLine page={page} reach={reach} hasOwn={hasOwn} />
            ) : null}
          </div>
        }
      />
      <Tabs<PagePart>
        value={part}
        onValueChange={(next) =>
          next &&
          void setParams(
            { "wiki.part": next === "page" ? null : next },
            { history: "replace" },
          )
        }
      >
        <TabsList label={`Parts of ${name}`} end={actions}>
          <TabsTab value="page">Page</TabsTab>
          {parts.includes("backdrop") ? (
            <TabsTab value="backdrop">Backdrop</TabsTab>
          ) : null}
        </TabsList>
        <TabsPanel value="page" className="pt-6">
          {body}
        </TabsPanel>
        {parts.includes("backdrop") ? (
          <TabsPanel value="backdrop" className="pt-6">
            <BackdropPanel id={id} />
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
