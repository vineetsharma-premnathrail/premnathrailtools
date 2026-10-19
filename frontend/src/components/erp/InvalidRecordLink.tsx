'use client'

import { useRouter } from 'next/navigation'
import { secondaryBtnStyle } from '@/components/crm/ui'
import { TEXT } from '@/lib/theme'

/** Shown when a page's record link (lib/recordRef.ts) was edited or is incomplete. */
export default function InvalidRecordLink({ message, listHref, listLabel = 'Back to list' }: { message: string; listHref: string; listLabel?: string }) {
  const router = useRouter()
  return (
    <div style={{ maxWidth: 560, margin: '48px auto', padding: 24, borderRadius: 12, border: '1px solid #fecaca', background: '#fef2f2' }}>
      <div style={{ fontSize: 15, fontWeight: 700, color: '#991b1b', marginBottom: 8 }}>Invalid link</div>
      <p style={{ fontSize: 13, color: TEXT.body, margin: '0 0 16px' }}>{message}</p>
      <button type="button" onClick={() => router.push(listHref)} style={secondaryBtnStyle}>← {listLabel}</button>
    </div>
  )
}
