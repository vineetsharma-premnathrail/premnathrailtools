'use client'

// Cable schedule tab — covers Cable / Wiring Design (the schedule itself) and
// Wiring / Harness Installation (moving cables through cut → harnessed →
// installed → terminated → tested, usually a whole harness at a time).
import { useCallback, useEffect, useMemo, useState } from 'react'
import { electricalApi } from '@/lib/api'
import { extractErrorMessages } from '@/lib/validation'
import { TEXT } from '@/lib/theme'
import { secondaryBtnStyle } from '@/components/shared/ui'
import ConfirmDialog from '@/components/erp/ConfirmDialog'
import { ElectricalCable, ElectricalJobDetail, ElectricalMeta } from '@/types'
import {
  inputStyle, labelStyle, sectionStyle, sectionTitle, thStyle, tdStyle, primaryBtn, smallBtn, smallDangerBtn,
  tableWrap, Pill, ErrorBanner, NoticeBanner, Modal, F, rowStyle,
  CABLE_STATUS_LABELS, CABLE_STATUS_HEX, numOrNull, strOrNull,
} from './shared'

type Msg = string | string[]
type CableForm = {
  cable_tag: string; circuit: string; from_point: string; to_point: string; cable_type: string; cores: string
  size_sqmm: string; length_m: string; voltage_rating: string; color_code: string; harness_ref: string
  status: string; remarks: string
}

const INSTALLED = ['installed', 'terminated', 'tested']
const small: React.CSSProperties = { fontSize: 11, color: TEXT.muted, marginTop: 2 }
const fmtNum = (n: number) => n.toLocaleString('en-IN', { maximumFractionDigits: 2 })
const blankForm = (): CableForm => ({
  cable_tag: '', circuit: '', from_point: '', to_point: '', cable_type: '', cores: '', size_sqmm: '', length_m: '',
  voltage_rating: '', color_code: '', harness_ref: '', status: 'designed', remarks: '',
})

// `meta` is part of the shared tab contract; the cable schedule has no coded lists of its own.
export default function CablesTab({ job, canEdit, onChanged }: { job: ElectricalJobDetail; meta: ElectricalMeta; canEdit: boolean; onChanged: () => void }) {
  const [cables, setCables] = useState<ElectricalCable[]>([])
  const [loaded, setLoaded] = useState(false)
  const [error, setError] = useState<Msg>('')
  const [notice, setNotice] = useState('')
  const [busy, setBusy] = useState(false)

  // Filters + bulk selection
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState('')
  const [harnessFilter, setHarnessFilter] = useState('')
  const [selected, setSelected] = useState<number[]>([])
  const [bulkStatus, setBulkStatus] = useState('')

  // Add / edit / delete
  const [formOpen, setFormOpen] = useState(false)
  const [editing, setEditing] = useState<ElectricalCable | null>(null)
  const [form, setForm] = useState<CableForm>(blankForm)
  const [formError, setFormError] = useState<Msg>('')
  const [deleting, setDeleting] = useState<ElectricalCable | null>(null)

  useEffect(() => {
    let cancelled = false
    electricalApi.listCables(job.id)
      .then((rows: ElectricalCable[]) => { if (!cancelled) { setCables(rows); setSelected([]) } })
      .catch((err) => { if (!cancelled) setError(extractErrorMessages(err, `Could not load the cable schedule for ${job.job_number}.`)) })
      .finally(() => { if (!cancelled) setLoaded(true) })
    return () => { cancelled = true }
  }, [job.id, job.job_number])

  const reload = useCallback(async () => {
    try {
      const rows: ElectricalCable[] = await electricalApi.listCables(job.id)
      setCables(rows)
      const ids = new Set(rows.map((c) => c.id))
      setSelected((s) => s.filter((id) => ids.has(id)))
    } catch (err) {
      setError(extractErrorMessages(err, `Could not reload the cable schedule for ${job.job_number}.`))
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

  const harnesses = useMemo(
    () => Array.from(new Set(cables.map((c) => c.harness_ref).filter((h): h is string => !!h))).sort(),
    [cables],
  )

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase()
    return cables.filter((c) => {
      if (statusFilter && c.status !== statusFilter) return false
      if (harnessFilter === '__none__' ? !!c.harness_ref : harnessFilter && c.harness_ref !== harnessFilter) return false
      if (!q) return true
      return [c.cable_tag, c.circuit, c.from_point, c.to_point, c.harness_ref].some((v) => (v || '').toLowerCase().includes(q))
    })
  }, [cables, search, statusFilter, harnessFilter])

  const installedCount = cables.filter((c) => INSTALLED.includes(c.status)).length
  const visibleLength = visible.reduce((sum, c) => sum + (c.length_m || 0), 0)
  const visibleIds = visible.map((c) => c.id)
  const selectedVisible = selected.filter((id) => visibleIds.includes(id))
  const allVisibleSelected = visible.length > 0 && selectedVisible.length === visible.length

  const toggle = (id: number) => setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]))
  const toggleAllVisible = () => setSelected((s) => (
    allVisibleSelected ? s.filter((id) => !visibleIds.includes(id)) : Array.from(new Set([...s, ...visibleIds]))
  ))

  const applyBulk = async () => {
    if (!bulkStatus || !selectedVisible.length) return
    const ids = selectedVisible
    const label = CABLE_STATUS_LABELS[bulkStatus] || bulkStatus
    const ok = await mutate(
      () => electricalApi.bulkCableStatus(job.id, ids, bulkStatus),
      `Could not move ${ids.length} cable(s) to ${label}.`,
      { success: `${ids.length} cable${ids.length === 1 ? '' : 's'} moved to ${label}.` },
    )
    if (ok) { setSelected([]); setBulkStatus('') }
  }

  const set = (k: keyof CableForm, v: string) => setForm((f) => ({ ...f, [k]: v }))

  const openAdd = () => {
    setEditing(null)
    setForm(blankForm())
    setFormError('')
    setFormOpen(true)
  }

  const openEdit = (c: ElectricalCable) => {
    const s = (v?: number | null) => (v == null ? '' : String(v))
    setEditing(c)
    setForm({
      cable_tag: c.cable_tag, circuit: c.circuit || '', from_point: c.from_point, to_point: c.to_point,
      cable_type: c.cable_type || '', cores: s(c.cores), size_sqmm: s(c.size_sqmm), length_m: s(c.length_m),
      voltage_rating: c.voltage_rating || '', color_code: c.color_code || '', harness_ref: c.harness_ref || '',
      status: c.status, remarks: c.remarks || '',
    })
    setFormError('')
    setFormOpen(true)
  }

  const save = async () => {
    setFormError('')
    const problems: string[] = []
    if (!form.cable_tag.trim()) problems.push('Enter a cable tag (e.g. W-101).')
    if (!form.from_point.trim()) problems.push('Enter where the cable runs from.')
    if (!form.to_point.trim()) problems.push('Enter where the cable runs to.')
    const cores = numOrNull(form.cores)
    const size = numOrNull(form.size_sqmm)
    const length = numOrNull(form.length_m)
    if (cores !== null && (!Number.isInteger(cores) || cores < 1 || cores > 200)) problems.push('Cores must be a whole number from 1 to 200.')
    if (size !== null && (!Number.isFinite(size) || size <= 0)) problems.push('Size (mm²) must be greater than 0.')
    if (length !== null && (!Number.isFinite(length) || length <= 0)) problems.push('Length (m) must be greater than 0.')
    if (problems.length) { setFormError(problems); return }

    const payload = {
      cable_tag: form.cable_tag.trim(),
      circuit: strOrNull(form.circuit),
      from_point: form.from_point.trim(),
      to_point: form.to_point.trim(),
      cable_type: strOrNull(form.cable_type),
      cores,
      size_sqmm: size,
      length_m: length,
      voltage_rating: strOrNull(form.voltage_rating),
      color_code: strOrNull(form.color_code),
      harness_ref: strOrNull(form.harness_ref),
      status: form.status,
      remarks: strOrNull(form.remarks),
    }
    const tag = payload.cable_tag.toUpperCase()
    const ok = await mutate(
      () => editing ? electricalApi.updateCable(job.id, editing.id, payload) : electricalApi.createCable(job.id, payload),
      editing ? `Could not save cable ${editing.cable_tag}.` : `Could not add cable ${tag} to the schedule.`,
      { success: editing ? `Cable ${tag} updated.` : `Cable ${tag} added.`, onError: setFormError },
    )
    if (ok) setFormOpen(false)
  }

  const cableSpec = (c: ElectricalCable) => {
    if (c.cores && c.size_sqmm) return `${c.cores} × ${fmtNum(c.size_sqmm)} mm²`
    if (c.cores) return `${c.cores} core`
    if (c.size_sqmm) return `${fmtNum(c.size_sqmm)} mm²`
    return ''
  }

  const headers = [...(canEdit ? ['__check__'] : []), 'Tag', 'Circuit', 'From → To', 'Cable', 'Length m', 'Harness', 'Colour', 'Status', ...(canEdit ? [''] : [])]
  const filtered = !!(search.trim() || statusFilter || harnessFilter)

  return (
    <div style={sectionStyle}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginBottom: 14 }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 14, flexWrap: 'wrap' }}>
          <p style={{ ...sectionTitle, margin: 0 }}>Cable Schedule</p>
          <span style={{ fontSize: 12, color: TEXT.muted }}>
            <strong style={{ color: TEXT.heading }}>{installedCount}</strong> of {cables.length} installed
          </span>
        </div>
        {canEdit && <button type="button" style={primaryBtn} onClick={openAdd}>+ Add Cable</button>}
      </div>

      <ErrorBanner error={error} />
      <NoticeBanner notice={notice} />

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'flex-end', marginBottom: 12 }}>
        <div style={{ flex: '1 1 240px', maxWidth: 340 }}>
          <label style={labelStyle}>Search</label>
          <input style={inputStyle} value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Tag, circuit, from / to, harness…" />
        </div>
        <div style={{ flex: '0 1 160px', minWidth: 140 }}>
          <label style={labelStyle}>Status</label>
          <select style={inputStyle} value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
            <option value="">All statuses</option>
            {Object.entries(CABLE_STATUS_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </div>
        <div style={{ flex: '0 1 170px', minWidth: 140 }}>
          <label style={labelStyle}>Harness</label>
          <select style={inputStyle} value={harnessFilter} onChange={(e) => setHarnessFilter(e.target.value)}>
            <option value="">All harnesses</option>
            <option value="__none__">— No harness —</option>
            {harnesses.map((h) => <option key={h} value={h}>{h}</option>)}
          </select>
        </div>
        {filtered && (
          <button type="button" style={secondaryBtnStyle} onClick={() => { setSearch(''); setStatusFilter(''); setHarnessFilter('') }}>Clear</button>
        )}
        <span style={{ fontSize: 12, color: TEXT.muted, marginLeft: 'auto', paddingBottom: 10 }}>
          {filtered ? `${visible.length} of ${cables.length} cables` : `${cables.length} cable${cables.length === 1 ? '' : 's'}`}
          {' · '}Total length <strong style={{ color: TEXT.heading }}>{fmtNum(visibleLength)} m</strong>
        </span>
      </div>

      {canEdit && selectedVisible.length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'center', padding: '10px 14px', marginBottom: 12, borderRadius: 12, background: 'rgba(255,106,42,0.07)', border: '1px solid rgba(255,106,42,0.25)' }}>
          <span style={{ fontSize: 13, fontWeight: 600, color: TEXT.heading }}>{selectedVisible.length} selected</span>
          <select aria-label="New status for selected cables" style={{ ...inputStyle, width: 'auto', minWidth: 160 }} value={bulkStatus} onChange={(e) => setBulkStatus(e.target.value)}>
            <option value="">Set status to…</option>
            {Object.entries(CABLE_STATUS_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
          <button type="button" style={{ ...primaryBtn, padding: '8px 14px' }} disabled={busy || !bulkStatus} onClick={applyBulk}>
            {busy ? 'Applying…' : `Apply to ${selectedVisible.length} cable${selectedVisible.length === 1 ? '' : 's'}`}
          </button>
          <button type="button" style={smallBtn} onClick={() => setSelected([])}>Clear selection</button>
        </div>
      )}

      <div style={tableWrap}>
        <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: canEdit ? 1180 : 1020 }}>
          <thead>
            <tr>
              {headers.map((h, idx) => h === '__check__' ? (
                <th key="check" style={{ ...thStyle, width: 36 }}>
                  <input type="checkbox" aria-label="Select all visible cables" checked={allVisibleSelected}
                    disabled={!visible.length} onChange={toggleAllVisible} />
                </th>
              ) : <th key={`${h}-${idx}`} style={thStyle}>{h}</th>)}
            </tr>
          </thead>
          <tbody>
            {!loaded ? (
              <tr><td colSpan={headers.length} style={{ ...tdStyle, textAlign: 'center', color: TEXT.muted }}>Loading cable schedule…</td></tr>
            ) : cables.length === 0 ? (
              <tr><td colSpan={headers.length} style={{ ...tdStyle, textAlign: 'center', color: TEXT.muted }}>
                No cables in this job&apos;s schedule yet.{canEdit ? ' Use "+ Add Cable" to start it.' : ''}
              </td></tr>
            ) : visible.length === 0 ? (
              <tr><td colSpan={headers.length} style={{ ...tdStyle, textAlign: 'center', color: TEXT.muted }}>No cables match these filters.</td></tr>
            ) : visible.map((c) => (
              <tr key={c.id} style={selected.includes(c.id) ? { background: 'rgba(255,106,42,0.05)' } : undefined}>
                {canEdit && (
                  <td style={{ ...tdStyle, width: 36 }}>
                    <input type="checkbox" aria-label={`Select cable ${c.cable_tag}`} checked={selected.includes(c.id)} onChange={() => toggle(c.id)} />
                  </td>
                )}
                <td style={{ ...tdStyle, fontWeight: 700, color: TEXT.heading, whiteSpace: 'nowrap' }}>{c.cable_tag}</td>
                <td style={tdStyle}>{c.circuit || <span style={{ color: TEXT.muted }}>—</span>}</td>
                <td style={{ ...tdStyle, minWidth: 200 }}>
                  {c.from_point} <span style={{ color: TEXT.muted }}>→</span> {c.to_point}
                </td>
                <td style={tdStyle}>
                  {cableSpec(c) || c.cable_type ? (
                    <>
                      <div style={{ whiteSpace: 'nowrap' }}>{cableSpec(c) || '—'}</div>
                      {(c.cable_type || c.voltage_rating) && <div style={small}>{[c.cable_type, c.voltage_rating].filter(Boolean).join(' · ')}</div>}
                    </>
                  ) : <span style={{ color: TEXT.muted }}>—</span>}
                </td>
                <td style={tdStyle}>{c.length_m != null ? fmtNum(c.length_m) : <span style={{ color: TEXT.muted }}>—</span>}</td>
                <td style={tdStyle}>{c.harness_ref || <span style={{ color: TEXT.muted }}>—</span>}</td>
                <td style={tdStyle}>{c.color_code || <span style={{ color: TEXT.muted }}>—</span>}</td>
                <td style={tdStyle}><Pill value={c.status} labels={CABLE_STATUS_LABELS} hex={CABLE_STATUS_HEX} /></td>
                {canEdit && (
                  <td style={{ ...tdStyle, whiteSpace: 'nowrap' }}>
                    <div style={{ display: 'flex', gap: 6 }}>
                      <button type="button" style={smallBtn} disabled={busy} onClick={() => openEdit(c)}>Edit</button>
                      <button type="button" style={smallDangerBtn} disabled={busy} onClick={() => setDeleting(c)}>Delete</button>
                    </div>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <Modal open={formOpen} title={editing ? `Edit Cable ${editing.cable_tag}` : 'Add Cable'} onClose={() => setFormOpen(false)} width={720}>
        <ErrorBanner error={formError} />
        <div style={rowStyle}>
          <F label="Cable Tag *" basis={130}>
            <input style={{ ...inputStyle, textTransform: 'uppercase' }} value={form.cable_tag} maxLength={50}
              onChange={(e) => set('cable_tag', e.target.value)} placeholder="W-101" />
          </F>
          <F label="Circuit" basis={220} grow max={320}>
            <input style={inputStyle} value={form.circuit} maxLength={150} onChange={(e) => set('circuit', e.target.value)} placeholder="e.g. Headlamp LH" />
          </F>
          <F label="Harness Ref" basis={130}>
            <input style={inputStyle} value={form.harness_ref} maxLength={50} onChange={(e) => set('harness_ref', e.target.value)} placeholder="H-01" />
          </F>
        </div>
        <div style={rowStyle}>
          <F label="From *" basis={220} grow max={320}>
            <input style={inputStyle} value={form.from_point} maxLength={150} onChange={(e) => set('from_point', e.target.value)} placeholder="e.g. MCP-01 / X1:5" />
          </F>
          <F label="To *" basis={220} grow max={320}>
            <input style={inputStyle} value={form.to_point} maxLength={150} onChange={(e) => set('to_point', e.target.value)} placeholder="e.g. Headlamp LH" />
          </F>
        </div>
        <div style={rowStyle}>
          <F label="Cable Type" basis={180} grow max={260}>
            <input style={inputStyle} value={form.cable_type} maxLength={100} onChange={(e) => set('cable_type', e.target.value)} placeholder="e.g. FRLS PVC, multi-strand Cu" />
          </F>
          <F label="Cores" basis={80}>
            <input style={inputStyle} type="number" min={1} max={200} step={1} value={form.cores} onChange={(e) => set('cores', e.target.value)} />
          </F>
          <F label="Size mm²" basis={100}>
            <input style={inputStyle} type="number" min={0} step="any" value={form.size_sqmm} onChange={(e) => set('size_sqmm', e.target.value)} />
          </F>
          <F label="Length m" basis={100}>
            <input style={inputStyle} type="number" min={0} step="any" value={form.length_m} onChange={(e) => set('length_m', e.target.value)} />
          </F>
        </div>
        <div style={rowStyle}>
          <F label="Voltage Rating" basis={130}>
            <input style={inputStyle} value={form.voltage_rating} maxLength={50} onChange={(e) => set('voltage_rating', e.target.value)} placeholder="1.1 kV" />
          </F>
          <F label="Colour Code" basis={130}>
            <input style={inputStyle} value={form.color_code} maxLength={50} onChange={(e) => set('color_code', e.target.value)} placeholder="Red / Black" />
          </F>
          <F label="Status" basis={150}>
            <select style={inputStyle} value={form.status} onChange={(e) => set('status', e.target.value)}>
              {Object.entries(CABLE_STATUS_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
          </F>
        </div>
        <div style={rowStyle}>
          <F label="Remarks" basis={300} grow>
            <input style={inputStyle} value={form.remarks} onChange={(e) => set('remarks', e.target.value)} />
          </F>
        </div>
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 6 }}>
          <button type="button" style={secondaryBtnStyle} onClick={() => setFormOpen(false)}>Cancel</button>
          <button type="button" style={primaryBtn} disabled={busy} onClick={save}>{busy ? 'Saving…' : editing ? 'Save Changes' : 'Add Cable'}</button>
        </div>
      </Modal>

      <ConfirmDialog
        open={!!deleting}
        title="Delete cable?"
        message={deleting ? `Remove cable ${deleting.cable_tag} (${deleting.from_point} → ${deleting.to_point}) from ${job.job_number}'s cable schedule?` : ''}
        confirmLabel="Delete"
        danger
        onCancel={() => setDeleting(null)}
        onConfirm={() => {
          const c = deleting
          setDeleting(null)
          if (c) mutate(() => electricalApi.deleteCable(job.id, c.id), `Could not delete cable ${c.cable_tag}.`, { success: `Cable ${c.cable_tag} deleted.` })
        }}
      />
    </div>
  )
}
