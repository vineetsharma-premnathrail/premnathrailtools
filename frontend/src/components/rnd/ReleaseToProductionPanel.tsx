'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { rndApi } from '@/lib/api'
import { formatDate } from '@/lib/format'
import { recordPath } from '@/lib/recordRef'
import { RndPrototype, RndStoreItemLookup } from '@/types'
import { TEXT, GLASS, SHADOWS } from '@/lib/theme'
import { primaryBtnStyle } from '@/components/shared/ui'
import ConfirmDialog from '@/components/erp/ConfirmDialog'
import { extractErrorMessages } from '@/lib/validation'
import { useCan } from '@/lib/permissions'
import { useEscapeKey } from '@/hooks/useEscapeKey'
import { FormSheet, SheetSection, SheetIcon, Req, Optional, SHEET, sheetBtn, sheetInput, sheetLabel, sheetHint } from '@/components/shared/FormSheet'

const sectionStyle: React.CSSProperties = {
  borderRadius: 18, background: GLASS.card, backdropFilter: GLASS.blur, WebkitBackdropFilter: GLASS.blur,
  border: `1px solid ${GLASS.border}`, boxShadow: SHADOWS.glass(), padding: 20, marginBottom: 20,
}
const noteStyle = (hex: string): React.CSSProperties => ({
  padding: '10px 14px', borderRadius: 10, background: `${hex}12`, border: `1px solid ${hex}40`, color: TEXT.body, fontSize: 13, marginBottom: 12,
})
const errorBox: React.CSSProperties = { padding: '10px 14px', marginBottom: 16, borderRadius: 10, background: 'rgba(220,38,38,0.08)', border: '1px solid rgba(220,38,38,0.2)', color: '#b91c1c', fontSize: 13 }

export function isReleased(proto: RndPrototype) {
  return !!proto.production_bom_id && !!proto.production_bom_number && proto.production_bom_status !== 'deleted'
}

/**
 * Handover step from the SAP mapping ("Final BOM release → Communicate to
 * Production"): turns a Validated prototype's BOM into a *draft* Production
 * BOM. Production then adds routing and activates it. The inputs live in a
 * FormSheet popup opened from the panel.
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
  const [sheetOpen, setSheetOpen] = useState(false)
  const [error, setError] = useState<string | string[]>('')
  // Releasing creates a Production BOM — the backend needs Prototypes → Approve.
  const { can, canFeature } = useCan()
  const canRelease = can('rnd', 'prototypes', 'approve') && canFeature('rnd', 'prototypes', 'release_production', 'approve')
  useEscapeKey(sheetOpen && !busy && !confirmOpen, () => setSheetOpen(false))

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
      setSheetOpen(false)
      onReleased(updated)
    } catch (err) {
      setError(extractErrorMessages(err, 'Failed to release the BOM to Production.'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div data-tour="rnd-release-panel" style={sectionStyle}>
      <h2 style={{ fontSize: 15, fontWeight: 700, color: TEXT.heading, margin: '0 0 4px' }}>Release to Production</h2>
      <p style={{ fontSize: 12, color: TEXT.muted, margin: '0 0 14px' }}>
        Hands this prototype&apos;s BOM to Production as a draft BOM. Production adds the routing and activates it.
      </p>

      {error && !sheetOpen && (
        <div style={{ ...errorBox, marginBottom: 12 }}>
          {Array.isArray(error) ? error.join(' ') : error}
        </div>
      )}

      {released ? (
        <div style={noteStyle('#16A34A')}>
          <b>Released</b> as{' '}
          <Link href={recordPath('/dashboard/production/bom', proto, 'production_bom_id')} style={{ color: '#FF6A2A', fontWeight: 700, textDecoration: 'none' }}>
            {proto.production_bom_number}
          </Link>{' '}
          ({proto.production_bom_status ? proto.production_bom_status.charAt(0).toUpperCase() + proto.production_bom_status.slice(1).replace(/_/g, ' ') : '—'}){proto.released_at ? ` on ${formatDate(proto.released_at)}` : ''}{proto.released_by_name ? ` by ${proto.released_by_name}` : ''}.
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
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
          <p style={{ fontSize: 12.5, color: TEXT.secondary, margin: 0 }}>
            Ready to release — {proto.bom_items.length} BOM line(s), every one an Item Master part.
            {!canRelease && ' Releasing needs the Prototypes “Approve” permission — ask your admin to grant it.'}
          </p>
          {canRelease && (
            <button
              data-tour="rnd-release-btn"
              type="button"
              disabled={busy}
              onClick={() => { setError(''); setSheetOpen(true) }}
              style={{ ...primaryBtnStyle, cursor: busy ? 'not-allowed' : 'pointer', opacity: busy ? 0.6 : 1 }}
            >
              Release BOM to Production
            </button>
          )}
        </div>
      )}

      {sheetOpen && (
        <FormSheet tour="rnd-release-form" width={580} icon="truck" iconColor="#16A34A" title="Release to Production"
          subtitle={`${proto.prototype_number} (${proto.version}) becomes a draft Production BOM.`} onClose={() => setSheetOpen(false)} busy={busy}
          footer={<>
            <button type="button" onClick={() => setSheetOpen(false)} disabled={busy} style={sheetBtn('secondary', SHEET.INK, busy)}>Cancel</button>
            <button type="button" onClick={() => setConfirmOpen(true)} disabled={busy || !product} style={sheetBtn('primary', '#16A34A', busy || !product)}>
              <SheetIcon name="truck" size={16} />{busy ? 'Releasing…' : 'Release BOM to Production'}
            </button>
          </>}>
          <div style={{ padding: '20px 24px' }}>
            {error && <div style={errorBox}>{Array.isArray(error) ? error.join(' ') : error}</div>}
            <SheetSection icon="box" title="Finished Product">
              <div data-tour="rnd-release-product" style={{ position: 'relative' }}>
                <label style={sheetLabel}>Finished Product (Item Master) <Req /></label>
                {product ? (
                  <div style={{ ...sheetInput, display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderColor: 'rgba(22,163,74,0.5)' }}>
                    <span><b>{product.item_code}</b> — {product.item_name}</span>
                    <button type="button" aria-label="Clear product" onClick={() => { setProduct(null); setSearch('') }} style={{ border: 'none', background: 'none', cursor: 'pointer', padding: 0, color: SHEET.MUTED, display: 'inline-flex' }}>
                      <SheetIcon name="x" size={14} />
                    </button>
                  </div>
                ) : (
                  <>
                    <input
                      style={sheetInput}
                      value={search}
                      autoFocus
                      onChange={(e) => { setSearch(e.target.value); if (!e.target.value.trim()) setResults([]) }}
                      placeholder="Search finished-goods item code or name…"
                    />
                    {search.trim() && (
                      <div style={{ marginTop: 4, border: `1px solid ${SHEET.LINE}`, borderRadius: 8, overflow: 'hidden', background: '#fff' }}>
                        {results.filter((i) => !componentIds.has(i.id)).slice(0, 8).map((i) => (
                          <div
                            key={i.id}
                            onClick={() => { setProduct(i); setSearch(''); setResults([]) }}
                            style={{ padding: '6px 10px', fontSize: 12, cursor: 'pointer', color: SHEET.BODY, borderTop: '1px solid rgba(0,0,0,0.04)' }}
                          >
                            <span style={{ fontWeight: 600 }}>{i.item_code}</span> · {i.item_name}{i.uom ? ` (${i.uom})` : ''}
                          </div>
                        ))}
                        {results.length === 0 && (
                          <div style={{ padding: '6px 10px', fontSize: 12, color: SHEET.MUTED }}>
                            No matching item. The finished product must exist in the Item Master — ask Store to create it.
                          </div>
                        )}
                      </div>
                    )}
                  </>
                )}
                <p style={sheetHint}>The finished-goods item this BOM builds.</p>
              </div>
              <div data-tour="rnd-release-base-qty" style={{ marginTop: 14, maxWidth: 160 }}>
                <label style={sheetLabel}>Base Qty</label>
                <input style={sheetInput} type="number" min={0} step="any" value={baseQty} onChange={(e) => setBaseQty(e.target.value)} />
              </div>
              <p style={sheetHint}>How many finished products the BOM quantities make — usually 1.</p>
            </SheetSection>
            <SheetSection icon="chat" title="Note for Production" extra={<Optional />}>
              <div data-tour="rnd-release-note">
                <input style={sheetInput} value={remarks} onChange={(e) => setRemarks(e.target.value)} placeholder="e.g. use routing from frame v1" />
              </div>
              <p style={sheetHint}>
                {proto.bom_items.length} BOM line(s) · repeated parts are merged into one line with the total quantity.
              </p>
            </SheetSection>
          </div>
        </FormSheet>
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
