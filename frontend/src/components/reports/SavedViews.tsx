'use client'

import { useEffect, useState } from 'react'
import { BookmarkSimple, Star } from '@phosphor-icons/react'
import PickerButton from './PickerButton'
import PromptDialog from '@/components/erp/PromptDialog'
import ConfirmDialog from '@/components/erp/ConfirmDialog'
import { menuItemStyle, textActionStyle } from '@/lib/reports/styles'
import { loadViews, MAX_VIEWS, newViewId, storeViews, type SavedView } from '@/lib/reports/savedViews'
import type { ReportState } from '@/lib/reports/params'

type Dialog = { kind: 'save' } | { kind: 'rename'; view: SavedView } | { kind: 'delete'; view: SavedView } | null

/** Saved views of one module, kept in this browser per viewer. A view stores the report, period (a preset by key), filters, grouping, measures, columns and sort. */
export default function SavedViews({ module, userId, report, state, activeId, onApply, onNotice, tour }: {
  module: string
  userId: number | string
  report: string
  state: ReportState
  activeId: string
  onApply: (view: SavedView) => void
  onNotice: (msg: string) => void
  tour?: string
}) {
  const [views, setViews] = useState<SavedView[]>([])
  const [dialog, setDialog] = useState<Dialog>(null)
  useEffect(() => { setViews(loadViews(userId, module)) }, [userId, module])

  const persist = (next: SavedView[]) => {
    setViews(next)
    if (!storeViews(userId, module, next)) onNotice('This browser would not save the view (private mode or storage full), so it will be gone when the page closes. Free some browser storage and save it again.')
  }
  const snapshot = (): ReportState => ({ ...state, page: 1, preset: state.preset })

  const sorted = [...views].sort((a, b) => a.name.localeCompare(b.name))
  const active = views.find((v) => v.id === activeId)

  return (
    <>
      <PickerButton icon={<BookmarkSimple size={16} />} label={active ? active.name.slice(0, 22) : 'Saved views'} badge={views.length || ''} tour={tour} minWidth={300} maxHeight={440} align="right" title="Save this setup and come back to it later">
        {(close) => (
          <div style={{ padding: 8, display: 'flex', flexDirection: 'column', gap: 2 }}>
            {sorted.length === 0 && <p style={{ margin: 0, padding: '8px 10px', fontSize: 13, color: '#64748b' }}>No saved views yet. Set the period, filters and grouping you like, then save them here.</p>}
            {sorted.map((v) => (
              <div key={v.id} style={{ borderRadius: 8, background: v.id === activeId ? 'rgba(255,122,69,0.08)' : 'transparent', padding: '2px 0 4px' }}>
                <button type="button" style={menuItemStyle(v.id === activeId)} onClick={() => { onApply(v); close() }}>
                  {v.isDefault && <Star size={14} weight="fill" color="#eda100" aria-label="Opens first" />}
                  <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{v.name}</span>
                </button>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, paddingLeft: 12, paddingTop: 2 }}>
                  <button type="button" style={textActionStyle} onClick={() => { persist(views.map((x) => (x.id === v.id ? { ...x, report, state: snapshot() } : x))); onNotice(`View "${v.name}" now holds the current setup.`); close() }}>Update</button>
                  <button type="button" style={textActionStyle} onClick={() => { close(); setDialog({ kind: 'rename', view: v }) }}>Rename</button>
                  <button type="button" style={textActionStyle} onClick={() => persist(views.map((x) => ({ ...x, isDefault: x.id === v.id ? !x.isDefault : false })))}>{v.isDefault ? 'Stop opening first' : 'Open this first'}</button>
                  <button type="button" style={{ ...textActionStyle, color: '#b91c1c' }} onClick={() => { close(); setDialog({ kind: 'delete', view: v }) }}>Delete</button>
                </div>
              </div>
            ))}
            <div style={{ borderTop: '1px solid #e2e8f0', marginTop: 6, paddingTop: 6 }}>
              <button type="button" style={{ ...menuItemStyle(false), fontWeight: 700, color: '#2563eb' }}
                onClick={() => {
                  if (views.length >= MAX_VIEWS) { onNotice(`You can keep ${MAX_VIEWS} saved views. Delete one you no longer use, then save again.`); close(); return }
                  close(); setDialog({ kind: 'save' })
                }}>
                Save current setup as...
              </button>
            </div>
          </div>
        )}
      </PickerButton>

      <PromptDialog open={dialog?.kind === 'save'} title="Save this view" message="Name it so you can find it again, for example 'Urgent jobs this quarter'." placeholder="View name" confirmLabel="Save view" danger={false} requireValue
        onCancel={() => setDialog(null)}
        onConfirm={(name) => {
          const n = name.trim()
          if (views.some((v) => v.name.toLowerCase() === n.toLowerCase())) { onNotice(`A view called "${n}" already exists - choose another name, or use Update on that view.`); setDialog(null); return }
          const v: SavedView = { id: newViewId(), name: n, report, state: snapshot() }
          persist([...views, v])
          setDialog(null)
          onApply(v)
        }} />
      <PromptDialog open={dialog?.kind === 'rename'} title="Rename view" placeholder="View name" confirmLabel="Rename" danger={false} requireValue
        onCancel={() => setDialog(null)}
        onConfirm={(name) => {
          const v = dialog?.kind === 'rename' ? dialog.view : null
          const n = name.trim()
          if (v && views.some((x) => x.id !== v.id && x.name.toLowerCase() === n.toLowerCase())) onNotice(`A view called "${n}" already exists - choose another name.`)
          else if (v) persist(views.map((x) => (x.id === v.id ? { ...x, name: n } : x)))
          setDialog(null)
        }} />
      <ConfirmDialog open={dialog?.kind === 'delete'} title="Delete this view?" message={dialog?.kind === 'delete' ? `"${dialog.view.name}" will be removed from this browser. The reports themselves are not affected.` : ''} confirmLabel="Delete view"
        onCancel={() => setDialog(null)}
        onConfirm={() => { if (dialog?.kind === 'delete') persist(views.filter((x) => x.id !== dialog.view.id)); setDialog(null) }} />
    </>
  )
}
