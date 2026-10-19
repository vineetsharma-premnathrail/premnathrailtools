'use client'

import SearchableSelect from '@/components/erp/SearchableSelect'
import { Req, sheetInput, sheetLabel } from '@/components/shared/FormSheet'
import DateField from '@/components/erp/DateField'
import { SafetyMeta } from './types'

export interface PersonForm {
  person_type: string
  user_id: string
  external_name: string
  external_company: string
  age: string
  occupation: string
  outcome: string
  injury_nature: string
  body_part: string
  treatment: string
  lost_days: string
  return_to_work_date: string
}

export const EMPTY_PERSON: PersonForm = {
  person_type: 'employee', user_id: '', external_name: '', external_company: '', age: '', occupation: '',
  outcome: 'first_aid', injury_nature: '', body_part: '', treatment: '', lost_days: '0', return_to_work_date: '',
}

export function personToPayload(p: PersonForm): Record<string, unknown> {
  return {
    person_type: p.person_type,
    user_id: p.person_type === 'employee' && p.user_id ? Number(p.user_id) : null,
    external_name: p.person_type === 'employee' ? null : p.external_name.trim() || null,
    external_company: p.person_type === 'employee' ? null : p.external_company.trim() || null,
    age: p.age ? Number(p.age) : null,
    occupation: p.occupation.trim() || null,
    outcome: p.outcome,
    injury_nature: p.injury_nature.trim() || null,
    body_part: p.body_part.trim() || null,
    treatment: p.treatment.trim() || null,
    lost_days: p.outcome === 'lost_time' ? Number(p.lost_days || 0) : 0,
    return_to_work_date: p.return_to_work_date || null,
  }
}

const input: React.CSSProperties = sheetInput
const label: React.CSSProperties = sheetLabel

/** One injured / involved person: employee by pick, outsider by name. */
export default function PersonFields({ value, onChange, meta }: { value: PersonForm; onChange: (p: PersonForm) => void; meta: SafetyMeta }) {
  const set = (k: keyof PersonForm, v: string) => onChange({ ...value, [k]: v })
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10 }}>
      <div style={{ flex: '0 1 170px', minWidth: 150 }}>
        <label style={label}>Category</label>
        <select style={input} value={value.person_type} onChange={(e) => set('person_type', e.target.value)}>
          {meta.person_types.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
      </div>
      {value.person_type === 'employee' ? (
        <div style={{ flex: '1 1 240px', maxWidth: 320 }}>
          <label style={label}>Employee <Req /></label>
          <SearchableSelect value={value.user_id} onChange={(v) => set('user_id', v)} placeholder="Pick the employee…"
            options={meta.employees.map((u) => ({ value: String(u.id), label: `${u.name} (${u.email})` }))} />
        </div>
      ) : (
        <>
          <div style={{ flex: '1 1 200px', maxWidth: 280 }}>
            <label style={label}>Name <Req /></label>
            <input style={input} value={value.external_name} onChange={(e) => set('external_name', e.target.value)} />
          </div>
          <div style={{ flex: '1 1 180px', maxWidth: 260 }}>
            <label style={label}>Company / contractor</label>
            <input style={input} value={value.external_company} onChange={(e) => set('external_company', e.target.value)} />
          </div>
        </>
      )}
      <div style={{ flex: '0 1 80px', minWidth: 70 }}>
        <label style={label}>Age</label>
        <input style={input} inputMode="numeric" value={value.age} onChange={(e) => set('age', e.target.value.replace(/\D/g, '').slice(0, 3))} />
      </div>
      <div style={{ flex: '1 1 160px', maxWidth: 220 }}>
        <label style={label}>Occupation</label>
        <input style={input} value={value.occupation} onChange={(e) => set('occupation', e.target.value)} placeholder="e.g. Welder" />
      </div>
      <div style={{ flex: '0 1 180px', minWidth: 160 }}>
        <label style={label}>Outcome</label>
        <select style={input} value={value.outcome} onChange={(e) => set('outcome', e.target.value)}>
          {meta.outcomes.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
      </div>
      <div style={{ flex: '1 1 180px', maxWidth: 260 }}>
        <label style={label}>Nature of injury</label>
        <input style={input} value={value.injury_nature} onChange={(e) => set('injury_nature', e.target.value)} placeholder="e.g. Cut, burn, fracture" />
      </div>
      <div style={{ flex: '1 1 140px', maxWidth: 200 }}>
        <label style={label}>Body part</label>
        <input style={input} value={value.body_part} onChange={(e) => set('body_part', e.target.value)} />
      </div>
      {value.outcome === 'lost_time' && (
        <>
          <div style={{ flex: '0 1 100px', minWidth: 90 }}>
            <label style={label}>Days lost <Req /></label>
            <input style={input} inputMode="numeric" value={value.lost_days} onChange={(e) => set('lost_days', e.target.value.replace(/\D/g, '').slice(0, 4))} />
          </div>
          <div style={{ flex: '0 1 160px', minWidth: 150 }}>
            <label style={label}>Back at work on</label>
            <DateField value={value.return_to_work_date} onChange={(v) => set('return_to_work_date', v)} />
          </div>
        </>
      )}
      <div style={{ flex: '1 1 100%' }}>
        <label style={label}>Treatment given</label>
        <input style={input} value={value.treatment} onChange={(e) => set('treatment', e.target.value)} placeholder="First aid at site / taken to hospital…" />
      </div>
    </div>
  )
}
