"use client";

import { useRef, useState } from "react";
import { TextButton } from "@/ui/button";

/** Mostly a mew; very rarely she's had enough. */
const HISS_CHANCE = 0.006;

interface Word {
  readonly id: number;
  readonly text: string;
  readonly driftX: number;
  readonly driftY: number;
}

/**
 * The cat says something when poked: "Nya~", or one time in a hundred and sixty
 * or so, "Hiss!". Each word drifts down and right from her as it fades.
 */
export function Logo() {
  const [words, setWords] = useState<readonly Word[]>([]);
  const next = useRef(0);
  const poke = () => {
    const hiss = Math.random() < HISS_CHANCE;
    const word = {
      id: next.current++,
      text: hiss ? "Hiss!" : "Nya~",
      driftX: Math.round(18 + Math.random() * 18),
      driftY: Math.round(20 + Math.random() * 12),
    };
    setWords((shown) => [...shown.slice(-4), word]);
  };
  return (
    <div className="relative flex shrink-0 items-center gap-2.5">
      <TextButton
        aria-label="Kazusa"
        className="rounded-[0.625rem] transition-transform duration-150 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ui-primary active:scale-85"
        onClick={poke}
      >
        <img
          src="/logo.png"
          alt=""
          className="size-8 rounded-[0.625rem] object-cover"
          width={32}
          height={32}
          draggable={false}
        />
      </TextButton>
      <span className="text-lg font-extrabold tracking-[-0.01em] max-md:hidden">
        Kazusa
      </span>
      {words.map((word) => (
        <span
          key={word.id}
          aria-hidden
          className="pointer-events-none absolute top-5 left-6 z-20"
        >
          <span
            data-hiss={word.text === "Hiss!" || undefined}
            style={
              {
                "--ui-drift-x": `${word.driftX}px`,
                "--ui-drift-y": `${word.driftY}px`,
              } as React.CSSProperties
            }
            className="block animate-ui-float-away text-sm font-extrabold whitespace-nowrap text-ui-accent-ink [text-shadow:0_1px_0_var(--ui-ground),0_-1px_0_var(--ui-ground),1px_0_0_var(--ui-ground),-1px_0_0_var(--ui-ground),0_2px_6px_color-mix(in_oklch,var(--ui-ink)_22%,transparent)] data-hiss:text-ui-danger motion-reduce:animate-ui-fade-out"
            onAnimationEnd={() =>
              setWords((shown) => shown.filter((one) => one.id !== word.id))
            }
          >
            {word.text}
          </span>
        </span>
      ))}
    </div>
  );
}
