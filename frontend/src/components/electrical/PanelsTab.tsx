'use client'

// Panels tab — covers the Panel Design and Panel Assembly stages. Moving a
// panel to Assembled (or later) stamps who assembled it and when, server-side.
import { useCallback, useEffect, useState } from 'react'
import { electricalApi } from '@/lib/api'
import { extractErrorMessages } from '@/lib/validation'
import { formatDate } from '@/lib/format'
import { TEXT } from '@/lib/theme'
import { secondaryBtnStyle } from '@/components/shared/ui'
import ConfirmDialog from '@/components/erp/ConfirmDialog'
import { ElectricalJobDetail, ElectricalMeta, ElectricalPanel } from '@/types'
import {
  inputStyle, sectionStyle, sectionTitle, thStyle, tdStyle, primaryBtn, smallBtn, smallDangerBtn,
  tableWrap, Pill, ErrorBanner, NoticeBanner, Modal, F, rowStyle,
  PANEL_STATUS_LABELS, PANEL_STATUS_HEX, strOrNull,
} from './shared'

type Msg = string | string[]
type PanelForm = {
  panel_tag: string; name: string; panel_type: string; location_on_vehicle: string; enclosure_material: string
  ip_rating: string; dimensions: string; status: string; remarks: string
}

const small: React.CSSProperties = { fontSize: 11, color: TEXT.muted, marginTop: 2 }
const ASSEMBLED = ['assembled', 'tested', 'installed']

export default function PanelsTab({ job, meta, canEdit, onChanged }: { job: ElectricalJobDetail; meta: ElectricalMeta; canEdit: boolean; onChanged: () => void }) {
  const [panels, setPanels] = useState<ElectricalPanel[]>([])
  const [loaded, setLoaded] = useState(false)
  const [error, setError] = useState<Msg>('')
  const [notice, setNotice] = useState('')
  const [busy, setBusy] = useState(false)

  const typeKeys = Object.keys(meta.panel_types || {})
  const defaultType = typeKeys.includes('control') ? 'control' : (typeKeys[0] || 'control')
  const blankForm = (): PanelForm => ({
    panel_tag: '', name: '', panel_type: defaultType, location_on_vehicle: '', enclosure_material: '',
    ip_rating: '', dimensions: '', status: 'designed', remarks: '',
  })
  const [formOpen, setFormOpen] = useState(false)
  const [editing, setEditing] = useState<ElectricalPanel | null>(null)
  const [form, setForm] = useState<PanelForm>(blankForm)
  const [formError, setFormError] = useState<Msg>('')
  const [deleting, setDeleting] = useState<ElectricalPanel | null>(null)

  useEffect(() => {
    let cancelled = false
    electricalApi.listPanels(job.id)
      .then((rows: ElectricalPanel[]) => { if (!cancelled) setPanels(rows) })
      .catch((err) => { if (!cancelled) setError(extractErrorMessages(err, `Could not load the panels for ${job.job_number}.`)) })
      .finally(() => { if (!cancelled) setLoaded(true) })
    return () => { cancelled = true }
  }, [job.id, job.job_number])

  const reload = useCallback(async () => {
    try {
      setPanels(await electricalApi.listPanels(job.id))
    } catch (err) {
      setError(extractErrorMessages(err, `Could not reload the panels for ${job.job_number}.`))
    }
  }, [job.id, job.job_number])

  const mutate = async (fn: () => Promise<unknown>, fallback: string, opts: { success?: string; onError?: (m: Msg) => void } = {}) => {
    setError('')
    setNotice('')
    setBusy(true)
    try {
      await fn()
      await reload()
      onChanged()
      if (opts.success) setNotice(opts.success)
      return true
    } catch (err) {
      const msg = extractErrorMessages(err, fallback)
      if (opts.onError) opts.onError(msg)
      else setError(msg)
      return false
    } finally {
      setBusy(false)
    }
  }

  const set = (k: keyof PanelForm, v: string) => setForm((f) => ({ ...f, [k]: v }))

  const openAdd = () => {
    setEditing(null)
    setForm(blankForm())
    setFormError('')
    setFormOpen(true)
  }

  const openEdit = (p: ElectricalPanel) => {
    setEditing(p)
    setForm({
      panel_tag: p.panel_tag, name: p.name, panel_type: p.panel_type, location_on_vehicle: p.location_on_vehicle || '',
      enclosure_material: p.enclosure_material || '', ip_rating: p.ip_rating || '', dimensions: p.dimensions || '',
      status: p.status, remarks: p.remarks || '',
    })
    setFormError('')
    setFormOpen(true)
  }

  const save = async () => {
    setFormError('')
    const problems: string[] = []
    if (!form.panel_tag.trim()) problems.push('Enter a panel tag (e.g. MCP-01).')
    if (!form.name.trim()) problems.push('Enter a panel name.')
    if (problems.length) { setFormError(problems); return }
    const payload = {
      panel_tag: form.panel_tag.trim(),
      name: form.name.trim(),
      panel_type: form.panel_type,
      location_on_vehicle: strOrNull(form.location_on_vehicle),
      enclosure_material: strOrNull(form.enclosure_material),
      ip_rating: strOrNull(form.ip_rating),
      dimensions: strOrNull(form.dimensions),
      status: form.status,
      remarks: strOrNull(form.remarks),
    }
    const tag = payload.panel_tag.toUpperCase()
    const ok = await mutate(
      () => editing ? electricalApi.updatePanel(job.id, editing.id, payload) : electricalApi.createPanel(job.id, payload),
      editing ? `Could not save panel ${editing.panel_tag}.` : `Could not add panel ${tag}.`,
      { success: editing ? `Panel ${tag} updated.` : `Panel ${tag} added.`, onError: setFormError },
    )
    if (ok) setFormOpen(false)
  }

  const changeStatus = (p: ElectricalPanel, status: string) => {
    if (status === p.status) return
    mutate(
      () => electricalApi.updatePanel(job.id, p.id, { status }),
      `Could not move panel ${p.panel_tag} to ${PANEL_STATUS_LABELS[status] || status}.`,
      { success: `Panel ${p.panel_tag} is now ${PANEL_STATUS_LABELS[status] || status}.` },
    )
  }

  const assembledCount = panels.filter((p) => ASSEMBLED.includes(p.status)).length
  const headers = ['Tag', 'Name', 'Type', 'Location', 'Enclosure / IP', 'Components', 'Status', 'Assembled', ...(canEdit ? [''] : [])]

  return (
    <div style={sectionStyle}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginBottom: 14 }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 14, flexWrap: 'wrap' }}>
          <p style={{ ...sectionTitle, margin: 0 }}>Panels</p>
          <span style={{ fontSize: 12, color: TEXT.muted }}>
            {panels.length} panel{panels.length === 1 ? '' : 's'} · {assembledCount} assembled
          </span>
        </div>
        {canEdit && <button type="button" style={primaryBtn} onClick={openAdd}>+ Add Panel</button>}
      </div>

      <ErrorBanner error={error} />
      <NoticeBanner notice={notice} />

      <div style={tableWrap}>
        <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: canEdit ? 1100 : 960 }}>
          <thead>
            <tr>{headers.map((h, idx) => <th key={`${h}-${idx}`} style={thStyle}>{h}</th>)}</tr>
          </thead>
          <tbody>
            {!loaded ? (
              <tr><td colSpan={headers.length} style={{ ...tdStyle, textAlign: 'center', color: TEXT.muted }}>Loading panels…</td></tr>
            ) : panels.length === 0 ? (
              <tr><td colSpan={headers.length} style={{ ...tdStyle, textAlign: 'center', color: TEXT.muted }}>
                No panels designed for this job yet.{canEdit ? ' Use "+ Add Panel" to add the first one.' : ''}
              </td></tr>
            ) : panels.map((p) => (
              <tr key={p.id}>
                <td style={{ ...tdStyle, fontWeight: 700, color: TEXT.heading, whiteSpace: 'nowrap' }}>{p.panel_tag}</td>
                <td style={{ ...tdStyle, minWidth: 160 }}>
                  {p.name}
                  {p.dimensions && <div style={small}>{p.dimensions}</div>}
                </td>
                <td style={{ ...tdStyle, whiteSpace: 'nowrap' }}>{meta.panel_types?.[p.panel_type] || p.panel_type}</td>
                <td style={tdStyle}>{p.location_on_vehicle || <span style={{ color: TEXT.muted }}>—</span>}</td>
                <td style={tdStyle}>
                  {p.enclosure_material || p.ip_rating
                    ? [p.enclosure_material, p.ip_rating].filter(Boolean).join(' · ')
                    : <span style={{ color: TEXT.muted }}>—</span>}
                </td>
                <td style={tdStyle}>{p.component_count}</td>
                <td style={tdStyle}>
                  {canEdit ? (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 6, alignItems: 'flex-start' }}>
                      <Pill value={p.status} labels={PANEL_STATUS_LABELS} hex={PANEL_STATUS_HEX} />
                      <select aria-label={`Status of panel ${p.panel_tag}`} value={p.status} disabled={busy}
                        onChange={(e) => changeStatus(p, e.target.value)}
                        style={{ ...inputStyle, width: 'auto', padding: '4px 8px', fontSize: 12 }}>
                        {Object.entries(PANEL_STATUS_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                      </select>
                    </div>
                  ) : <Pill value={p.status} labels={PANEL_STATUS_LABELS} hex={PANEL_STATUS_HEX} />}
                </td>
                <td style={tdStyle}>
                  {p.assembled_at || p.assembled_by_name ? (
                    <>
                      <div>{p.assembled_by_name || '—'}</div>
                      <div style={small}>{formatDate(p.assembled_at)}</div>
                    </>
                  ) : <span style={{ color: TEXT.muted }}>—</span>}
                </td>
                {canEdit && (
                  <td style={{ ...tdStyle, whiteSpace: 'nowrap' }}>
                    <div style={{ display: 'flex', gap: 6 }}>
                      <button type="button" style={smallBtn} disabled={busy} onClick={() => openEdit(p)}>Edit</button>
                      <button type="button" style={smallDangerBtn} disabled={busy} onClick={() => setDeleting(p)}>Delete</button>
                    </div>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <Modal open={formOpen} title={editing ? `Edit Panel ${editing.panel_tag}` : 'Add Panel'} onClose={() => setFormOpen(false)} width={700}>
        <ErrorBanner error={formError} />
        <div style={rowStyle}>
          <F label="Panel Tag *" basis={130}>
            <input style={{ ...inputStyle, textTransform: 'uppercase' }} value={form.panel_tag} maxLength={50}
              onChange={(e) => set('panel_tag', e.target.value)} placeholder="MCP-01" />
          </F>
          <F label="Name *" basis={240} grow max={340}>
            <input style={inputStyle} value={form.name} maxLength={150} onChange={(e) => set('name', e.target.value)} placeholder="e.g. Main Control Panel" />
          </F>
          <F label="Panel Type" basis={170}>
            <select style={inputStyle} value={form.panel_type} onChange={(e) => set('panel_type', e.target.value)}>
              {Object.entries(meta.panel_types || {}).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
          </F>
        </div>
        <div style={rowStyle}>
          <F label="Location on Vehicle" basis={220} grow max={320}>
            <input style={inputStyle} value={form.location_on_vehicle} maxLength={150} onChange={(e) => set('location_on_vehicle', e.target.value)} placeholder="e.g. Driver cabin, LHS" />
          </F>
          <F label="Enclosure Material" basis={180} grow max={260}>
            <input style={inputStyle} value={form.enclosure_material} maxLength={100} onChange={(e) => set('enclosure_material', e.target.value)} placeholder="e.g. CRCA, SS304" />
          </F>
          <F label="IP Rating" basis={100}>
            <input style={inputStyle} value={form.ip_rating} maxLength={20} onChange={(e) => set('ip_rating', e.target.value)} placeholder="IP65" />
          </F>
        </div>
        <div style={rowStyle}>
          <F label="Dimensions" basis={180} grow max={260}>
            <input style={inputStyle} value={form.dimensions} maxLength={100} onChange={(e) => set('dimensions', e.target.value)} placeholder="W × H × D mm" />
          </F>
          <F label="Status" basis={150}>
            <select style={inputStyle} value={form.status} onChange={(e) => set('status', e.target.value)}>
              {Object.entries(PANEL_STATUS_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
          </F>
        </div>
        <div style={rowStyle}>
          <F label="Remarks" basis={300} grow>
            <textarea style={{ ...inputStyle, minHeight: 56, resize: 'vertical', fontFamily: 'inherit' }} value={form.remarks}
              onChange={(e) => set('remarks', e.target.value)} />
          </F>
        </div>
        <p style={{ fontSize: 12, color: TEXT.muted, margin: '0 0 12px' }}>
          Setting the status to Assembled, Tested or Installed records you as the assembler with today&apos;s date.
        </p>
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          <button type="button" style={secondaryBtnStyle} onClick={() => setFormOpen(false)}>Cancel</button>
          <button type="button" style={primaryBtn} disabled={busy} onClick={save}>{busy ? 'Saving…' : editing ? 'Save Changes' : 'Add Panel'}</button>
        </div>
      </Modal>

      <ConfirmDialog
        open={!!deleting}
        title="Delete panel?"
        message={deleting ? `Delete panel ${deleting.panel_tag} (${deleting.name}) from ${job.job_number}?${deleting.component_count ? ` ${deleting.component_count} BOM line(s) are mounted in it — move them to another panel on the BOM tab first.` : ''}` : ''}
        confirmLabel="Delete"
        danger
        onCancel={() => setDeleting(null)}
        onConfirm={() => {
          const p = deleting
          setDeleting(null)
          if (p) mutate(() => electricalApi.deletePanel(job.id, p.id), `Could not delete panel ${p.panel_tag}.`, { success: `Panel ${p.panel_tag} deleted.` })
        }}
      />
    </div>
  )
}
