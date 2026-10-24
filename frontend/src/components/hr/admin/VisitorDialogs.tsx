'use client'

import Select from '@/components/shared/Select'
import { useEffect, useState } from 'react'
import { hrApi } from '@/lib/api'
import { extractErrorMessages } from '@/lib/validation'
import type { HrVisitor, HrBranchLookup, DirectoryUser } from '@/types'
import DateField from '@/components/erp/DateField'
import SearchableSelect from '@/components/erp/SearchableSelect'
import { SheetColumns, SheetSection, SheetIcon, Optional, Req, SHEET, sheetBtn, sheetInput, sheetLabel, sheetHint } from '@/components/shared/FormSheet'
import { FormDialog, ErrorBanner, todayIso } from './adminUi'

export const ID_PROOF_TYPES = ['Aadhaar', 'PAN', 'Driving Licence', 'Passport', 'Voter ID', 'Company ID', 'Other']

const row: React.CSSProperties = { display: 'flex', flexWrap: 'wrap', gap: 12 }

function Fld({ label, children, basis = 200, grow = false, max, req = false }: { label: string; children: React.ReactNode; basis?: number; grow?: boolean; max?: number; req?: boolean }) {
  return (
    <div style={{ flex: grow ? `1 1 ${basis}px` : `0 1 ${basis}px`, minWidth: Math.min(basis, 130), maxWidth: max }}>
      <label style={sheetLabel}>{label}{req && <> <Req /></>}</label>
      {children}
    </div>
  )
}

/** Local IST wall-clock date + time → ISO string the backend stores. */
export function toIstIso(dateIso: string, time: string): string | null {
  if (!dateIso) return null
  return `${dateIso}T${time || '09:00'}:00+05:30`
}

// ── Register / pre-register ─────────────────────────────────────────────────

export function RegisterVisitorDialog({
  open, isHr, selfId, people, branches, onClose, onSaved,
}: {
  open: boolean
  isHr: boolean
  selfId: number
  people: DirectoryUser[]
  branches: HrBranchLookup[]
  onClose: () => void
  onSaved: (v: HrVisitor) => void
}) {
  const blank = {
    visitor_name: '', visitor_company: '', visitor_phone: '', visitor_email: '', purpose: '', host_user_id: '', branch_id: '',
    expected_date: todayIso(), expected_time: '', number_of_persons: '1', vehicle_no: '', id_proof_type: '', id_proof_last4: '',
    items_carried: '', remarks: '', check_in_now: false, badge_no: '',
  }
  const [f, setF] = useState(blank)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string[]>([])

  useEffect(() => {
    if (open) { setF({ ...blank, host_user_id: String(selfId) }); setError([]) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, selfId])

  const set = <K extends keyof typeof blank>(k: K) => (v: (typeof blank)[K]) => setF((p) => ({ ...p, [k]: v }))

  const save = async () => {
    const problems: string[] = []
    if (!f.visitor_name.trim()) problems.push("Enter the visitor's name.")
    if (isHr && !f.host_user_id) problems.push('Pick the employee the visitor is meeting (host).')
    const persons = Number(f.number_of_persons)
    if (!Number.isInteger(persons) || persons < 1) problems.push('Number of persons must be a whole number, 1 or more.')
    if (problems.length) { setError(problems); return }
    setSaving(true); setError([])
    try {
      const v = await hrApi.createVisitor({
        visitor_name: f.visitor_name.trim(), visitor_company: f.visitor_company || null, visitor_phone: f.visitor_phone || null,
        visitor_email: f.visitor_email || null, purpose: f.purpose || null,
        host_user_id: isHr ? Number(f.host_user_id) : selfId,
        branch_id: f.branch_id ? Number(f.branch_id) : null,
        expected_at: f.check_in_now ? null : toIstIso(f.expected_date, f.expected_time),
        number_of_persons: persons, vehicle_no: f.vehicle_no || null, id_proof_type: f.id_proof_type || null,
        id_proof_last4: f.id_proof_last4 || null, items_carried: f.items_carried || null, remarks: f.remarks || null,
        check_in_now: isHr && f.check_in_now, badge_no: f.badge_no || null,
      })
      onSaved(v)
    } catch (err) {
      setError(extractErrorMessages(err, 'The visitor could not be registered.'))
    } finally {
      setSaving(false)
    }
  }

  return (
    <FormDialog
      open={open}
      title={isHr ? 'Register visitor' : 'Pre-register a visitor'}
      subtitle={isHr ? 'Pre-register an expected visitor, or tick “Walk-in” to check them in right away. The host is notified on check-in.' : 'Reception will see this visitor on the gate board and notify you when they check in.'}
      icon="users"
      onClose={onClose}
      busy={saving}
      maxWidth={960}
      bare
      footer={<>
        <button type="button" style={sheetBtn('secondary', SHEET.INK, saving)} onClick={onClose} disabled={saving}>Cancel</button>
        <button type="button" data-tour="hr-visitor-form-save" style={sheetBtn('primary', SHEET.BLUE, saving)} onClick={save} disabled={saving}>
          <SheetIcon name={f.check_in_now ? 'check' : 'plus'} size={16} />{saving ? 'Saving…' : f.check_in_now ? 'Register & check in' : 'Register visitor'}
        </button>
      </>}
    >
      <SheetColumns
        left={<>
          <ErrorBanner error={error} />
          <SheetSection icon="user" title="Visitor">
            <div style={row}>
              <Fld label="Visitor name" req basis={220} grow max={320}><input data-tour="hr-visitor-form-name" style={sheetInput} value={f.visitor_name} onChange={(e) => set('visitor_name')(e.target.value)} /></Fld>
              <Fld label="Company" basis={200} grow max={300}><input data-tour="hr-visitor-form-company" style={sheetInput} value={f.visitor_company} onChange={(e) => set('visitor_company')(e.target.value)} /></Fld>
            </div>
            <div style={{ ...row, marginTop: 12 }}>
              <Fld label="Phone" basis={160}><input data-tour="hr-visitor-form-phone" style={sheetInput} inputMode="tel" value={f.visitor_phone} onChange={(e) => set('visitor_phone')(e.target.value)} /></Fld>
              <Fld label="Email" basis={220} grow max={300}><input data-tour="hr-visitor-form-email" style={sheetInput} type="email" value={f.visitor_email} onChange={(e) => set('visitor_email')(e.target.value)} /></Fld>
              <Fld label="Persons" basis={90}><input data-tour="hr-visitor-form-persons" style={sheetInput} inputMode="numeric" value={f.number_of_persons} onChange={(e) => set('number_of_persons')(e.target.value.replace(/\D/g, ''))} /></Fld>
            </div>
            <label style={{ ...sheetLabel, marginTop: 12 }}>Purpose of visit</label>
            <input data-tour="hr-visitor-form-purpose" style={sheetInput} value={f.purpose} onChange={(e) => set('purpose')(e.target.value)} placeholder="Vendor meeting, interview, audit, delivery…" />
          </SheetSection>
          <SheetSection icon="calendar" title="Host & Visit">
            <div data-tour="hr-visitor-form-host-plant" style={row}>
              {isHr && (
                <Fld label="Host (meeting)" req basis={240} grow max={340}>
                  <SearchableSelect value={f.host_user_id} onChange={set('host_user_id')} placeholder="Search employee…" options={people.map((p) => ({ value: String(p.id), label: `${p.name}${p.department ? ` · ${p.department}` : ''}` }))} />
                </Fld>
              )}
              <Fld label="Plant" basis={190}>
                <Select style={sheetInput} value={f.branch_id} onChange={(e) => set('branch_id')(e.target.value)}>
                  <option value="">{isHr ? "Host's plant" : 'My plant'}</option>
                  {branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
                </Select>
              </Fld>
            </div>
            {isHr && (
              <label data-tour="hr-visitor-form-walkin" style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: SHEET.BODY, cursor: 'pointer', marginTop: 12 }}>
                <input type="checkbox" checked={f.check_in_now} onChange={(e) => set('check_in_now')(e.target.checked)} />
                Walk-in — check the visitor in now
              </label>
            )}
            {f.check_in_now ? (
              <div data-tour="hr-visitor-form-badge-id" style={{ ...row, marginTop: 12 }}>
                <Fld label="Badge no." basis={130}><input style={sheetInput} value={f.badge_no} onChange={(e) => set('badge_no')(e.target.value)} /></Fld>
                <Fld label="ID proof" basis={170}>
                  <Select style={sheetInput} value={f.id_proof_type} onChange={(e) => set('id_proof_type')(e.target.value)}>
                    <option value="">—</option>
                    {ID_PROOF_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
                  </Select>
                </Fld>
                <Fld label="ID last 4" basis={110}><input style={sheetInput} maxLength={4} value={f.id_proof_last4} onChange={(e) => set('id_proof_last4')(e.target.value)} /></Fld>
              </div>
            ) : (
              <div data-tour="hr-visitor-form-expected" style={{ ...row, marginTop: 12 }}>
                <Fld label="Expected date" basis={160}><DateField value={f.expected_date} onChange={set('expected_date')} /></Fld>
                <Fld label="Time" basis={120}><input type="time" style={sheetInput} value={f.expected_time} onChange={(e) => set('expected_time')(e.target.value)} /></Fld>
              </div>
            )}
          </SheetSection>
        </>}
        right={<>
          <SheetSection icon="shield" title="Gate Details" extra={<Optional />}>
            <label style={sheetLabel}>Vehicle no.</label>
            <input data-tour="hr-visitor-form-vehicle" style={sheetInput} value={f.vehicle_no} onChange={(e) => set('vehicle_no')(e.target.value.toUpperCase())} />
            <label style={{ ...sheetLabel, marginTop: 14 }}>Items carried</label>
            <input data-tour="hr-visitor-form-items" style={sheetInput} value={f.items_carried} onChange={(e) => set('items_carried')(e.target.value)} placeholder="Laptop, samples, tools…" />
            <p style={sheetHint}>Only the last 4 characters of an ID proof are stored.</p>
          </SheetSection>
          <SheetSection icon="chat" title="Remarks" extra={<Optional />}>
            <textarea rows={4} data-tour="hr-visitor-form-remarks" style={{ ...sheetInput, resize: 'vertical' }} value={f.remarks} onChange={(e) => set('remarks')(e.target.value)} />
          </SheetSection>
        </>}
      />
    </FormDialog>
  )
}

// ── Edit ────────────────────────────────────────────────────────────────────

/** Stored ISO timestamp → IST wall-clock { date: 'YYYY-MM-DD', time: 'HH:MM' }. */
function istParts(iso?: string | null): { date: string; time: string } {
  if (!iso) return { date: '', time: '' }
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return { date: '', time: '' }
  const ist = new Date(d.getTime() + 330 * 60_000).toISOString()
  return { date: ist.slice(0, 10), time: ist.slice(11, 16) }
}

/**
 * Edit a visitor entry. The host or registrant may edit while the visitor is
 * still expected; reception (HR) may edit any entry that isn't cancelled and
 * is the only one who can change the host. Only changed fields are sent.
 */
export function EditVisitorDialog({
  visitor, isHr, people, branches, onClose, onSaved,
}: {
  visitor: HrVisitor | null
  isHr: boolean
  people: DirectoryUser[]
  branches: HrBranchLookup[]
  onClose: () => void
  onSaved: (v: HrVisitor) => void
}) {
  const fromVisitor = (v: HrVisitor) => {
    const exp = istParts(v.expected_at)
    return {
      visitor_name: v.visitor_name || '', visitor_company: v.visitor_company || '', visitor_phone: v.visitor_phone || '',
      visitor_email: v.visitor_email || '', purpose: v.purpose || '', host_user_id: String(v.host_user_id || ''),
      branch_id: v.branch_id ? String(v.branch_id) : '', expected_date: exp.date, expected_time: exp.time,
      number_of_persons: String(v.number_of_persons || 1), vehicle_no: v.vehicle_no || '', id_proof_type: v.id_proof_type || '',
      id_proof_last4: v.id_proof_last4 || '', items_carried: v.items_carried || '', remarks: v.remarks || '', badge_no: v.badge_no || '',
    }
  }
  type Form = ReturnType<typeof fromVisitor>
  const [f, setF] = useState<Form | null>(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string[]>([])

  useEffect(() => {
    if (visitor) { setF(fromVisitor(visitor)); setError([]) }
    else setF(null)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visitor])

  if (!visitor || !f) return null
  const set = <K extends keyof Form>(k: K) => (v: Form[K]) => setF((p) => (p ? { ...p, [k]: v } : p))
  const expected = visitor.status === 'expected'

  const save = async () => {
    const problems: string[] = []
    if (!f.visitor_name.trim()) problems.push("Enter the visitor's name.")
    if (isHr && !f.host_user_id) problems.push('Pick the employee the visitor is meeting (host).')
    const persons = Number(f.number_of_persons)
    if (!Number.isInteger(persons) || persons < 1) problems.push('Number of persons must be a whole number, 1 or more.')
    if (f.id_proof_last4 && f.id_proof_last4.length !== 4) problems.push('Enter exactly the last 4 characters of the ID proof, or leave it blank.')
    if (problems.length) { setError(problems); return }

    const before = fromVisitor(visitor)
    const payload: Record<string, unknown> = {}
    const text = (k: keyof Form, value: string | null) => { if (f[k] !== before[k]) payload[k] = value }
    text('visitor_name', f.visitor_name.trim())
    text('visitor_company', f.visitor_company || null)
    text('visitor_phone', f.visitor_phone || null)
    text('visitor_email', f.visitor_email || null)
    text('purpose', f.purpose || null)
    text('vehicle_no', f.vehicle_no || null)
    text('id_proof_type', f.id_proof_type || null)
    text('id_proof_last4', f.id_proof_last4 || null)
    text('items_carried', f.items_carried || null)
    text('remarks', f.remarks || null)
    if (isHr) text('badge_no', f.badge_no || null)
    if (f.number_of_persons !== before.number_of_persons) payload.number_of_persons = persons
    if (f.branch_id !== before.branch_id && f.branch_id) payload.branch_id = Number(f.branch_id)
    if (isHr && f.host_user_id !== before.host_user_id) payload.host_user_id = Number(f.host_user_id)
    if (expected && (f.expected_date !== before.expected_date || f.expected_time !== before.expected_time)) {
      payload.expected_at = toIstIso(f.expected_date, f.expected_time)
    }
    if (Object.keys(payload).length === 0) { onClose(); return }

    setSaving(true); setError([])
    try {
      onSaved(await hrApi.updateVisitor(visitor.id, payload))
    } catch (err) {
      setError(extractErrorMessages(err, `Visit ${visitor.visit_no} could not be updated. Check the fields above and try again; if it keeps failing, the entry may have been checked in or cancelled meanwhile — refresh the list.`))
    } finally {
      setSaving(false)
    }
  }

  return (
    <FormDialog
      open={!!visitor}
      title={`Edit visit ${visitor.visit_no}`}
      subtitle={isHr ? 'Correct the entry. Changing the host notifies the new host.' : 'You can change the details until reception checks the visitor in.'}
      icon="edit"
      onClose={onClose}
      busy={saving}
      maxWidth={960}
      bare
      footer={<>
        <button type="button" style={sheetBtn('secondary', SHEET.INK, saving)} onClick={onClose} disabled={saving}>Cancel</button>
        <button type="button" style={sheetBtn('primary', SHEET.BLUE, saving)} onClick={save} disabled={saving}>
          <SheetIcon name="check" size={16} />{saving ? 'Saving…' : 'Save changes'}
        </button>
      </>}
    >
      <SheetColumns
        left={<>
          <ErrorBanner error={error} />
          <SheetSection icon="user" title="Visitor">
            <div style={row}>
              <Fld label="Visitor name" req basis={220} grow max={320}><input style={sheetInput} value={f.visitor_name} onChange={(e) => set('visitor_name')(e.target.value)} /></Fld>
              <Fld label="Company" basis={200} grow max={300}><input style={sheetInput} value={f.visitor_company} onChange={(e) => set('visitor_company')(e.target.value)} /></Fld>
            </div>
            <div style={{ ...row, marginTop: 12 }}>
              <Fld label="Phone" basis={160}><input style={sheetInput} inputMode="tel" value={f.visitor_phone} onChange={(e) => set('visitor_phone')(e.target.value)} /></Fld>
              <Fld label="Email" basis={220} grow max={300}><input style={sheetInput} type="email" value={f.visitor_email} onChange={(e) => set('visitor_email')(e.target.value)} /></Fld>
              <Fld label="Persons" basis={90}><input style={sheetInput} inputMode="numeric" value={f.number_of_persons} onChange={(e) => set('number_of_persons')(e.target.value.replace(/\D/g, ''))} /></Fld>
            </div>
            <label style={{ ...sheetLabel, marginTop: 12 }}>Purpose of visit</label>
            <input style={sheetInput} value={f.purpose} onChange={(e) => set('purpose')(e.target.value)} />
          </SheetSection>
          <SheetSection icon="calendar" title="Host & Visit">
            <div style={row}>
              {isHr && (
                <Fld label="Host (meeting)" req basis={240} grow max={340}>
                  <SearchableSelect value={f.host_user_id} onChange={set('host_user_id')} placeholder="Search employee…" options={people.map((p) => ({ value: String(p.id), label: `${p.name}${p.department ? ` · ${p.department}` : ''}` }))} />
                </Fld>
              )}
              <Fld label="Plant" basis={190}>
                <Select style={sheetInput} value={f.branch_id} onChange={(e) => set('branch_id')(e.target.value)}>
                  {!f.branch_id && <option value="">—</option>}
                  {branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
                </Select>
              </Fld>
            </div>
            {expected && (
              <div style={{ ...row, marginTop: 12 }}>
                <Fld label="Expected date" basis={160}><DateField value={f.expected_date} onChange={set('expected_date')} /></Fld>
                <Fld label="Time" basis={120}><input type="time" style={sheetInput} value={f.expected_time} onChange={(e) => set('expected_time')(e.target.value)} /></Fld>
              </div>
            )}
          </SheetSection>
        </>}
        right={<>
          <SheetSection icon="shield" title="Gate Details" extra={<Optional />}>
            <div style={row}>
              {isHr && <Fld label="Badge no." basis={130}><input style={sheetInput} value={f.badge_no} onChange={(e) => set('badge_no')(e.target.value)} /></Fld>}
              <Fld label="ID proof" basis={150} grow>
                <Select style={sheetInput} value={f.id_proof_type} onChange={(e) => set('id_proof_type')(e.target.value)}>
                  <option value="">—</option>
                  {ID_PROOF_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
                </Select>
              </Fld>
              <Fld label="ID last 4" basis={110}><input style={sheetInput} maxLength={4} value={f.id_proof_last4} onChange={(e) => set('id_proof_last4')(e.target.value)} /></Fld>
            </div>
            <label style={{ ...sheetLabel, marginTop: 12 }}>Vehicle no.</label>
            <input style={sheetInput} value={f.vehicle_no} onChange={(e) => set('vehicle_no')(e.target.value.toUpperCase())} />
            <label style={{ ...sheetLabel, marginTop: 12 }}>Items carried</label>
            <input style={sheetInput} value={f.items_carried} onChange={(e) => set('items_carried')(e.target.value)} />
          </SheetSection>
          <SheetSection icon="chat" title="Remarks" extra={<Optional />}>
            <textarea rows={4} style={{ ...sheetInput, resize: 'vertical' }} value={f.remarks} onChange={(e) => set('remarks')(e.target.value)} />
          </SheetSection>
        </>}
      />
    </FormDialog>
  )
}

// ── Check in ────────────────────────────────────────────────────────────────

export function CheckInDialog({ visitor, onClose, onDone }: { visitor: HrVisitor | null; onClose: () => void; onDone: (v: HrVisitor) => void }) {
  const [badge, setBadge] = useState('')
  const [idType, setIdType] = useState('')
  const [idLast4, setIdLast4] = useState('')
  const [vehicle, setVehicle] = useState('')
  const [items, setItems] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string[]>([])

  useEffect(() => {
    if (!visitor) return
    setBadge(visitor.badge_no || ''); setIdType(visitor.id_proof_type || ''); setIdLast4(visitor.id_proof_last4 || '')
    setVehicle(visitor.vehicle_no || ''); setItems(visitor.items_carried || ''); setError([])
  }, [visitor])

  const submit = async () => {
    if (!visitor) return
    setSaving(true); setError([])
    try {
      const v = await hrApi.checkInVisitor(visitor.id, { badge_no: badge, id_proof_type: idType, id_proof_last4: idLast4, vehicle_no: vehicle, items_carried: items })
      onDone(v)
    } catch (err) {
      setError(extractErrorMessages(err, 'The visitor could not be checked in.'))
    } finally {
      setSaving(false)
    }
  }

  return (
    <FormDialog
      open={!!visitor}
      title={`Check in ${visitor?.visitor_name || ''}`}
      subtitle={visitor ? `Meeting ${visitor.host_name || 'host'}${visitor.visitor_company ? ` · ${visitor.visitor_company}` : ''}. The host gets a notification.` : undefined}
      icon="check"
      iconColor="#16A34A"
      onClose={onClose}
      busy={saving}
      bare
      footer={<>
        <button type="button" style={sheetBtn('secondary', SHEET.INK, saving)} onClick={onClose} disabled={saving}>Cancel</button>
        <button type="button" data-tour="hr-visitor-checkin-save" style={sheetBtn('primary', '#16A34A', saving)} onClick={submit} disabled={saving}><SheetIcon name="check" size={16} />{saving ? 'Checking in…' : 'Check in now'}</button>
      </>}
    >
      <div style={{ padding: '20px 24px' }}>
        <ErrorBanner error={error} />
        <SheetSection icon="shield" title="Badge & ID">
          <div data-tour="hr-visitor-checkin-badge-id" style={row}>
            <Fld label="Badge no." basis={130}><input autoFocus style={sheetInput} value={badge} onChange={(e) => setBadge(e.target.value)} /></Fld>
            <Fld label="ID proof" basis={170}>
              <Select style={sheetInput} value={idType} onChange={(e) => setIdType(e.target.value)}>
                <option value="">—</option>
                {ID_PROOF_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
              </Select>
            </Fld>
            <Fld label="ID last 4" basis={110}><input style={sheetInput} maxLength={4} value={idLast4} onChange={(e) => setIdLast4(e.target.value)} /></Fld>
          </div>
        </SheetSection>
        <SheetSection icon="truck" title="Vehicle & Items" extra={<Optional />}>
          <div data-tour="hr-visitor-checkin-vehicle-items" style={row}>
            <Fld label="Vehicle no." basis={150}><input style={sheetInput} value={vehicle} onChange={(e) => setVehicle(e.target.value.toUpperCase())} /></Fld>
            <Fld label="Items carried" basis={240} grow><input style={sheetInput} value={items} onChange={(e) => setItems(e.target.value)} /></Fld>
          </div>
        </SheetSection>
      </div>
    </FormDialog>
  )
}
