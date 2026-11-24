"use client";

import {
  Accordion,
  AccordionHeader,
  AccordionItem,
  AccordionPanel,
  AccordionTrigger,
} from "@ui-sdk/react/accordion";
import {
  Meter,
  MeterIndicator,
  MeterLabel,
  MeterTrack,
} from "@ui-sdk/react/meter";
import {
  ChevronDownIcon,
  MapIcon,
  MapPinIcon,
  MessageCircleIcon,
  RouteIcon,
  UserRoundCheckIcon,
  XIcon,
} from "lucide-react";
import { parseAsString, useQueryStates } from "nuqs";
import type { ComponentType, ReactNode } from "react";
import { presenceState } from "@/components/entities/presence-avatar";
import {
  CharacterContextSection,
  CharacterContextSummary,
} from "@/components/inspector/sections/character-context";
import {
  CharacterModelSection,
  CharacterModelSummary,
} from "@/components/inspector/sections/character-model";
import {
  CharacterRecentSection,
  CharacterRecentSummary,
} from "@/components/inspector/sections/character-recent";
import {
  CharacterStatesSection,
  CharacterStatesSummary,
} from "@/components/inspector/sections/character-states";
import { Inspector } from "@/components/shell/inspector";
import { chatsParsers } from "@/components/views/chats/search-params";
import { useWorldNow } from "@/components/views/world/world-state";
import { useAccess } from "@/hooks/use-access";
import { useCharacterStatus, useCharacters } from "@/hooks/use-characters";
import { useDesireRecord } from "@/hooks/use-desires";
import { useRunsOnModel } from "@/hooks/use-models";
import { usePlay } from "@/hooks/use-play";
import { entityRefParser, type EntityRef } from "@/lib/state/entity-ref";
import { formatSimTime } from "@/lib/time/sim";
import { HaloFace } from "./halo-face";

const STATE_TEXT = {
  idle: "Awake",
  thinking: "Thinking",
  composing: "Typing",
  offstage: "Offstage",
  unknown: "Not simulated",
} as const;

/** Group ids arrive as `after_school_sweets_club`; people read names. */
function groupLabel(id: string): string {
  return id
    .split(/[_-]+/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

type Fold = {
  value: string;
  title: string;
  Section: ComponentType<{ entity: EntityRef }>;
  Summary: ComponentType<{ entity: EntityRef }>;
};

/**
 * One column, read top to bottom in the order a watcher asks: who is this,
 * what can I do, where are they and with whom, how do they feel. Everything
 * deeper folds into a single row with its key fact, so the column never
 * spends height on a section until you ask for it.
 */
export function HaloSheet({ id }: { id: string }) {
  const { byId } = useCharacters();
  const character = byId.get(id);
  const status = useCharacterStatus(character?.kind === "agent" ? id : undefined);
  const record = useDesireRecord(id);
  const { rooms, travelers } = useWorldNow();
  const { play, canAct, player } = usePlay();
  const { hasPermission } = useAccess();
  const runsOnModel = useRunsOnModel({ id });
  const [, setParams] = useQueryStates({
    view: parseAsString,
    sel: entityRefParser,
    "chats.id": chatsParsers["chats.id"],
    "chats.member": chatsParsers["chats.member"],
  });

  if (!character) return <Inspector />;

  const entity: EntityRef = { kind: "character", id };
  const state = presenceState(character.kind, status);
  const room = rooms.find((r) => r.members.some((m) => m.id === id));
  const traveling = travelers.some((m) => m.id === id);
  const company = room?.members.filter((m) => m.id !== id) ?? [];
  const firstName = character.name.split(/\s+/)[0];
  const played = Boolean(status?.playedBy);
  const levels = played ? [] : Object.entries(record?.levels ?? {});
  const task = status?.task;
  const canManage = hasPermission("manage") && runsOnModel;

  const folds: Fold[] = [
    { value: "states", title: "States", Section: CharacterStatesSection, Summary: CharacterStatesSummary },
    { value: "recent", title: "Recent", Section: CharacterRecentSection, Summary: CharacterRecentSummary },
    ...(canManage
      ? [
          { value: "model", title: "Model", Section: CharacterModelSection, Summary: CharacterModelSummary },
          {
            value: "context",
            title: "Memory and context",
            Section: CharacterContextSection,
            Summary: CharacterContextSummary,
          },
        ]
      : []),
  ];

  return (
    <article className="halo-sheet" aria-label={character.name}>
      <header className="halo-sheet-head">
        <HaloFace
          id={character.id}
          name={character.name}
          avatarUrl={character.avatarUrl}
          kind={character.kind}
          size="md"
        />
        <div className="halo-sheet-title">
          <h2 className="halo-sheet-name text-balance">{character.name}</h2>
          <p className="halo-sheet-status" data-state={state}>
            <span className="halo-dot" aria-hidden="true" />
            <span className="truncate">
              {STATE_TEXT[state]}
              {character.groups?.length ? ` · ${groupLabel(character.groups[0])}` : ""}
            </span>
          </p>
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

      <div className="halo-sheet-actions" role="group" aria-label={`Actions for ${firstName}`}>
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
          <IconAction label={`Play as ${firstName}`} onClick={() => void play(id)}>
            <UserRoundCheckIcon aria-hidden className="size-4" />
          </IconAction>
        ) : null}
        <IconAction label="Show on the map" onClick={() => void setParams({ view: "world" })}>
          <MapIcon aria-hidden className="size-4" />
        </IconAction>
      </div>

      <section className="halo-now" aria-label="Right now">
        <p className="halo-where">
          {traveling ? (
            <RouteIcon aria-hidden className="size-4" />
          ) : (
            <MapPinIcon aria-hidden className="size-4" />
          )}
          <span className="halo-where-text">
            <span className="halo-where-place">
              {traveling ? "On the way" : room ? room.label : "Somewhere unknown"}
            </span>
            {room?.area ? <span className="halo-where-area">{room.area}</span> : null}
          </span>
        </p>

        {company.length > 0 ? (
          <ul className="halo-company-list" aria-label="With them">
            {company.map((m) => (
              <li key={m.id}>
                <button
                  type="button"
                  className="halo-company-person"
                  title={m.name}
                  onClick={() => void setParams({ sel: { kind: "character", id: m.id } })}
                >
                  <HaloFace id={m.id} name={m.name} avatarUrl={m.avatarUrl} kind={m.kind} size="sm" />
                  <span>{m.name.split(/\s+/)[0]}</span>
                </button>
              </li>
            ))}
          </ul>
        ) : room ? (
          <p className="halo-block-note">Alone</p>
        ) : null}

        {task ? (
          <p className="halo-task">
            <span>{task.description}</span>
            <span className="halo-block-note">
              {`${formatSimTime(task.startedAt)} – ${formatSimTime(task.endAt)}`}
            </span>
          </p>
        ) : null}
      </section>

      {levels.length > 0 ? (
        <section className="halo-meters" aria-label="Desires">
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
              <MeterTrack className="halo-meter-track">
                <MeterIndicator className="halo-meter-fill" />
              </MeterTrack>
            </Meter>
          ))}
        </section>
      ) : null}

      {character.summary ? (
        <p className="halo-about text-pretty">{character.summary}</p>
      ) : null}

      <Accordion multiple className="halo-folds">
        {folds.map(({ value, title, Section, Summary }) => (
          <AccordionItem key={value} value={value} className="halo-fold">
            <AccordionHeader className="halo-fold-head">
              <AccordionTrigger className="halo-fold-trigger">
                <span className="halo-fold-title">{title}</span>
                <span className="halo-fold-summary">
                  <Summary entity={entity} />
                </span>
                <ChevronDownIcon aria-hidden className="halo-fold-chevron size-4" />
              </AccordionTrigger>
            </AccordionHeader>
            <AccordionPanel className="halo-fold-panel">
              <Section entity={entity} />
            </AccordionPanel>
          </AccordionItem>
        ))}
      </Accordion>
    </article>
  );
}

function IconAction({
  label,
  onClick,
  children,
}: {
  label: string;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      className="halo-action halo-action-icon"
      aria-label={label}
      title={label}
      onClick={onClick}
    >
      {children}
    </button>
  );
}
