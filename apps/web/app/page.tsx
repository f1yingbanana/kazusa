import { Suspense } from 'react'
import { Shell } from '@/components/shell/shell'

export default function Page() {
  return (
    <Suspense>
      <Shell />
    </Suspense>
  )
}
