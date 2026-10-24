'use client'

import Select from '@/components/shared/Select'
import { HrLifecycleEvent, HrLifecycleEventType, HrLifecycleMeta } from '@/types'
import { TEXT } from '@/lib/theme'
import { Req, sheetInput, sheetLabel } from '@/components/shared/FormSheet'
import DateField from '@/components/erp/DateField'
import SearchableSelect from '@/components/erp/SearchableSelect'

export interface EventFormState {
  candidate_name: string
  candidate_email: string
  effective_date: string
  to_department_id: string
  to_branch_id: string
  to_designation_id: string
  to_grade_id: string
  to_manager_id: string
  resignation_date: string
  last_working_day: string
  exit_type: string
  exit_reason: string
  notice_period_days: string
  handover_to_id: string
  remarks: string
}

export const EMPTY_EVENT_FORM: EventFormState = {
  candidate_name: '', candidate_email: '', effective_date: '',
  to_department_id: '', to_branch_id: '', to_designation_id: '', to_grade_id: '', to_manager_id: '',
  resignation_date: '', last_working_day: '', exit_type: '', exit_reason: '', notice_period_days: '',
  handover_to_id: '', remarks: '',
}

export const EXIT_TYPE_LABELS: Record<string, string> = {
  resignation: 'Resignation', termination: 'Termination', retirement: 'Retirement',
  absconding: 'Absconding', contract_end: 'Contract end', death: 'Death',
}

const s = (v: string | number | null | undefined) => (v === null || v === undefined ? '' : String(v))

export function eventToForm(ev: HrLifecycleEvent): EventFormState {
  return {
    candidate_name: s(ev.candidate_name), candidate_email: s(ev.candidate_email), effective_date: s(ev.effective_date),
    to_department_id: s(ev.to_department_id), to_branch_id: s(ev.to_branch_id), to_designation_id: s(ev.to_designation_id),
    to_grade_id: s(ev.to_grade_id), to_manager_id: s(ev.to_manager_id),
    resignation_date: s(ev.resignation_date), last_working_day: s(ev.last_working_day), exit_type: s(ev.exit_type),
    exit_reason: s(ev.exit_reason), notice_period_days: s(ev.notice_period_days), handover_to_id: s(ev.handover_to_id),
    remarks: s(ev.remarks),
  }
}

const idOrNull = (v: string) => (v ? Number(v) : null)
const strOrNull = (v: string) => (v.trim() ? v.trim() : null)

/** Payload for the fields that apply to `type` (others are sent as null so an
 * edit that changes nothing type-irrelevant can't leave stale values). */
export function formToPayload(type: HrLifecycleEventType, f: EventFormState): Record<string, unknown> {
  const p: Record<string, unknown> = {
    effective_date: f.effective_date || null,
    remarks: strOrNull(f.remarks),
  }
  if (type === 'joining') {
    p.candidate_name = strOrNull(f.candidate_name)
    p.candidate_email = strOrNull(f.candidate_email)
  }
  if (type === 'joining' || type === 'transfer' || type === 'promotion') {
    p.to_department_id = idOrNull(f.to_department_id)
    p.to_branch_id = idOrNull(f.to_branch_id)
    p.to_designation_id = idOrNull(f.to_designation_id)
    p.to_grade_id = idOrNull(f.to_grade_id)
    p.to_manager_id = idOrNull(f.to_manager_id)
  }
  if (type === 'transfer' || type === 'promotion' || type === 'exit') {
    p.handover_to_id = idOrNull(f.handover_to_id)
  }
  if (type === 'exit') {
    p.resignation_date = f.resignation_date || null
    p.last_working_day = f.last_working_day || null
    p.exit_type = f.exit_type || null
    p.exit_reason = strOrNull(f.exit_reason)
    p.notice_period_days = f.notice_period_days.trim() ? Number(f.notice_period_days) : null
  }
  return p
}

const textInput: React.CSSProperties = sheetInput

/** Sheet-style label + control ("… *" in the label = required). */
function Field({ label, children }: { label: string; children: React.ReactNode }) {
  const req = label.endsWith(' *')
  return (
    <div>
      <label style={sheetLabel}>{req ? label.slice(0, -2) : label}{req && <> <Req /></>}</label>
      {children}
    </div>
  )
}

function Box({ w, grow, max, tour, children }: { w: number; grow?: boolean; max?: number; tour?: string; children: React.ReactNode }) {
  return <div data-tour={tour} style={{ flex: grow ? `1 1 ${w}px` : `0 1 ${w}px`, minWidth: w, maxWidth: max }}>{children}</div>
}

export default function EventFields({
  type, form, setForm, meta, subjectUserId,
}: {
  type: HrLifecycleEventType
  form: EventFormState
  setForm: (f: EventFormState) => void
  meta: HrLifecycleMeta
  subjectUserId?: number | null
}) {
  const set = (k: keyof EventFormState, v: string) => setForm({ ...form, [k]: v })
  const userOptions = meta.users
    .filter((u) => u.id !== subjectUserId)
    .map((u) => ({ value: String(u.id), label: `${u.name} — ${u.designation || u.email}` }))
  const deptOptions = meta.departments.map((d) => ({ value: String(d.id), label: d.name }))
  const branchOptions = meta.branches.map((b) => ({ value: String(b.id), label: b.name }))
  const desigOptions = meta.designations.map((d) => ({ value: String(d.id), label: d.name }))
  const gradeOptions = meta.grades.map((g) => ({ value: String(g.id), label: `${g.code} — ${g.name}` }))
  const withNone = (opts: { value: string; label: string }[], none: string) => [{ value: '', label: none }, ...opts]

  const dateLabel = type === 'joining' ? 'Date of joining' : type === 'confirmation' ? 'Confirmation date' : type === 'exit' ? 'Effective date' : 'Effective from'
  const isMove = type === 'joining' || type === 'transfer' || type === 'promotion'
  const noChange = type === 'joining' ? '— Not set —' : '— No change —'

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {type !== 'exit' && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12 }}>
          <Box w={170} tour="hr-lce-effective-date">
            <Field label={dateLabel}><DateField value={form.effective_date} onChange={(v) => set('effective_date', v)} /></Field>
          </Box>
        </div>
      )}

      {isMove && (
        <>
          <p style={{ fontSize: 12.5, color: TEXT.muted, margin: 0 }}>
            {type === 'joining'
              ? 'Where the new joiner will sit. Applied to their employee profile when the joining is completed.'
              : 'Only fill what changes — blank fields stay as they are. Applied when the event is completed.'}
          </p>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12 }}>
            <Box w={220} grow max={320} tour="hr-lce-department">
              <Field label={type === 'joining' ? 'Department' : 'New department'}>
                <SearchableSelect value={form.to_department_id} onChange={(v) => set('to_department_id', v)} options={withNone(deptOptions, noChange)} placeholder={noChange} />
              </Field>
            </Box>
            <Box w={200} grow max={300} tour="hr-lce-plant">
              <Field label={type === 'joining' ? 'Plant' : 'New plant'}>
                <SearchableSelect value={form.to_branch_id} onChange={(v) => set('to_branch_id', v)} options={withNone(branchOptions, noChange)} placeholder={noChange} />
              </Field>
            </Box>
            <Box w={220} grow max={320} tour="hr-lce-designation">
              <Field label={type === 'joining' ? 'Designation' : 'New designation'}>
                <SearchableSelect value={form.to_designation_id} onChange={(v) => set('to_designation_id', v)} options={withNone(desigOptions, noChange)} placeholder={noChange} />
              </Field>
            </Box>
            <Box w={180} grow max={260} tour="hr-lce-grade">
              <Field label={type === 'joining' ? 'Grade' : 'New grade'}>
                <SearchableSelect value={form.to_grade_id} onChange={(v) => set('to_grade_id', v)} options={withNone(gradeOptions, noChange)} placeholder={noChange} />
              </Field>
            </Box>
            <Box w={240} grow max={340} tour="hr-lce-manager">
              <Field label={type === 'joining' ? 'Reporting manager' : 'New reporting manager'}>
                <SearchableSelect value={form.to_manager_id} onChange={(v) => set('to_manager_id', v)} options={withNone(userOptions, noChange)} placeholder={noChange} />
              </Field>
            </Box>
          </div>
          {(meta.designations.length === 0 || meta.grades.length === 0) && (
            <p style={{ fontSize: 12, color: TEXT.muted, margin: 0 }}>
              {meta.designations.length === 0 ? 'No designations yet' : 'No grades yet'} — add them in HR &gt; Masters to pick them here.
            </p>
          )}
        </>
      )}

      {(type === 'transfer' || type === 'promotion') && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12 }}>
          <Box w={240} grow max={340} tour="hr-lce-successor">
            <Field label="Successor (optional)">
              <SearchableSelect value={form.handover_to_id} onChange={(v) => set('handover_to_id', v)} options={withNone(userOptions, '— None —')} placeholder="— None —" />
            </Field>
          </Box>
          <p style={{ flex: '1 1 260px', fontSize: 12, color: TEXT.muted, margin: '22px 0 0' }}>
            Needed only if the old department head slot or pending P2P approvals should move to someone else on completion.
          </p>
        </div>
      )}

      {type === 'exit' && (
        <>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12 }}>
            <Box w={170} tour="hr-lce-exit-type">
              <Field label="Exit type">
                <Select style={textInput} value={form.exit_type} onChange={(e) => set('exit_type', e.target.value)}>
                  <option value="">Select…</option>
                  {meta.exit_types.map((t) => <option key={t} value={t}>{EXIT_TYPE_LABELS[t] || t}</option>)}
                </Select>
              </Field>
            </Box>
            <Box w={170} tour="hr-lce-resignation-date">
              <Field label="Resignation date"><DateField value={form.resignation_date} onChange={(v) => set('resignation_date', v)} /></Field>
            </Box>
            <Box w={170} tour="hr-lce-last-working-day">
              <Field label="Last working day *"><DateField value={form.last_working_day} onChange={(v) => set('last_working_day', v)} /></Field>
            </Box>
            <Box w={130} tour="hr-lce-notice-days">
              <Field label="Notice (days)">
                <input style={textInput} inputMode="numeric" value={form.notice_period_days} onChange={(e) => set('notice_period_days', e.target.value.replace(/[^0-9]/g, ''))} placeholder="e.g. 30" />
              </Field>
            </Box>
            <Box w={240} grow max={340} tour="hr-lce-handover">
              <Field label="Handover to (successor)">
                <SearchableSelect value={form.handover_to_id} onChange={(v) => set('handover_to_id', v)} options={withNone(userOptions, '— Decide later —')} placeholder="— Decide later —" />
              </Field>
            </Box>
          </div>
          <div data-tour="hr-lce-exit-reason">
            <Field label="Exit reason">
              <textarea style={{ ...textInput, minHeight: 70, resize: 'vertical' }} value={form.exit_reason} onChange={(e) => set('exit_reason', e.target.value)} placeholder="Why the employee is leaving (HR-only)" />
            </Field>
          </div>
        </>
      )}

      <div data-tour="hr-lce-remarks">
        <Field label="Remarks">
          <textarea style={{ ...textInput, minHeight: 60, resize: 'vertical' }} value={form.remarks} onChange={(e) => set('remarks', e.target.value)} placeholder="Anything HR should know about this event (HR-only)" />
        </Field>
      </div>
    </div>
  )
}
