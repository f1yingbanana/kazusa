"use client";

import {
  Meter,
  MeterIndicator,
  MeterLabel,
  MeterTrack,
  MeterValue,
} from "@ui-sdk/react/meter";
import {
  Tabs,
  TabsIndicator,
  TabsList,
  TabsPanel,
  TabsTab,
} from "@ui-sdk/react/tabs";
import {
  MapIcon,
  MapPinIcon,
  MessageCircleIcon,
  RouteIcon,
  UserRoundCheckIcon,
  XIcon,
} from "lucide-react";
import { parseAsString, useQueryStates } from "nuqs";
import { presenceState } from "@/components/entities/presence-avatar";
import { Inspector } from "@/components/shell/inspector";
import { chatsParsers } from "@/components/views/chats/search-params";
import { useWorldNow } from "@/components/views/world/world-state";
import { useCharacterStatus, useCharacters } from "@/hooks/use-characters";
import { useDesireRecord } from "@/hooks/use-desires";
import { usePlay } from "@/hooks/use-play";
import { entityRefParser } from "@/lib/state/entity-ref";
import { formatSimTime } from "@/lib/time/sim";
import { HaloFace } from "./halo-face";

const STATE_TEXT = {
  idle: "Awake",
  thinking: "Thinking",
  composing: "Typing",
  offstage: "Offstage",
  unknown: "Not simulated",
} as const;

/**
 * What you want to know about someone at a glance (where, with whom, doing
 * what, how they feel) and what you can do with them, with the full record
 * one tab away.
 */
export function HaloSheet({ id }: { id: string }) {
  const { byId } = useCharacters();
  const character = byId.get(id);
  const status = useCharacterStatus(character?.kind === "agent" ? id : undefined);
  const record = useDesireRecord(id);
  const { rooms, travelers } = useWorldNow();
  const { play, canAct, player } = usePlay();
  const [, setParams] = useQueryStates({
    view: parseAsString,
    sel: entityRefParser,
    "chats.id": chatsParsers["chats.id"],
    "chats.member": chatsParsers["chats.member"],
  });

  if (!character) return <Inspector />;

  const state = presenceState(character.kind, status);
  const room = rooms.find((r) => r.members.some((m) => m.id === id));
  const traveling = travelers.some((m) => m.id === id);
  const company = room?.members.filter((m) => m.id !== id) ?? [];
  const firstName = character.name.split(/\s+/)[0];
  const levels = Object.entries(record?.levels ?? {});
  const task = status?.task;

  return (
    <article className="halo-sheet" aria-label={character.name}>
      <header className="halo-sheet-head">
        <HaloFace
          id={character.id}
          name={character.name}
          avatarUrl={character.avatarUrl}
          kind={character.kind}
          size="lg"
        />
        <div className="halo-sheet-title">
          <h2 className="halo-sheet-name text-balance">{character.name}</h2>
          {character.groups?.length ? (
            <p className="halo-sheet-groups">{character.groups.join(" · ")}</p>
          ) : null}
        </div>
        <button
          type="button"
          className="halo-icon-button halo-sheet-close"
          aria-label="Close"
          onClick={() => void setParams({ sel: null })}
        >
          <XIcon aria-hidden className="size-4" />
        </button>
      </header>

      <p className="halo-sheet-status" data-state={state}>
        <span className="halo-dot" aria-hidden="true" />
        <span>
          {STATE_TEXT[state]}
          {task ? ` · ${task.description}` : ""}
        </span>
      </p>

      <div className="halo-sheet-actions">
        <button
          type="button"
          className="halo-action"
          data-primary=""
          onClick={() =>
            void setParams({ view: "chats", "chats.id": null, "chats.member": id })
          }
        >
          <MessageCircleIcon aria-hidden className="size-4" />
          {canAct ? "Message" : "Their chats"}
        </button>
        {play && player.id !== id && character.kind === "agent" ? (
          <button type="button" className="halo-action" onClick={() => void play(id)}>
            <UserRoundCheckIcon aria-hidden className="size-4" />
            {`Play as ${firstName}`}
          </button>
        ) : null}
        <button
          type="button"
          className="halo-action"
          onClick={() => void setParams({ view: "world" })}
        >
          <MapIcon aria-hidden className="size-4" />
          On the map
        </button>
      </div>

      <Tabs defaultValue="now" className="halo-tabs">
        <TabsList className="halo-tabs-list" aria-label={`About ${firstName}`}>
          <TabsIndicator className="halo-tabs-indicator" />
          <TabsTab value="now" className="halo-tab">Right now</TabsTab>
          <TabsTab value="all" className="halo-tab">Everything</TabsTab>
        </TabsList>

        <TabsPanel value="now" className="halo-tabs-panel">
          <section className="halo-card-block" aria-label="Where">
            <p className="halo-where">
              {traveling ? (
                <RouteIcon aria-hidden className="size-4" />
              ) : (
                <MapPinIcon aria-hidden className="size-4" />
              )}
              <span>
                <span className="halo-where-place">
                  {traveling ? "On the way somewhere" : room ? room.label : "Somewhere unknown"}
                </span>
                {room?.area ? <span className="halo-where-area">{room.area}</span> : null}
              </span>
            </p>
            {company.length > 0 ? (
              <div className="halo-company">
                <span className="halo-block-label">With</span>
                <ul className="halo-company-list">
                  {company.map((m) => (
                    <li key={m.id}>
                      <button
                        type="button"
                        className="halo-company-person"
                        onClick={() =>
                          void setParams({ sel: { kind: "character", id: m.id } })
                        }
                      >
                        <HaloFace id={m.id} name={m.name} avatarUrl={m.avatarUrl} kind={m.kind} size="sm" />
                        <span>{m.name.split(/\s+/)[0]}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            ) : room ? (
              <p className="halo-block-note">Alone here.</p>
            ) : null}
          </section>

          {task ? (
            <section className="halo-card-block" aria-label="Doing">
              <span className="halo-block-label">Doing</span>
              <p className="halo-task">{task.description}</p>
              <p className="halo-block-note">
                {`Since ${formatSimTime(task.startedAt)}, until about ${formatSimTime(task.endAt)}`}
              </p>
            </section>
          ) : null}

          {levels.length > 0 ? (
            <section className="halo-card-block" aria-label="How they feel">
              <span className="halo-block-label">How they feel</span>
              <div className="halo-meters">
                {levels.map(([name, level]) => (
                  <Meter
                    key={name}
                    value={Math.round(level)}
                    min={0}
                    max={100}
                    className="halo-meter"
                    data-low={level < 30 ? "" : undefined}
                  >
                    <MeterLabel className="halo-meter-label">
                      {name.charAt(0).toUpperCase() + name.slice(1)}
                    </MeterLabel>
                    <MeterValue className="halo-meter-value" />
                    <MeterTrack className="halo-meter-track">
                      <MeterIndicator className="halo-meter-fill" />
                    </MeterTrack>
                  </Meter>
                ))}
              </div>
            </section>
          ) : null}

          {character.summary ? (
            <section className="halo-card-block" aria-label="About">
              <span className="halo-block-label">About</span>
              <p className="halo-about text-pretty">{character.summary}</p>
            </section>
          ) : null}
        </TabsPanel>

        <TabsPanel value="all" className="halo-tabs-panel halo-tabs-panel-full">
          <Inspector />
        </TabsPanel>
      </Tabs>
    </article>
  );
}
