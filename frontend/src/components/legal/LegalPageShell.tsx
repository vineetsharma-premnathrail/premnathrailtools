'use client'

import { useRouter } from 'next/navigation'
import { ReactNode } from 'react'
import { ArrowLeft } from '@phosphor-icons/react'
import { secondaryBtnStyle } from '@/components/shared/ui'

export default function LegalPageShell({ title, updatedDate, children }: { title: string; updatedDate: string; children: ReactNode }) {
  const router = useRouter()

  return (
    <div
      style={{
        minHeight: '100vh',
        background: 'linear-gradient(160deg,#fff7ed,#ffe9d6 45%,#ffdcc2)',
        padding: '32px 20px',
        display: 'flex',
        justifyContent: 'center',
      }}
    >
      <div style={{ width: '100%', maxWidth: 720 }}>
        <button
          onClick={() => router.back()}
          style={{
            ...secondaryBtnStyle,
            marginBottom: 20,
            border: '1px solid rgba(180,120,80,.3)',
            background: 'rgba(255,255,255,.6)',
            color: '#8a6547',
          }}
        >
          <ArrowLeft size={15} />
          Back
        </button>

        <div
          style={{
            background: 'rgba(255,255,255,.75)',
            borderRadius: 20,
            border: '1px solid rgba(255,255,255,.8)',
            boxShadow: '0 12px 32px rgba(120,70,30,.12)',
            padding: '32px 36px',
          }}
        >
          <h1 style={{ fontSize: 24, fontWeight: 700, color: '#3a2313', margin: '0 0 6px' }}>{title}</h1>
          <p style={{ fontSize: 12.5, color: '#a8825f', margin: '0 0 24px' }}>Last updated {updatedDate}</p>
          <div style={{ fontSize: 14, lineHeight: 1.7, color: '#5c4130' }}>{children}</div>
        </div>
      </div>
    </div>
  )
}
