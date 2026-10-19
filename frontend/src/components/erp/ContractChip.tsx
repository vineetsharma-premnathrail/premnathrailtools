'use client'

import { useEffect, useState } from 'react'
import { serviceContractsApi } from '@/lib/sdServiceApi'
import { SERVICE_CONTRACTS_ENABLED } from '@/lib/features'

type Entitlement = {
  contract_id: number; contract_number: string; contract_type?: string; covered: boolean; reason?: string
  end_date?: string; visits_included?: number; visits_used?: number; labour_covered?: boolean; spares_covered?: boolean
  sla_response_hours?: number | null; sla_resolution_hours?: number | null
} | null

const TYPE_LABELS: Record<string, string> = { amc: 'AMC', cmc: 'CMC', extended_warranty: 'Ext. warranty' }

/** AMC / CMC covering a machine today (erp/service-contracts entitlement):
 * contract no., coverage, visits used / included and the contract SLA hours.
 * Renders nothing when the machine has no contract. */
export default function ContractChip({ projectId }: { projectId: number }) {
  const [ent, setEnt] = useState<Entitlement>(null)
  useEffect(() => {
    if (!SERVICE_CONTRACTS_ENABLED) return
    serviceContractsApi.entitlement(projectId).then((r: { entitlement: Entitlement }) => setEnt(r.entitlement)).catch(() => setEnt(null))
  }, [projectId])
  if (!ent) return null
  const hex = ent.covered ? '#0f766e' : '#b45309'
  const parts = ent.covered ? [
    `${TYPE_LABELS[ent.contract_type || ''] || 'Contract'} ${ent.contract_number}`,
    [ent.labour_covered && 'labour', ent.spares_covered && 'spares'].filter(Boolean).join(' + ') + ' covered',
    ent.visits_included ? `visits ${ent.visits_used ?? 0}/${ent.visits_included}` : 'unlimited visits',
    (ent.sla_response_hours || ent.sla_resolution_hours) ? `SLA ${ent.sla_response_hours ?? '—'}h / ${ent.sla_resolution_hours ?? '—'}h` : null,
  ].filter(Boolean) : [ent.reason || `${ent.contract_number}: not covering this visit`]
  return (
    <span title={ent.covered && ent.end_date ? `Valid till ${ent.end_date}` : undefined}
      style={{ fontSize: 11.5, fontWeight: 700, padding: '4px 10px', borderRadius: 9999, background: `${hex}1a`, color: hex, whiteSpace: 'nowrap', display: 'inline-block' }}>
      {parts.join(' · ')}
    </span>
  )
}
