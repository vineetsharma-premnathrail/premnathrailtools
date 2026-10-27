'use client'

import { rndApi } from '@/lib/api'
import { RndProject } from '@/types'
import { BudgetPicker } from '@/components/finance/ProjectBudget'
import { Optional, SheetSection, sheetHint, sheetInput, sheetLabel } from '@/components/shared/FormSheet'

export type RndBudgetDraft = { financeId: string; amount: string }

export const EMPTY_RND_BUDGET: RndBudgetDraft = { financeId: '', amount: '' }

/** financeId = a budget Finance created (linked); otherwise the typed amount. */
export const rndBudgetFromProject = (p: RndProject): RndBudgetDraft => ({
  financeId: p.budget_from_finance && p.internal_order_id ? String(p.internal_order_id) : '',
  amount: !p.budget_from_finance && p.budget_amount != null ? String(p.budget_amount) : '',
})

export function rndBudgetError(d: RndBudgetDraft): string {
  if (!d.financeId && d.amount.trim() && !(Number(d.amount) >= 0)) return 'Budget amount must be a number of rupees (0 or more), or leave it blank.'
  return ''
}

/** Payload part. On edit (`initial` given) the budget link is sent only when it changed. */
export function rndBudgetPayload(d: RndBudgetDraft, initial?: RndBudgetDraft): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  if (!initial || d.financeId !== initial.financeId) out.internal_order_id = d.financeId ? Number(d.financeId) : null
  if (!d.financeId) out.budget_amount = d.amount.trim() ? Number(d.amount) : null
  return out
}

/** Budget section of the New / Edit R&D Project form. */
export default function RndBudgetFields({ value, onChange, projectId }: { value: RndBudgetDraft; onChange: (v: RndBudgetDraft) => void; projectId?: number }) {
  return (
    <SheetSection icon="list" title="Budget" extra={<Optional />}>
      <div data-tour="rnd-pf-budget">
        <label style={sheetLabel}>Finance budget</label>
        <BudgetPicker value={value.financeId} onChange={(v) => onChange({ ...value, financeId: v })} load={() => rndApi.projectBudgetOptions(projectId)} />
        {!value.financeId && (
          <div style={{ marginTop: 14, maxWidth: 260 }}>
            <label style={sheetLabel}>Budget amount (₹)</label>
            <input style={sheetInput} type="number" min={0} inputMode="decimal" value={value.amount} onChange={(e) => onChange({ ...value, amount: e.target.value })} placeholder="e.g. 250000" />
          </div>
        )}
        <p style={sheetHint}>
          {value.financeId
            ? 'The amount is set by Finance on that budget. Purchases charged to this project are booked on it.'
            : 'Pick a budget Finance created, or type an amount — Finance then opens a development budget with the first purchase charged to this project.'}
        </p>
      </div>
    </SheetSection>
  )
}
