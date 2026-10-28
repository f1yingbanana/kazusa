import {
  BriefcaseIcon,
  CircleDotIcon,
  FootprintsIcon,
  GraduationCapIcon,
  MessagesSquareIcon,
  MoonIcon,
  SparklesIcon,
  UtensilsIcon,
  type LucideIcon,
} from 'lucide-react'

/*
 * Presentation only: `task.type` is the category the character picked from
 * Taskman's configured list (`taskman.categories`), so mapping it to an icon
 * is fine. It must never drive state (e.g. "asleep"), per D7. Worlds with
 * custom categories fall back to a neutral dot.
 */
const TASK_ICONS: Record<string, LucideIcon> = {
  sleeping: MoonIcon,
  traveling: FootprintsIcon,
  eating: UtensilsIcon,
  studying: GraduationCapIcon,
  working: BriefcaseIcon,
  socializing: MessagesSquareIcon,
  'having fun': SparklesIcon,
  miscellaneous: CircleDotIcon,
}

export function taskIcon(type: string | undefined): LucideIcon {
  return (type && TASK_ICONS[type]) || CircleDotIcon
}

/** `having fun` → `Having fun`. Categories are freeform per world. */
export function taskLabel(type: string) {
  return type.charAt(0).toUpperCase() + type.slice(1)
}
