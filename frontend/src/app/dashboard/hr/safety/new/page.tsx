'use client'

import Select from '@/components/shared/Select'
import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useRequireApp } from '@/hooks/useAuth'
import { hrSafetyApi } from '@/lib/api'
import { extractErrorMessages } from '@/lib/validation'
import { recordPath } from '@/lib/recordRef'
import HrNav from '@/components/hr/HrNav'
import DateField from '@/components/erp/DateField'
import SearchableSelect from '@/components/erp/SearchableSelect'
import { FormPage, SheetColumns, SheetSection, SheetIcon, Optional, Req, SHEET, sheetBtn, sheetInput, sheetLabel, sheetHint } from '@/components/shared/FormSheet'
import PersonFields, { EMPTY_PERSON, PersonForm, personToPayload } from '@/components/hr/safety/PersonFields'
import { SafetyMeta } from '@/components/hr/safety/types'

function todayIso() {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

export default function NewSafetyIncidentPage() {
  const { isAuthorized, isLoading, user } = useRequireApp('hr')
  const router = useRouter()
  const [meta, setMeta] = useState<SafetyMeta | null>(null)
  const [error, setError] = useState<string[]>([])
  const [saving, setSaving] = useState(false)
  const [f, setF] = useState({
    title: '', incident_type: 'near_miss', severity: 'low', branch_id: '', department_id: '', location_text: '',
    date: todayIso(), time: '', description: '', immediate_action: '', asset_id: '', erp_project_id: '',
  })
  const [persons, setPersons] = useState<PersonForm[]>([])
  const [witnesses, setWitnesses] = useState<{ name: string; statement: string }[]>([])
  const [files, setFiles] = useState<File[]>([])

  useEffect(() => {
    if (!isAuthorized) return
    hrSafetyApi.meta().then((m: SafetyMeta) => setMeta(m)).catch((err) => setError(extractErrorMessages(err, 'Could not load the form lists.')))
  }, [isAuthorized])
  useEffect(() => {
    if (user?.branch_id && !f.branch_id) setF((x) => ({ ...x, branch_id: String(user.branch_id) }))
  }, [user, f.branch_id])

  const set = (k: keyof typeof f, v: string) => setF((x) => ({ ...x, [k]: v }))

  const submit = async () => {
    const problems: string[] = []
    if (f.title.trim().length < 3) problems.push('Give the incident a short title (what happened).')
    if (!f.date || !f.time) problems.push('Enter the date and time it happened.')
    if (f.description.trim().length < 10) problems.push('Describe what happened in a few sentences (at least 10 characters).')
    persons.forEach((p, i) => {
      if (p.person_type === 'employee' && !p.user_id) problems.push(`Person ${i + 1}: pick the employee.`)
      if (p.person_type !== 'employee' && !p.external_name.trim()) problems.push(`Person ${i + 1}: type their name.`)
    })
    if (problems.length) { setError(problems); return }
    setSaving(true)
    setError([])
    try {
      const inc = await hrSafetyApi.create({
        title: f.title.trim(), incident_type: f.incident_type, severity: f.severity,
        branch_id: f.branch_id ? Number(f.branch_id) : null, department_id: f.department_id ? Number(f.department_id) : null,
        location_text: f.location_text.trim() || null, occurred_at: `${f.date}T${f.time}:00+05:30`,
        description: f.description.trim(), immediate_action: f.immediate_action.trim() || null,
        asset_id: f.asset_id ? Number(f.asset_id) : null, erp_project_id: f.erp_project_id ? Number(f.erp_project_id) : null,
        witnesses: witnesses.filter((w) => w.name.trim()).map((w) => ({ name: w.name.trim(), statement: w.statement.trim() || null })),
        persons: persons.map(personToPayload),
      })
      for (const file of files) {
        try { await hrSafetyApi.uploadAttachment(inc.id, file) } catch { /* upload failure shouldn't block the report */ }
      }
      router.push(recordPath('/dashboard/hr/safety', inc))
    } catch (err) {
      setError(extractErrorMessages(err, 'The incident could not be reported.'))
      setSaving(false)
    }
  }

  if (isLoading || !isAuthorized) return null

  const back = () => router.push('/dashboard/hr/safety')
  const L = (text: string, req = false) => <label style={sheetLabel}>{text}{req && <> <Req /></>}</label>

  return (
    <div>
      <FormPage nav={<HrNav />} tour="hr-safety-new-form" icon="alert" iconColor="#DC2626" title="Report an incident"
        subtitle="Report every accident, near miss, dangerous occurrence and first-aid case as soon as the area is safe. The plant head and the EHS team are alerted; a high or fatal incident also alerts the Partners."
        onBack={back} backTour="hr-safety-new-back"
        footer={<>
          <button type="button" style={sheetBtn('secondary', SHEET.INK, saving)} disabled={saving} onClick={back}>Cancel</button>
          <button type="button" disabled={saving || !meta} style={sheetBtn('primary', '#DC2626', saving || !meta)} onClick={submit}><SheetIcon name="send" size={16} />{saving ? 'Reporting…' : 'Report incident'}</button>
        </>}>
        {error.length > 0 && (
          <div style={{ padding: '16px 24px 0' }}>
            <div style={{ padding: '10px 14px', borderRadius: 10, background: 'rgba(220,38,38,0.08)', border: '1px solid rgba(220,38,38,0.2)', color: '#b91c1c', fontSize: 13 }}>
              {error.join(' ')}
            </div>
          </div>
        )}
        {!meta && error.length === 0 && <p style={{ padding: '20px 24px', margin: 0, fontSize: 13, color: SHEET.MUTED }}>Loading…</p>}

        {meta && (
          <>
            <SheetColumns
              left={<>
                <SheetSection icon="alert" title="What Happened" color="#DC2626">
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12 }}>
                    <div style={{ flex: '1 1 100%' }}>
                      {L('Title', true)}
                      <input style={sheetInput} value={f.title} onChange={(e) => set('title', e.target.value)} placeholder="e.g. Hand caught in press brake" maxLength={200} />
                    </div>
                    <div style={{ flex: '1 1 210px', maxWidth: 260 }}>
                      {L('Type', true)}
                      <Select style={sheetInput} value={f.incident_type} onChange={(e) => set('incident_type', e.target.value)}>
                        {meta.incident_types.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                      </Select>
                    </div>
                    <div style={{ flex: '0 1 130px', minWidth: 120 }}>
                      {L('Severity', true)}
                      <Select style={sheetInput} value={f.severity} onChange={(e) => set('severity', e.target.value)}>
                        {meta.severities.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                      </Select>
                    </div>
                    <div style={{ flex: '0 1 160px', minWidth: 150 }}>
                      {L('Date', true)}
                      <DateField value={f.date} onChange={(v) => set('date', v)} />
                    </div>
                    <div style={{ flex: '0 1 120px', minWidth: 110 }}>
                      {L('Time', true)}
                      <input type="time" style={sheetInput} value={f.time} onChange={(e) => set('time', e.target.value)} />
                    </div>
                  </div>
                </SheetSection>
                <SheetSection icon="chat" title="Description">
                  {L('Description', true)}
                  <textarea style={{ ...sheetInput, minHeight: 90, resize: 'vertical' }} value={f.description} onChange={(e) => set('description', e.target.value)} placeholder="What was being done, what went wrong, what happened next…" />
                  <div style={{ marginTop: 14 }}>
                    {L('Immediate action taken')}
                    <textarea style={{ ...sheetInput, minHeight: 60, resize: 'vertical' }} value={f.immediate_action} onChange={(e) => set('immediate_action', e.target.value)} placeholder="First aid, hospital, machine isolated, area barricaded…" />
                  </div>
                </SheetSection>
              </>}
              right={<>
                <SheetSection icon="building" title="Where">
                  {L('Plant')}
                  <Select style={sheetInput} value={f.branch_id} onChange={(e) => set('branch_id', e.target.value)}>
                    <option value="">Customer site / other</option>
                    {meta.branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
                  </Select>
                  <div style={{ marginTop: 12 }}>
                    {L('Department')}
                    <SearchableSelect value={f.department_id} onChange={(v) => set('department_id', v)} placeholder="Select…"
                      options={meta.departments.filter((d) => !f.branch_id || !d.branch_id || String(d.branch_id) === f.branch_id).map((d) => ({ value: String(d.id), label: d.name }))} />
                  </div>
                  <div style={{ marginTop: 12 }}>
                    {L('Exact place')}
                    <input style={sheetInput} value={f.location_text} onChange={(e) => set('location_text', e.target.value)} placeholder="e.g. Fabrication bay 2, near CNC-04" />
                  </div>
                </SheetSection>
                <SheetSection icon="tool" title="Equipment" extra={<Optional />}>
                  {L('Machine / equipment involved')}
                  <SearchableSelect value={f.asset_id} onChange={(v) => set('asset_id', v)} placeholder="Plant machine (optional)…"
                    options={meta.assets.map((a) => ({ value: String(a.id), label: a.label }))} />
                  <div style={{ marginTop: 12 }}>
                    {L('Customer machine (site incident)')}
                    <SearchableSelect value={f.erp_project_id} onChange={(v) => set('erp_project_id', v)} placeholder="Commissioning / service site (optional)…"
                      options={meta.projects.map((p) => ({ value: String(p.id), label: p.label }))} />
                  </div>
                </SheetSection>
                <SheetSection icon="clip" title="Photos / Documents" extra={<Optional />}>
                  <input type="file" multiple accept="image/*,.pdf,.doc,.docx,.xls,.xlsx" onChange={(e) => setFiles(Array.from(e.target.files || []))} style={sheetInput} />
                  {files.length > 0 && <p style={sheetHint}>{files.length} file(s) — uploaded after the report is saved.</p>}
                </SheetSection>
              </>}
            />

            <div style={{ padding: '20px 24px 4px', borderTop: `1px solid ${SHEET.LINE}` }}>
              <SheetSection icon="users" title="Persons Injured / Involved" extra={<button type="button" style={{ ...sheetBtn('secondary', SHEET.BLUE), marginLeft: 'auto' }} onClick={() => setPersons([...persons, { ...EMPTY_PERSON }])}><SheetIcon name="plus" size={14} />Add person</button>}>
                {persons.length === 0 && <p style={{ fontSize: 13, color: SHEET.MUTED, margin: 0 }}>Nobody hurt (near miss / property damage)? Leave this empty.</p>}
                {persons.map((p, i) => (
                  <div key={i} style={{ border: `1px solid ${SHEET.LINE}`, borderRadius: 12, padding: '12px 14px', marginTop: i ? 10 : 0 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
                      <b style={{ fontSize: 12.5, color: SHEET.INK }}>Person {i + 1}</b>
                      <button type="button" onClick={() => setPersons(persons.filter((_, j) => j !== i))} style={sheetBtn('ghost', '#b91c1c')}><SheetIcon name="trash" size={14} />Remove</button>
                    </div>
                    <PersonFields value={p} meta={meta} onChange={(np) => setPersons(persons.map((x, j) => (j === i ? np : x)))} />
                  </div>
                ))}
              </SheetSection>

              <SheetSection icon="user" title="Witnesses" extra={<button type="button" style={{ ...sheetBtn('secondary', SHEET.BLUE), marginLeft: 'auto' }} onClick={() => setWitnesses([...witnesses, { name: '', statement: '' }])}><SheetIcon name="plus" size={14} />Add witness</button>}>
                {witnesses.length === 0 && <p style={{ fontSize: 13, color: SHEET.MUTED, margin: 0 }}>Add anyone who saw it happen.</p>}
                {witnesses.map((w, i) => (
                  <div key={i} style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 8, alignItems: 'center' }}>
                    <input style={{ ...sheetInput, flex: '0 1 240px' }} placeholder="Name" value={w.name} onChange={(e) => setWitnesses(witnesses.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))} />
                    <input style={{ ...sheetInput, flex: '1 1 300px', width: 'auto' }} placeholder="What they saw" value={w.statement} onChange={(e) => setWitnesses(witnesses.map((x, j) => (j === i ? { ...x, statement: e.target.value } : x)))} />
                    <button type="button" style={sheetBtn('ghost', '#b91c1c')} onClick={() => setWitnesses(witnesses.filter((_, j) => j !== i))}><SheetIcon name="trash" size={14} />Remove</button>
                  </div>
                ))}
              </SheetSection>
            </div>
          </>
        )}
      </FormPage>
    </div>
  )
}
