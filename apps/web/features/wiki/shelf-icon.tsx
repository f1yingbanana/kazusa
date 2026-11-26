import {
  CalendarIcon,
  MapPinIcon,
  ShapesIcon,
  UserRoundIcon,
  UsersRoundIcon,
} from "lucide-react";
import type { ReactNode } from "react";
import type { Shelf } from "@/lib/wiki/index-tree";

export const SHELF_ICON: Readonly<Record<Shelf, ReactNode>> = {
  places: <MapPinIcon aria-hidden />,
  people: <UserRoundIcon aria-hidden />,
  groups: <UsersRoundIcon aria-hidden />,
  concepts: <ShapesIcon aria-hidden />,
  days: <CalendarIcon aria-hidden />,
};
