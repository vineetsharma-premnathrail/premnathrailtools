'use client'

import ErpNav from '@/components/erp/ErpNav'
import { SERVICE_CONTRACTS_ENABLED } from '@/lib/features'

// While service contracts are "Upcoming", every contract page shows this
// notice instead of the screens (list, new, detail).
export default function ServiceContractsLayout({ children }: { children: React.ReactNode }) {
  if (SERVICE_CONTRACTS_ENABLED) return <>{children}</>
  return (
    <div>
      <ErpNav />
      <div style={{ maxWidth: 560, margin: '48px auto', padding: 28, borderRadius: 16, textAlign: 'center',
        background: 'rgba(255,255,255,.6)', border: '1px solid rgba(0,0,0,0.08)' }}>
        <span style={{ display: 'inline-block', fontSize: 11, fontWeight: 700, letterSpacing: '.06em', textTransform: 'uppercase',
          padding: '3px 10px', borderRadius: 999, background: 'rgba(255,122,69,0.15)', color: '#FF7A45', marginBottom: 12 }}>
          Upcoming
        </span>
        <h1 style={{ fontSize: 20, fontWeight: 700, color: '#1f1108', margin: '0 0 8px' }}>Service Contracts (AMC / CMC)</h1>
        <p style={{ fontSize: 13.5, color: '#57534e', margin: 0, lineHeight: 1.6 }}>
          Contract-wise coverage, included visits, SLA and periodic billing are coming soon.
          Until then, keep recording the AMC on the machine (AMC status and end date).
        </p>
      </div>
    </div>
  )
}
