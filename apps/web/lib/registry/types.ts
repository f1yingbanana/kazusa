import type { ComponentType, ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import type {
  Domain,
  JournalEventOf,
  JournalKind,
  StreamEventOf,
  StreamEventType,
} from "@kazusa/client";
import type { EntityKind, EntityRef } from "@/lib/state/entity-ref";
import type { LiveContext } from "@/lib/registry/live";

export interface StageView {
  readonly id: string;
  readonly label: string;
  readonly icon: LucideIcon;
  readonly order: number;
  readonly requires: readonly Domain[];
  /** Reads its own namespaced URL params (`tl.*`, `world.*`, `chats.*`). */
  readonly component: ComponentType;
}

export interface InspectorSection {
  readonly id: string;
  readonly entity: EntityKind;
  readonly title: string;
  readonly order: number;
  readonly requires: readonly Domain[];
  readonly component: ComponentType<{ readonly entity: EntityRef }>;
}

export interface StatusItem {
  readonly id: string;
  readonly side: "start" | "end";
  readonly order: number;
  readonly requires: readonly Domain[];
  readonly component: ComponentType;
}

export interface ThoughtLine {
  /** Character id the thought belongs to. */
  readonly by: string;
  readonly text: string;
  readonly confidence?: number;
}

export interface StageLink {
  readonly view: string;
  readonly params: Readonly<Record<string, string>>;
  readonly label: string;
}

export interface TimelineKind<K extends JournalKind = JournalKind> {
  readonly kind: K;
  readonly label: string;
  readonly icon: LucideIcon;
  readonly facet: "task" | "chat" | "world" | "social" | "mind";
  readonly salience: "low" | "normal" | "high";
  /** Actors shown as chips; defaults to `event.actors`. */
  readonly actors?: (event: JournalEventOf<K>) => readonly string[];
  readonly fact: (event: JournalEventOf<K>) => ReactNode;
  readonly thought?: (event: JournalEventOf<K>) => ThoughtLine | undefined;
  readonly collapseKey?: (event: JournalEventOf<K>) => string | undefined;
  readonly target?: (event: JournalEventOf<K>) => EntityRef | StageLink | undefined;
}

/** Applies one SSE event type to client state. */
export type LiveHandler<T extends StreamEventType> = (
  event: StreamEventOf<T>,
  ctx: LiveContext,
) => void;
