'use client'

import { useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { useRequireApp } from '@/hooks/useAuth'
import { hydraulicApi } from '@/lib/api'
import { HydBom } from '@/types'
import { TEXT, GLASS, SHADOWS, GRADIENTS, BORDER, DANGER } from '@/lib/theme'
import { secondaryBtnStyle, InfoRow } from '@/components/shared/ui'
import HydraulicNav from '@/components/hydraulic/HydraulicNav'
import HydBomForm from '@/components/hydraulic/HydBomForm'
import ConfirmDialog from '@/components/erp/ConfirmDialog'
import { COMPONENT_CATEGORY_LABELS, SYSTEM_TYPE_LABELS } from '@/components/hydraulic/labels'
import { extractErrorMessages } from '@/lib/validation'
import { formatDateTime } from '@/lib/format'

const STATUS_LABELS: Record<string, string> = { draft: 'Draft', released: 'Released', obsolete: 'Obsolete' }
const STATUS_HEX: Record<string, string> = { draft: '#78716c', released: '#16A34A', obsolete: '#a8a29e' }

const sectionStyle: React.CSSProperties = {
  borderRadius: 18, background: GLASS.card, backdropFilter: GLASS.blur, WebkitBackdropFilter: GLASS.blur,
  border: `1px solid ${GLASS.border}`, boxShadow: SHADOWS.glass(), padding: 20, marginBottom: 20,
}
const sectionTitle: React.CSSProperties = { fontSize: 12, fontWeight: 600, letterSpacing: '.05em', textTransform: 'uppercase', color: TEXT.secondary, margin: '0 0 14px' }
const thStyle: React.CSSProperties = { textAlign: 'left', padding: '8px 12px', fontSize: 11, fontWeight: 600, letterSpacing: '.03em', textTransform: 'uppercase', color: TEXT.muted, background: '#fdf1e6', whiteSpace: 'nowrap' }
const tdStyle: React.CSSProperties = { padding: '9px 12px', fontSize: 13, color: TEXT.body, borderTop: `1px solid ${BORDER.light}`, verticalAlign: 'middle' }
const primaryBtn: React.CSSProperties = {
  padding: '10px 18px', borderRadius: 12, border: 'none', cursor: 'pointer',
  background: GRADIENTS.primary, color: '#fff', fontSize: 13, fontWeight: 600, boxShadow: `0 8px 20px ${SHADOWS.glowOrange}`,
}
const dangerBtn: React.CSSProperties = { ...secondaryBtnStyle, color: DANGER.primary, borderColor: DANGER.border }
const pill = (hex: string): React.CSSProperties => ({ fontSize: 11, fontWeight: 700, padding: '4px 10px', borderRadius: 9999, background: `${hex}1a`, color: hex, whiteSpace: 'nowrap' })
const inr = (n: number) => `₹${n.toLocaleString('en-IN', { maximumFractionDigits: 2 })}`

type ConfirmKind = 'release' | 'revise' | 'delete'

/** A blob download's error body is itself a Blob — read the JSON `detail` out of it. */
async function blobErrorMessages(err: unknown, fallback: string): Promise<string[]> {
  const data = (err as { response?: { data?: unknown } })?.response?.data
  if (data instanceof Blob) {
    try {
      const parsed = JSON.parse(await data.text())
      if (typeof parsed?.detail === 'string') return [parsed.detail]
    } catch { /* not JSON — fall through to the generic extractor */ }
  }
  return extractErrorMessages(err, fallback)
}

export default function HydBomDetailPage() {
  const { isAuthorized, isLoading } = useRequireApp('hydraulic')
  const router = useRouter()
  const params = useParams()
  const bomId = Number(params.id)

  const [bom, setBom] = useState<HydBom | null>(null)
  const [error, setError] = useState<string | string[]>('')
  const [notice, setNotice] = useState('')
  const [busy, setBusy] = useState(false)
  const [confirm, setConfirm] = useState<ConfirmKind | null>(null)

  useEffect(() => {
    if (!isAuthorized || !bomId) return
    hydraulicApi.getBom(bomId)
      .then((b: HydBom) => { setBom(b); setError(''); setNotice('') })
      .catch((err) => setError(extractErrorMessages(err, 'Failed to load BOM.')))
  }, [isAuthorized, bomId])

  const runConfirm = async () => {
    const kind = confirm
    setConfirm(null)
    setBusy(true)
    setError('')
    setNotice('')
    try {
      if (kind === 'release') {
        const updated: HydBom = await hydraulicApi.releaseBom(bomId)
        setBom(updated)
        setNotice(`${updated.bom_number} Rev ${updated.revision} released — it is now locked.`)
      } else if (kind === 'revise') {
        const next: HydBom = await hydraulicApi.reviseBom(bomId)
        router.push(`/dashboard/hydraulic/bom/${next.id}`)
      } else if (kind === 'delete') {
        await hydraulicApi.deleteBom(bomId)
        router.push('/dashboard/hydraulic/bom')
        return
      }
    } catch (err) {
      const fallback = { release: 'Failed to release BOM.', revise: 'Failed to raise a new BOM revision.', delete: 'Failed to delete BOM.' }[kind || 'release']
      setError(extractErrorMessages(err, fallback))
    } finally {
      setBusy(false)
    }
  }

  const handleExport = async () => {
    if (!bom) return
    setBusy(true)
    setError('')
    try {
      const blob = await hydraulicApi.exportBom(bomId)
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `${bom.bom_number}-Rev${bom.revision}.csv`
      document.body.appendChild(a)
      a.click()
      a.remove()
      URL.revokeObjectURL(url)
    } catch (err) {
      setError(await blobErrorMessages(err, 'Failed to export BOM as CSV.'))
    } finally {
      setBusy(false)
    }
  }

  if (isLoading || !isAuthorized) return null

  const isDraft = bom?.status === 'draft'

  return (
    <div>
      <HydraulicNav />

      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap' }}>
        <div>
          <p style={{ fontSize: 11.5, fontWeight: 600, letterSpacing: '.05em', textTransform: 'uppercase', color: TEXT.muted, margin: '0 0 4px' }}>
            Hydraulic &amp; Pneumatic · BOM
          </p>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, margin: '0 0 20px', flexWrap: 'wrap' }}>
            <h1 style={{ fontSize: 24, fontWeight: 700, color: TEXT.heading, margin: 0 }}>
              {bom ? `${bom.bom_number} Rev ${bom.revision} — ${bom.title}` : 'BOM'}
            </h1>
            {bom && <span style={pill(STATUS_HEX[bom.status])}>{STATUS_LABELS[bom.status] || bom.status}</span>}
          </div>
        </div>
        <button onClick={() => router.push('/dashboard/hydraulic/bom')} type="button" style={secondaryBtnStyle}>← Back</button>
      </div>

      {error && (
        <div style={{ padding: '10px 14px', marginBottom: 16, borderRadius: 10, background: 'rgba(220,38,38,0.08)', border: '1px solid rgba(220,38,38,0.2)', color: '#b91c1c', fontSize: 13 }}>
          {Array.isArray(error) ? error.join(' ') : error}
        </div>
      )}
      {notice && (
        <div style={{ padding: '10px 14px', marginBottom: 16, borderRadius: 10, background: 'rgba(22,163,74,0.08)', border: '1px solid rgba(22,163,74,0.2)', color: '#15803d', fontSize: 13 }}>
          {notice}
        </div>
      )}

      {bom && (
        <>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', marginBottom: 20 }}>
            {isDraft && <button type="button" disabled={busy} style={primaryBtn} onClick={() => setConfirm('release')}>Release</button>}
            {bom.status === 'released' && <button type="button" disabled={busy} style={primaryBtn} onClick={() => setConfirm('revise')}>Raise New Revision</button>}
            <button type="button" disabled={busy} style={secondaryBtnStyle} onClick={handleExport}>Export CSV</button>
            {isDraft && <button type="button" disabled={busy} style={dangerBtn} onClick={() => setConfirm('delete')}>Delete</button>}
            {bom.status === 'obsolete' && <span style={{ fontSize: 12.5, color: TEXT.muted }}>This revision is obsolete — a later revision has been released.</span>}
          </div>

          <div style={{ ...sectionStyle, padding: '14px 20px' }}>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '12px 28px' }}>
              <InfoRow label="Created by" value={`${bom.created_by_name || '—'}${bom.created_at ? ` · ${formatDateTime(bom.created_at)}` : ''}`} />
              <InfoRow label="Released" value={bom.released_at ? `${bom.released_by_name || '—'} · ${formatDateTime(bom.released_at)}` : '—'} />
              <InfoRow label="Lines" value={String(bom.line_count)} />
              <InfoRow label="Total cost" value={inr(bom.total_cost)} />
            </div>
          </div>

          {isDraft ? (
            <HydBomForm
              key={bom.updated_at || bom.id}
              initial={bom}
              submitLabel="Save Changes"
              onSubmit={async (payload) => {
                setNotice('')
                const updated: HydBom = await hydraulicApi.updateBom(bomId, payload)
                setBom(updated)
                setNotice('BOM saved.')
              }}
            />
          ) : (
            <>
              <div style={sectionStyle}>
                <p style={sectionTitle}>BOM</p>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '14px 28px' }}>
                  <div style={{ flex: '1 1 240px', maxWidth: 360 }}>
                    <InfoRow label="System" value={bom.system_number ? `${bom.system_number} — ${bom.system_name || ''}` : 'Not linked to a system'} />
                    {bom.system_id && (
                      <span onClick={() => router.push(`/dashboard/hydraulic/systems/${bom.system_id}`)} style={{ fontSize: 12, fontWeight: 600, color: '#FF6A2A', cursor: 'pointer' }}>Open system →</span>
                    )}
                  </div>
                  <div style={{ flex: '1 1 220px', maxWidth: 320 }}>
                    <InfoRow label="Circuit" value={bom.circuit_number ? `${bom.circuit_number} Rev ${bom.circuit_revision || '?'}` : '—'} />
                    {bom.circuit_id && (
                      <span onClick={() => router.push(`/dashboard/hydraulic/circuits/${bom.circuit_id}`)} style={{ fontSize: 12, fontWeight: 600, color: '#FF6A2A', cursor: 'pointer' }}>Open circuit →</span>
                    )}
                  </div>
                  <InfoRow label="Medium" value={SYSTEM_TYPE_LABELS[bom.system_type] || bom.system_type} />
                </div>
                {bom.remarks && <div style={{ marginTop: 14 }}><InfoRow label="Remarks" value={bom.remarks} /></div>}
              </div>

              <div style={{ ...sectionStyle, padding: 0, overflow: 'auto' }}>
                <p style={{ ...sectionTitle, padding: '16px 20px 0' }}>Lines ({bom.items.length})</p>
                <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 900 }}>
                  <thead>
                    <tr>
                      {['Tag', 'Code', 'Component', 'Category', 'Make / Model', 'Qty', 'UOM', 'Unit Cost', 'Line Cost'].map((h) => (
                        <th key={h} style={{ ...thStyle, textAlign: ['Qty', 'Unit Cost', 'Line Cost'].includes(h) ? 'right' : 'left' }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {bom.items.length === 0 ? (
                      <tr><td colSpan={9} style={{ ...tdStyle, textAlign: 'center', color: TEXT.muted }}>No lines on this BOM.</td></tr>
                    ) : bom.items.map((i) => (
                      <tr key={i.id}>
                        <td style={{ ...tdStyle, fontWeight: 600, color: TEXT.heading }}>{i.tag_number || '—'}</td>
                        <td style={{ ...tdStyle, whiteSpace: 'nowrap' }}>
                          <span onClick={() => router.push(`/dashboard/hydraulic/components/${i.component_id}`)} style={{ fontWeight: 600, color: '#FF6A2A', cursor: 'pointer' }}>
                            {i.component_code || `#${i.component_id}`}
                          </span>
                        </td>
                        <td style={tdStyle}>
                          {i.component_name || '—'}
                          {i.remarks && <span style={{ display: 'block', fontSize: 11.5, color: TEXT.muted }}>{i.remarks}</span>}
                        </td>
                        <td style={tdStyle}>{i.component_category ? (COMPONENT_CATEGORY_LABELS[i.component_category] || i.component_category) : '—'}</td>
                        <td style={tdStyle}>{[i.manufacturer, i.model_number].filter(Boolean).join(' ') || '—'}</td>
                        <td style={{ ...tdStyle, textAlign: 'right' }}>{i.quantity.toLocaleString('en-IN')}</td>
                        <td style={tdStyle}>{i.uom}</td>
                        <td style={{ ...tdStyle, textAlign: 'right', whiteSpace: 'nowrap' }}>{inr(i.unit_cost)}</td>
                        <td style={{ ...tdStyle, textAlign: 'right', whiteSpace: 'nowrap' }}>{inr(i.line_cost)}</td>
                      </tr>
                    ))}
                    {bom.items.length > 0 && (
                      <tr>
                        <td colSpan={8} style={{ ...tdStyle, textAlign: 'right', fontWeight: 700, color: TEXT.heading }}>Total</td>
                        <td style={{ ...tdStyle, textAlign: 'right', fontWeight: 700, color: TEXT.heading, whiteSpace: 'nowrap' }}>{inr(bom.total_cost)}</td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </>
      )}

      <ConfirmDialog
        open={confirm !== null}
        title={{ release: 'Release BOM?', revise: 'Raise a new revision?', delete: 'Delete draft BOM?' }[confirm || 'release']}
        message={{
          release: 'Released BOMs are locked; changes need a new revision. Save any edits first — the last saved lines are what gets released. Any earlier released revision becomes obsolete.',
          revise: `A new draft revision is created as a copy of Rev ${bom?.revision}, which stays released until the new one is released.`,
          delete: `${bom?.bom_number} Rev ${bom?.revision} and its lines will be removed. Released revisions are not affected.`,
        }[confirm || 'release']}
        confirmLabel={{ release: 'Release', revise: 'Raise Revision', delete: 'Delete' }[confirm || 'release']}
        danger={confirm === 'delete'}
        onConfirm={runConfirm}
        onCancel={() => setConfirm(null)}
      />
    </div>
  )
}
