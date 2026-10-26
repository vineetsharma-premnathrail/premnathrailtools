'use client'

import { useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { useRequireOrgTab } from '@/app/dashboard/organization/_lib/useRequireOrgTab'
import { organizationApi, storeApi, costCentersApi } from '@/lib/api'
import { Branch, BranchAddress, BranchUserAssignment, BranchDocument, Department, StoreLocation, CostCenter } from '@/types'
import { TEXT, BRAND, BORDER } from '@/lib/theme'
import OrgListItem, { orgEmptyStyle } from '@/components/organization/OrgListItem'
import OrganizationNav from '@/components/organization/OrganizationNav'
import InvalidRecordLink from '@/components/erp/InvalidRecordLink'
import { useRecordId } from '@/lib/recordRef'
import { PLANT_STATUS_LABELS, PLANT_STATUS_HEX } from '@/components/organization/PlantForm'
import { secondaryBtnStyle, primaryBtnStyle, Pill, DetailCard, DetailSummary, DetailGroup, DetailRow } from '@/components/shared/ui'
import { extractErrorMessages } from '@/lib/validation'
import { useCan } from '@/lib/permissions'
import { formatDate } from '@/lib/format'

const emptyStyle = orgEmptyStyle
const ListItem = OrgListItem

const TABS = ['Basic', 'Address', 'Operational Configuration', 'Branch Users', 'Branch Departments', 'Branch Stores', 'Branch Cost Centers', 'Branch Documents'] as const

const DETAIL_TAB_TOUR_IDS: Record<typeof TABS[number], string> = {
  'Basic': 'org-plant-detail-tab-basic',
  'Address': 'org-plant-detail-tab-address',
  'Operational Configuration': 'org-plant-detail-tab-operational',
  'Branch Users': 'org-plant-detail-tab-users',
  'Branch Departments': 'org-plant-detail-tab-departments',
  'Branch Stores': 'org-plant-detail-tab-warehouses',
  'Branch Cost Centers': 'org-plant-detail-tab-costcenters',
  'Branch Documents': 'org-plant-detail-tab-documents',
}

// Inside a branch every tab is about that branch, so the "Branch " prefix is dropped on screen.
const TAB_LABELS: Record<typeof TABS[number], string> = {
  'Basic': 'Basic',
  'Address': 'Address',
  'Operational Configuration': 'Operations',
  'Branch Users': 'Users',
  'Branch Departments': 'Departments',
  'Branch Stores': 'Stores',
  'Branch Cost Centers': 'Cost Centers',
  'Branch Documents': 'Documents',
}

export default function PlantDetailPage() {
  const { isAuthorized, isLoading } = useRequireOrgTab('branches')
  const { can, canFeature } = useCan()
  // Plant features (core/features/organization.py): Branch Users / Branch Documents.
  const seeUsers = canFeature('organization', 'branches', 'user_assignments', 'view')
  const seeDocs = canFeature('organization', 'branches', 'documents', 'view')
  const seeTab = (t: typeof TABS[number]) => (t === 'Branch Users' ? seeUsers : t === 'Branch Documents' ? seeDocs : true)
  const params = useParams()
  const router = useRouter()
  const ref = params.id as string
  const { id: resolvedPlantId, error: linkError } = useRecordId(ref)
  const plantId = resolvedPlantId ?? 0

  const [plant, setPlant] = useState<Branch | null>(null)
  const [addresses, setAddresses] = useState<BranchAddress[]>([])
  const [assignments, setAssignments] = useState<BranchUserAssignment[]>([])
  const [departments, setDepartments] = useState<Department[]>([])
  const [warehouses, setWarehouses] = useState<StoreLocation[]>([])
  const [costCenters, setCostCenters] = useState<CostCenter[]>([])
  const [documents, setDocuments] = useState<BranchDocument[]>([])
  const [error, setError] = useState('')
  const [tab, setTab] = useState<typeof TABS[number]>('Basic')

  const load = () => {
    setError('')
    Promise.all([
      organizationApi.getBranch(plantId),
      organizationApi.listBranchAddresses(plantId),
      seeUsers ? organizationApi.listBranchUserAssignments(plantId) : Promise.resolve([]),
      organizationApi.listDepartments(plantId),
      storeApi.listLocations(plantId),
      costCentersApi.listCostCenters(plantId),
      seeDocs ? organizationApi.listBranchDocuments(plantId) : Promise.resolve([]),
    ])
      .then(([p, a, u, d, w, cc, docs]) => {
        setPlant(p); setAddresses(a); setAssignments(u); setDepartments(d); setWarehouses(w); setCostCenters(cc); setDocuments(docs)
      })
      .catch((err: unknown) => setError(extractErrorMessages(err, 'Could not load this branch. Reload the page; if it keeps failing, check you still have access to Organization › Branches.').join(' ')))
  }

  useEffect(() => {
    if (isAuthorized && plantId) load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAuthorized, plantId])

  if (isLoading || !isAuthorized) return null
  if (linkError) return (<div><OrganizationNav /><InvalidRecordLink message={linkError} listHref="/dashboard/organization/plants" listLabel="Back to branches" /></div>)
  if (!plantId) return <div><OrganizationNav /></div>

  if (error) {
    return (
      <div>
        <OrganizationNav />
        <div style={{ padding: '20px 24px' }}>
          <div style={{ padding: '10px 14px', borderRadius: 10, background: 'rgba(220,38,38,0.08)', border: '1px solid rgba(220,38,38,0.2)', color: '#b91c1c', fontSize: 13 }}>
            {error}
          </div>
        </div>
      </div>
    )
  }

  if (!plant) return null

  const primaryAddress = addresses.find((a) => a.is_primary && a.is_active) || addresses.find((a) => a.is_active)
  const titleCase = (v?: string | null) => (v ? v.replace(/_/g, ' ').replace(/^\w/, (c) => c.toUpperCase()) : '')
  const canEdit = can('organization', 'branches', 'edit')
  // Small count next to each list tab so the user sees what is inside before clicking.
  const COUNTED: Partial<Record<typeof TABS[number], number>> = {
    'Address': addresses.length,
    'Branch Users': assignments.length,
    'Branch Departments': departments.length,
    'Branch Stores': warehouses.length,
    'Branch Cost Centers': costCenters.length,
    'Branch Documents': documents.length,
  }

  return (
    <div>
      <OrganizationNav />

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, marginBottom: 16, flexWrap: 'wrap' }}>
        <div style={{ minWidth: 0 }}>
          <p style={{ fontSize: 11.5, fontWeight: 600, letterSpacing: '.05em', textTransform: 'uppercase', color: TEXT.muted, margin: '0 0 4px' }}>Organization › Branches</p>
          <h1 style={{ fontSize: 24, fontWeight: 700, color: TEXT.heading, margin: 0 }}>Branch Details</h1>
        </div>
        <div style={{ display: 'flex', gap: 10 }}>
          {can('organization', 'branches', 'edit') && <button
            onClick={() => router.push(`/dashboard/organization/plants/${ref}/edit`)}
            data-tour="org-plant-detail-edit-btn"
            style={primaryBtnStyle}
          >
            Edit
          </button>}
          <button onClick={() => router.push('/dashboard/organization/plants')} type="button" data-tour="org-plant-detail-back" style={secondaryBtnStyle}>← Back</button>
        </div>
      </div>

      <DetailCard>
        <DetailSummary
          title={plant.name}
          text={plant.description || (primaryAddress ? [primaryAddress.city, primaryAddress.state].filter(Boolean).join(', ') || undefined : undefined)}
          meta={<>
            <span data-tour="org-plant-detail-status"><Pill label={PLANT_STATUS_LABELS[plant.status] || plant.status} hex={PLANT_STATUS_HEX[plant.status] || '#64748b'} /></span>
            <span>·</span><span>Code {plant.code}</span>
            {plant.plant_type && <><span>·</span><span>{plant.plant_type}</span></>}
            {plant.manager_user_name && <><span>·</span><span>Manager: {plant.manager_user_name}</span></>}
          </>}
        />

        <div style={{ display: 'flex', gap: 8, margin: '4px 0', borderBottom: `1px solid ${BORDER.normal}`, flexWrap: 'wrap' }}>
          {TABS.filter(seeTab).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              data-tour={DETAIL_TAB_TOUR_IDS[t]}
              style={{
                padding: '10px 6px', marginRight: 16, border: 'none', borderRadius: 0, boxShadow: 'none', outline: 'none',
                background: 'transparent', borderBottom: tab === t ? `2px solid ${BRAND.primary}` : '2px solid transparent',
                color: tab === t ? BRAND.primary : TEXT.secondary, fontWeight: 600, fontSize: 13, cursor: 'pointer', whiteSpace: 'nowrap',
              }}
            >
              {TAB_LABELS[t]}
              {COUNTED[t] !== undefined && <span style={{ marginLeft: 6, fontSize: 11.5, color: TEXT.muted, fontWeight: 600 }}>{COUNTED[t]}</span>}
            </button>
          ))}
        </div>

        {(tab === 'Basic' || !seeTab(tab)) && (
          <>
            <DetailGroup title="Basic information">
              <DetailRow label="Company">{plant.company_name}</DetailRow>
              <DetailRow label="Branch type">{plant.plant_type}</DetailRow>
              <DetailRow label="Industry / function">{plant.industry_function}</DetailRow>
              <DetailRow label="Established on">{plant.established_date ? formatDate(plant.established_date) : null}</DetailRow>
              <DetailRow label="Active from">{plant.active_from ? formatDate(plant.active_from) : null}</DetailRow>
            </DetailGroup>
            <DetailGroup title="People">
              <DetailRow label="Branch head">{plant.head_user_name}</DetailRow>
              <DetailRow label="Branch manager">{plant.manager_user_name}</DetailRow>
            </DetailGroup>
            <DetailGroup title="Notes" last>
              <DetailRow label="Description">{plant.description}</DetailRow>
              <DetailRow label="Remarks">{plant.remarks}</DetailRow>
            </DetailGroup>
          </>
        )}

        {tab === 'Address' && (
          <div style={{ paddingTop: 8 }}>
            {addresses.length === 0 ? (
              <p style={emptyStyle}>No addresses added yet{canEdit ? ' — use Edit › Address to add this branch’s address.' : '.'}</p>
            ) : addresses.map((a, i) => (
              <ListItem key={a.id} last={i === addresses.length - 1}
                title={a.address_type || 'Address'}
                tags={<>{a.is_primary && <Pill label="Primary" hex="#047857" />}{!a.is_active && <Pill label="Inactive" hex="#b91c1c" />}</>}
                body={[a.address_line1, a.address_line2, a.landmark, a.city, a.district, a.state, a.country, a.pincode].filter(Boolean).join(', ')} />
            ))}
          </div>
        )}

        {tab === 'Operational Configuration' && (
          <>
            <DetailGroup title="Working time">
              <DetailRow label="Working calendar">{plant.working_calendar}</DetailRow>
              <DetailRow label="Working days">{plant.working_days}</DetailRow>
              <DetailRow label="Working hours">{plant.working_hours}</DetailRow>
              <DetailRow label="Time zone">{plant.timezone}</DetailRow>
            </DetailGroup>
            <DetailGroup title="Defaults">
              <DetailRow label="Default store">{plant.default_warehouse_name}</DetailRow>
              <DetailRow label="Default cost center">{plant.default_cost_center_name}</DetailRow>
              <DetailRow label="Default profit center">{plant.default_profit_center}</DetailRow>
              <DetailRow label="Currency">{plant.currency}</DetailRow>
            </DetailGroup>
            <DetailGroup title="GST" last>
              <DetailRow label="GSTIN">{plant.gstin}</DetailRow>
              <DetailRow label="State code">{plant.state_code}</DetailRow>
            </DetailGroup>
          </>
        )}

        {tab === 'Branch Users' && seeUsers && (
          <div style={{ paddingTop: 8 }}>
            {assignments.length === 0 ? (
              <p style={emptyStyle}>No users assigned to this branch yet{canEdit ? ' — use Edit › Users to assign people.' : '.'}</p>
            ) : assignments.map((a, i) => (
              <ListItem key={a.id} last={i === assignments.length - 1}
                title={a.user_name || `User #${a.user_id}`}
                sub={a.role || undefined}
                tags={a.is_primary_branch ? <Pill label="Primary branch" hex="#047857" /> : null}
                body={[a.designation, a.department_name, a.access_level, a.employee_id].filter(Boolean).join(' · ') || '—'} />
            ))}
          </div>
        )}

        {tab === 'Branch Departments' && (
          <div style={{ paddingTop: 8 }}>
            <p style={{ fontSize: 12, color: TEXT.muted, margin: '0 0 4px' }}>Departments are managed from Organization › Department.</p>
            {departments.length === 0 ? (
              <p style={emptyStyle}>No departments under this branch yet.</p>
            ) : departments.map((d, i) => (
              <ListItem key={d.id} last={i === departments.length - 1}
                title={d.name}
                sub={d.code || undefined}
                body={d.head_user_name ? `Head: ${d.head_user_name}` : 'No head set'} />
            ))}
          </div>
        )}

        {tab === 'Branch Stores' && (
          <div style={{ paddingTop: 8 }}>
            {warehouses.length === 0 ? (
              <p style={emptyStyle}>No stores under this branch yet — stores are added from the Store module.</p>
            ) : warehouses.map((w, i) => (
              <ListItem key={w.id} last={i === warehouses.length - 1}
                title={w.name}
                sub={w.code || undefined}
                tags={plant.default_warehouse_id === w.id ? <Pill label="Default" hex="#047857" /> : null}
                body={[titleCase(w.warehouse_type), w.manager_user_name ? `Manager: ${w.manager_user_name}` : '', titleCase(w.status)].filter(Boolean).join(' · ') || '—'} />
            ))}
          </div>
        )}

        {tab === 'Branch Cost Centers' && (
          <div style={{ paddingTop: 8 }}>
            {costCenters.length === 0 ? (
              <p style={emptyStyle}>No cost centers under this branch yet.</p>
            ) : costCenters.map((cc, i) => (
              <ListItem key={cc.id} last={i === costCenters.length - 1}
                title={cc.name}
                sub={cc.code || undefined}
                tags={plant.default_cost_center_id === cc.id ? <Pill label="Default" hex="#047857" /> : null}
                body={[titleCase(cc.cost_center_type), cc.department_name, cc.head_user_name ? `Head: ${cc.head_user_name}` : ''].filter(Boolean).join(' · ') || '—'} />
            ))}
          </div>
        )}

        {tab === 'Branch Documents' && seeDocs && (
          <div style={{ paddingTop: 8 }}>
            {documents.length === 0 ? (
              <p style={emptyStyle}>No documents uploaded yet{canEdit ? ' — use Edit › Documents to upload licences and certificates.' : '.'}</p>
            ) : documents.map((d, i) => (
              <ListItem key={d.id} last={i === documents.length - 1}
                title={d.document_name}
                sub={d.document_type}
                body={[d.filename, d.expiry_date ? `Expires ${formatDate(d.expiry_date)}` : '', d.version ? `v${d.version}` : ''].filter(Boolean).join(' · ')}
                action={d.sharepoint_url && canFeature('organization', 'branches', 'documents', 'export') ? <a href={d.sharepoint_url} target="_blank" rel="noreferrer" style={{ fontSize: 11.5, fontWeight: 600, color: BRAND.primaryActive }}>Open</a> : null} />
            ))}
          </div>
        )}
      </DetailCard>
    </div>
  )
}
