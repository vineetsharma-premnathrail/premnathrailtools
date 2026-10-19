'use client'

import { useCallback, useEffect, useState } from 'react'
import { useRequireApp } from '@/hooks/useAuth'
import { useCan } from '@/lib/permissions'
import { hrApi, hrOrgApi, hrRegisterApi } from '@/lib/api'
import { extractErrorMessages } from '@/lib/validation'
import { TEXT } from '@/lib/theme'
import { primaryBtnStyle, secondaryBtnStyle } from '@/components/shared/ui'
import HrNav from '@/components/hr/HrNav'
import DateField from '@/components/erp/DateField'
import ManagedDocumentPanel from '@/components/shared/ManagedDocumentPanel'
import { Banner, PortalModal, downloadBlob, h3, hint, inputStyle, labelStyle, localIso, sectionStyle, tableWrap, td, th } from '@/components/hr/hcmUi'
import { SHEET, sheetBtn } from '@/components/shared/FormSheet'

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']

type Reg = { id: number; register_type: string; register_label: string; branch_id: number; branch_name: string; year: number; month: number; period: string; revision: number; generated_at: string | null; generated_by_name: string | null }
type RegType = { key: string; label: string; monthly: boolean }

/** HR › Reports: statutory registers per plant (Factories Act Form 12, Form 25
 * muster roll, Form 14 leave register) as managed Word documents with an Excel
 * soft copy, plus date-effective headcount from the assignment history. */
export default function HrReportsPage() {
  const { isAuthorized, isLoading } = useRequireApp('hr')
  const { can } = useCan()
  const canGenerate = can('hr', 'reports', 'print')
  const canExport = can('hr', 'reports', 'export')
  const now = new Date()
  const [types, setTypes] = useState<RegType[]>([])
  const [plants, setPlants] = useState<{ id: number; name: string }[]>([])
  const [rows, setRows] = useState<Reg[]>([])
  const [error, setError] = useState<string[]>([])
  const [notice, setNotice] = useState('')
  const [form, setForm] = useState({ register_type: 'form25', branch_id: '', year: now.getFullYear(), month: now.getMonth() || 12 })
  const [docFor, setDocFor] = useState<Reg | null>(null)
  const [asOf, setAsOf] = useState(localIso())
  const [headcount, setHeadcount] = useState<{ total: number; by_department: Record<string, number> } | null>(null)

  const load = useCallback(() => {
    hrRegisterApi.list().then(setRows).catch((err) => setError(extractErrorMessages(err, "Couldn't load the registers.")))
  }, [])
  useEffect(() => {
    if (!isAuthorized) return
    load()
    hrRegisterApi.types().then(setTypes).catch(() => setTypes([]))
    hrApi.getAttendanceLookups().then((l) => setPlants(l.branches)).catch(() => setPlants([]))
  }, [isAuthorized, load])

  const generate = async () => {
    if (!form.branch_id) { setError(['Pick the plant the register is for.']); return }
    const monthly = types.find((t) => t.key === form.register_type)?.monthly
    try {
      const r = await hrRegisterApi.generate({ ...form, branch_id: Number(form.branch_id), month: monthly ? form.month : 0 })
      setNotice(`${r.register_label} ready for ${r.branch_name}, ${r.period}. Open it in Word to review, sign and print.`)
      setError([]); load(); setDocFor(r)
    } catch (err) { setError(extractErrorMessages(err, "Couldn't generate the register.")) }
  }
  const xlsx = async (r: Reg) => {
    try { downloadBlob(await hrRegisterApi.xlsx(r.id), `${r.register_type}_${r.branch_name}_${r.year}${r.month ? `_${String(r.month).padStart(2, '0')}` : ''}.xlsx`) }
    catch (err) { setError(extractErrorMessages(err, "Couldn't export the register to Excel.")) }
  }
  const loadHeadcount = async () => {
    try { setHeadcount(await hrOrgApi.asOf({ date: asOf })) }
    catch (err) { setError(extractErrorMessages(err, "Couldn't load the headcount.")) }
  }

  if (isLoading || !isAuthorized) return null
  const monthly = types.find((t) => t.key === form.register_type)?.monthly

  return (
    <div>
      <HrNav />
      <div style={{ marginBottom: 18 }}>
        <p style={{ fontSize: 11.5, fontWeight: 600, letterSpacing: '.05em', textTransform: 'uppercase', color: TEXT.muted, margin: '0 0 4px' }}>HR &amp; Administration · Reports</p>
        <h1 style={{ fontSize: 24, fontWeight: 700, color: TEXT.heading, margin: '0 0 4px' }}>Statutory registers &amp; reports</h1>
        <p style={{ fontSize: 13.5, color: TEXT.muted, margin: 0 }}>Factories Act registers per plant, built from attendance, leave and approved overtime. The Word document is the register of record.</p>
      </div>
      <Banner errors={error} ok={notice} />

      {canGenerate && (
        <div style={{ ...sectionStyle, display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'flex-end' }}>
          <div style={{ flex: '1 1 260px', maxWidth: 340 }}>
            <label style={labelStyle}>Register</label>
            <select value={form.register_type} onChange={(e) => setForm({ ...form, register_type: e.target.value })} style={inputStyle}>
              {types.map((t) => <option key={t.key} value={t.key}>{t.label}</option>)}
            </select>
          </div>
          <div style={{ flex: '0 1 220px' }}>
            <label style={labelStyle}>Plant</label>
            <select value={form.branch_id} onChange={(e) => setForm({ ...form, branch_id: e.target.value })} style={inputStyle}>
              <option value="">Pick a plant…</option>
              {plants.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </div>
          <div style={{ flex: '0 1 100px' }}><label style={labelStyle}>Year</label><input type="number" value={form.year} onChange={(e) => setForm({ ...form, year: Number(e.target.value) || now.getFullYear() })} style={inputStyle} /></div>
          {monthly && (
            <div style={{ flex: '0 1 150px' }}>
              <label style={labelStyle}>Month</label>
              <select value={form.month} onChange={(e) => setForm({ ...form, month: Number(e.target.value) })} style={inputStyle}>{MONTHS.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}</select>
            </div>
          )}
          <button type="button" style={primaryBtnStyle} onClick={generate}>Generate</button>
        </div>
      )}

      <div style={tableWrap}>
        <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 820 }}>
          <thead><tr><th style={th}>Register</th><th style={th}>Plant</th><th style={th}>Period</th><th style={th}>Generated</th><th style={th}></th></tr></thead>
          <tbody>
            {!rows.length && <tr><td style={td} colSpan={5}>No register generated yet.</td></tr>}
            {rows.map((r) => (
              <tr key={r.id}>
                <td style={td}>{r.register_label}{r.revision ? ` (rev ${r.revision})` : ''}</td>
                <td style={td}>{r.branch_name}</td>
                <td style={td}>{r.period}</td>
                <td style={td}>{r.generated_by_name || '—'}{r.generated_at ? ` · ${new Date(r.generated_at).toLocaleDateString('en-IN')}` : ''}</td>
                <td style={{ ...td, whiteSpace: 'nowrap' }}>
                  <button type="button" style={{ ...primaryBtnStyle, marginRight: 8 }} onClick={() => setDocFor(r)}>Word document</button>
                  {canExport && <button type="button" style={secondaryBtnStyle} onClick={() => xlsx(r)}>Excel</button>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div style={{ ...sectionStyle, display: 'flex', gap: 12, alignItems: 'flex-end', flexWrap: 'wrap' }}>
        <div style={{ flex: '1 1 100%' }}><h3 style={h3}>Headcount on a date</h3><p style={{ ...hint, margin: 0 }}>From the assignment history (who was in which department on that day).</p></div>
        <div style={{ flex: '0 1 170px' }}><label style={labelStyle}>As on</label><DateField value={asOf} onChange={setAsOf} /></div>
        <button type="button" style={secondaryBtnStyle} onClick={loadHeadcount}>Show</button>
        {headcount && (
          <div style={{ flex: '1 1 100%', fontSize: 13, color: TEXT.body }}>
            <b>{headcount.total}</b> employee(s): {Object.entries(headcount.by_department).map(([d, n]) => `${d} ${n}`).join(' · ') || '—'}
          </div>
        )}
      </div>

      <PortalModal open={!!docFor} icon="doc" width={760} title={docFor ? `${docFor.register_label} — ${docFor.branch_name}, ${docFor.period}` : ''}
        subtitle="Statutory register as a managed Word document." onClose={() => setDocFor(null)}
        footer={<button type="button" style={sheetBtn('secondary', SHEET.INK)} onClick={() => setDocFor(null)}>Close</button>}>
        {docFor && (
          <ManagedDocumentPanel entityType="hr_statutory_register" entityId={docFor.id} revision={docFor.revision} canModify={canGenerate}
            recordLabel="register" downloadName={`${docFor.register_type}-${docFor.branch_name}-${docFor.year}${docFor.month ? `-${docFor.month}` : ''}`} />
        )}
      </PortalModal>
    </div>
  )
}
