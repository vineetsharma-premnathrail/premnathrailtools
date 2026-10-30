'use client'

// Units tab. A project created in Project Management is one machine, so it has no units: the tab
// shows ONE "Whole project" row with where the project stands in every department (Design ... Delivered).
// An older project that came from a sales order still lists one row per vehicle / spares lot.
// Data: GET /projects/{id}/units (`has_units`, `whole_project.departments` for the whole-project row).
import { useEffect, useState } from 'react'
import { projectsApi } from '@/lib/api'
import { PmProject, ProjectUnitsResponse } from '@/types'
import { TEXT, GLASS } from '@/lib/theme'
import { formatDate } from '@/lib/format'
import { extractErrorMessages } from '@/lib/validation'
import { formatINR } from '@/components/sales/labels'
import ProjectUnitTable, { DEPARTMENT_COLUMNS, DepartmentCell } from '@/components/sales/ProjectUnitTable'
import { thStyle, tdStyle } from '@/components/sales/SalesUi'
import { DetailCard, DetailGroup, DetailRow, RowCount } from '@/components/shared/ui'
import { ErrorBanner, sectionStyle } from '@/components/projects/work/pmUi'

export default function UnitsTab({ project }: { project: PmProject }) {
  const [data, setData] = useState<ProjectUnitsResponse | null>(null)
  const [error, setError] = useState<string | string[]>('')

  useEffect(() => {
    let ignore = false
    projectsApi.units(project.id)
      .then((d) => { if (!ignore) { setData(d); setError('') } })
      .catch((err) => { if (!ignore) setError(extractErrorMessages(err, 'Could not load the units of this project. Check your connection and reload the page; if it keeps failing, ask an admin to check your access to this project.')) })
    return () => { ignore = true }
  }, [project.id])

  if (error && !data) return <ErrorBanner error={error} />
  if (!data) return <p style={{ fontSize: 13, color: TEXT.muted }}>Loading…</p>

  const hasUnits = data.has_units ?? data.elements.some((el) => el.status !== 'cancelled')
  const soNumber = data.so_number || project.so_number
  const poNumber = data.customer_po_number || project.customer_po_ref
  const wholeProjectLabel = data.whole_project?.label || `Whole project${project.machine_serial ? ` · ${project.machine_serial}` : ''}`
  const cells = data.whole_project?.departments || {}

  return (
    <div>
      <ErrorBanner error={error} />
      <DetailCard tour="pm-units-summary">
        <DetailGroup title={hasUnits ? 'Order' : 'Project'} last>
          {hasUnits && <DetailRow label="Sales order">{soNumber}</DetailRow>}
          <DetailRow label="Machine">{project.machine_serial}</DetailRow>
          <DetailRow label="Customer PO">{poNumber ? `${poNumber}${data.customer_po_date ? ` dated ${formatDate(data.customer_po_date)}` : ''}` : null}</DetailRow>
          {hasUnits && data.order_value !== null && data.order_value !== undefined && <DetailRow label="Order value (incl. GST)">{formatINR(data.order_value)}</DetailRow>}
          {hasUnits && <DetailRow label="Delivered">{`${data.vehicles_delivered} of ${data.vehicles_total} vehicles${data.lots_total ? ` · ${data.lots_total} spares lot(s)` : ''}`}</DetailRow>}
        </DetailGroup>
      </DetailCard>

      {!hasUnits && (
        <div style={{ ...sectionStyle, padding: 0 }}>
          <div style={{ padding: '16px 20px 8px' }}>
            <h2 style={{ fontSize: 15, fontWeight: 700, color: TEXT.heading, margin: 0 }}>Whole project — 360 view</h2>
            <p style={{ fontSize: 12.5, color: TEXT.muted, margin: '4px 0 0' }}>
              One project is one machine, so there is a single row. Each department column shows where the project stands; “—” means nothing is linked to {project.project_code} yet.
            </p>
          </div>
          <div data-tour="pm-units-360" style={{ overflow: 'auto', borderTop: `1px solid ${GLASS.border}`, borderRadius: '0 0 18px 18px' }}>
            {/* ui-audit-ignore table-scroll — wrapped in this box's own overflow:auto */}
            <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 1000 }}>
              <thead><tr><th style={thStyle}>Project <RowCount count={1} /></th>{DEPARTMENT_COLUMNS.map((c) => <th key={c.key} style={thStyle}>{c.label}</th>)}</tr></thead>
              <tbody>
                <tr>
                  <td style={tdStyle}><div style={{ fontWeight: 600, color: TEXT.heading, whiteSpace: 'nowrap' }}>{wholeProjectLabel}</div></td>
                  {DEPARTMENT_COLUMNS.map((c) => <td key={c.key} style={tdStyle}><DepartmentCell cell={cells[c.key]} /></td>)}
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      )}

      {data.elements.length > 0 && (
        <div style={{ ...sectionStyle, padding: 0 }}>
          <div style={{ padding: '16px 20px 8px' }}>
            <h2 style={{ fontSize: 15, fontWeight: 700, color: TEXT.heading, margin: 0 }}>Vehicles &amp; lots — 360 view</h2>
            <p style={{ fontSize: 12.5, color: TEXT.muted, margin: '4px 0 0' }}>
              One row per vehicle and per spares lot of the original order. Each department column shows where that unit stands; “—” means nothing is linked yet.
            </p>
          </div>
          <div data-tour="pm-units-360" style={{ overflow: 'auto', maxHeight: 'calc(100vh - 300px)', borderTop: `1px solid ${GLASS.border}`, borderRadius: '0 0 18px 18px' }}>
            <ProjectUnitTable elements={data.elements} />
          </div>
        </div>
      )}
    </div>
  )
}
