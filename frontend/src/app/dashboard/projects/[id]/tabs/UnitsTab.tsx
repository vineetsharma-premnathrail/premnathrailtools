'use client'

// Units tab: a project made from a sales order has one unit per vehicle (a
// delivery row of the order) and one per spares lot. The table shows where each
// unit stands in every department (Design ... Delivered). Data: GET /projects/{id}/units.
import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { projectsApi } from '@/lib/api'
import { PmProject, ProjectUnitsResponse } from '@/types'
import { TEXT, GLASS } from '@/lib/theme'
import { formatDate } from '@/lib/format'
import { extractErrorMessages } from '@/lib/validation'
import { recordPath } from '@/lib/recordRef'
import { useCan } from '@/lib/permissions'
import { formatINR } from '@/components/sales/labels'
import ProjectUnitTable from '@/components/sales/ProjectUnitTable'
import { DetailCard, DetailGroup, DetailRow } from '@/components/shared/ui'
import { ErrorBanner, sectionStyle } from '@/components/projects/work/pmUi'

export default function UnitsTab({ project }: { project: PmProject }) {
  const router = useRouter()
  const { can } = useCan()
  const [data, setData] = useState<ProjectUnitsResponse | null>(null)
  const [error, setError] = useState<string | string[]>('')

  useEffect(() => {
    let ignore = false
    projectsApi.units(project.id)
      .then((d) => { if (!ignore) { setData(d); setError('') } })
      .catch((err) => { if (!ignore) setError(extractErrorMessages(err, 'Could not load the units of this project. Check your connection and reload the page; if it keeps failing, ask an admin to check your access to this project.')) })
    return () => { ignore = true }
  }, [project.id])

  const soNumber = data?.so_number || project.so_number || project.sales_order_ref
  const soId = data?.sales_order_id ?? project.sales_order_id
  const canOpenSo = can('sales', 'orders', 'view') && !!soId

  if (error && !data) return <ErrorBanner error={error} />
  if (!data) return <p style={{ fontSize: 13, color: TEXT.muted }}>Loading…</p>

  return (
    <div>
      <ErrorBanner error={error} />
      <DetailCard tour="pm-units-summary">
        <DetailGroup title="Sales order" last>
          <DetailRow label="Sales order">{soNumber ? (canOpenSo ? (
            <button type="button" onClick={() => router.push(recordPath('/dashboard/sales/orders', { id: soId }))}
              style={{ background: 'none', border: 'none', padding: 0, color: '#2563EB', fontWeight: 600, cursor: 'pointer', fontSize: 13.5, fontFamily: 'inherit' }}>
              {soNumber} →
            </button>
          ) : soNumber) : null}</DetailRow>
          <DetailRow label="Customer PO">{data.customer_po_number ? `${data.customer_po_number}${data.customer_po_date ? ` dated ${formatDate(data.customer_po_date)}` : ''}` : null}</DetailRow>
          {data.order_value !== null && data.order_value !== undefined && <DetailRow label="Order value (incl. GST)">{formatINR(data.order_value)}</DetailRow>}
          <DetailRow label="Delivered">{`${data.vehicles_delivered} of ${data.vehicles_total} vehicles${data.lots_total ? ` · ${data.lots_total} spares lot(s)` : ''}`}</DetailRow>
        </DetailGroup>
      </DetailCard>

      <div style={{ ...sectionStyle, padding: 0 }}>
        <div style={{ padding: '16px 20px 8px' }}>
          <h2 style={{ fontSize: 15, fontWeight: 700, color: TEXT.heading, margin: 0 }}>Vehicles &amp; lots — 360 view</h2>
          <p style={{ fontSize: 12.5, color: TEXT.muted, margin: '4px 0 0' }}>
            One row per vehicle (a delivery row of the order) and per spares lot. Each department column shows where that unit stands; “—” means nothing is linked yet.
          </p>
        </div>
        <div data-tour="pm-units-360" style={{ overflow: 'auto', maxHeight: 'calc(100vh - 300px)', borderTop: `1px solid ${GLASS.border}`, borderRadius: '0 0 18px 18px' }}>
          <ProjectUnitTable elements={data.elements} />
        </div>
      </div>
    </div>
  )
}
