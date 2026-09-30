'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { rndApi } from '@/lib/api'
import { RndPrototype, RndStoreItemLookup } from '@/types'
import { TEXT, GLASS, SHADOWS, GRADIENTS, BORDER } from '@/lib/theme'
import ConfirmDialog from '@/components/erp/ConfirmDialog'
import { extractErrorMessages } from '@/lib/validation'

const inputStyle: React.CSSProperties = {
  width: '100%', padding: '10px 12px', borderRadius: 10, border: `1px solid ${BORDER.normal}`,
  background: 'rgba(255,255,255,.7)', fontSize: 13.5, outline: 'none', color: TEXT.body,
}
const labelStyle: React.CSSProperties = { fontSize: 12, fontWeight: 600, color: TEXT.secondary, marginBottom: 6, display: 'block' }
const sectionStyle: React.CSSProperties = {
  borderRadius: 18, background: GLASS.card, backdropFilter: GLASS.blur, WebkitBackdropFilter: GLASS.blur,
  border: `1px solid ${GLASS.border}`, boxShadow: SHADOWS.glass(), padding: 20, marginBottom: 20,
}
const noteStyle = (hex: string): React.CSSProperties => ({
  padding: '10px 14px', borderRadius: 10, background: `${hex}12`, border: `1px solid ${hex}40`, color: TEXT.body, fontSize: 13, marginBottom: 12,
})

export function isReleased(proto: RndPrototype) {
  return !!proto.production_bom_id && !!proto.production_bom_number && proto.production_bom_status !== 'deleted'
}

/**
 * Handover step from the SAP mapping ("Final BOM release → Communicate to
 * Production"): turns a Validated prototype's BOM into a *draft* Production
 * BOM. Production then adds routing and activates it.
 */
export default function ReleaseToProductionPanel({
  proto, onReleased,
}: {
  proto: RndPrototype
  onReleased: (updated: RndPrototype) => void
}) {
  const [search, setSearch] = useState('')
  const [results, setResults] = useState<RndStoreItemLookup[]>([])
  const [product, setProduct] = useState<RndStoreItemLookup | null>(null)
  const [baseQty, setBaseQty] = useState('1')
  const [remarks, setRemarks] = useState('')
  const [busy, setBusy] = useState(false)
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [error, setError] = useState<string | string[]>('')

  useEffect(() => {
    const q = search.trim()
    if (!q) return
    let cancelled = false
    const t = setTimeout(() => {
      rndApi.lookupStoreItems(q)
        .then((data) => { if (!cancelled) setResults(Array.isArray(data) ? data : []) })
        .catch((err) => { if (!cancelled) setError(extractErrorMessages(err, 'Failed to search the Item Master.')) })
    }, 250)
    return () => { cancelled = true; clearTimeout(t) }
  }, [search])

  const released = isReleased(proto)
  const unlinked = proto.bom_items.filter((l) => !l.store_item_id)
  const componentIds = new Set(proto.bom_items.map((l) => l.store_item_id))

  const handleRelease = async () => {
    setConfirmOpen(false)
    setError('')
    if (!product) { setError('Pick the finished-product item this BOM builds.'); return }
    const qty = Number(baseQty)
    if (!baseQty.trim() || !Number.isFinite(qty) || qty <= 0) { setError('Base quantity must be greater than 0 (usually 1).'); return }
    setBusy(true)
    try {
      const updated: RndPrototype = await rndApi.releasePrototypeToProduction(proto.id, {
        product_item_id: product.id,
        base_quantity: qty,
        remarks: remarks.trim() || undefined,
      })
      onReleased(updated)
    } catch (err) {
      setError(extractErrorMessages(err, 'Failed to release the BOM to Production.'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div style={sectionStyle}>
      <h2 style={{ fontSize: 15, fontWeight: 700, color: TEXT.heading, margin: '0 0 4px' }}>Release to Production</h2>
      <p style={{ fontSize: 12, color: TEXT.muted, margin: '0 0 14px' }}>
        Hands this prototype&apos;s BOM to Production as a draft BOM. Production adds the routing and activates it.
      </p>

      {error && (
        <div style={{ padding: '10px 14px', marginBottom: 12, borderRadius: 10, background: 'rgba(220,38,38,0.08)', border: '1px solid rgba(220,38,38,0.2)', color: '#b91c1c', fontSize: 13 }}>
          {Array.isArray(error) ? error.join(' ') : error}
        </div>
      )}

      {released ? (
        <div style={noteStyle('#16A34A')}>
          <b>Released</b> as{' '}
          <Link href={`/dashboard/production/bom/${proto.production_bom_id}`} style={{ color: '#FF6A2A', fontWeight: 700, textDecoration: 'none' }}>
            {proto.production_bom_number}
          </Link>{' '}
          ({proto.production_bom_status}){proto.released_at ? ` on ${proto.released_at.slice(0, 10)}` : ''}{proto.released_by_name ? ` by ${proto.released_by_name}` : ''}.
          {proto.production_bom_status === 'draft' && (
            <div style={{ marginTop: 6, fontSize: 12.5, color: TEXT.secondary }}>
              Next step is in Production: add the routing operations on the draft BOM, then activate it. Work orders can&apos;t be released from a BOM with no routing.
            </div>
          )}
          <div style={{ marginTop: 6, fontSize: 12.5, color: TEXT.secondary }}>
            This prototype&apos;s BOM is now frozen. For design changes, create a new prototype version.
          </div>
        </div>
      ) : proto.status !== 'validated' ? (
        <div style={noteStyle('#78716c')}>
          Available once the prototype is <b>Validated</b>. Record the validation experiments, then set Status to Validated and save.
        </div>
      ) : unlinked.length > 0 ? (
        <div style={noteStyle('#F59E0B')}>
          Production BOMs can only use Item Master parts. These lines are free text:{' '}
          <b>{unlinked.map((l) => l.item_name).join(', ')}</b>. Ask Store to create them, then pick them on each BOM line and save.
        </div>
      ) : proto.bom_items.length === 0 ? (
        <div style={noteStyle('#F59E0B')}>Add the prototype&apos;s parts to the BOM first.</div>
      ) : (
        <>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 14, marginBottom: 14 }}>
            <div style={{ flex: '1 1 300px', minWidth: 240, maxWidth: 440, position: 'relative' }}>
              <label style={labelStyle}>Finished Product (Item Master) *</label>
              {product ? (
                <div style={{ ...inputStyle, display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderColor: 'rgba(22,163,74,0.5)' }}>
                  <span><b>{product.item_code}</b> — {product.item_name}</span>
                  <span onClick={() => { setProduct(null); setSearch('') }} style={{ cursor: 'pointer', fontSize: 15, color: TEXT.muted }}>×</span>
                </div>
              ) : (
                <>
                  <input
                    style={inputStyle}
                    value={search}
                    onChange={(e) => { setSearch(e.target.value); if (!e.target.value.trim()) setResults([]) }}
                    placeholder="Search finished-goods item code or name…"
                  />
                  {search.trim() && (
                    <div style={{ marginTop: 4, border: '1px solid rgba(0,0,0,0.08)', borderRadius: 8, overflow: 'hidden', background: '#fff' }}>
                      {results.filter((i) => !componentIds.has(i.id)).slice(0, 8).map((i) => (
                        <div
                          key={i.id}
                          onClick={() => { setProduct(i); setSearch(''); setResults([]) }}
                          style={{ padding: '6px 10px', fontSize: 12, cursor: 'pointer', color: TEXT.secondary, borderTop: '1px solid rgba(0,0,0,0.04)' }}
                        >
                          <span style={{ fontWeight: 600 }}>{i.item_code}</span> · {i.item_name}{i.uom ? ` (${i.uom})` : ''}
                        </div>
                      ))}
                      {results.length === 0 && (
                        <div style={{ padding: '6px 10px', fontSize: 12, color: TEXT.muted }}>
                          No matching item. The finished product must exist in the Item Master — ask Store to create it.
                        </div>
                      )}
                    </div>
                  )}
                </>
              )}
            </div>
            <div style={{ flex: '0 1 130px', minWidth: 110 }}>
              <label style={labelStyle}>Base Qty</label>
              <input style={inputStyle} type="number" min={0} step="any" value={baseQty} onChange={(e) => setBaseQty(e.target.value)} />
            </div>
            <div style={{ flex: '1 1 260px', minWidth: 220, maxWidth: 440 }}>
              <label style={labelStyle}>Note for Production</label>
              <input style={inputStyle} value={remarks} onChange={(e) => setRemarks(e.target.value)} placeholder="e.g. use routing from frame v1" />
            </div>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
            <p style={{ fontSize: 11.5, color: TEXT.muted, margin: 0 }}>
              {proto.bom_items.length} BOM line(s) · repeated parts are merged into one line with the total quantity.
            </p>
            <button
              type="button"
              disabled={busy || !product}
              onClick={() => setConfirmOpen(true)}
              style={{ padding: '10px 22px', borderRadius: 12, border: 'none', cursor: busy || !product ? 'not-allowed' : 'pointer', background: GRADIENTS.primary, color: '#fff', fontSize: 13.5, fontWeight: 600, opacity: busy || !product ? 0.6 : 1 }}
            >
              {busy ? 'Releasing…' : 'Release BOM to Production'}
            </button>
          </div>
        </>
      )}

      <ConfirmDialog
        open={confirmOpen}
        title="Release this BOM to Production?"
        message={product ? `This creates a draft Production BOM for ${product.item_code} from ${proto.prototype_number} (${proto.version}). The prototype's BOM will be frozen afterwards.` : ''}
        confirmLabel="Release"
        onConfirm={handleRelease}
        onCancel={() => setConfirmOpen(false)}
      />
    </div>
  )
}
