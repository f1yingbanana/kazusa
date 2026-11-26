import type { NumberStat } from "@kazusa/client";

const TICKS_SHOWN = 16;

export function BandScale({ stat }: { stat: NumberStat }) {
  const bands = [...(stat.bands ?? [])].sort((a, b) => a.min - b.min);
  const span = stat.max - stat.min;
  if (bands.length < 2 || span <= 0) return null;
  const step = stat.step ?? 1;

  const segments = bands
    .map((band, index) => {
      const from = Math.max(band.min, stat.min);
      const to = Math.min(bands[index + 1]?.min ?? stat.max, stat.max);
      return { name: band.name, from, width: to - from };
    })
    .filter(({ width }) => width > 0);

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
              className="h-1.5 basis-0 rounded-full bg-ui-tint"
              style={{
                flexGrow: width,
                maskImage:
                  steps > 1 && steps <= TICKS_SHOWN
                    ? `repeating-linear-gradient(to right, black 0 calc(${100 / steps}% - 1px), transparent calc(${100 / steps}% - 1px) ${100 / steps}%)`
                    : undefined,
              }}
            />
          );
        })}
        <span
          className="absolute top-1/2 size-2.5 -translate-1/2 rounded-full bg-ui-primary ring-2 ring-ui-surface"
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
            <span className="truncate font-medium text-ui-ink">{name}</span>
            <span className="font-[ui-monospace,monospace] text-xs text-ui-soft tabular-nums">
              {from}
            </span>
          </span>
        ))}
      </div>
    </div>
  );
}
