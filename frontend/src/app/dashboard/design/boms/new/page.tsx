'use client'

import { useEffect, useMemo, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { useRequireApp } from '@/hooks/useAuth'
import { useAssigneeFilter } from '@/hooks/useAssigneeFilter'
import { designApi } from '@/lib/api'
import { DesignLookupOption } from '@/types'
import DesignNav from '@/components/design/DesignNav'
import SearchableSelect from '@/components/erp/SearchableSelect'
import { FormPage, SheetColumns, SheetSection, SheetIcon, SHEET, Req, Optional, sheetBtn, sheetInput, sheetLabel, sheetHint, SheetError } from '@/components/shared/FormSheet'
import { toOptions } from '@/components/design/designMeta'
import { useDesignMe } from '@/components/design/useDesignMe'
import { extractErrorMessages } from '@/lib/validation'
import BomLinesEditor, { BomLineDraft, bomDraftsToPayload, bomLinesToDrafts, emptyBomLine, itemsFromBomLines } from '../BomLinesEditor'
import { recordPath, useRecordId } from '@/lib/recordRef'
import InvalidRecordLink from '@/components/erp/InvalidRecordLink'
import OrderProjectPicker, { OrderProjectValue } from '@/components/sales/OrderProjectPicker'

function mergeOptions(base: DesignLookupOption[], extra: DesignLookupOption[]): DesignLookupOption[] {
  const seen = new Set(base.map((o) => o.id))
  return [...base, ...extra.filter((o) => !seen.has(o.id))]
}

export default function NewDesignBomPage() {
  const { isAuthorized, isLoading, user } = useRequireApp('design')
  const router = useRouter()
  const searchParams = useSearchParams()
  const me = useDesignMe(isAuthorized)
  const requestParam = searchParams.get('request_id') || ''
  const { id: requestParamId, error: linkError } = useRecordId(requestParam || null)

  const [users, setUsers] = useState<DesignLookupOption[]>([])
  const [projects, setProjects] = useState<DesignLookupOption[]>([])
  const [machines, setMachines] = useState<DesignLookupOption[]>([])
  const [items, setItems] = useState<DesignLookupOption[]>([])
  const [documents, setDocuments] = useState<DesignLookupOption[]>([])
  const [boms, setBoms] = useState<DesignLookupOption[]>([])
  const [requests, setRequests] = useState<DesignLookupOption[]>([])

  const [productId, setProductId] = useState('')
  const [productSearch, setProductSearch] = useState('')
  const [productMsg, setProductMsg] = useState('')
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [documentId, setDocumentId] = useState('')
  const [pmProjectId, setPmProjectId] = useState('')
  const [erpProjectId, setErpProjectId] = useState('')
  const [requestId, setRequestId] = useState('')
  const [orderProject, setOrderProject] = useState<OrderProjectValue | null>(null)
  const [reviewerId, setReviewerId] = useState('')
  const [approverId, setApproverId] = useState('')
  const [copyFromId, setCopyFromId] = useState('')
  const [copyMsg, setCopyMsg] = useState('')
  const [rows, setRows] = useState<BomLineDraft[]>([emptyBomLine('10')])

  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | string[]>('')

  useEffect(() => {
    if (!isAuthorized) return
    Promise.all([
      designApi.lookupUsers(), designApi.lookupProjects(), designApi.lookupMachines(), designApi.lookupItems(),
      designApi.lookupDocuments(), designApi.lookupBoms(),
    ])
      .then(([u, p, m, i, d, b]) => { setUsers(u); setProjects(p); setMachines(m); setItems(i); setDocuments(d); setBoms(b) })
      .catch((err) => setError(extractErrorMessages(err, 'Failed to load the form options.')))
    designApi.listRequests({ status: 'open,accepted,in_progress,on_hold' })
      .then((r) => setRequests((prev) => mergeOptions(prev, r.map((q) => ({ id: q.id, label: `${q.request_number} — ${q.title}` })))))
      .catch(() => { /* no Requests tab access — the request picker just stays short */ })
  }, [isAuthorized])

  // Coming from a design request: link it and carry over its project/machine.
  useEffect(() => {
    if (!isAuthorized || !requestParamId) return
    designApi.getRequest(requestParamId)
      .then((r) => {
        setRequestId(String(r.id))
        setRequests((prev) => mergeOptions([{ id: r.id, label: `${r.request_number} — ${r.title}` }], prev))
        if (r.pm_project_id) setPmProjectId(String(r.pm_project_id))
        if (r.erp_project_id) setErpProjectId(String(r.erp_project_id))
        if (r.order_project_id) setOrderProject({ projectId: r.order_project_id, elementId: r.order_project_element_id ?? null })
      })
      .catch((err) => setError(extractErrorMessages(err, 'Could not load the linked design request — it may have been deleted, or your account lacks access to it.')))
  }, [isAuthorized, requestParamId])

  // Checker/approver never offer the author — the backend refuses them anyway.
  const signatoryOptions = useMemo(
    () => toOptions(users.filter((u) => u.id !== user?.id).map((u) => ({ id: u.id, label: u.code ? `${u.label} — ${u.code}` : u.label })), 'Not decided yet'),
    [users, user],
  )
  // Role "Assign to" rule (Role & Permissions › Design › BOMs): who may be named checker.
  const allowChecker = useAssigneeFilter('design:boms.check_release')
  const checkerOptions = useMemo(
    () => toOptions(users.filter((u) => u.id !== user?.id && allowChecker(u.id)).map((u) => ({ id: u.id, label: u.code ? `${u.label} — ${u.code}` : u.label })), 'Not decided yet'),
    [users, user, allowChecker],
  )

  if (isLoading || !isAuthorized) return null
  if (linkError) return (<div><DesignNav /><InvalidRecordLink message={linkError} listHref="/dashboard/design/boms" listLabel="Back to BOMs" /></div>)

  const searchProduct = async () => {
    const q = productSearch.trim()
    if (!q) return
    setProductMsg('')
    try {
      const found = await designApi.lookupItems(q)
      setItems((prev) => mergeOptions(prev, found))
      setProductMsg(found.length ? `${found.length} found — pick it in the list.` : `No Item Master item matches “${q}”. Ask Store to create the product item first.`)
    } catch (err) {
      setProductMsg(extractErrorMessages(err, 'Searching Item Master failed.').join(' '))
    }
  }

  const copyLines = async (bomId: string) => {
    setCopyFromId(bomId)
    setCopyMsg('')
    if (!bomId) return
    try {
      const src = await designApi.getBom(Number(bomId))
      const rev = src.revisions.find((r) => r.status === 'released') || src.revisions.find((r) => ['draft', 'in_review', 'in_approval'].includes(r.status)) || src.revisions[0]
      if (!rev || !rev.lines.length) { setCopyMsg(`${src.bom_number} has no lines to copy.`); return }
      setItems((prev) => mergeOptions(prev, itemsFromBomLines(rev.lines)))
      setRows(bomLinesToDrafts(rev.lines))
      setCopyMsg(`${rev.lines.length} line${rev.lines.length === 1 ? '' : 's'} copied from ${src.bom_number} ${rev.revision_label} — edit them below as needed.`)
    } catch (err) {
      setError(extractErrorMessages(err, 'Copying lines from that BOM failed.'))
    }
  }

  const handleSubmit = async () => {
    setError('')
    if (!productId) { setError('Pick the product (assembly) item this BOM builds — it must exist in Item Master.'); return }
    if (title.trim().length < 2) { setError('Give the BOM a title (at least 2 characters).'); return }
    if (reviewerId && reviewerId === approverId) { setError('The checker and the approver must be two different people.'); return }
    const built = bomDraftsToPayload(rows)
    if ('error' in built) { setError(built.error); return }
    if (built.lines.some((l) => l.store_item_id === Number(productId))) { setError('A BOM can\'t list its own product item as a line.'); return }

    setSaving(true)
    try {
      const created = await designApi.createBom({
        product_item_id: Number(productId),
        title: title.trim(),
        description: description.trim() || null,
        document_id: documentId ? Number(documentId) : null,
        pm_project_id: pmProjectId ? Number(pmProjectId) : null,
        erp_project_id: erpProjectId ? Number(erpProjectId) : null,
        design_request_id: requestId ? Number(requestId) : null,
        order_project_id: orderProject?.projectId ?? null,
        order_project_element_id: orderProject?.elementId ?? null,
        reviewer_id: reviewerId ? Number(reviewerId) : null,
        approver_id: approverId ? Number(approverId) : null,
        lines: built.lines,
      })
      router.push(recordPath('/dashboard/design/boms', created))
    } catch (err) {
      setError(extractErrorMessages(err, 'Failed to create the BOM.'))
      setSaving(false)
    }
  }

  const isViewer = me?.role === 'viewer'
  const goBack = () => router.push(requestParam ? `/dashboard/design/requests/${requestParam}` : '/dashboard/design/boms')

  return (
    <FormPage
      nav={<DesignNav />}
      tour="design-bomnew-form" backTour="design-bomnew-back-btn"
      icon="list"
      title="New Bill of Materials"
      subtitle="One BOM per product item, single level. Sub-assemblies are lines whose item has its own released BOM. It starts as draft R0."
      onBack={goBack}
      footer={<>
        <button data-tour="design-bomnew-cancel-btn" type="button" onClick={() => router.push('/dashboard/design/boms')} disabled={saving} style={sheetBtn('secondary', SHEET.INK, saving)}>Cancel</button>
        {!isViewer && (
          <button data-tour="design-bomnew-save-btn" type="button" onClick={handleSubmit} disabled={saving} style={sheetBtn('primary', SHEET.BLUE, saving)}>
            <SheetIcon name="check" size={16} />{saving ? 'Creating…' : 'Create BOM (draft R0)'}
          </button>
        )}
      </>}
    >
      {(error || isViewer) && (
        <div style={{ padding: '20px 24px 0' }}>
          <SheetError error={error} />
          {isViewer && (
            <div style={{ padding: '10px 14px', marginBottom: 16, borderRadius: 10, background: 'rgba(245,158,11,0.1)', border: '1px solid rgba(245,158,11,0.3)', color: '#92400E', fontSize: 13 }}>
              You have view-only access to Design — only Design team members create BOMs. Ask the Design head to add you to the team in Design → Settings.
            </div>
          )}
        </div>
      )}

      <SheetColumns
        left={<>
          <SheetSection icon="box" title="Product">
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12 }}>
              <div data-tour="design-bomnew-product" style={{ flex: '1 1 280px', maxWidth: 460 }}>
                <label style={sheetLabel}>Product item (assembly) <Req /></label>
                <SearchableSelect value={productId} onChange={setProductId} options={toOptions(items)} placeholder="Select the item this BOM builds…" />
              </div>
              <div data-tour="design-bomnew-product-search" style={{ flex: '1 1 240px', maxWidth: 380 }}>
                <label style={sheetLabel}>Not in the list? Search Item Master</label>
                <div style={{ display: 'flex', gap: 6 }}>
                  <input style={sheetInput} value={productSearch} onChange={(e) => setProductSearch(e.target.value)} placeholder="Code, name or part no."
                    onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); searchProduct() } }} />
                  <button type="button" style={sheetBtn('secondary', SHEET.INK, !productSearch.trim())} disabled={!productSearch.trim()} onClick={searchProduct}><SheetIcon name="search" size={14} />Search</button>
                </div>
                {productMsg && <p style={sheetHint}>{productMsg}</p>}
              </div>
            </div>
          </SheetSection>
          <SheetSection icon="doc" title="Basic Information">
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, marginBottom: 12 }}>
              <div data-tour="design-bomnew-title" style={{ flex: '1 1 280px', maxWidth: 520 }}>
                <label style={sheetLabel}>Title <Req /></label>
                <input style={sheetInput} value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Bogie frame assembly — BOM" />
              </div>
              <div data-tour="design-bomnew-drawing" style={{ flex: '1 1 240px', maxWidth: 420 }}>
                <label style={sheetLabel}>GA / assembly drawing <Optional /></label>
                <SearchableSelect value={documentId} onChange={setDocumentId} options={toOptions(documents, 'None')} placeholder="Select drawing…" />
              </div>
            </div>
            <div data-tour="design-bomnew-description">
              <label style={sheetLabel}>Description <Optional /></label>
              <textarea style={{ ...sheetInput, minHeight: 60, resize: 'vertical' }} value={description} onChange={(e) => setDescription(e.target.value)} />
            </div>
          </SheetSection>
        </>}
        right={<>
          <SheetSection icon="link" title="Links" extra={<Optional />}>
            <div data-tour="design-bomnew-order-project" style={{ marginBottom: 12 }}>
              <label style={sheetLabel}>Order project</label>
              <OrderProjectPicker value={orderProject} requireElement={false} onChange={(v) => setOrderProject(v)} />
              <p style={sheetHint}>A project BOM for a confirmed order — pick a vehicle only for a vehicle-specific variant.</p>
            </div>
            <div data-tour="design-bomnew-project" style={{ marginBottom: 12 }}>
              <label style={sheetLabel}>Project</label>
              <SearchableSelect value={pmProjectId} onChange={setPmProjectId} options={toOptions(projects, 'None')} placeholder="Select project…" />
            </div>
            <div data-tour="design-bomnew-machine" style={{ marginBottom: 12 }}>
              <label style={sheetLabel}>Machine</label>
              <SearchableSelect value={erpProjectId} onChange={setErpProjectId} options={toOptions(machines, 'None')} placeholder="Select machine…" />
            </div>
            <div data-tour="design-bomnew-request">
              <label style={sheetLabel}>Design request</label>
              <SearchableSelect value={requestId} onChange={setRequestId} options={toOptions(requests, 'None')} placeholder="Select request…" />
            </div>
          </SheetSection>
          <SheetSection icon="users" title="Signatories">
            <div data-tour="design-bomnew-checker" style={{ marginBottom: 12 }}>
              <label style={sheetLabel}>Checked by</label>
              <SearchableSelect value={reviewerId} onChange={setReviewerId} options={checkerOptions} placeholder="Select checker…" />
            </div>
            <div data-tour="design-bomnew-approver">
              <label style={sheetLabel}>Approved (released) by</label>
              <SearchableSelect value={approverId} onChange={setApproverId} options={signatoryOptions} placeholder="Select approver…" />
              <p style={sheetHint}>Left blank, the default approver from Design Settings is used.</p>
            </div>
          </SheetSection>
        </>}
      />

      <div style={{ padding: '20px 24px 4px', borderTop: `1px solid ${SHEET.LINE}` }}>
        <SheetSection icon="list" title="Lines">
          <div data-tour="design-bomnew-copy" style={{ maxWidth: 380, marginBottom: 12 }}>
            <label style={sheetLabel}>Copy lines from another BOM <Optional /></label>
            <SearchableSelect value={copyFromId} onChange={copyLines} options={toOptions(boms, 'Don\'t copy')} placeholder="Start from an existing BOM…" />
          </div>
          {copyMsg && <p style={{ ...sheetHint, margin: '0 0 10px' }}>{copyMsg}</p>}
          <BomLinesEditor
            rows={rows}
            onChange={setRows}
            items={items}
            onItemsLoaded={(found) => setItems((prev) => mergeOptions(prev, found))}
            documents={documents}
            disabled={saving}
          />
          <p style={sheetHint}>
            Every line needs an Item Master item to be released. A “New item” line is sent to Store as an item-code request and blocks release until the code exists.
            Drawings must be released before the BOM can be.
          </p>
        </SheetSection>
      </div>
    </FormPage>
  )
}
