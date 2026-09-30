'use client'

import { useEffect, useState } from 'react'
import { hrApi } from '@/lib/api'
import { extractErrorMessages } from '@/lib/validation'
import type { HrVisitor, HrBranchLookup, DirectoryUser } from '@/types'
import DateField from '@/components/erp/DateField'
import SearchableSelect from '@/components/erp/SearchableSelect'
import { secondaryBtnStyle } from '@/components/shared/ui'
import { FormDialog, ErrorBanner, formInputStyle, labelStyle, primaryActionStyle, todayIso } from './adminUi'

export const ID_PROOF_TYPES = ['Aadhaar', 'PAN', 'Driving Licence', 'Passport', 'Voter ID', 'Company ID', 'Other']

const row: React.CSSProperties = { display: 'flex', flexWrap: 'wrap', gap: 12 }

function Fld({ label, children, basis = 200, grow = false, max }: { label: string; children: React.ReactNode; basis?: number; grow?: boolean; max?: number }) {
  return (
    <div style={{ flex: grow ? `1 1 ${basis}px` : `0 1 ${basis}px`, minWidth: Math.min(basis, 130), maxWidth: max }}>
      <label style={labelStyle}>{label}</label>
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
      onClose={onClose}
      maxWidth={680}
      footer={<>
        <button type="button" style={secondaryBtnStyle} onClick={onClose} disabled={saving}>Cancel</button>
        <button type="button" style={{ ...primaryActionStyle, opacity: saving ? 0.7 : 1 }} onClick={save} disabled={saving}>
          {saving ? 'Saving…' : f.check_in_now ? 'Register & check in' : 'Register visitor'}
        </button>
      </>}
    >
      <ErrorBanner error={error} />
      <div style={row}>
        <Fld label="Visitor name *" basis={220} grow max={320}><input style={formInputStyle} value={f.visitor_name} onChange={(e) => set('visitor_name')(e.target.value)} /></Fld>
        <Fld label="Company" basis={200} grow max={300}><input style={formInputStyle} value={f.visitor_company} onChange={(e) => set('visitor_company')(e.target.value)} /></Fld>
      </div>
      <div style={row}>
        <Fld label="Phone" basis={160}><input style={formInputStyle} inputMode="tel" value={f.visitor_phone} onChange={(e) => set('visitor_phone')(e.target.value)} /></Fld>
        <Fld label="Email" basis={220} grow max={300}><input style={formInputStyle} type="email" value={f.visitor_email} onChange={(e) => set('visitor_email')(e.target.value)} /></Fld>
        <Fld label="Persons" basis={90}><input style={formInputStyle} inputMode="numeric" value={f.number_of_persons} onChange={(e) => set('number_of_persons')(e.target.value.replace(/\D/g, ''))} /></Fld>
      </div>
      <div>
        <label style={labelStyle}>Purpose of visit</label>
        <input style={formInputStyle} value={f.purpose} onChange={(e) => set('purpose')(e.target.value)} placeholder="Vendor meeting, interview, audit, delivery…" />
      </div>
      <div style={row}>
        {isHr && (
          <Fld label="Host (meeting) *" basis={240} grow max={340}>
            <SearchableSelect value={f.host_user_id} onChange={set('host_user_id')} placeholder="Search employee…" options={people.map((p) => ({ value: String(p.id), label: `${p.name}${p.department ? ` · ${p.department}` : ''}` }))} />
          </Fld>
        )}
        <Fld label="Plant" basis={190}>
          <select style={formInputStyle} value={f.branch_id} onChange={(e) => set('branch_id')(e.target.value)}>
            <option value="">{isHr ? "Host's plant" : 'My plant'}</option>
            {branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
          </select>
        </Fld>
      </div>
      {isHr && (
        <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: '#334155', cursor: 'pointer' }}>
          <input type="checkbox" checked={f.check_in_now} onChange={(e) => set('check_in_now')(e.target.checked)} />
          Walk-in — check the visitor in now
        </label>
      )}
      {f.check_in_now ? (
        <div style={row}>
          <Fld label="Badge no." basis={130}><input style={formInputStyle} value={f.badge_no} onChange={(e) => set('badge_no')(e.target.value)} /></Fld>
          <Fld label="ID proof" basis={170}>
            <select style={formInputStyle} value={f.id_proof_type} onChange={(e) => set('id_proof_type')(e.target.value)}>
              <option value="">—</option>
              {ID_PROOF_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
          </Fld>
          <Fld label="ID last 4" basis={110}><input style={formInputStyle} maxLength={4} value={f.id_proof_last4} onChange={(e) => set('id_proof_last4')(e.target.value)} /></Fld>
        </div>
      ) : (
        <div style={row}>
          <Fld label="Expected date" basis={160}><DateField value={f.expected_date} onChange={set('expected_date')} /></Fld>
          <Fld label="Time" basis={120}><input type="time" style={formInputStyle} value={f.expected_time} onChange={(e) => set('expected_time')(e.target.value)} /></Fld>
        </div>
      )}
      <div style={row}>
        <Fld label="Vehicle no." basis={150}><input style={formInputStyle} value={f.vehicle_no} onChange={(e) => set('vehicle_no')(e.target.value.toUpperCase())} /></Fld>
        <Fld label="Items carried" basis={240} grow max={420}><input style={formInputStyle} value={f.items_carried} onChange={(e) => set('items_carried')(e.target.value)} placeholder="Laptop, samples, tools…" /></Fld>
      </div>
      <div>
        <label style={labelStyle}>Remarks</label>
        <textarea rows={2} style={{ ...formInputStyle, resize: 'vertical' }} value={f.remarks} onChange={(e) => set('remarks')(e.target.value)} />
      </div>
      <p style={{ fontSize: 11.5, color: '#78716c', margin: 0 }}>Only the last 4 characters of an ID proof are stored.</p>
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
      onClose={onClose}
      footer={<>
        <button type="button" style={secondaryBtnStyle} onClick={onClose} disabled={saving}>Cancel</button>
        <button type="button" style={{ ...primaryActionStyle, opacity: saving ? 0.7 : 1 }} onClick={submit} disabled={saving}>{saving ? 'Checking in…' : 'Check in now'}</button>
      </>}
    >
      <ErrorBanner error={error} />
      <div style={row}>
        <Fld label="Badge no." basis={130}><input autoFocus style={formInputStyle} value={badge} onChange={(e) => setBadge(e.target.value)} /></Fld>
        <Fld label="ID proof" basis={170}>
          <select style={formInputStyle} value={idType} onChange={(e) => setIdType(e.target.value)}>
            <option value="">—</option>
            {ID_PROOF_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
        </Fld>
        <Fld label="ID last 4" basis={110}><input style={formInputStyle} maxLength={4} value={idLast4} onChange={(e) => setIdLast4(e.target.value)} /></Fld>
      </div>
      <div style={row}>
        <Fld label="Vehicle no." basis={150}><input style={formInputStyle} value={vehicle} onChange={(e) => setVehicle(e.target.value.toUpperCase())} /></Fld>
        <Fld label="Items carried" basis={240} grow><input style={formInputStyle} value={items} onChange={(e) => setItems(e.target.value)} /></Fld>
      </div>
    </FormDialog>
  )
}
