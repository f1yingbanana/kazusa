"use client";

import type { WikiKind, WikiSourceResponse } from "@kazusa/client";
import { PencilIcon } from "lucide-react";
import { parseAsString, useQueryStates } from "nuqs";
import { useEffect } from "react";
import { useSWRConfig } from "swr";
import { useAccess } from "@/hooks/use-access";
import { isCast, useCharacters } from "@/hooks/use-characters";
import { useSelection } from "@/hooks/use-selection";
import { useWikiReach } from "@/hooks/use-wiki-editor";
import { useWikiPage } from "@/hooks/use-wiki";
import { serializeEntityRef } from "@/lib/state/entity-ref";
import { markQuietSelection } from "@/lib/state/ui-store";
import { isOwnSection } from "@/lib/wiki/layers";
import { Button } from "@/ui/button";
import { Note } from "@/ui/note";
import { Tabs, TabsList, TabsPanel, TabsTab } from "@/ui/tabs";
import { charactersParsers, profilePatch } from "../characters/search-params";
import { PageArticle } from "./article";
import { BackdropPanel } from "./backdrop";
import { PageEditor } from "./page-editor";
import { PageFacts } from "./page-facts";
import { Eyebrow, PageHead, Sheet } from "./page-header";
import { PageMenu } from "./page-menu";
import { withTransition, BODY_TRANSITION } from "./motion";
import { wikiPatch } from "./open";
import { ReachLine } from "./reach";
import { wikiParsers, type PagePart } from "./search-params";

/** After a save, every wiki read again, the index's included. */
export function useRefreshWiki() {
  const { mutate } = useSWRConfig();
  return () =>
    mutate(
      (key) => Array.isArray(key) && String(key[0]).startsWith("kazusa/wiki"),
    );
}

/**
 * A World Wiki page, read or written in place. Reading, it is an article with
 * the box of facts beside it; a place has its backdrop as a second part.
 * Writing, the same page becomes its form: the title glides into its field. One
 * of the cast lives in Characters, and opens there.
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
  const [, select] = useSelection();
  const refresh = useRefreshWiki();
  const character = byId.get(id);
  const cast = isCast(character);
  const page = read.data?.world;
  const editing = canManage && params["wiki.edit"] === "world";
  const raw = params["wiki.raw"] === "1";
  const name = page?.name ?? params["wiki.name"] ?? character?.name ?? id;
  const kind: WikiKind | undefined =
    page?.kind ?? params["wiki.kind"] ?? (character ? "person" : undefined);

  useEffect(() => {
    if (cast) void setParams({ ...wikiPatch(null), ...profilePatch(id) });
  }, [cast, id, setParams]);

  // The details panel follows what the page is about, without opening over it.
  const subject = page?.place ? "place" : character ? "character" : undefined;
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

  if (cast) return null;
  if (read.isLoading) return <Note inset="panel">Opening the page…</Note>;
  if (read.error)
    return <Note inset="panel">{"Couldn't read this page."}</Note>;

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

  const parts: PagePart[] = page?.place ? ["page", "backdrop"] : ["page"];
  const part: PagePart =
    params["wiki.part"] && parts.includes(params["wiki.part"])
      ? params["wiki.part"]
      : "page";
  const hasOwn = Boolean(page?.sections.some((s) => isOwnSection(s, id)));

  const actions = page ? (
    <>
      {canManage && part === "page" ? (
        <Button
          tone="soft"
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
        onDeleted={() => {
          void select(null);
          void setParams(wikiPatch(null));
        }}
      />
    </>
  ) : null;

  const body = page ? (
    <div
      style={BODY_TRANSITION}
      className="flex flex-col-reverse gap-8 @min-[46rem]:flex-row-reverse @min-[46rem]:items-start @min-[46rem]:gap-10"
    >
      <PageFacts
        page={page}
        reach={reach}
        className="motion-safe:animate-ui-enter motion-safe:fill-mode-[both] motion-safe:[animation-delay:90ms] @max-[46rem]:max-w-80 @min-[46rem]:sticky @min-[46rem]:top-4 @min-[46rem]:w-64 @min-[46rem]:shrink-0"
      />
      <div className="max-w-160 min-w-0 flex-1">
        <PageArticle
          page={page}
          subject={page.kind === "person" ? id : undefined}
          reach={reach}
        />
      </div>
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
      {`Nothing is written about ${name} yet.`}
    </Note>
  );

  return (
    <Sheet label={name}>
      <PageHead
        eyebrow={
          page ? (
            <Eyebrow page={page} />
          ) : kind ? (
            <Eyebrow page={{ id, kind }} />
          ) : null
        }
        title={name}
        aliases={page?.aliases.filter((alias) => alias !== name)}
        actions={actions}
        under={
          page && reach ? (
            <ReachLine page={page} reach={reach} hasOwn={hasOwn} />
          ) : null
        }
      />
      {parts.length > 1 ? (
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
          <TabsList label={`Parts of ${name}`}>
            <TabsTab value="page">Page</TabsTab>
            <TabsTab value="backdrop">Backdrop</TabsTab>
          </TabsList>
          <TabsPanel value="page" className="pt-6">
            {body}
          </TabsPanel>
          <TabsPanel value="backdrop" className="pt-6">
            <BackdropPanel id={id} />
          </TabsPanel>
        </Tabs>
      ) : (
        body
      )}
    </Sheet>
  );
}
