'use client'

import { useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { useRequireAdmin } from '@/hooks/useAuth'
import { organizationApi, storeApi, costCentersApi } from '@/lib/api'
import { Branch, BranchAddress, BranchUserAssignment, BranchDocument, Department, StoreLocation, CostCenter } from '@/types'
import { TEXT, GLASS, SHADOWS, BRAND, BORDER } from '@/lib/theme'
import OrganizationNav from '@/components/organization/OrganizationNav'
import { PLANT_STATUS_LABELS, PLANT_STATUS_HEX } from '@/components/organization/PlantForm'
import { secondaryBtnStyle } from '@/components/shared/ui'

const sectionStyle: React.CSSProperties = {
  borderRadius: 18, background: GLASS.card, backdropFilter: GLASS.blur, WebkitBackdropFilter: GLASS.blur,
  border: `1px solid ${GLASS.border}`, boxShadow: SHADOWS.glass(), padding: 20, marginBottom: 20,
}
const labelStyle: React.CSSProperties = { fontSize: 11, fontWeight: 700, color: TEXT.muted, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 4 }
const valueStyle: React.CSSProperties = { fontSize: 14, color: TEXT.body, marginBottom: 16 }
const cardRowStyle: React.CSSProperties = {
  display: 'flex', flexDirection: 'column', gap: 8, padding: '14px 16px', borderRadius: 12,
  background: 'rgba(255,255,255,.5)', border: `1px solid ${BORDER.normal}`,
}

const TABS = ['Basic', 'Address', 'Operational Configuration', 'Branch Users', 'Branch Departments', 'Branch Warehouses', 'Branch Cost Centers', 'Branch Documents'] as const

const DETAIL_TAB_TOUR_IDS: Record<typeof TABS[number], string> = {
  'Basic': 'org-plant-detail-tab-basic',
  'Address': 'org-plant-detail-tab-address',
  'Operational Configuration': 'org-plant-detail-tab-operational',
  'Branch Users': 'org-plant-detail-tab-users',
  'Branch Departments': 'org-plant-detail-tab-departments',
  'Branch Warehouses': 'org-plant-detail-tab-warehouses',
  'Branch Cost Centers': 'org-plant-detail-tab-costcenters',
  'Branch Documents': 'org-plant-detail-tab-documents',
}

export default function PlantDetailPage() {
  const { isAuthorized, isLoading } = useRequireAdmin()
  const params = useParams()
  const router = useRouter()
  const plantId = Number(params.id)

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
      organizationApi.listBranchUserAssignments(plantId),
      organizationApi.listDepartments(plantId),
      storeApi.listLocations(plantId),
      costCentersApi.listCostCenters(plantId),
      organizationApi.listBranchDocuments(plantId),
    ])
      .then(([p, a, u, d, w, cc, docs]) => {
        setPlant(p); setAddresses(a); setAssignments(u); setDepartments(d); setWarehouses(w); setCostCenters(cc); setDocuments(docs)
      })
      .catch(() => setError('Failed to load branch.'))
  }

  useEffect(() => {
    if (isAuthorized && plantId) load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAuthorized, plantId])

  if (isLoading || !isAuthorized) return null

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

  return (
    <div>
      <OrganizationNav />

      <div style={{ padding: '20px 24px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <h1 style={{ fontSize: 22, fontWeight: 700, color: TEXT.heading, margin: 0 }}>{plant.name}</h1>
              <span style={{ fontSize: 11, fontWeight: 700, padding: '4px 10px', borderRadius: 9999, background: `${PLANT_STATUS_HEX[plant.status]}1a`, color: PLANT_STATUS_HEX[plant.status] }}>
                {PLANT_STATUS_LABELS[plant.status] || plant.status}
              </span>
            </div>
            <p style={{ fontSize: 12, color: TEXT.secondary, margin: '8px 0 0 0' }}>Code: {plant.code}</p>
          </div>
          <div style={{ display: 'flex', gap: 10 }}>
            <button onClick={() => router.push('/dashboard/organization/plants')} type="button" data-tour="org-plant-detail-back" style={secondaryBtnStyle}>← Back</button>
            <button
              onClick={() => router.push(`/dashboard/organization/plants/${plantId}/edit`)}
              data-tour="org-plant-detail-edit-btn"
              style={{ padding: '10px 20px', borderRadius: 10, border: 'none', background: `linear-gradient(140deg,${BRAND.primary},${BRAND.primaryHover})`, color: '#fff', fontSize: 13.5, fontWeight: 700, cursor: 'pointer', boxShadow: `0 4px 14px ${BRAND.primaryGlow}` }}
            >
              Edit
            </button>
          </div>
        </div>

        <div style={{ display: 'flex', gap: 8, marginBottom: 20, borderBottom: `1px solid ${BORDER.normal}`, flexWrap: 'wrap' }}>
          {TABS.map((t) => (
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
              {t}
            </button>
          ))}
        </div>

        {tab === 'Basic' && (
          <div style={sectionStyle}>
            <h2 style={{ fontSize: 12, fontWeight: 700, color: TEXT.muted, textTransform: 'uppercase', marginBottom: 12 }}>Basic Information</h2>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20 }}>
              <div><div style={labelStyle}>Company</div><div style={valueStyle}>{plant.company_name || '—'}</div></div>
              <div><div style={labelStyle}>Branch Type</div><div style={valueStyle}>{plant.plant_type || '—'}</div></div>
              <div><div style={labelStyle}>Branch Head</div><div style={valueStyle}>{plant.head_user_name || '—'}</div></div>
              <div><div style={labelStyle}>Branch Manager</div><div style={valueStyle}>{plant.manager_user_name || '—'}</div></div>
              <div><div style={labelStyle}>Established Date</div><div style={valueStyle}>{plant.established_date || '—'}</div></div>
              <div><div style={labelStyle}>Industry / Function</div><div style={valueStyle}>{plant.industry_function || '—'}</div></div>
              <div><div style={labelStyle}>Active From</div><div style={valueStyle}>{plant.active_from || '—'}</div></div>
              <div style={{ gridColumn: '1 / -1' }}><div style={labelStyle}>Description</div><div style={valueStyle}>{plant.description || '—'}</div></div>
              <div style={{ gridColumn: '1 / -1' }}><div style={labelStyle}>Remarks</div><div style={valueStyle}>{plant.remarks || '—'}</div></div>
            </div>
          </div>
        )}

        {tab === 'Address' && (
          <div style={sectionStyle}>
            <h2 style={{ fontSize: 12, fontWeight: 700, color: TEXT.muted, textTransform: 'uppercase', marginBottom: 12 }}>Addresses</h2>
            {addresses.length === 0 ? (
              <p style={{ fontSize: 13, color: TEXT.muted }}>No addresses added yet.</p>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {addresses.map((a) => (
                  <div key={a.id} style={cardRowStyle}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4, flexWrap: 'wrap' }}>
                      <span style={{ fontSize: 13.5, fontWeight: 600, color: TEXT.heading }}>{a.address_type || 'Address'}</span>
                      {a.is_primary && <span style={{ fontSize: 10.5, fontWeight: 700, padding: '2px 8px', borderRadius: 9999, background: 'rgba(16,185,129,0.12)', color: '#047857' }}>PRIMARY</span>}
                      {!a.is_active && <span style={{ fontSize: 10.5, fontWeight: 700, padding: '2px 8px', borderRadius: 9999, background: 'rgba(220,38,38,0.1)', color: '#b91c1c' }}>INACTIVE</span>}
                    </div>
                    <p style={{ fontSize: 12.5, color: TEXT.secondary, margin: 0 }}>
                      {[a.address_line1, a.address_line2, a.landmark, a.city, a.district, a.state, a.country, a.pincode].filter(Boolean).join(', ')}
                    </p>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {tab === 'Operational Configuration' && (
          <div style={sectionStyle}>
            <h2 style={{ fontSize: 12, fontWeight: 700, color: TEXT.muted, textTransform: 'uppercase', marginBottom: 12 }}>Operational Configuration</h2>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20 }}>
              <div><div style={labelStyle}>Working Calendar</div><div style={valueStyle}>{plant.working_calendar || '—'}</div></div>
              <div><div style={labelStyle}>Working Days</div><div style={valueStyle}>{plant.working_days || '—'}</div></div>
              <div><div style={labelStyle}>Working Hours</div><div style={valueStyle}>{plant.working_hours || '—'}</div></div>
              <div><div style={labelStyle}>Time Zone</div><div style={valueStyle}>{plant.timezone || '—'}</div></div>
              <div><div style={labelStyle}>Default Warehouse</div><div style={valueStyle}>{plant.default_warehouse_name || '—'}</div></div>
              <div><div style={labelStyle}>Default Cost Center</div><div style={valueStyle}>{plant.default_cost_center_name || '—'}</div></div>
              <div><div style={labelStyle}>Default Profit Center</div><div style={valueStyle}>{plant.default_profit_center || '—'}</div></div>
              <div><div style={labelStyle}>Currency</div><div style={valueStyle}>{plant.currency || '—'}</div></div>
            </div>
          </div>
        )}

        {tab === 'Branch Users' && (
          <div style={sectionStyle}>
            <h2 style={{ fontSize: 12, fontWeight: 700, color: TEXT.muted, textTransform: 'uppercase', marginBottom: 12 }}>Branch Users</h2>
            {assignments.length === 0 ? (
              <p style={{ fontSize: 13, color: TEXT.muted }}>No users assigned yet.</p>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {assignments.map((a) => (
                  <div key={a.id} style={cardRowStyle}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4, flexWrap: 'wrap' }}>
                      <span style={{ fontSize: 13.5, fontWeight: 600, color: TEXT.heading }}>{a.user_name || `User #${a.user_id}`}</span>
                      {a.role && <span style={{ fontSize: 10.5, fontWeight: 600, padding: '2px 8px', borderRadius: 9999, background: 'rgba(244,113,59,0.1)', color: BRAND.primary }}>{a.role}</span>}
                      {a.is_primary_branch && <span style={{ fontSize: 10.5, fontWeight: 700, padding: '2px 8px', borderRadius: 9999, background: 'rgba(16,185,129,0.12)', color: '#047857' }}>PRIMARY</span>}
                    </div>
                    <p style={{ fontSize: 12.5, color: TEXT.secondary, margin: 0 }}>
                      {[a.designation, a.department_name, a.access_level, a.employee_id].filter(Boolean).join(' · ') || '—'}
                    </p>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {tab === 'Branch Departments' && (
          <div style={sectionStyle}>
            <h2 style={{ fontSize: 12, fontWeight: 700, color: TEXT.muted, textTransform: 'uppercase', marginBottom: 12 }}>Branch Departments</h2>
            <p style={{ fontSize: 11.5, color: TEXT.muted, margin: '0 0 12px' }}>Managed from Organization &gt; Department.</p>
            {departments.length === 0 ? (
              <p style={{ fontSize: 13, color: TEXT.muted }}>No departments under this branch yet.</p>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {departments.map((d) => (
                  <div key={d.id} style={cardRowStyle}>
                    <span style={{ fontSize: 13.5, fontWeight: 600, color: TEXT.heading }}>{d.name}</span>
                    <p style={{ fontSize: 12.5, color: TEXT.secondary, margin: 0 }}>{[d.code, d.head_user_name].filter(Boolean).join(' · ') || '—'}</p>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {tab === 'Branch Warehouses' && (
          <div style={sectionStyle}>
            <h2 style={{ fontSize: 12, fontWeight: 700, color: TEXT.muted, textTransform: 'uppercase', marginBottom: 12 }}>Branch Warehouses</h2>
            {warehouses.length === 0 ? (
              <p style={{ fontSize: 13, color: TEXT.muted }}>No warehouses added yet.</p>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {warehouses.map((w) => (
                  <div key={w.id} style={cardRowStyle}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4, flexWrap: 'wrap' }}>
                      <span style={{ fontSize: 13.5, fontWeight: 600, color: TEXT.heading }}>{w.name}</span>
                      {plant.default_warehouse_id === w.id && <span style={{ fontSize: 10.5, fontWeight: 700, padding: '2px 8px', borderRadius: 9999, background: 'rgba(16,185,129,0.12)', color: '#047857' }}>DEFAULT</span>}
                    </div>
                    <p style={{ fontSize: 12.5, color: TEXT.secondary, margin: 0 }}>
                      {[w.code, w.warehouse_type, w.manager_user_name, w.status].filter(Boolean).join(' · ') || '—'}
                    </p>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {tab === 'Branch Cost Centers' && (
          <div style={sectionStyle}>
            <h2 style={{ fontSize: 12, fontWeight: 700, color: TEXT.muted, textTransform: 'uppercase', marginBottom: 12 }}>Branch Cost Centers</h2>
            {costCenters.length === 0 ? (
              <p style={{ fontSize: 13, color: TEXT.muted }}>No cost centers added yet.</p>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {costCenters.map((cc) => (
                  <div key={cc.id} style={cardRowStyle}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4, flexWrap: 'wrap' }}>
                      <span style={{ fontSize: 13.5, fontWeight: 600, color: TEXT.heading }}>{cc.name}</span>
                      {plant.default_cost_center_id === cc.id && <span style={{ fontSize: 10.5, fontWeight: 700, padding: '2px 8px', borderRadius: 9999, background: 'rgba(16,185,129,0.12)', color: '#047857' }}>DEFAULT</span>}
                    </div>
                    <p style={{ fontSize: 12.5, color: TEXT.secondary, margin: 0 }}>
                      {[cc.code, cc.cost_center_type, cc.department_name, cc.head_user_name].filter(Boolean).join(' · ') || '—'}
                    </p>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {tab === 'Branch Documents' && (
          <div style={sectionStyle}>
            <h2 style={{ fontSize: 12, fontWeight: 700, color: TEXT.muted, textTransform: 'uppercase', marginBottom: 12 }}>Branch Documents</h2>
            {documents.length === 0 ? (
              <p style={{ fontSize: 13, color: TEXT.muted }}>No documents uploaded yet.</p>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {documents.map((d) => (
                  <div key={d.id} style={cardRowStyle}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 }}>
                      <div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4, flexWrap: 'wrap' }}>
                          <span style={{ fontSize: 13.5, fontWeight: 600, color: TEXT.heading }}>{d.document_name}</span>
                          <span style={{ fontSize: 10.5, fontWeight: 600, padding: '2px 8px', borderRadius: 9999, background: 'rgba(244,113,59,0.1)', color: BRAND.primary }}>{d.document_type}</span>
                        </div>
                        <p style={{ fontSize: 12.5, color: TEXT.secondary, margin: 0 }}>
                          {d.filename}{d.expiry_date ? ` · Expires ${d.expiry_date}` : ''}{d.version ? ` · v${d.version}` : ''}
                        </p>
                      </div>
                      {d.sharepoint_url && <a href={d.sharepoint_url} target="_blank" rel="noreferrer" style={{ fontSize: 11.5, fontWeight: 600, color: BRAND.primaryActive }}>Open</a>}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
