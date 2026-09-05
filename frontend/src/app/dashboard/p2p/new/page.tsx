'use client'

import { useEffect, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { useRequireApp } from '@/hooks/useAuth'
import { p2pApi, usersApi } from '@/lib/api'
import { PRCategoryMeta, P2PRequestLineItemInput, DirectoryUser } from '@/types'
import { TEXT, GLASS, SHADOWS, GRADIENTS, BRAND, BORDER } from '@/lib/theme'
import SearchableSelect from '@/components/erp/SearchableSelect'
import DateField from '@/components/erp/DateField'
import { secondaryBtnStyle } from '@/components/shared/ui'
import P2PNav from '@/components/p2p/P2PNav'

const PRIORITIES = ['low', 'medium', 'high']

function emptyItem(): P2PRequestLineItemInput {
  return { item_name: '', make: '', part_code: '', unit: '', quantity: 1, project_inhouse: '', category: '', ship_to: '' }
}


const inputStyle: React.CSSProperties = {
  width: '100%', padding: '10px 12px', borderRadius: 10, border: `1px solid ${BORDER.normal}`,
  background: 'rgba(255,255,255,.7)', fontSize: 13.5, outline: 'none', color: TEXT.body,
}
const labelStyle: React.CSSProperties = { fontSize: 12, fontWeight: 600, color: TEXT.secondary, marginBottom: 6, display: 'block' }
const sectionStyle: React.CSSProperties = {
  borderRadius: 18, background: GLASS.card, backdropFilter: GLASS.blur, WebkitBackdropFilter: GLASS.blur,
  border: `1px solid ${GLASS.border}`, boxShadow: SHADOWS.glass(), padding: 20, marginBottom: 20,
}

export default function NewP2PRequestPage() {
  const { isAuthorized, isLoading } = useRequireApp('p2p')
  const router = useRouter()
  const searchParams = useSearchParams()

  const [categories, setCategories] = useState<PRCategoryMeta[]>([])
  const [requirementTypes, setRequirementTypes] = useState<string[]>([])
  const [projects, setProjects] = useState<{ id: number; label: string }[]>([])
  const [directoryUsers, setDirectoryUsers] = useState<DirectoryUser[]>([])

  const [departmentHeadId, setDepartmentHeadId] = useState('')
  const [projectHeadId, setProjectHeadId] = useState('')
  const [plantHeadId, setPlantHeadId] = useState('')

  const [projectId, setProjectId] = useState('')
  const [categoryCode, setCategoryCode] = useState('')
  const [requiredDate, setRequiredDate] = useState('')
  const [requirementType, setRequirementType] = useState('')
  const [priority, setPriority] = useState('medium')
  const [remarks, setRemarks] = useState('')
  const [items, setItems] = useState<P2PRequestLineItemInput[]>([emptyItem()])
  const [supportingFiles, setSupportingFiles] = useState<File[]>([])
  const [specFiles, setSpecFiles] = useState<File[]>([])

  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')

  // Pre-fill from Store's "Raise P2P Request" low-stock action — see
  // docs/product/PURCHASE_STORE_INTEGRATION.md integration point 2. Pure
  // UI pre-fill only; nothing is submitted until the requester reviews and
  // clicks Submit themselves.
  useEffect(() => {
    const itemName = searchParams.get('item_name')
    if (!itemName) return
    setItems([{
      item_name: itemName,
      make: searchParams.get('make') || '',
      part_code: searchParams.get('part_code') || '',
      unit: searchParams.get('unit') || '',
      quantity: Number(searchParams.get('quantity')) || 1,
      project_inhouse: 'Inhouse',
      category: searchParams.get('category') || '',
      ship_to: '',
    }])
    setRemarks(`Auto-suggested from Store low-stock alert${searchParams.get('part_code') ? ` for part ${searchParams.get('part_code')}` : ''}.`)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    if (!isAuthorized) return
    ;(async () => {
      try {
        const [meta, projectList, directory] = await Promise.all([p2pApi.getMeta(), p2pApi.listProjects(), usersApi.directory()])
        setCategories(meta.categories)
        setRequirementTypes(meta.requirement_types)
        setProjects(projectList)
        setDirectoryUsers(directory)
      } catch {
        setError('Failed to load form options.')
      }
    })()
  }, [isAuthorized])

  // Any active user can be picked for any of these three roles — search by name or email.
  const departmentHeads = directoryUsers
  const projectHeads = directoryUsers
  const plantHeads = directoryUsers

  const updateItem = (idx: number, field: keyof P2PRequestLineItemInput, value: string | number | null) => {
    setItems((prev) => prev.map((it, i) => (i === idx ? { ...it, [field]: value } : it)))
  }
  const addItem = () => {
    setItems((prev) => [...prev, emptyItem()])
  }
  const removeItem = (idx: number) => {
    setItems((prev) => prev.filter((_, i) => i !== idx))
  }

  const handleSubmit = async () => {
    setError('')
    if (!categoryCode) { setError('Please select a Purchase Requisition category.'); return }
    if (items.length === 0 || !items[0].item_name) { setError('At least one item is required.'); return }

    setSubmitting(true)
    try {
      const filledItems = items.filter((it) => it.item_name)

      const pr = await p2pApi.create({
        project_label: projectId ? projects.find((p) => p.id === Number(projectId))?.label : undefined,
        category_code: categoryCode,
        required_date: requiredDate || undefined,
        requirement_type: requirementType || undefined,
        priority,
        remarks: remarks || undefined,
        approver_id: departmentHeadId ? Number(departmentHeadId) : undefined,
        approver_name: departmentHeads.find((u) => String(u.id) === departmentHeadId)?.name,
        project_head_id: projectHeadId ? Number(projectHeadId) : undefined,
        project_head_name: projectHeads.find((u) => String(u.id) === projectHeadId)?.name,
        plant_head_id: plantHeadId ? Number(plantHeadId) : undefined,
        plant_head_name: plantHeads.find((u) => String(u.id) === plantHeadId)?.name,
        items: filledItems.map((it) => ({
          ...it,
          quantity: Number(it.quantity) || 1,
        })),
      })

      const allFiles = [...supportingFiles.map((f) => ({ f, doc: 'supporting' })), ...specFiles.map((f) => ({ f, doc: 'specification' }))]
      for (const doc of ['supporting', 'specification'] as const) {
        const files = allFiles.filter((x) => x.doc === doc).map((x) => x.f)
        if (files.length) {
          try { await p2pApi.uploadAttachments(pr.id, files, doc) } catch { /* upload failure shouldn't block PR creation */ }
        }
      }

      router.push(`/dashboard/p2p/${pr.id}`)
    } catch (e: unknown) {
      const err = e as { response?: { data?: { detail?: string } } }
      setError(err.response?.data?.detail || 'Failed to submit Purchase Requisition.')
    } finally {
      setSubmitting(false)
    }
  }

  if (isLoading || !isAuthorized) return null

  return (
    <div style={{ width: '100%' }}>
      <P2PNav />

      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap' }}>
        <div>
          <p style={{ fontSize: 11.5, fontWeight: 600, letterSpacing: '.05em', textTransform: 'uppercase', color: TEXT.muted, margin: '0 0 4px' }}>
            Procure-to-Pay Module
          </p>
          <h1 style={{ fontSize: 24, fontWeight: 700, color: TEXT.heading, margin: '0 0 20px' }}>New Purchase Requisition</h1>
        </div>
        <button onClick={() => router.back()} type="button" style={secondaryBtnStyle}>
          ← Back
        </button>
      </div>

      {error && (
        <div style={{ padding: '10px 14px', marginBottom: 16, borderRadius: 10, background: 'rgba(220,38,38,0.08)', border: '1px solid rgba(220,38,38,0.2)', color: '#b91c1c', fontSize: 13 }}>
          {error}
        </div>
      )}

      <div style={sectionStyle}>
        <h2 style={{ fontSize: 15, fontWeight: 700, color: TEXT.heading, margin: '0 0 14px' }}>Request Details</h2>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 14, marginBottom: 24 }}>
          <div style={{ flex: '1 1 220px', minWidth: 200 }}>
            <label style={labelStyle}>Project</label>
            <SearchableSelect
              value={projectId}
              onChange={setProjectId}
              options={projects.map((p) => ({ value: String(p.id), label: p.label }))}
              placeholder="Search existing project…"
            />
          </div>
          <div style={{ flex: '1 1 200px', minWidth: 180 }}>
            <label style={labelStyle}>Purchase Requisition Category *</label>
            <select style={inputStyle} value={categoryCode} onChange={(e) => setCategoryCode(e.target.value)}>
              <option value="">Select category…</option>
              {categories.map((c) => <option key={c.code} value={c.code}>{c.label} ({c.code})</option>)}
            </select>
          </div>
          <div style={{ flex: '0 1 170px', minWidth: 150 }}>
            <label style={labelStyle}>Required Date</label>
            <DateField value={requiredDate} onChange={setRequiredDate} />
          </div>
          <div style={{ flex: '1 1 180px', minWidth: 160 }}>
            <label style={labelStyle}>Requirement Type</label>
            <select style={inputStyle} value={requirementType} onChange={(e) => setRequirementType(e.target.value)}>
              <option value="">Select type…</option>
              {requirementTypes.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
          </div>
        </div>

        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14, paddingTop: 20, borderTop: `1px solid ${BORDER.normal}` }}>
          <h2 style={{ fontSize: 15, fontWeight: 700, color: TEXT.heading, margin: 0 }}>Item Details</h2>
          <button onClick={addItem} type="button" style={{ padding: '6px 14px', borderRadius: 8, border: `1px solid ${BRAND.primaryBorder}`, background: BRAND.primarySoft, color: BRAND.primaryActive, fontSize: 12.5, fontWeight: 600, cursor: 'pointer' }}>
            + Add Item
          </button>
        </div>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 1360 }}>
            <thead>
              <tr>
                {['SL', 'Item Description *', 'Make', 'Part Code', 'UOM', 'Qty', 'Project/Inhouse', 'Category', 'Ship To', ''].map((h) => (
                  <th key={h} style={{ textAlign: 'left', padding: '0 8px 8px', fontSize: 11, fontWeight: 600, letterSpacing: '.03em', textTransform: 'uppercase', color: TEXT.muted, whiteSpace: 'nowrap' }}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {items.map((item, idx) => (
                <tr key={idx}>
                  <td style={{ padding: '6px 8px', fontSize: 12.5, fontWeight: 600, color: TEXT.muted }}>{idx + 1}</td>
                  <td style={{ padding: '6px 8px', minWidth: 160 }}>
                    <input style={inputStyle} value={item.item_name} onChange={(e) => updateItem(idx, 'item_name', e.target.value)} />
                  </td>
                  <td style={{ padding: '6px 8px', minWidth: 110 }}>
                    <input style={inputStyle} value={item.make} onChange={(e) => updateItem(idx, 'make', e.target.value)} />
                  </td>
                  <td style={{ padding: '6px 8px', minWidth: 110 }}>
                    <input style={inputStyle} value={item.part_code} onChange={(e) => updateItem(idx, 'part_code', e.target.value)} />
                  </td>
                  <td style={{ padding: '6px 8px', minWidth: 90 }}>
                    <input style={inputStyle} value={item.unit} onChange={(e) => updateItem(idx, 'unit', e.target.value)} placeholder="pcs / kg" />
                  </td>
                  <td style={{ padding: '6px 8px', minWidth: 70 }}>
                    <input type="number" style={inputStyle} value={item.quantity} onChange={(e) => updateItem(idx, 'quantity', e.target.value)} />
                  </td>
                  <td style={{ padding: '6px 8px', minWidth: 130 }}>
                    <select style={inputStyle} value={item.project_inhouse} onChange={(e) => updateItem(idx, 'project_inhouse', e.target.value)}>
                      <option value="">Select…</option>
                      <option value="Project">Project</option>
                      <option value="Inhouse">Inhouse</option>
                    </select>
                  </td>
                  <td style={{ padding: '6px 8px', minWidth: 130 }}>
                    <input style={inputStyle} value={item.category} onChange={(e) => updateItem(idx, 'category', e.target.value)} />
                  </td>
                  <td style={{ padding: '6px 8px', minWidth: 140 }}>
                    <input style={inputStyle} value={item.ship_to} onChange={(e) => updateItem(idx, 'ship_to', e.target.value)} />
                  </td>
                  <td style={{ padding: '6px 8px' }}>
                    {items.length > 1 && (
                      <span onClick={() => removeItem(idx)} style={{ fontSize: 11.5, fontWeight: 600, color: '#dc2626', cursor: 'pointer', whiteSpace: 'nowrap' }}>Remove</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <h2 style={{ fontSize: 15, fontWeight: 700, color: TEXT.heading, margin: '0 0 14px', paddingTop: 20, borderTop: `1px solid ${BORDER.normal}` }}>Priority & Remarks</h2>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 14, marginBottom: 24 }}>
          <div style={{ flex: '0 1 180px', minWidth: 160 }}>
            <label style={labelStyle}>Priority</label>
            <select style={inputStyle} value={priority} onChange={(e) => setPriority(e.target.value)}>
              {PRIORITIES.map((p) => <option key={p} value={p}>{p[0].toUpperCase() + p.slice(1)}</option>)}
            </select>
          </div>
          <div style={{ flex: '1 1 320px' }}>
            <label style={labelStyle}>Remarks</label>
            <textarea style={{ ...inputStyle, minHeight: 42 }} value={remarks} onChange={(e) => setRemarks(e.target.value)} />
          </div>
        </div>

        <h2 style={{ fontSize: 15, fontWeight: 700, color: TEXT.heading, margin: '0 0 14px', paddingTop: 20, borderTop: `1px solid ${BORDER.normal}` }}>Approval</h2>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 14, marginBottom: 24 }}>
          <div style={{ flex: '1 1 220px', minWidth: 200 }}>
            <label style={labelStyle}>Department Head</label>
            <SearchableSelect
              value={departmentHeadId}
              onChange={setDepartmentHeadId}
              options={departmentHeads.map((u) => ({ value: String(u.id), label: `${u.name} (${u.email})${u.department ? ` — ${u.department}` : ''}` }))}
              placeholder="Search department head…"
            />
          </div>
          <div style={{ flex: '1 1 220px', minWidth: 200 }}>
            <label style={labelStyle}>Project Head</label>
            <SearchableSelect
              value={projectHeadId}
              onChange={setProjectHeadId}
              options={projectHeads.map((u) => ({ value: String(u.id), label: `${u.name} (${u.email})` }))}
              placeholder="Search project head…"
            />
          </div>
          <div style={{ flex: '1 1 220px', minWidth: 200 }}>
            <label style={labelStyle}>Plant Head</label>
            <SearchableSelect
              value={plantHeadId}
              onChange={setPlantHeadId}
              options={plantHeads.map((u) => ({ value: String(u.id), label: `${u.name} (${u.email})` }))}
              placeholder="Search plant head…"
            />
          </div>
        </div>
        <p style={{ fontSize: 11.5, color: TEXT.muted, margin: '-10px 0 24px' }}>
          Leave blank to skip a role. If a Department Head isn&apos;t picked here, one is auto-assigned from your own department when configured.
        </p>

        <h2 style={{ fontSize: 15, fontWeight: 700, color: TEXT.heading, margin: '0 0 14px', paddingTop: 20, borderTop: `1px solid ${BORDER.normal}` }}>Documents</h2>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 14 }}>
          <div style={{ flex: '0 1 280px', minWidth: 240 }}>
            <label style={labelStyle}>Supporting Documents</label>
            <input type="file" multiple onChange={(e) => setSupportingFiles(Array.from(e.target.files || []))} style={inputStyle} />
          </div>
          <div style={{ flex: '0 1 280px', minWidth: 240 }}>
            <label style={labelStyle}>Specification / Reference File</label>
            <input type="file" multiple onChange={(e) => setSpecFiles(Array.from(e.target.files || []))} style={inputStyle} />
          </div>
        </div>
      </div>

      <div style={{ display: 'flex', gap: 12, justifyContent: 'flex-end' }}>
        <button onClick={() => router.back()} type="button" style={{ padding: '12px 22px', borderRadius: 12, border: `1px solid ${BORDER.normal}`, background: 'transparent', color: TEXT.secondary, fontSize: 14, fontWeight: 600, cursor: 'pointer' }}>
          Cancel
        </button>
        <button onClick={handleSubmit} disabled={submitting} type="button" style={{ padding: '12px 26px', borderRadius: 12, border: 'none', cursor: submitting ? 'not-allowed' : 'pointer', background: GRADIENTS.primary, color: '#fff', fontSize: 14, fontWeight: 600, opacity: submitting ? 0.6 : 1 }}>
          {submitting ? 'Submitting…' : 'Submit Purchase Requisition'}
        </button>
      </div>
    </div>
  )
}
