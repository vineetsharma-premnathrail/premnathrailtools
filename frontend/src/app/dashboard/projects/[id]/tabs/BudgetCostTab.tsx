'use client'

import { useEffect, useState } from 'react'
import { projectsApi } from '@/lib/api'
import { PmBudgetLine, PmBudgetLineInput, PmCostEntry, PmCostEntryInput } from '@/types'
import { TEXT, GLASS, SHADOWS, BORDER, BRAND } from '@/lib/theme'
import DateField from '@/components/erp/DateField'
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

function fmtAmount(n?: number) {
  if (n === undefined || n === null) return '—'
  return n.toLocaleString('en-IN', { maximumFractionDigits: 2 })
}

function emptyBudgetLine(): PmBudgetLineInput & { budgeted_amount_str: string } {
  return { category: '', budgeted_amount: 0, notes: '', budgeted_amount_str: '' }
}

function emptyCostEntry(): PmCostEntryInput & { amount_str: string; budget_line_id_str: string } {
  return { amount: 0, amount_str: '', budget_line_id_str: '', cost_date: '', description: '' }
}

export default function BudgetCostTab({ projectId }: { projectId: number }) {
  const [lines, setLines] = useState<PmBudgetLine[]>([])
  const [entries, setEntries] = useState<PmCostEntry[]>([])
  const [loadingLines, setLoadingLines] = useState(true)
  const [loadingEntries, setLoadingEntries] = useState(true)
  const [error, setError] = useState<string | string[]>('')

  const [showAddLine, setShowAddLine] = useState(false)
  const [newLine, setNewLine] = useState(emptyBudgetLine())
  const [savingLine, setSavingLine] = useState(false)
  const [deleteLineTarget, setDeleteLineTarget] = useState<PmBudgetLine | null>(null)
  const [deletingLine, setDeletingLine] = useState(false)

  const [showAddEntry, setShowAddEntry] = useState(false)
  const [newEntry, setNewEntry] = useState(emptyCostEntry())
  const [savingEntry, setSavingEntry] = useState(false)
  const [deleteEntryTarget, setDeleteEntryTarget] = useState<PmCostEntry | null>(null)
  const [deletingEntry, setDeletingEntry] = useState(false)

  const loadLines = () => {
    setLoadingLines(true)
    projectsApi.listBudgetLines(projectId)
      .then((data) => setLines(Array.isArray(data) ? data : []))
      .catch((err) => setError(extractErrorMessages(err, 'Failed to load budget lines.')))
      .finally(() => setLoadingLines(false))
  }

  const loadEntries = () => {
    setLoadingEntries(true)
    projectsApi.listCostEntries(projectId)
      .then((data) => setEntries(Array.isArray(data) ? data : []))
      .catch((err) => setError(extractErrorMessages(err, 'Failed to load cost entries.')))
      .finally(() => setLoadingEntries(false))
  }

  useEffect(() => { loadLines(); loadEntries() }, [projectId])

  const categoryName = (lineId?: number) => lines.find((l) => l.id === lineId)?.category || '—'

  const handleAddLine = async () => {
    setError('')
    if (!newLine.category.trim()) { setError('Category is required.'); return }
    setSavingLine(true)
    try {
      await projectsApi.createBudgetLine(projectId, {
        category: newLine.category.trim(),
        budgeted_amount: Number(newLine.budgeted_amount_str || 0),
        notes: newLine.notes?.trim() || undefined,
      })
      setNewLine(emptyBudgetLine())
      setShowAddLine(false)
      loadLines()
    } catch (err: any) {
      setError(extractErrorMessages(err, 'Failed to add budget line.'))
    } finally {
      setSavingLine(false)
    }
  }

  const handleDeleteLine = async () => {
    if (!deleteLineTarget) return
    setDeletingLine(true)
    try {
      await projectsApi.deleteBudgetLine(projectId, deleteLineTarget.id)
      setDeleteLineTarget(null)
      loadLines()
    } catch (err: any) {
      setError(extractErrorMessages(err, 'Failed to delete budget line.'))
    } finally {
      setDeletingLine(false)
    }
  }

  const handleAddEntry = async () => {
    setError('')
    if (!newEntry.amount_str || Number(newEntry.amount_str) <= 0) { setError('A valid amount is required.'); return }
    setSavingEntry(true)
    try {
      await projectsApi.createCostEntry(projectId, {
        budget_line_id: newEntry.budget_line_id_str ? Number(newEntry.budget_line_id_str) : undefined,
        amount: Number(newEntry.amount_str),
        cost_date: newEntry.cost_date || undefined,
        description: newEntry.description?.trim() || undefined,
      })
      setNewEntry(emptyCostEntry())
      setShowAddEntry(false)
      loadEntries()
      loadLines()
    } catch (err: any) {
      setError(extractErrorMessages(err, 'Failed to add cost entry.'))
    } finally {
      setSavingEntry(false)
    }
  }

  const handleDeleteEntry = async () => {
    if (!deleteEntryTarget) return
    setDeletingEntry(true)
    try {
      await projectsApi.deleteCostEntry(projectId, deleteEntryTarget.id)
      setDeleteEntryTarget(null)
      loadEntries()
      loadLines()
    } catch (err: any) {
      setError(extractErrorMessages(err, 'Failed to delete cost entry.'))
    } finally {
      setDeletingEntry(false)
    }
  }

  return (
    <div>
      {error && (
        <div style={{ padding: '10px 14px', marginBottom: 16, borderRadius: 10, background: 'rgba(220,38,38,0.08)', border: '1px solid rgba(220,38,38,0.2)', color: '#b91c1c', fontSize: 13 }}>
          {Array.isArray(error) ? error.join(' ') : error}
        </div>
      )}

      <div style={sectionStyle}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14, flexWrap: 'wrap', gap: 10 }}>
          <h2 style={{ fontSize: 15, fontWeight: 700, color: TEXT.heading, margin: 0 }}>Budget Lines</h2>
          <button
            onClick={() => setShowAddLine((s) => !s)}
            type="button"
            style={{ padding: '6px 14px', borderRadius: 8, border: `1px solid ${BRAND.primaryBorder}`, background: BRAND.primarySoft, color: BRAND.primaryActive, fontSize: 12.5, fontWeight: 600, cursor: 'pointer' }}
          >
            {showAddLine ? 'Cancel' : '+ Add Budget Line'}
          </button>
        </div>

        {showAddLine && (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 14, marginBottom: 18, paddingBottom: 18, borderBottom: `1px solid ${BORDER.normal}` }}>
            <div style={{ flex: '1 1 220px', minWidth: 200 }}>
              <label style={labelStyle}>Category *</label>
              <input style={inputStyle} value={newLine.category} onChange={(e) => setNewLine({ ...newLine, category: e.target.value })} />
            </div>
            <div style={{ flex: '0 1 160px', minWidth: 150 }}>
              <label style={labelStyle}>Budgeted Amount *</label>
              <input type="number" min={0} style={inputStyle} value={newLine.budgeted_amount_str} onChange={(e) => setNewLine({ ...newLine, budgeted_amount_str: e.target.value })} />
            </div>
            <div style={{ flex: '1 1 240px', minWidth: 220 }}>
              <label style={labelStyle}>Notes</label>
              <input style={inputStyle} value={newLine.notes || ''} onChange={(e) => setNewLine({ ...newLine, notes: e.target.value })} />
            </div>
            <div style={{ flex: '0 0 auto', alignSelf: 'flex-end' }}>
              <button
                onClick={handleAddLine}
                disabled={savingLine}
                type="button"
                style={{ padding: '10px 20px', borderRadius: 10, border: 'none', cursor: savingLine ? 'not-allowed' : 'pointer', background: '#6366f1', color: '#fff', fontSize: 13, fontWeight: 600, opacity: savingLine ? 0.6 : 1 }}
              >
                {savingLine ? 'Saving…' : 'Save Line'}
              </button>
            </div>
          </div>
        )}

        {loadingLines ? (
          <p style={{ fontSize: 13, color: TEXT.muted }}>Loading…</p>
        ) : lines.length === 0 ? (
          <p style={{ fontSize: 13, color: TEXT.muted }}>No budget lines yet.</p>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 700 }}>
              <thead>
                <tr>
                  {['Category', 'Budgeted', 'Spent', 'Remaining', 'Notes', ''].map((h) => (
                    <th key={h} style={{ textAlign: 'left', padding: '0 8px 8px', fontSize: 11, fontWeight: 600, letterSpacing: '.03em', textTransform: 'uppercase', color: TEXT.muted, whiteSpace: 'nowrap' }}>
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {lines.map((line) => (
                  <tr key={line.id} style={{ borderTop: `1px solid ${BORDER.light}` }}>
                    <td style={{ padding: '10px 8px', fontSize: 13, color: TEXT.heading, fontWeight: 600 }}>{line.category}</td>
                    <td style={{ padding: '10px 8px', fontSize: 12.5, color: TEXT.secondary }}>{fmtAmount(line.budgeted_amount)}</td>
                    <td style={{ padding: '10px 8px', fontSize: 12.5, color: TEXT.secondary }}>{fmtAmount(line.spent_amount)}</td>
                    <td style={{ padding: '10px 8px', fontSize: 12.5, fontWeight: 600, color: (line.remaining_amount ?? 0) < 0 ? '#dc2626' : TEXT.secondary }}>{fmtAmount(line.remaining_amount)}</td>
                    <td style={{ padding: '10px 8px', fontSize: 12.5, color: TEXT.secondary }}>{line.notes || '—'}</td>
                    <td style={{ padding: '10px 8px' }}>
                      <span onClick={() => setDeleteLineTarget(line)} style={{ fontSize: 12, fontWeight: 600, color: '#dc2626', cursor: 'pointer', whiteSpace: 'nowrap' }}>Delete</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div style={sectionStyle}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14, flexWrap: 'wrap', gap: 10 }}>
          <h2 style={{ fontSize: 15, fontWeight: 700, color: TEXT.heading, margin: 0 }}>Cost Entries</h2>
          <button
            onClick={() => setShowAddEntry((s) => !s)}
            type="button"
            style={{ padding: '6px 14px', borderRadius: 8, border: `1px solid ${BRAND.primaryBorder}`, background: BRAND.primarySoft, color: BRAND.primaryActive, fontSize: 12.5, fontWeight: 600, cursor: 'pointer' }}
          >
            {showAddEntry ? 'Cancel' : '+ Add Cost Entry'}
          </button>
        </div>

        {showAddEntry && (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 14, marginBottom: 18, paddingBottom: 18, borderBottom: `1px solid ${BORDER.normal}` }}>
            <div style={{ flex: '0 1 200px', minWidth: 180 }}>
              <label style={labelStyle}>Budget Line</label>
              <select style={inputStyle} value={newEntry.budget_line_id_str} onChange={(e) => setNewEntry({ ...newEntry, budget_line_id_str: e.target.value })}>
                <option value="">None</option>
                {lines.map((l) => <option key={l.id} value={l.id}>{l.category}</option>)}
              </select>
            </div>
            <div style={{ flex: '0 1 150px', minWidth: 140 }}>
              <label style={labelStyle}>Amount *</label>
              <input type="number" min={0} style={inputStyle} value={newEntry.amount_str} onChange={(e) => setNewEntry({ ...newEntry, amount_str: e.target.value })} />
            </div>
            <div style={{ flex: '0 1 160px', minWidth: 150 }}>
              <label style={labelStyle}>Cost Date</label>
              <DateField value={newEntry.cost_date || ''} onChange={(v) => setNewEntry({ ...newEntry, cost_date: v })} />
            </div>
            <div style={{ flex: '1 1 220px', minWidth: 200 }}>
              <label style={labelStyle}>Description</label>
              <input style={inputStyle} value={newEntry.description || ''} onChange={(e) => setNewEntry({ ...newEntry, description: e.target.value })} />
            </div>
            <div style={{ flex: '0 0 auto', alignSelf: 'flex-end' }}>
              <button
                onClick={handleAddEntry}
                disabled={savingEntry}
                type="button"
                style={{ padding: '10px 20px', borderRadius: 10, border: 'none', cursor: savingEntry ? 'not-allowed' : 'pointer', background: '#6366f1', color: '#fff', fontSize: 13, fontWeight: 600, opacity: savingEntry ? 0.6 : 1 }}
              >
                {savingEntry ? 'Saving…' : 'Save Entry'}
              </button>
            </div>
          </div>
        )}

        {loadingEntries ? (
          <p style={{ fontSize: 13, color: TEXT.muted }}>Loading…</p>
        ) : entries.length === 0 ? (
          <p style={{ fontSize: 13, color: TEXT.muted }}>No cost entries yet.</p>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 800 }}>
              <thead>
                <tr>
                  {['Category', 'Amount', 'Date', 'Description', 'Recorded By', ''].map((h) => (
                    <th key={h} style={{ textAlign: 'left', padding: '0 8px 8px', fontSize: 11, fontWeight: 600, letterSpacing: '.03em', textTransform: 'uppercase', color: TEXT.muted, whiteSpace: 'nowrap' }}>
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {entries.map((entry) => (
                  <tr key={entry.id} style={{ borderTop: `1px solid ${BORDER.light}` }}>
                    <td style={{ padding: '10px 8px', fontSize: 13, color: TEXT.heading, fontWeight: 600 }}>{categoryName(entry.budget_line_id)}</td>
                    <td style={{ padding: '10px 8px', fontSize: 12.5, color: TEXT.secondary }}>{fmtAmount(entry.amount)}</td>
                    <td style={{ padding: '10px 8px', fontSize: 12.5, color: TEXT.secondary, whiteSpace: 'nowrap' }}>{entry.cost_date || '—'}</td>
                    <td style={{ padding: '10px 8px', fontSize: 12.5, color: TEXT.secondary }}>{entry.description || '—'}</td>
                    <td style={{ padding: '10px 8px', fontSize: 12.5, color: TEXT.secondary }}>{entry.recorded_by_name || '—'}</td>
                    <td style={{ padding: '10px 8px' }}>
                      <span onClick={() => setDeleteEntryTarget(entry)} style={{ fontSize: 12, fontWeight: 600, color: '#dc2626', cursor: 'pointer', whiteSpace: 'nowrap' }}>Delete</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <ConfirmDialog
        open={!!deleteLineTarget}
        title="Delete this budget line?"
        message={`Delete budget line "${deleteLineTarget?.category}"? This action cannot be undone.`}
        confirmLabel={deletingLine ? 'Deleting…' : 'Delete'}
        onConfirm={handleDeleteLine}
        onCancel={() => setDeleteLineTarget(null)}
      />

      <ConfirmDialog
        open={!!deleteEntryTarget}
        title="Delete this cost entry?"
        message={`Delete this cost entry of ${fmtAmount(deleteEntryTarget?.amount)}? This action cannot be undone.`}
        confirmLabel={deletingEntry ? 'Deleting…' : 'Delete'}
        onConfirm={handleDeleteEntry}
        onCancel={() => setDeleteEntryTarget(null)}
      />
    </div>
  )
}
