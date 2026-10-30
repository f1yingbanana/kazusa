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

export interface SectionSidebarProps {
  /** Called after the sidebar navigated or selected, so a sheet can close. */
  readonly onNavigated?: () => void;
}

/**
 * A section of the app: one rail icon, one sidebar, one stage. The sidebar
 * narrows what the stage shows; it never belongs to another section.
 */
export interface StageView {
  readonly id: string;
  readonly label: string;
  readonly icon: LucideIcon;
  readonly order: number;
  readonly requires: readonly Domain[];
  /** Reads its own namespaced URL params (`tl.*`, `world.*`, `chats.*`). */
  readonly component: ComponentType;
  readonly sidebar?: ComponentType<SectionSidebarProps>;
  /** Small count on the rail icon (e.g. unread). Renders nothing when zero. */
  readonly badge?: ComponentType;
  /**
   * `end` pins the icon to the bottom of the rail with the app's own tools
   * (Settings), apart from the world's sections. Defaults to `start`.
   */
  readonly placement?: "start" | "end";
}

export interface InspectorSection {
  readonly id: string;
  readonly entity: EntityKind;
  readonly title: string;
  readonly order: number;
  readonly requires: readonly Domain[];
  readonly component: ComponentType<{ readonly entity: EntityRef }>;
  /**
   * A hook narrowing the section to some entities of its kind (only live
   * agents have a model). Always the same hook for a section, so it is called
   * unconditionally. Defaults to every entity.
   */
  readonly useApplies?: (entity: EntityRef) => boolean;
}

/** One page of the Settings section, listed in its sidebar. */
export interface SettingsCategory {
  readonly id: string;
  readonly label: string;
  readonly description: string;
  readonly icon: LucideIcon;
  readonly order: number;
  readonly component: ComponentType;
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
  /**
   * Left out of the default Timeline filter and the inspector's Recent. Still
   * one checkbox away in the Timeline sidebar.
   */
  readonly hiddenByDefault?: boolean;
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
