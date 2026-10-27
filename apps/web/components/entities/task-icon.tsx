import {
  BookOpenIcon,
  CircleDotIcon,
  CoffeeIcon,
  CookingPotIcon,
  FootprintsIcon,
  GraduationCapIcon,
  HammerIcon,
  MessagesSquareIcon,
  MoonIcon,
  PenLineIcon,
  UtensilsIcon,
  type LucideIcon,
} from 'lucide-react'

/*
 * Presentation only: `task.type` is a structured tool argument, so mapping it
 * to an icon is fine. It must never drive state (e.g. "asleep"), per D7.
 */
const TASK_ICONS: Record<string, LucideIcon> = {
  read: BookOpenIcon,
  work: HammerIcon,
  eat: UtensilsIcon,
  walk: FootprintsIcon,
  study: GraduationCapIcon,
  talk: MessagesSquareIcon,
  rest: CoffeeIcon,
  cook: CookingPotIcon,
  write: PenLineIcon,
  sleep: MoonIcon,
}

export function taskIcon(type: string | undefined): LucideIcon {
  return (type && TASK_ICONS[type]) || CircleDotIcon
}
