import { Suspense } from 'react'
import { SetupGuide } from '@/components/setup/setup-guide'
import { Shell } from '@/components/shell/shell'
import { setup } from '@/lib/setup/setup'

export const dynamic = 'force-dynamic'

export default async function Page() {
  const status = await setup.status()
  if (!status.configured) return <SetupGuide status={status} />
  return (
    <Suspense>
      <Shell />
    </Suspense>
  )
}
