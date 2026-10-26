'use client'

import Select from '@/components/shared/Select'
import { useCallback, useEffect, useState } from 'react'
import { hrPeriodApi } from '@/lib/api'
import { useAuth } from '@/hooks/useAuth'
import { useCan } from '@/lib/permissions'
import { extractErrorMessages } from '@/lib/validation'
import { primaryBtnStyle, secondaryBtnStyle, RowCount } from '@/components/shared/ui'
import { FormSheet, SheetSection, SheetIcon, Req, SHEET, sheetBtn, sheetInput, sheetLabel, sheetHint } from '@/components/shared/FormSheet'
import PromptDialog from '@/components/erp/PromptDialog'
import { Banner, Pill, downloadBlob, h3, hint, inputStyle, labelStyle, sectionStyle, tableWrap, td, th } from '@/components/hr/hcmUi'

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
const STATUS_LABELS: Record<string, string> = { locked: 'Locked for payroll', open: 'Open (unlocked)' }
const STATUS_HEX: Record<string, string> = { locked: '#DC2626', open: '#16A34A' }

type Period = { id: number; year: number; month: number; label: string; branch_id: number | null; branch_name: string; status: string; locked_by_name: string | null; locked_at: string | null; unlocked_by_name: string | null; unlock_reason: string | null; history: { action: string; by: string; at: string; reason: string | null }[] }

/** Attendance period lock before the ADP payroll export (PT60 cut-off). */
export default function PeriodsPanel() {
  const { user } = useAuth()
  const { canFeature } = useCan()
  // HR › Attendance › Payroll periods feature (lock = create, unlock = cancel, ADP file = export)
  const canLock = canFeature('hr', 'attendance', 'periods', 'create')
  const canExport = canFeature('hr', 'attendance', 'periods', 'export')
  const isPartner = (!!(user as { is_partner?: boolean } | null)?.is_partner || user?.role === 'admin') && canFeature('hr', 'attendance', 'periods', 'cancel')
  const now = new Date()
  // Default = last month (the one usually locked) — in January that's December of last year.
  const [year, setYear] = useState(now.getMonth() === 0 ? now.getFullYear() - 1 : now.getFullYear())
  const [month, setMonth] = useState(now.getMonth() === 0 ? 12 : now.getMonth())
  const [branchId, setBranchId] = useState('')
  const [plants, setPlants] = useState<{ id: number; name: string }[]>([])
  const [items, setItems] = useState<Period[]>([])
  const [error, setError] = useState<string[]>([])
  const [notice, setNotice] = useState('')
  const [confirmLock, setConfirmLock] = useState(false)
  const [unlocking, setUnlocking] = useState<Period | null>(null)

  const load = useCallback(() => {
    hrPeriodApi.list(year).then((res) => { setItems(res.items); setPlants(res.plants); setError([]) })
      .catch((err) => setError(extractErrorMessages(err, "Couldn't load the attendance periods.")))
  }, [year])
  useEffect(() => { load() }, [load])

  const lock = async () => {
    setConfirmLock(false)
    try {
      await hrPeriodApi.lock({ year, month, branch_id: branchId ? Number(branchId) : null })
      setNotice(`${MONTHS[month - 1]} ${year} locked. You can now export it for ADP.`); load()
    } catch (err) { setError(extractErrorMessages(err, "Couldn't lock the period.")) }
  }
  const unlock = async (reason: string) => {
    const p = unlocking
    setUnlocking(null)
    if (!p) return
    try { await hrPeriodApi.unlock(p.id, reason); setNotice(`${p.label} unlocked.`); load() }
    catch (err) { setError(extractErrorMessages(err, "Couldn't unlock the period.")) }
  }
  const exportAdp = async (p: Period) => {
    try {
      const blob = await hrPeriodApi.adpExport({ year: p.year, month: p.month, branch_id: p.branch_id || undefined })
      downloadBlob(blob, `adp_input_${p.year}_${String(p.month).padStart(2, '0')}${p.branch_id ? `_${p.branch_name}` : ''}.csv`)
    } catch (err) { setError(extractErrorMessages(err, "Couldn't export for ADP.")) }
  }

  const plantName = branchId ? plants.find((p) => String(p.id) === branchId)?.name : 'all plants'
  return (
    <div>
      <Banner errors={error} ok={notice} />
      <div style={sectionStyle}>
        <h3 style={h3}>Lock a month for payroll</h3>
        <p style={hint}>Lock the month once attendance, leave and overtime are final, then export it for ADP. While locked nothing can change that month&apos;s attendance (marking, imports, punches, roster, regularizations, leave, overtime). Only a Partner can unlock, with a reason.</p>
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'flex-end' }}>
          <div style={{ flex: '0 1 100px' }}><label style={labelStyle}>Year</label><input type="number" value={year} onChange={(e) => setYear(Number(e.target.value) || now.getFullYear())} style={inputStyle} /></div>
          {canLock && <button type="button" style={primaryBtnStyle} onClick={() => setConfirmLock(true)}>Lock period</button>}
        </div>
      </div>

      <div style={tableWrap}>
        <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 820 }}>
          <thead><tr><th style={th}>Month <RowCount count={items.length} /></th><th style={th}>Plant</th><th style={th}>Status</th><th style={th}>Locked by</th><th style={th}>Last unlock</th><th style={th}></th></tr></thead>
          <tbody>
            {!items.length && <tr><td style={td} colSpan={6}>No period of {year} has been locked yet.</td></tr>}
            {items.map((p) => (
              <tr key={p.id}>
                <td style={td}>{p.label}</td>
                <td style={td}>{p.branch_name}</td>
                <td style={td}><Pill label={STATUS_LABELS[p.status] || p.status} hex={STATUS_HEX[p.status] || '#64748B'} /></td>
                <td style={td}>{p.locked_by_name || '—'}{p.locked_at ? ` · ${new Date(p.locked_at).toLocaleDateString('en-IN')}` : ''}</td>
                <td style={td}>{p.unlocked_by_name ? `${p.unlocked_by_name}: ${p.unlock_reason}` : '—'}</td>
                <td style={{ ...td, whiteSpace: 'nowrap' }}>
                  {p.status === 'locked' && canExport && <button type="button" style={{ ...secondaryBtnStyle, marginRight: 8 }} onClick={() => exportAdp(p)}>Export for ADP</button>}
                  {p.status === 'locked' && isPartner && <button type="button" style={secondaryBtnStyle} onClick={() => setUnlocking(p)}>Unlock</button>}
                  {p.status === 'open' && canLock && <button type="button" style={secondaryBtnStyle} onClick={() => { setMonth(p.month); setBranchId(p.branch_id ? String(p.branch_id) : ''); setConfirmLock(true) }}>Lock again</button>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {confirmLock && (
        <FormSheet width={580} icon="shield" iconColor="#DC2626" title="Lock a month for payroll"
          subtitle="The month's attendance becomes read-only for payroll. Only a Partner can unlock it."
          onClose={() => setConfirmLock(false)} busy={false}
          footer={<>
            <button type="button" style={sheetBtn('secondary', SHEET.INK)} onClick={() => setConfirmLock(false)}>Cancel</button>
            <button type="button" style={sheetBtn('primary', '#DC2626')} onClick={lock}><SheetIcon name="shield" size={16} />Lock {MONTHS[month - 1]} {year}</button>
          </>}>
          <div style={{ padding: '20px 24px' }}>
            <SheetSection icon="calendar" title="Period">
              <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
                <div style={{ flex: '0 1 100px' }}><label style={sheetLabel}>Year <Req /></label><input type="number" value={year} onChange={(e) => setYear(Number(e.target.value) || now.getFullYear())} style={sheetInput} /></div>
                <div style={{ flex: '0 1 150px' }}>
                  <label style={sheetLabel}>Month <Req /></label>
                  <Select value={month} onChange={(e) => setMonth(Number(e.target.value))} style={sheetInput}>{MONTHS.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}</Select>
                </div>
                <div style={{ flex: '1 1 200px' }}>
                  <label style={sheetLabel}>Plant</label>
                  <Select value={branchId} onChange={(e) => setBranchId(e.target.value)} style={sheetInput}>
                    <option value="">All plants</option>
                    {plants.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                  </Select>
                </div>
              </div>
              <p style={sheetHint}>Attendance of {MONTHS[month - 1]} {year} for {plantName} becomes read-only: marking, imports, punches, roster, regularizations, leave and overtime are blocked until a Partner unlocks it.</p>
            </SheetSection>
          </div>
        </FormSheet>
      )}
      <PromptDialog open={!!unlocking} title={unlocking ? `Unlock ${unlocking.label} (${unlocking.branch_name})?` : ''} requireValue
        message="ADP may already have this month's numbers. Say why it must change — the reason is kept with the payroll history."
        placeholder="Reason for unlocking (required)…" confirmLabel="Unlock" onConfirm={unlock} onCancel={() => setUnlocking(null)} />
    </div>
  )
}
