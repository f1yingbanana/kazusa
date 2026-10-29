'use client'

import { useMemo, useRef, useState } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import type { CharacterSummary } from '@kazusa/client'
import { PresenceAvatar } from '@/components/entities/presence-avatar'
import { MockTag } from '@/components/entities/source-state'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Spinner } from '@/components/ui/spinner'
import { useClockAnchor } from '@/hooks/use-clock'
import { useOffstage, useStage } from '@/hooks/use-stage'
import { statusStore } from '@/lib/live/state'
import { cn } from '@/lib/utils'

/** What the dialog opens with: everyone on, everyone off, or as things are. */
export type CastIntent = 'onstage' | 'offstage' | 'choose'

export interface CastRequest {
  readonly label: string
  readonly cast: readonly CharacterSummary[]
  readonly intent: CastIntent
}

/**
 * Who in a group is simulated. Opened from a group's menu in the World sidebar; nothing changes until Apply, and the
 * dialog says what each change does in the world and what it costs.
 */
export function CastDialog({
  request,
  onOpenChange,
}: {
  request: CastRequest | null
  onOpenChange: (open: boolean) => void
}) {
  return (
    <Dialog open={request !== null} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[min(40rem,90dvh)] flex-col gap-4 sm:max-w-lg">
        {request ? (
          <CastForm key={`${request.label}:${request.intent}`} request={request} onDone={() => onOpenChange(false)} />
        ) : null}
      </DialogContent>
    </Dialog>
  )
}

/** "Airi, Natsu and 4 others". */
function names(people: readonly CharacterSummary[]): string {
  const shown = people.slice(0, 3).map((c) => c.name)
  const rest = people.length - shown.length
  if (rest > 0) return `${shown.join(', ')} and ${rest} ${rest === 1 ? 'other' : 'others'}`
  return shown.length <= 1 ? (shown[0] ?? '') : `${shown.slice(0, -1).join(', ')} and ${shown.at(-1)}`
}

function CastForm({ request, onDone }: { request: CastRequest; onDone: () => void }) {
  const { label, cast, intent } = request
  const { apply } = useStage()
  const offstage = useOffstage()
  const paused = useClockAnchor()?.clock.speed === 0
  const [selected, setSelected] = useState<ReadonlySet<string>>(() => {
    if (intent === 'onstage') return new Set(cast.map((c) => c.id))
    if (intent === 'offstage') return new Set()
    return new Set(cast.filter((c) => !offstage.has(c.id)).map((c) => c.id))
  })
  const [query, setQuery] = useState('')
  const [busy, setBusy] = useState(false)

  const comingBack = cast.filter((c) => selected.has(c.id) && offstage.has(c.id))
  const goingOff = cast.filter((c) => !selected.has(c.id) && !offstage.has(c.id))
  const waiting = comingBack.reduce((sum, c) => sum + (statusStore.get(c.id)?.queued ?? 0), 0)
  const changes = comingBack.length + goingOff.length

  const shown = useMemo(() => {
    const needle = query.trim().toLowerCase()
    return needle ? cast.filter((c) => c.name.toLowerCase().includes(needle) || c.id.includes(needle)) : cast
  }, [cast, query])

  const toggle = (id: string, on: boolean) =>
    setSelected((current) => {
      const next = new Set(current)
      if (on) next.add(id)
      else next.delete(id)
      return next
    })

  async function submit() {
    if (!apply || changes === 0) {
      onDone()
      return
    }
    setBusy(true)
    const done =
      (await apply(
        comingBack.map((c) => c.id),
        true,
      )) &&
      (await apply(
        goingOff.map((c) => c.id),
        false,
      ))
    setBusy(false)
    if (done) onDone()
  }

  const onCount = selected.size
  // One character (from the inspector) needs no list: just what will happen.
  const single = cast.length === 1
  const title = single
    ? intent === 'onstage'
      ? `Bring ${label} onstage?`
      : `Send ${label} offstage?`
    : `Who's onstage: ${label}`
  return (
    <>
      <DialogHeader>
        <DialogTitle className="flex items-center gap-2">
          {title}
          <MockTag requires={['stage']} />
        </DialogTitle>
        <DialogDescription>
          Onstage characters think, act and cost model turns. Offstage characters are paused: they aren't anywhere in
          the world, and texts to them wait until they're back.
        </DialogDescription>
      </DialogHeader>

      {single ? null : (
        <>
          <div className="flex items-center gap-2">
            <Input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={`Search ${cast.length} characters`}
              aria-label="Search this group"
              className="h-8 flex-1"
            />
            <Button variant="outline" size="sm" onClick={() => setSelected(new Set(cast.map((c) => c.id)))}>
              All on
            </Button>
            <Button variant="outline" size="sm" onClick={() => setSelected(new Set())}>
              All off
            </Button>
          </div>

          <CastList cast={shown} selected={selected} offstage={offstage} onToggle={toggle} />

          <p className="font-mono text-[11px] text-muted-foreground tabular-nums">
            {`${onCount} of ${cast.length} onstage after this`}
          </p>
        </>
      )}

      {changes > 0 ? (
        <div className="flex flex-col gap-2 rounded-md bg-muted/60 px-3 py-2.5 text-sm">
          {goingOff.length > 0 ? (
            <div>
              <p className="font-medium">{`${names(goingOff)} ${goingOff.length === 1 ? 'goes' : 'go'} offstage`}</p>
              <p className="text-muted-foreground">
                They leave where they are, and anyone talking with them sees them go. A thought already underway
                finishes; after that, nothing until they're back.
              </p>
            </div>
          ) : null}
          {comingBack.length > 0 ? (
            <div>
              <p className="font-medium">{`${names(comingBack)} ${comingBack.length === 1 ? 'comes' : 'come'} back`}</p>
              <p className="text-muted-foreground">
                {`They pick up where they left off, feeling as they did, and check in right away${
                  waiting > 0 ? `, reading ${waiting} waiting ${waiting === 1 ? 'message' : 'messages'} first` : ''
                }. That starts ${comingBack.length} model ${comingBack.length === 1 ? 'turn' : 'turns'} now.`}
              </p>
            </div>
          ) : null}
          {paused ? (
            <p className="text-muted-foreground">The clock is paused, so nobody acts until it runs again.</p>
          ) : null}
        </div>
      ) : null}

      <DialogFooter>
        <Button variant="ghost" onClick={onDone}>
          Cancel
        </Button>
        <Button onClick={() => void submit()} disabled={busy}>
          {busy ? <Spinner data-icon="inline-start" /> : null}
          {changes === 0 ? 'Done' : `Apply ${changes} ${changes === 1 ? 'change' : 'changes'}`}
        </Button>
      </DialogFooter>
    </>
  )
}

/** Virtualized: a group can be the whole cast of 300 (D5). */
function CastList({
  cast,
  selected,
  offstage,
  onToggle,
}: {
  cast: readonly CharacterSummary[]
  selected: ReadonlySet<string>
  offstage: ReadonlySet<string>
  onToggle: (id: string, on: boolean) => void
}) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const virtualizer = useVirtualizer({
    count: cast.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => 40,
    getItemKey: (index) => cast[index]?.id ?? index,
    overscan: 8,
  })

  if (cast.length === 0) return <p className="py-6 text-center text-sm text-muted-foreground">Nobody matches.</p>

  return (
    <div ref={scrollRef} className="max-h-72 min-h-24 overflow-y-auto rounded-md border">
      <ul className="relative w-full" style={{ height: virtualizer.getTotalSize() }}>
        {virtualizer.getVirtualItems().map((virtual) => {
          const character = cast[virtual.index]
          const on = selected.has(character.id)
          const wasOff = offstage.has(character.id)
          const waiting = statusStore.get(character.id)?.queued ?? 0
          const note =
            on && wasOff
              ? 'comes back'
              : !on && !wasOff
                ? 'goes offstage'
                : wasOff
                  ? waiting > 0
                    ? `offstage · ${waiting} waiting`
                    : 'offstage'
                  : 'onstage'
          const changing = on === wasOff
          const inputId = `cast-${character.id}`
          return (
            <li
              key={virtual.key}
              className="absolute inset-x-0 top-0"
              style={{
                height: virtual.size,
                transform: `translateY(${virtual.start}px)`,
              }}
            >
              <label
                htmlFor={inputId}
                className="flex h-full cursor-pointer items-center gap-2.5 border-b px-3 last:border-b-0 hover:bg-accent/60"
              >
                <Checkbox
                  id={inputId}
                  checked={on}
                  onCheckedChange={(checked) => onToggle(character.id, checked === true)}
                />
                <PresenceAvatar
                  id={character.id}
                  name={character.name}
                  avatarUrl={character.avatarUrl}
                  kind="agent"
                  size="xs"
                />
                <span className="min-w-0 flex-1 truncate text-sm">{character.name}</span>
                <span
                  className={cn('shrink-0 text-xs', changing ? 'font-medium text-foreground' : 'text-muted-foreground')}
                >
                  {note}
                </span>
              </label>
            </li>
          )
        })}
      </ul>
    </div>
  )
}
