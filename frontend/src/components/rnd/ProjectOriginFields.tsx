'use client'

// "Project Origin" fields for an R&D (Prototype / Research) project — WHY the
// project exists. Two origins: Existing Projects (improve a project / machine we
// already built) and New Project (a new product, process or technology, optionally
// linked to the customer requirement behind it). Used by the New Project form and
// the project's Edit page; the server (rnd/services/project_origin.py) applies the
// same rules.

import Select from '@/components/shared/Select'
import { useEffect, useRef, useState } from 'react'
import { Wrench, Lightbulb } from '@phosphor-icons/react'
import type { Icon as PhosphorIcon } from '@phosphor-icons/react'
import { rndApi } from '@/lib/api'
import { RndImprovementReason, RndProject, RndProjectSourceKind, RndProjectSourceOption } from '@/types'
import type { RndProjectOriginV2 } from '@/types/rndIntake'
import SearchableSelect from '@/components/erp/SearchableSelect'
import { Req, Optional, SHEET, sheetInput, sheetLabel, sheetHint } from '@/components/shared/FormSheet'
import { extractErrorMessages } from '@/lib/validation'
import { segmentBtnStyle } from '@/components/shared/ui'

export interface OriginDraft {
  origin: RndProjectOriginV2 | ''
  /** New Project: the customer requirement (inquiry / tender) behind it, optional. */
  sourceKind: RndProjectSourceKind | ''
  sourceId: number | null
  sourceLabel: string
  reason: RndImprovementReason | ''
  productId: number | null
  productLabel: string
  /** Existing Projects: the existing project / machine (PEW) being improved. */
  machineId: number | null
  machineLabel: string
  note: string
}

export const EMPTY_ORIGIN: OriginDraft = {
  origin: '', sourceKind: '', sourceId: null, sourceLabel: '', reason: '', productId: null, productLabel: '',
  machineId: null, machineLabel: '', note: '',
}

export const ORIGINS: { value: RndProjectOriginV2; label: string; meaning: string; icon: PhosphorIcon }[] = [
  { value: 'existing_projects', label: 'Existing Projects', meaning: 'Fix or improve a project / machine we already built — complaint, NCR, service issue, cost or production.', icon: Wrench },
  { value: 'new_project', label: 'New Project', meaning: 'A new product, process or technology — our own idea or a customer requirement that BD sent to R&D.', icon: Lightbulb },
]
export const ORIGIN_LABELS: Record<string, string> = Object.fromEntries(ORIGINS.map((o) => [o.value, o.label]))
export const ORIGIN_HEX: Record<string, string> = { existing_projects: '#D97706', new_project: '#7C3AED' }

/** Any stored origin as one of the two current ones (older values: product_improvement → Existing Projects, the rest → New Project). */
export function normalizeOrigin(v: string | null | undefined): RndProjectOriginV2 | '' {
  if (!v) return ''
  if (v === 'existing_projects' || v === 'product_improvement') return 'existing_projects'
  return 'new_project'
}

export const REASONS: { value: RndImprovementReason; label: string }[] = [
  { value: 'customer_complaint', label: 'Customer complaint' },
  { value: 'ncr', label: 'NCR (non-conformance)' },
  { value: 'service_report', label: 'Service report / field issue' },
  { value: 'cost_reduction', label: 'Cost reduction' },
  { value: 'production_difficulty', label: 'Production difficulty' },
]
export const KIND_LABELS: Record<RndProjectSourceKind, string> = {
  inquiry: 'Inquiry', tender: 'Tender', quality_complaint: 'Customer complaint', ncr: 'NCR', service_request: 'Service request',
}

export function originFromProject(p: RndProject): OriginDraft {
  return {
    origin: normalizeOrigin(p.origin), sourceKind: p.source_kind || '', sourceId: p.source_id ?? null, sourceLabel: p.source_ref || '',
    reason: p.improvement_reason || '', productId: p.product_id ?? null, productLabel: p.product_name || '',
    machineId: p.machine_id ?? null, machineLabel: p.machine_label || '', note: p.origin_note || '',
  }
}

/** Whether the rules need an attached proof document (proposal / note / study). */
export function originProofRequired(d: OriginDraft): boolean {
  return d.origin === 'new_project'
}

/** The first missing origin field as a message saying what to pick, or ''.
 *  `attachments` = files staged on the form (null when editing — proof is only checked on create). */
export function originError(d: OriginDraft, attachments: number | null): string {
  if (!d.origin) return 'Pick the project origin — why this project exists (Existing Projects or New Project).'
  if (d.origin === 'existing_projects') {
    if (!d.machineId) return 'Pick the existing project being improved (PEW number) — Project Origin › Existing Projects.'
    if (!d.reason) return 'Pick the reason for the improvement (Project Origin › Existing Projects).'
  }
  if (d.origin === 'new_project' && !d.note.trim()) return "Fill 'Who proposed it and why' in Project Origin — it is required for a New Project."
  if (attachments !== null && originProofRequired(d) && attachments < 1) {
    return 'Attach at least one proof document in Attachments — the proposal, management note or study behind this New Project.'
  }
  return ''
}

/** Fields for the create / update API call. */
export function originPayload(d: OriginDraft): Record<string, unknown> {
  const kind = d.origin === 'new_project' ? d.sourceKind : ''
  const linked = !!kind && !!d.sourceId
  return {
    origin: d.origin || null,
    source_kind: linked ? kind : null,
    source_id: linked ? d.sourceId : null,
    improvement_reason: d.origin === 'existing_projects' ? d.reason || null : null,
    product_id: d.origin === 'new_project' ? d.productId : null,
    machine_id: d.origin === 'existing_projects' ? d.machineId : null,
    origin_note: d.note.trim() || null,
  }
}

/** Searchable picker over /rnd/projects/source-options (server search, max 20). */
function SourcePicker({ kind, value, label, onChange, placeholder }: {
  kind: RndProjectSourceKind | 'product' | 'machine'
  value: number | null
  label: string
  onChange: (id: number | null, label: string) => void
  placeholder: string
}) {
  const [options, setOptions] = useState<RndProjectSourceOption[]>([])
  const [error, setError] = useState('')
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const seq = useRef(0)

  const load = (q: string) => {
    const mine = ++seq.current
    rndApi.projectSourceOptions(kind, q)
      .then((rows) => { if (mine === seq.current) { setOptions(rows); setError('') } })
      .catch((err) => { if (mine === seq.current) setError([extractErrorMessages(err, 'Could not load the list.')].flat().join(' ')) })
  }
  useEffect(() => {
    load('')
    return () => { if (timer.current) clearTimeout(timer.current) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kind])

  const onSearch = (q: string) => {
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(() => load(q.trim()), 250)
  }
  const list = options.map((o) => ({ value: String(o.id), label: o.id === value ? label || o.label : o.sub ? `${o.label} — ${o.sub}` : o.label }))
  if (value && !options.some((o) => o.id === value)) list.unshift({ value: String(value), label: label || `#${value}` })

  return (
    <div>
      <SearchableSelect
        value={value ? String(value) : ''}
        onChange={(v) => { const o = options.find((x) => String(x.id) === v); onChange(v ? Number(v) : null, o?.label || '') }}
        options={list}
        placeholder={placeholder}
        onSearch={onSearch}
      />
      {error && <p style={{ ...sheetHint, color: '#b91c1c' }}>{error}</p>}
    </div>
  )
}

function Toggle<T extends string>({ value, options, onChange }: { value: T | ''; options: { value: T; label: string }[]; onChange: (v: T) => void }) {
  return (
    <div style={{ display: 'inline-flex', border: `1px solid ${SHEET.LINE}`, borderRadius: 10, overflow: 'hidden' }}>
      {options.map((o) => {
        const on = o.value === value
        return (
          <button key={o.value} type="button" onClick={() => onChange(o.value)}
            style={{ ...segmentBtnStyle(on), border: 'none', borderRadius: 0, background: on ? SHEET.BLUE : '#fff', color: on ? '#fff' : SHEET.BODY }}>
            {o.label}
          </button>
        )
      })}
    </div>
  )
}

const PROOF_HINT: Record<string, string> = {
  existing_projects: 'The project being improved and the reason are enough; add who proposed it if useful.',
  new_project: 'Proof: attach the proposal or management note in Attachments. Linking a customer requirement keeps the project traceable to it.',
}

export default function ProjectOriginFields({ value, onChange, creating }: {
  value: OriginDraft
  onChange: (next: OriginDraft) => void
  /** New project form: attachments are mandatory proof for a New Project. */
  creating?: boolean
}) {
  const d = value
  const set = (patch: Partial<OriginDraft>) => onChange({ ...d, ...patch })
  const needNote = d.origin === 'new_project'

  return (
    <div>
      <div data-tour="rnd-pf-origin" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 10 }}>
        {ORIGINS.map((o) => {
          const on = d.origin === o.value
          const Icon = o.icon
          return (
            // ui-audit-ignore-next-line custom-button — origin option card (icon + title + description tile), not a pill button
            <button key={o.value} type="button" aria-pressed={on}
              onClick={() => { if (!on) onChange({ ...EMPTY_ORIGIN, origin: o.value, note: d.note, sourceKind: o.value === 'new_project' ? 'inquiry' : '' }) }}
              style={{
                textAlign: 'left', padding: '12px 14px', borderRadius: 12, cursor: 'pointer', display: 'flex', gap: 10, alignItems: 'flex-start',
                border: `1.5px solid ${on ? SHEET.BLUE : SHEET.LINE}`, background: on ? 'rgba(37,99,235,0.06)' : '#fff',
              }}>
              <Icon size={20} color={on ? SHEET.BLUE : SHEET.MUTED} style={{ flex: 'none', marginTop: 1 }} />
              <span>
                <span style={{ display: 'block', fontSize: 13.5, fontWeight: 700, color: on ? SHEET.BLUE : SHEET.INK }}>{o.label}</span>
                <span style={{ display: 'block', fontSize: 12, color: SHEET.MUTED, marginTop: 2, lineHeight: 1.4 }}>{o.meaning}</span>
              </span>
            </button>
          )
        })}
      </div>

      {d.origin === 'new_project' && (
        <div data-tour="rnd-pf-origin-source" style={{ marginTop: 14 }}>
          <label style={sheetLabel}>Customer requirement <Optional /></label>
          <div style={{ marginBottom: 8 }}>
            <Toggle value={d.sourceKind as 'inquiry' | 'tender' | ''} options={[{ value: 'inquiry', label: 'Inquiry' }, { value: 'tender', label: 'Tender' }]}
              onChange={(k) => { if (k !== d.sourceKind) set({ sourceKind: k, sourceId: null, sourceLabel: '' }) }} />
          </div>
          {d.sourceKind && (
            <SourcePicker key={d.sourceKind} kind={d.sourceKind} value={d.sourceId} label={d.sourceLabel}
              onChange={(id, label) => set({ sourceId: id, sourceLabel: label })}
              placeholder={`Search ${d.sourceKind === 'inquiry' ? 'inquiries' : 'tenders'} sent to R&D — R&D ID, customer, product…`} />
          )}
          <p style={sheetHint}>Only requirements sent to R&D that you can open are listed, by R&D ID. Leave empty for an internal idea.</p>
          <div style={{ marginTop: 12 }}>
            <label style={sheetLabel}>Product <Optional /></label>
            <SourcePicker kind="product" value={d.productId} label={d.productLabel}
              onChange={(id, label) => set({ productId: id, productLabel: label })} placeholder="Existing product this is based on, if any" />
          </div>
        </div>
      )}

      {d.origin === 'existing_projects' && (
        <div data-tour="rnd-pf-origin-source" style={{ marginTop: 14 }}>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12 }}>
            <div style={{ flex: '1 1 260px', maxWidth: 380 }}>
              <label style={sheetLabel}>Existing project being improved <Req /></label>
              <SourcePicker kind="machine" value={d.machineId} label={d.machineLabel}
                onChange={(id, label) => set({ machineId: id, machineLabel: label })} placeholder="Search project — PEW number, model or client…" />
            </div>
            <div style={{ flex: '0 1 240px', minWidth: 210 }}>
              <label style={sheetLabel}>Reason <Req /></label>
              <Select style={sheetInput} value={d.reason} onChange={(e) => set({ reason: e.target.value as RndImprovementReason })}>
                <option value="">Select reason…</option>
                {REASONS.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
              </Select>
            </div>
          </div>
        </div>
      )}

      {d.origin && (
        <div data-tour="rnd-pf-origin-note" style={{ marginTop: 12 }}>
          <label style={sheetLabel}>Who proposed it and why {needNote ? <Req /> : <Optional />}</label>
          <textarea style={{ ...sheetInput, resize: 'vertical', minHeight: 64 }} value={d.note} onChange={(e) => set({ note: e.target.value })}
            placeholder={d.origin === 'existing_projects' ? 'e.g. Production (Mr. X) — the casting needs 3 re-machining steps; a fabricated part would halve the cost.'
              : 'e.g. Proposed by the R&D head after the Jan review — the market needs a lighter model.'} />
        </div>
      )}

      {d.origin && (
        <p style={{ ...sheetHint, marginTop: 10 }}>
          {PROOF_HINT[d.origin]}
          {creating && originProofRequired(d) && <strong style={{ color: '#b91c1c' }}> At least one attachment is required.</strong>}
        </p>
      )}
    </div>
  )
}
