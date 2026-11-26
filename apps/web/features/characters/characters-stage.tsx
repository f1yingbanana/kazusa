"use client";

import type { CharacterSummary } from "@kazusa/client";
import { CheckIcon, HistoryIcon, PencilIcon } from "lucide-react";
import { parseAsString, useQueryStates } from "nuqs";
import { useEffect, useRef, useState } from "react";
import { useAccess } from "@/hooks/use-access";
import { useCharacters } from "@/hooks/use-characters";
import { useSelection } from "@/hooks/use-selection";
import { firstName } from "@/lib/format";
import { serializeEntityRef } from "@/lib/state/entity-ref";
import { markQuietSelection } from "@/lib/state/ui-store";
import { Button } from "@/ui/button";
import { Note } from "@/ui/note";
import { Tabs, TabsList, TabsPanel, TabsTab } from "@/ui/tabs";
import { wikiParsers } from "../wiki/search-params";
import { timelineParsers, timelinePatch } from "../timeline/search-params";
import { withTransition } from "../wiki/motion";
import { AboutTab } from "./about-tab";
import { clearGalleryFocus, rememberGalleryFocus } from "./cast";
import { Gallery } from "./gallery";
import { LooksTab } from "./looks-tab";
import { MemoryTab } from "./memory-tab";
import { PeopleTab } from "./people-tab";
import { CastNav, ProfileInfobox, ProfileTitle } from "./profile-header";
import {
  charactersParsers,
  PROFILE_TABS,
  type ProfileTab,
} from "./search-params";
import { StoryTab } from "./story-tab";

const LABEL: Record<ProfileTab, string> = {
  about: "About",
  story: "Story",
  people: "People",
  looks: "Looks",
  memory: "Memory",
};

/** The cast, or one of them: their card opens their profile. */
export function CharactersStage() {
  const [{ character: id }] = useQueryStates(charactersParsers);
  const { byId, isLoading } = useCharacters();
  useEffect(() => () => clearGalleryFocus(), []);
  const character = id ? byId.get(id) : undefined;
  if (!id) return <Gallery />;
  if (!character)
    return (
      <Note inset="panel">
        {isLoading ? "Finding them…" : `Nobody called “${id}” is in the cast.`}
      </Note>
    );
  return <Profile key={character.id} character={character} />;
}

/**
 * One person's page: the World Wiki's page on them, with what only a character
 * has. The title, then who the world says they are, what has happened to them,
 * who they know, how they look and what they remember, with their picture and
 * groups in a box beside the text. What they're doing now stays in the details
 * panel, as it does everywhere.
 */
function Profile({ character }: { character: CharacterSummary }) {
  const [, select] = useSelection();
  const { canManage } = useAccess();
  const [editing, setEditing] = useState<ProfileTab | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [params, setParams] = useQueryStates({
    ...charactersParsers,
    view: parseAsString,
    ...wikiParsers,
    "tl.actors": timelineParsers["tl.actors"],
    "tl.watch": timelineParsers["tl.watch"],
  });
  const agent = character.kind === "agent";
  const called = firstName(character.name);

  // The details panel follows whom you're reading about, without a drawer
  // opening over the page on a narrow screen.
  useEffect(() => {
    rememberGalleryFocus(character.id);
    const ref = { kind: "character", id: character.id } as const;
    markQuietSelection(serializeEntityRef(ref));
    void select(ref, { history: "replace" });
  }, [character.id, select]);

  const tabs = PROFILE_TABS.filter(
    (tab) => agent || (tab !== "story" && tab !== "memory"),
  );
  const asked = params["chars.tab"];
  const tab = asked && tabs.includes(asked) ? asked : tabs[0];
  const editingNow = canManage && editing === tab;
  const edit = (on: boolean) =>
    withTransition(() => setEditing(on ? tab : null));
  const editButton = editingNow ? (
    tab === "about" ? null : (
      <Button
        tone="primary"
        size="sm"
        icon={<CheckIcon aria-hidden />}
        onClick={() => edit(false)}
      >
        Done
      </Button>
    )
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

  const end =
    tab === "story" ? (
      <Button
        tone="ghost"
        size="sm"
        icon={<HistoryIcon aria-hidden />}
        onClick={() => void setParams(timelinePatch([character.id]))}
      >
        In Timeline
      </Button>
    ) : tab !== "people" && canManage ? (
      editButton
    ) : null;

  return (
    // A pixel in from the card's edge: its outline is an inset ring, which the
    // tabs, once stuck to the top, would otherwise paint over.
    <div
      ref={scrollRef}
      className="mt-px flex min-h-0 flex-col overflow-y-auto motion-safe:animate-ui-enter"
    >
      <div className="mx-auto flex w-full max-w-5xl min-w-0 flex-col">
        <div className="flex min-w-0 flex-col gap-3 px-8 pt-5 pb-2 max-lg:px-6 max-md:px-4 max-md:pt-4">
          <CastNav id={character.id} />
          <ProfileTitle character={character} />
        </div>
        <Tabs<ProfileTab>
          value={tab}
          onValueChange={(next) => {
            if (!next) return;
            if (scrollRef.current) scrollRef.current.scrollTop = 0;
            setEditing(null);
            void setParams(
              { "chars.tab": next === tabs[0] ? null : next },
              { history: "replace" },
            );
          }}
        >
          <TabsList
            label={`About ${called}`}
            end={end}
            className="sticky top-0 z-10 bg-ui-surface px-8 pt-2 max-lg:px-6 max-md:px-4"
          >
            {tabs.map((one) => (
              <TabsTab key={one} value={one}>
                {LABEL[one]}
              </TabsTab>
            ))}
          </TabsList>
          <div className="@container px-8 pt-6 pb-10 max-lg:px-6 max-md:px-4 max-md:pb-6">
            <div className="flex flex-col gap-6 @min-[46rem]:flex-row-reverse @min-[46rem]:items-start @min-[46rem]:gap-8">
              <ProfileInfobox
                hidden={editingNow && tab === "about"}
                character={character}
                className="@max-[46rem]:max-w-80 @min-[46rem]:sticky @min-[46rem]:top-16 @min-[46rem]:w-64 @min-[46rem]:shrink-0"
              />
              <div className="min-w-0 flex-1">
                <TabsPanel value="about">
                  <AboutTab
                    character={character}
                    editing={editingNow}
                    onDone={() => edit(false)}
                  />
                </TabsPanel>
                <TabsPanel value="story">
                  <StoryTab character={character} />
                </TabsPanel>
                <TabsPanel value="people">
                  <PeopleTab character={character} />
                </TabsPanel>
                <TabsPanel value="looks">
                  <LooksTab character={character} editing={editingNow} />
                </TabsPanel>
                <TabsPanel value="memory">
                  <MemoryTab character={character} editing={editingNow} />
                </TabsPanel>
              </div>
            </div>
          </div>
        </Tabs>
      </div>
    </div>
  );
}
