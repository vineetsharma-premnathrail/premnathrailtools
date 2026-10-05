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

type ItemType = { value: string; label: string; prefix: string }

const FIELDS = [
  { key: 'label', label: 'Name', placeholder: 'Spare Part', maxLength: 100, required: true },
  { key: 'prefix', label: 'Code prefix', placeholder: 'SP (blank = auto)', maxLength: 6, upper: true },
]

export default function StoreItemTypesPage() {
  const { isAuthorized, isLoading } = useRequireApp('store')
  const [types, setTypes] = useState<ItemType[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  // null = closed, 'new' = add, otherwise the type being edited
  const [editing, setEditing] = useState<ItemType | 'new' | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<ItemType | null>(null)
  const [deleteErrors, setDeleteErrors] = useState<string[]>([])

  // Backend refuses a type that's still on an item or category, with the reason.
  const handleDelete = async () => {
    if (!deleteTarget) return
    try {
      setTypes(await storeApi.deleteItemType(deleteTarget.value))
    } catch (err) {
      setDeleteErrors(extractErrorMessages(err, `Failed to delete item type ${deleteTarget.label}.`))
    } finally {
      setDeleteTarget(null)
    }
  }

  const load = async () => {
    setLoading(true)
    try {
      setTypes((await storeApi.getItemMeta()).item_types)
    } catch (err) {
      setLoadError(extractErrorMessages(err, 'Failed to load item types.').join(' '))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (isAuthorized) load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAuthorized])

  const save = async (v: Record<string, string>) => {
    const payload = { label: v.label, prefix: v.prefix }
    setTypes(editing === 'new' || !editing
      ? await storeApi.createItemType(payload)
      : await storeApi.updateItemType(editing.value, payload))
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
          <h1 style={{ fontSize: 24, fontWeight: 700, color: TEXT.heading, margin: '0 0 8px' }}>Item Types</h1>
        </div>
        <button data-tour="itype-add-btn" onClick={() => setEditing('new')} style={primaryBtnStyle}>
          <span style={{ fontSize: 17, lineHeight: 1, marginRight: 6 }}>+</span> Add Item Type
        </button>
      </div>

      <StoreSettingsNav />

      <MessageDialog open={!!loadError} variant="error" title="Failed to Load Item Types" message={loadError} onClose={() => setLoadError('')} actionLabel="Reload" onAction={() => window.location.reload()} />
      <MessageDialog open={deleteErrors.length > 0} variant="error" title="Cannot Delete Item Type" message={deleteErrors} onClose={() => setDeleteErrors([])} />
      <ConfirmDialog
        open={!!deleteTarget}
        title="Delete this item type?"
        message={`This permanently removes "${deleteTarget?.label}". This cannot be undone.`}
        onCancel={() => setDeleteTarget(null)}
        onConfirm={handleDelete}
      />
      <MasterEditDialog
        open={editing !== null}
        title={editing === 'new' ? 'Add Item Type' : 'Edit Item Type'}
        note="The prefix starts every new item code of this type (e.g. SP-0001). Changing it applies only to items created from now on."
        fields={FIELDS}
        initial={editing && editing !== 'new' ? { label: editing.label, prefix: editing.prefix } : { label: '', prefix: '' }}
        onSave={save}
        onClose={() => setEditing(null)}
      />

      <div data-tour="itype-table" style={{ borderRadius: 18, background: GLASS.card, backdropFilter: GLASS.blur, WebkitBackdropFilter: GLASS.blur, border: `1px solid ${GLASS.border}`, boxShadow: SHADOWS.glass(), overflow: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 480 }}>
          <thead>
            <tr>
              {['Name', 'Code Prefix', ''].map((h) => (
                <th key={h} style={{ position: 'sticky', top: 0, background: '#fdf1e6', zIndex: 1, textAlign: 'left', padding: '12px 16px', fontSize: 11, fontWeight: 600, letterSpacing: '.05em', textTransform: 'uppercase', color: TEXT.muted }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading && <tr><td colSpan={3} style={{ padding: 24, textAlign: 'center', color: TEXT.muted, fontSize: 13 }}>Loading…</td></tr>}
            {!loading && types.length === 0 && (
              <tr><td colSpan={3} style={{ padding: 24, textAlign: 'center', color: TEXT.muted, fontSize: 13 }}>No item types yet.</td></tr>
            )}
            {!loading && types.map((t) => (
              <tr key={t.value} style={{ borderTop: '1px solid rgba(0,0,0,0.05)' }}>
                <td style={{ padding: '12px 16px', fontSize: 13, fontWeight: 600, color: TEXT.body }}>{t.label}</td>
                <td style={{ padding: '12px 16px', fontSize: 13, color: TEXT.secondary, fontFamily: 'monospace' }}>{t.prefix}</td>
                <td style={{ padding: '0 16px', textAlign: 'right', whiteSpace: 'nowrap' }}>
                  <span onClick={() => setEditing(t)} style={{ color: '#FF6A2A', fontSize: 12.5, fontWeight: 600, cursor: 'pointer' }}>Edit</span>
                  <span onClick={() => setDeleteTarget(t)} style={{ color: '#b91c1c', fontSize: 12.5, fontWeight: 600, cursor: 'pointer', marginLeft: 14 }}>Delete</span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
