'use client'

import { useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { useRequireApp } from '@/hooks/useAuth'
import { hydraulicApi } from '@/lib/api'
import { HydSparePart } from '@/types'
import { TEXT, DANGER, GLASS, SHADOWS, BORDER } from '@/lib/theme'
import { secondaryBtnStyle } from '@/components/shared/ui'
import HydraulicNav from '@/components/hydraulic/HydraulicNav'
import SparePartForm from '@/components/hydraulic/SparePartForm'
import ConfirmDialog from '@/components/erp/ConfirmDialog'
import { CRITICALITY_LABELS, CRITICALITY_HEX } from '@/components/hydraulic/labels'
import { extractErrorMessages } from '@/lib/validation'

const STOCK_LABELS: Record<string, string> = { ok: 'In Stock', low: 'Low', out: 'Out of Stock', not_linked: 'Not Linked' }
const STOCK_HEX: Record<string, string> = { ok: '#16A34A', low: '#F59E0B', out: '#DC2626', not_linked: '#78716c' }

const cardStyle: React.CSSProperties = {
  borderRadius: 18, background: GLASS.card, backdropFilter: GLASS.blur, WebkitBackdropFilter: GLASS.blur,
  border: `1px solid ${GLASS.border}`, boxShadow: SHADOWS.glass(), padding: 20, marginBottom: 20,
}
const statLabel: React.CSSProperties = { fontSize: 11, fontWeight: 600, letterSpacing: '.04em', textTransform: 'uppercase', color: TEXT.muted, margin: '0 0 4px' }
const statValue: React.CSSProperties = { fontSize: 16, fontWeight: 700, color: TEXT.heading, margin: 0 }
const pill = (hex: string): React.CSSProperties => ({ fontSize: 11, fontWeight: 700, padding: '4px 10px', borderRadius: 9999, background: `${hex}1a`, color: hex, whiteSpace: 'nowrap' })
const qty = (n: number) => n.toLocaleString('en-IN', { maximumFractionDigits: 3 })

export default function HydSparePartDetailPage() {
  const { isAuthorized, isLoading } = useRequireApp('hydraulic')
  const router = useRouter()
  const params = useParams()
  const spareId = Number(params.id)

  const [spare, setSpare] = useState<HydSparePart | null>(null)
  const [error, setError] = useState<string | string[]>('')
  const [saved, setSaved] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)

  useEffect(() => {
    if (!isAuthorized || !spareId) return
    hydraulicApi.getSpare(spareId)
      .then(setSpare)
      .catch((err) => setError(extractErrorMessages(err, 'Failed to load spare part.')))
  }, [isAuthorized, spareId])

  const handleDelete = async () => {
    setConfirmDelete(false)
    try {
      await hydraulicApi.deleteSpare(spareId)
      router.push('/dashboard/hydraulic/spares')
    } catch (err) {
      setError(extractErrorMessages(err, 'Failed to delete spare part.'))
    }
  }

  if (isLoading || !isAuthorized) return null

  const linked = !!spare && spare.stock_status !== 'not_linked'
  const stockHex = spare ? STOCK_HEX[spare.stock_status] : '#78716c'
  const availColor = spare?.stock_status === 'out' ? '#DC2626' : spare?.stock_status === 'low' ? '#B45309' : TEXT.heading

  return (
    <div>
      <HydraulicNav />

      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap' }}>
        <div>
          <p style={{ fontSize: 11.5, fontWeight: 600, letterSpacing: '.05em', textTransform: 'uppercase', color: TEXT.muted, margin: '0 0 4px' }}>
            Hydraulic &amp; Pneumatic · Spare Part
          </p>
          <h1 style={{ fontSize: 24, fontWeight: 700, color: TEXT.heading, margin: '0 0 20px' }}>{spare ? `${spare.part_code} — ${spare.name}` : 'Spare Part'}</h1>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          {spare && (
            <button type="button" onClick={() => setConfirmDelete(true)} style={{ ...secondaryBtnStyle, color: DANGER.primary, borderColor: DANGER.border }}>Delete</button>
          )}
          <button onClick={() => router.push('/dashboard/hydraulic/spares')} type="button" style={secondaryBtnStyle}>← Back</button>
        </div>
      </div>

      {error && (
        <div style={{ padding: '10px 14px', marginBottom: 16, borderRadius: 10, background: 'rgba(220,38,38,0.08)', border: '1px solid rgba(220,38,38,0.2)', color: '#b91c1c', fontSize: 13 }}>
          {Array.isArray(error) ? error.join(' ') : error}
        </div>
      )}
      {saved && (
        <div style={{ padding: '10px 14px', marginBottom: 16, borderRadius: 10, background: 'rgba(22,163,74,0.08)', border: '1px solid rgba(22,163,74,0.2)', color: '#15803d', fontSize: 13 }}>
          Spare part saved.
        </div>
      )}

      {spare && (
        <>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 20, alignItems: 'flex-start', marginBottom: 20 }}>
            <div style={{ ...cardStyle, flex: '1 1 440px', marginBottom: 0, borderLeft: `4px solid ${stockHex}` }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginBottom: 14 }}>
                <h2 style={{ fontSize: 15, fontWeight: 700, color: TEXT.heading, margin: 0 }}>Stock</h2>
                <div style={{ display: 'flex', gap: 8 }}>
                  <span style={pill(CRITICALITY_HEX[spare.criticality])}>{CRITICALITY_LABELS[spare.criticality] || spare.criticality}</span>
                  <span style={pill(stockHex)}>{STOCK_LABELS[spare.stock_status] || spare.stock_status}</span>
                </div>
              </div>
              {linked ? (
                <>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 28 }}>
                    <div><p style={statLabel}>On hand</p><p style={statValue}>{qty(spare.on_hand_qty ?? 0)} {spare.uom}</p></div>
                    <div><p style={statLabel}>Available</p><p style={{ ...statValue, color: availColor }}>{qty(spare.available_qty ?? 0)} {spare.uom}</p></div>
                    <div><p style={statLabel}>Min stock</p><p style={statValue}>{qty(spare.min_stock_qty)} {spare.uom}</p></div>
                    <div><p style={statLabel}>Reorder qty</p><p style={statValue}>{spare.reorder_qty ? `${qty(spare.reorder_qty)} ${spare.uom}` : '—'}</p></div>
                    <div><p style={statLabel}>Used (12 m)</p><p style={statValue}>{qty(spare.used_last_12m)} {spare.uom}</p></div>
                  </div>
                  <p style={{ fontSize: 12, color: TEXT.muted, margin: '12px 0 0' }}>
                    From Store item {spare.store_item_code} — {spare.store_item_name}, summed over every Store location. Available = on hand less reserved.
                    {spare.lead_time_days != null ? ` Lead time ${spare.lead_time_days} day(s).` : ''}
                  </p>
                </>
              ) : (
                <p style={{ fontSize: 13, color: TEXT.secondary, margin: 0, lineHeight: 1.6 }}>
                  Stock isn&apos;t tracked for this spare yet. Link it to a Store item below — on-hand and available quantities then come from Store,
                  low-stock alerts start working, and completing a service job can issue it from a Store location.
                  {spare.used_last_12m ? ` Used ${qty(spare.used_last_12m)} ${spare.uom} on service jobs in the last 12 months.` : ''}
                </p>
              )}
            </div>

            <div style={{ ...cardStyle, flex: '1 1 320px', marginBottom: 0 }}>
              <h2 style={{ fontSize: 15, fontWeight: 700, color: TEXT.heading, margin: '0 0 12px' }}>Used in Systems ({spare.used_in_systems.length})</h2>
              {!spare.component_id ? (
                <p style={{ fontSize: 13, color: TEXT.muted, margin: 0 }}>Pick the component this spare is for — systems whose released BOM carries that component then appear here.</p>
              ) : spare.used_in_systems.length === 0 ? (
                <p style={{ fontSize: 13, color: TEXT.muted, margin: 0 }}>
                  No released BOM uses {spare.component_code} yet.
                </p>
              ) : spare.used_in_systems.map((u) => (
                <div key={u.system_id} onClick={() => router.push(`/dashboard/hydraulic/systems/${u.system_id}`)}
                  style={{ display: 'flex', gap: 12, padding: '9px 0', borderTop: `1px solid ${BORDER.light}`, cursor: 'pointer', flexWrap: 'wrap', fontSize: 13 }}>
                  <span style={{ fontWeight: 600, color: TEXT.heading, minWidth: 110 }}>{u.system_number}</span>
                  <span style={{ flex: '1 1 160px', color: TEXT.body }}>{u.system_name}</span>
                  <span style={{ color: TEXT.muted }}>{qty(u.quantity)} × {spare.component_code}</span>
                </div>
              ))}
            </div>
          </div>

          <SparePartForm
            key={spare.updated_at}
            initial={spare}
            submitLabel="Save Changes"
            onSubmit={async (payload) => {
              setSaved(false)
              const updated = await hydraulicApi.updateSpare(spareId, payload)
              setSpare(updated)
              setSaved(true)
            }}
          />
        </>
      )}

      <ConfirmDialog
        open={confirmDelete}
        title="Delete spare part?"
        message={`${spare?.part_code} will be removed from the spares list and pickers. Completed service jobs keep their history, and the Store item itself isn't touched.`}
        confirmLabel="Delete"
        danger
        onConfirm={handleDelete}
        onCancel={() => setConfirmDelete(false)}
      />
    </div>
  )
}
