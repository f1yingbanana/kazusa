"use client";

import type { CharacterSummary, WikiPicture } from "@kazusa/client";
import { useQueryStates } from "nuqs";
import { usePortraits } from "@/hooks/use-scene";
import { useWornOutfit } from "@/hooks/use-stats";
import { useWikiCharacter } from "@/hooks/use-wiki-editor";
import { firstName } from "@/lib/format";
import { cx } from "@/ui/cx";
import { Note } from "@/ui/note";
import { Portrait } from "@/ui/portrait";
import { placedFrame } from "./frame";
import { charactersParsers } from "./search-params";

const USUAL = "";

/** Pictures by outfit, the usual clothes first. */
function byOutfit<T extends WikiPicture>(pictures: readonly T[]) {
  const outfits = new Map<string, T[]>();
  for (const picture of pictures) {
    const key = picture.outfit ?? USUAL;
    outfits.set(key, [...(outfits.get(key) ?? []), picture]);
  }
  return [...outfits.entries()].sort(([a], [b]) =>
    a === USUAL ? -1 : b === USUAL ? 1 : a.localeCompare(b),
  );
}

/**
 * Every way they can be drawn and the stickers they send. Pressing a portrait
 * tries it on: the figure beside the book changes until you leave.
 */
export function LooksTab({ character }: { character: CharacterSummary }) {
  const { data, error, isLoading } = useWikiCharacter(character.id);
  const { data: set } = usePortraits(character.id);
  const frames = new Map(
    (set?.portraits ?? []).map((p) => [
      p.name,
      placedFrame(p.placement, set?.size, set?.eyeline),
    ]),
  );
  const [{ "chars.look": look }, setParams] = useQueryStates(charactersParsers);
  const worn = useWornOutfit(character.id);
  const called = firstName(character.name);
  if (isLoading) return <Note>{`Fetching ${called}'s pictures…`}</Note>;
  if (error || !data) return <Note>{"Couldn't read their pictures."}</Note>;
  if (!data.portraits.length && !data.stickers.length)
    return <Note>{`${called} has no portraits or stickers yet.`}</Note>;

  const outfitName = (key: string) =>
    key === USUAL ? "Usual clothes" : key[0].toUpperCase() + key.slice(1);

  return (
    <div className="flex flex-col gap-8">
      {byOutfit(data.portraits).map(([outfit, pictures]) => (
        <section
          key={outfit || "usual"}
          aria-label={outfitName(outfit)}
          className="flex flex-col gap-3"
        >
          <Heading
            title={outfitName(outfit)}
            note={outfit ? data.outfits[outfit] : undefined}
            wearing={(worn ?? USUAL) === outfit || (!worn && outfit === USUAL)}
          />
          <ul className="grid grid-cols-[repeat(auto-fill,minmax(7.5rem,1fr))] gap-3">
            {pictures.map((picture) => {
              const on = look === picture.name;
              return (
                <li key={picture.name}>
                  <button
                    type="button"
                    aria-pressed={on}
                    title={on ? "Back to how they usually look" : "Try it on"}
                    onClick={() =>
                      void setParams(
                        { "chars.look": on ? null : picture.name },
                        { history: "replace" },
                      )
                    }
                    className="group/look flex w-full flex-col gap-1.5 rounded-[1rem] text-start outline-none"
                  >
                    <Portrait
                      name={character.name}
                      src={picture.url}
                      frame={frames.get(picture.name)}
                      className={cx(
                        "aspect-[4/5] w-full rounded-[1rem] transition-[translate] duration-200 group-hover/look:-translate-y-0.5 group-focus-visible/look:outline-2 group-focus-visible/look:outline-offset-2 group-focus-visible/look:outline-ui-primary motion-reduce:transition-none",
                        on &&
                          "ring-2 ring-ui-primary ring-offset-2 ring-offset-ui-surface",
                      )}
                    />
                    <span className="text-[0.8125rem] font-bold capitalize group-aria-pressed/look:text-ui-primary">
                      {picture.mood}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        </section>
      ))}

      {data.stickers.length ? (
        <section aria-label="Stickers" className="flex flex-col gap-3">
          <Heading
            title="Stickers"
            note={`What ${called} sends in chats, by what they show.`}
          />
          <ul className="grid grid-cols-[repeat(auto-fill,minmax(6.5rem,1fr))] gap-3">
            {data.stickers.map((sticker) => (
              <li
                key={sticker.name}
                className="flex flex-col items-center gap-1 rounded-[1rem] bg-ui-ground p-2 text-center"
                title={sticker.look ?? sticker.mood}
              >
                <img
                  src={sticker.url}
                  alt={sticker.look ?? sticker.mood}
                  loading="lazy"
                  draggable={false}
                  className="aspect-square w-full object-contain"
                />
                <span className="line-clamp-2 text-xs font-semibold text-ui-soft">
                  {sticker.outfit
                    ? `${sticker.mood} · ${sticker.outfit}`
                    : sticker.mood}
                </span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}

function Heading({
  title,
  note,
  wearing = false,
}: {
  title: string;
  note?: string | undefined;
  wearing?: boolean;
}) {
  return (
    <div className="flex flex-col gap-0.5">
      <h3 className="flex items-center gap-2 text-[0.9375rem] font-extrabold">
        {title}
        {wearing ? (
          <span className="rounded-full bg-ui-accent-tint px-2 py-0.5 text-xs font-bold text-ui-accent-ink">
            Wearing now
          </span>
        ) : null}
      </h3>
      {note ? <p className="text-[0.8125rem] text-ui-soft">{note}</p> : null}
    </div>
  );
}
