'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useRequireApp } from '@/hooks/useAuth'
import QualityNav from '@/components/quality/QualityNav'
import { isLiveQualityPath } from '@/components/quality/qualityLive'
import { PageHeader } from '@/components/quality/QualityBits'
import { secondaryBtnStyle } from '@/components/shared/ui'
import { TEXT } from '@/lib/theme'

// Quality is live for incoming inspection only. A hidden part opened by URL
// gets one short message here instead of a half-working page.
// The live list is components/quality/qualityLive.ts.
function NotLiveYet() {
  const { isAuthorized, isLoading } = useRequireApp('quality')
  if (isLoading || !isAuthorized) return null
  return (
    <div>
      <QualityNav />
      <PageHeader title="Not live yet" />
      <p style={{ fontSize: 13.5, color: TEXT.body, margin: '0 0 16px', maxWidth: 560 }}>
        This part of Quality is not live yet — use Incoming Inspection. Quality checks on purchased items are done there.
      </p>
      <Link href="/dashboard/quality/lots" style={{ ...secondaryBtnStyle, textDecoration: 'none', display: 'inline-flex', alignItems: 'center' }}>
        Go to Incoming Inspection
      </Link>
    </div>
  )
}

export default function QualityLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()
  if (!isLiveQualityPath(pathname)) return <NotLiveYet />
  return <>{children}</>
}
