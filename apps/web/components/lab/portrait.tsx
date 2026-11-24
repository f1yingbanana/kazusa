import { Avatar, AvatarFallback, AvatarImage } from "@ui-sdk/react/avatar";
import type { Character } from "./data";

type PortraitProps = {
  character: Character;
  size?: "sm" | "md" | "lg";
  decorative?: boolean;
};

function initials(name: string) {
  return name
    .split(" ")
    .map((part) => part[0])
    .join("");
}

export function Portrait({ character, size = "md", decorative = false }: PortraitProps) {
  return (
    <span className="lab-portrait" data-size={size} data-awake={character.awake || undefined}>
      <span className="lab-halo" aria-hidden="true" />
      <Avatar
        {...(decorative
          ? { "aria-hidden": true }
          : { role: "img", "aria-label": character.name })}
      >
        <AvatarImage src={character.image} alt="" />
        <AvatarFallback>{initials(character.name)}</AvatarFallback>
      </Avatar>
    </span>
  );
}
