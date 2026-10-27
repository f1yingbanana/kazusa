'use client'

import { useMemo } from 'react'
import { useStatusVersion } from '@/hooks/use-characters'
import { statusStore } from '@/lib/live/state'

export function ActivitySummaryItem() {
  const version = useStatusVersion()
  const counts = useMemo(() => {
    let thinking = 0
    let composing = 0
    let queued = 0
    for (const status of statusStore.values()) {
      if (status.brain === 'thinking') thinking += 1
      if (status.composingIn.length > 0) composing += 1
      queued += status.queued
    }
    return { thinking, composing, queued }
    // `version` changes on every live status write.
  }, [version])

  return (
    <span className="tabular-nums">
      {`${counts.thinking} thinking · ${counts.composing} composing · ${counts.queued} queued`}
    </span>
  )
}
