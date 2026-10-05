'use client'

import { useEffect, useState } from 'react'
import { useRequireApp } from '@/hooks/useAuth'
import { storeApi } from '@/lib/api'
import { TEXT, GLASS, SHADOWS } from '@/lib/theme'
import { primaryBtnStyle } from '@/components/shared/ui'
import StoreNav from '@/components/store/StoreNav'
import StoreSettingsNav from '@/components/store/StoreSettingsNav'
import MasterEditDialog from '@/components/store/MasterEditDialog'
import MessageDialog from '@/components/erp/MessageDialog'
import ConfirmDialog from '@/components/erp/ConfirmDialog'
import { extractErrorMessages } from '@/lib/validation'

type Uom = { code: string; label: string }

const FIELDS = [
  { key: 'code', label: 'Unit code', placeholder: 'KG', maxLength: 20, upper: true, required: true },
  { key: 'label', label: 'Unit name', placeholder: 'Kilogram', maxLength: 100 },
]

// The API returns dropdown options ({ value: 'KG', label: 'KG — Kilogram' });
// split the display label back into the bare name for the table/edit form.
const toUom = (o: { value: string; label: string }): Uom => ({
  code: o.value,
  label: o.label.startsWith(`${o.value} — `) ? o.label.slice(o.value.length + 3) : '',
})

export default function StoreUomsPage() {
  const { isAuthorized, isLoading } = useRequireApp('store')
  const [uoms, setUoms] = useState<Uom[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  const [editing, setEditing] = useState<Uom | 'new' | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<Uom | null>(null)
  const [deleteErrors, setDeleteErrors] = useState<string[]>([])

  // Backend refuses a unit that's already on an item / PR / PO / GRN line, with the reason.
  const handleDelete = async () => {
    if (!deleteTarget) return
    try {
      setUoms((await storeApi.deleteUom(deleteTarget.code)).map(toUom))
    } catch (err) {
      setDeleteErrors(extractErrorMessages(err, `Failed to delete unit ${deleteTarget.code}.`))
    } finally {
      setDeleteTarget(null)
    }
  }

  const load = async () => {
    setLoading(true)
    try {
      setUoms((await storeApi.getItemMeta()).uoms.map(toUom))
    } catch (err) {
      setLoadError(extractErrorMessages(err, 'Failed to load units of measure.').join(' '))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (isAuthorized) load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAuthorized])

  const save = async (v: Record<string, string>) => {
    const payload = { code: v.code, label: v.label }
    const options = editing === 'new' || !editing
      ? await storeApi.createUom(payload)
      : await storeApi.updateUom(editing.code, payload)
    setUoms(options.map(toUom))
  }

  if (isLoading || !isAuthorized) return null

  return (
    <div>
      <StoreNav />

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 8 }}>
        <div>
          <p style={{ fontSize: 11.5, fontWeight: 600, letterSpacing: '.05em', textTransform: 'uppercase', color: TEXT.muted, margin: '0 0 4px' }}>
            Store &amp; Inventory · Settings
          </p>
          <h1 style={{ fontSize: 24, fontWeight: 700, color: TEXT.heading, margin: '0 0 8px' }}>Units of Measure</h1>
        </div>
        <button data-tour="uom-add-btn" onClick={() => setEditing('new')} style={primaryBtnStyle}>
          <span style={{ fontSize: 17, lineHeight: 1, marginRight: 6 }}>+</span> Add Unit
        </button>
      </div>

      <StoreSettingsNav />

      <MessageDialog open={!!loadError} variant="error" title="Failed to Load Units" message={loadError} onClose={() => setLoadError('')} actionLabel="Reload" onAction={() => window.location.reload()} />
      <MessageDialog open={deleteErrors.length > 0} variant="error" title="Cannot Delete Unit" message={deleteErrors} onClose={() => setDeleteErrors([])} />
      <ConfirmDialog
        open={!!deleteTarget}
        title="Delete this unit?"
        message={`This permanently removes "${deleteTarget?.code}${deleteTarget?.label ? ` — ${deleteTarget.label}` : ''}". This cannot be undone.`}
        onCancel={() => setDeleteTarget(null)}
        onConfirm={handleDelete}
      />
      <MasterEditDialog
        open={editing !== null}
        title={editing === 'new' ? 'Add Unit of Measure' : 'Edit Unit of Measure'}
        note={editing && editing !== 'new' ? 'Renaming the code also moves every item on this unit to the new code.' : 'Units are shared by Store items and Purchase Request lines.'}
        fields={FIELDS}
        initial={editing && editing !== 'new' ? { code: editing.code, label: editing.label } : { code: '', label: '' }}
        onSave={save}
        onClose={() => setEditing(null)}
      />

      <div data-tour="uom-table" style={{ borderRadius: 18, background: GLASS.card, backdropFilter: GLASS.blur, WebkitBackdropFilter: GLASS.blur, border: `1px solid ${GLASS.border}`, boxShadow: SHADOWS.glass(), overflow: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 480 }}>
          <thead>
            <tr>
              {['Code', 'Name', ''].map((h) => (
                <th key={h} style={{ position: 'sticky', top: 0, background: '#fdf1e6', zIndex: 1, textAlign: 'left', padding: '12px 16px', fontSize: 11, fontWeight: 600, letterSpacing: '.05em', textTransform: 'uppercase', color: TEXT.muted }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading && <tr><td colSpan={3} style={{ padding: 24, textAlign: 'center', color: TEXT.muted, fontSize: 13 }}>Loading…</td></tr>}
            {!loading && uoms.length === 0 && (
              <tr><td colSpan={3} style={{ padding: 24, textAlign: 'center', color: TEXT.muted, fontSize: 13 }}>No units yet.</td></tr>
            )}
            {!loading && uoms.map((u) => (
              <tr key={u.code} style={{ borderTop: '1px solid rgba(0,0,0,0.05)' }}>
                <td style={{ padding: '12px 16px', fontSize: 13, fontWeight: 600, color: TEXT.body, fontFamily: 'monospace' }}>{u.code}</td>
                <td style={{ padding: '12px 16px', fontSize: 13, color: TEXT.secondary }}>{u.label || '—'}</td>
                <td style={{ padding: '0 16px', textAlign: 'right', whiteSpace: 'nowrap' }}>
                  <span onClick={() => setEditing(u)} style={{ color: '#FF6A2A', fontSize: 12.5, fontWeight: 600, cursor: 'pointer' }}>Edit</span>
                  <span onClick={() => setDeleteTarget(u)} style={{ color: '#b91c1c', fontSize: 12.5, fontWeight: 600, cursor: 'pointer', marginLeft: 14 }}>Delete</span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
