import type { NumberStat } from "@kazusa/client";

/** Past this many steps in one word, ticks would run together. */
const TICKS_SHOWN = 16;

/**
 * A number's words drawn to scale: each word as wide as its range, a tick for
 * every step inside it, and a dot where the state starts. How far apart the
 * words are is the pace the state moves at, so it is shown, not described.
 */
export function BandScale({ stat }: { stat: NumberStat }) {
  const bands = [...(stat.bands ?? [])].sort((a, b) => a.min - b.min);
  const span = stat.max - stat.min;
  if (bands.length < 2 || span <= 0) return null;
  const step = stat.step ?? 1;
  const segments = bands.map((band, index) => {
    const from = Math.max(band.min, stat.min);
    const to = bands[index + 1]?.min ?? stat.max;
    return { name: band.name, from, width: to - from };
  });
  // Whatever lies under the first word has no name.
  const lead = (segments[0]?.from ?? stat.min) - stat.min;
  const start = ((stat.initial - stat.min) / span) * 100;

  return (
    <div
      role="img"
      aria-label={`${segments
        .map(({ name, from }) => `${name} from ${from}`)
        .join(", ")}; starts at ${stat.initial}`}
      className="flex flex-col gap-1.5 pt-2"
    >
      <div className="relative flex gap-0.5">
        {lead > 0 ? <span style={{ flexGrow: lead }} /> : null}
        {segments.map(({ name, width }) => {
          const steps = Math.round(width / step);
          return (
            <span
              key={name}
              className="h-1.5 basis-0 rounded-full bg-foreground/15"
              style={{
                flexGrow: width,
                // Cut a hairline between steps, whatever surface is behind.
                maskImage:
                  steps > 1 && steps <= TICKS_SHOWN
                    ? `repeating-linear-gradient(to right, black 0 calc(${100 / steps}% - 1px), transparent calc(${100 / steps}% - 1px) ${100 / steps}%)`
                    : undefined,
              }}
            />
          );
        })}
        <span
          className="absolute top-1/2 size-2.5 -translate-1/2 rounded-full bg-primary ring-2 ring-background"
          style={{ left: `${Math.min(100, Math.max(0, start))}%` }}
        />
      </div>
      <div className="flex gap-0.5 text-xs">
        {lead > 0 ? <span style={{ flexGrow: lead }} /> : null}
        {segments.map(({ name, from, width }) => (
          <span
            key={name}
            className="flex min-w-0 basis-0 items-baseline gap-1"
            style={{ flexGrow: width }}
          >
            <span className="truncate">{name}</span>
            <span className="font-mono text-[11px] text-muted-foreground tabular-nums">
              {from}
            </span>
          </span>
        ))}
      </div>
    </div>
  );
}
