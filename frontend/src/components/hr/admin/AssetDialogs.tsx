'use client'

import { useEffect, useState } from 'react'
import { hrApi } from '@/lib/api'
import { extractErrorMessages } from '@/lib/validation'
import type { HrAsset, HrBranchLookup, DirectoryUser } from '@/types'
import DateField from '@/components/erp/DateField'
import SearchableSelect from '@/components/erp/SearchableSelect'
import { SheetColumns, SheetSection, SheetIcon, Optional, Req, SHEET, sheetBtn, sheetInput, sheetLabel } from '@/components/shared/FormSheet'
import { FormDialog, ErrorBanner, todayIso, fmtDate } from './adminUi'

export const ASSET_CATEGORY_LABELS: Record<string, string> = {
  laptop: 'Laptop', desktop: 'Desktop', mobile: 'Mobile', sim: 'SIM Card', tablet: 'Tablet', monitor: 'Monitor',
  vehicle: 'Vehicle', id_card: 'ID Card', access_card: 'Access Card', furniture: 'Furniture', tool: 'Tool', other: 'Other',
}
export const ASSET_CONDITION_LABELS: Record<string, string> = { new: 'New', good: 'Good', fair: 'Fair', poor: 'Poor', damaged: 'Damaged' }

function Fld({ label, children, basis = 200, grow = false, max, req = false }: { label: string; children: React.ReactNode; basis?: number; grow?: boolean; max?: number; req?: boolean }) {
  return (
    <div style={{ flex: grow ? `1 1 ${basis}px` : `0 1 ${basis}px`, minWidth: Math.min(basis, 140), maxWidth: max }}>
      <label style={sheetLabel}>{label}{req && <> <Req /></>}</label>
      {children}
    </div>
  )
}

const row: React.CSSProperties = { display: 'flex', flexWrap: 'wrap', gap: 12 }

// ── Create / edit asset ─────────────────────────────────────────────────────

export function AssetFormDialog({
  open, asset, branches, onClose, onSaved,
}: {
  open: boolean
  asset?: HrAsset | null
  branches: HrBranchLookup[]
  onClose: () => void
  onSaved: (a: HrAsset) => void
}) {
  const blank = {
    asset_code: '', name: '', category: 'laptop', make: '', model: '', serial_number: '', purchase_date: '', purchase_cost: '',
    vendor_name: '', invoice_no: '', warranty_until: '', branch_id: '', condition: 'new', remarks: '',
  }
  const [f, setF] = useState(blank)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string[]>([])

  useEffect(() => {
    if (!open) return
    setError([])
    if (asset) {
      setF({
        asset_code: asset.asset_code, name: asset.name, category: asset.category, make: asset.make || '', model: asset.model || '',
        serial_number: asset.serial_number || '', purchase_date: asset.purchase_date || '',
        purchase_cost: asset.purchase_cost != null ? String(asset.purchase_cost) : '', vendor_name: asset.vendor_name || '',
        invoice_no: asset.invoice_no || '', warranty_until: asset.warranty_until || '',
        branch_id: asset.branch_id ? String(asset.branch_id) : '', condition: asset.condition || '', remarks: asset.remarks || '',
      })
    } else {
      setF(blank)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, asset])

  const set = (k: keyof typeof blank) => (v: string) => setF((p) => ({ ...p, [k]: v }))

  const save = async () => {
    const problems: string[] = []
    if (!f.name.trim()) problems.push('Asset name is required, e.g. "Dell Latitude 5440".')
    if (f.purchase_cost && !(Number(f.purchase_cost) >= 0)) problems.push('Purchase cost must be a number of rupees (0 or more).')
    if (asset && !f.asset_code.trim()) problems.push('Asset code cannot be blank on an existing asset.')
    if (problems.length) { setError(problems); return }
    setSaving(true)
    setError([])
    const payload: Record<string, unknown> = {
      name: f.name.trim(), category: f.category, make: f.make || null, model: f.model || null, serial_number: f.serial_number || null,
      purchase_date: f.purchase_date || null, purchase_cost: f.purchase_cost ? f.purchase_cost : null, vendor_name: f.vendor_name || null,
      invoice_no: f.invoice_no || null, warranty_until: f.warranty_until || null, branch_id: f.branch_id ? Number(f.branch_id) : null,
      condition: f.condition || null, remarks: f.remarks || null,
    }
    if (asset) payload.asset_code = f.asset_code.trim()
    else if (f.asset_code.trim()) payload.asset_code = f.asset_code.trim()
    try {
      const saved = asset ? await hrApi.updateAsset(asset.id, payload) : await hrApi.createAsset(payload)
      onSaved(saved)
    } catch (err) {
      setError(extractErrorMessages(err, 'The asset could not be saved.'))
    } finally {
      setSaving(false)
    }
  }

  return (
    <FormDialog
      open={open}
      icon={asset ? 'edit' : 'box'}
      title={asset ? `Edit ${asset.asset_code}` : 'Add asset'}
      subtitle={asset ? `${asset.name} — changes apply to the asset register.` : 'Leave the asset code blank to auto-number it (AST-0001, AST-0002…).'}
      onClose={onClose}
      busy={saving}
      maxWidth={960}
      bare
      footer={<>
        <button type="button" style={sheetBtn('secondary', SHEET.INK, saving)} onClick={onClose} disabled={saving}>Cancel</button>
        <button type="button" data-tour="hr-asset-form-save" style={sheetBtn('primary', SHEET.BLUE, saving)} onClick={save} disabled={saving}><SheetIcon name={asset ? 'check' : 'plus'} size={16} />{saving ? 'Saving…' : asset ? 'Save changes' : 'Add asset'}</button>
      </>}
    >
      <SheetColumns
        left={<>
          <ErrorBanner error={error} />
          <SheetSection icon="box" title="Asset">
            <div data-tour="hr-asset-form-code-name" style={row}>
              <Fld label="Asset code" basis={150}><input style={sheetInput} value={f.asset_code} onChange={(e) => set('asset_code')(e.target.value)} placeholder={asset ? '' : 'Auto'} /></Fld>
              <Fld label="Name" req basis={260} grow max={420}><input style={sheetInput} value={f.name} onChange={(e) => set('name')(e.target.value)} placeholder="Dell Latitude 5440" /></Fld>
            </div>
            <div data-tour="hr-asset-form-identity" style={{ ...row, marginTop: 12 }}>
              <Fld label="Category" basis={170}>
                <select style={sheetInput} value={f.category} onChange={(e) => set('category')(e.target.value)}>
                  {Object.entries(ASSET_CATEGORY_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                </select>
              </Fld>
              <Fld label="Make" basis={150}><input style={sheetInput} value={f.make} onChange={(e) => set('make')(e.target.value)} placeholder="Dell" /></Fld>
              <Fld label="Model" basis={150}><input style={sheetInput} value={f.model} onChange={(e) => set('model')(e.target.value)} /></Fld>
              <Fld label="Serial / IMEI" basis={170} grow max={260}><input style={sheetInput} value={f.serial_number} onChange={(e) => set('serial_number')(e.target.value)} /></Fld>
            </div>
          </SheetSection>
          <SheetSection icon="rupee" title="Purchase">
            <div data-tour="hr-asset-form-purchase" style={row}>
              <Fld label="Purchase date" basis={160}><DateField value={f.purchase_date} onChange={set('purchase_date')} /></Fld>
              <Fld label="Cost (₹)" basis={130}><input style={sheetInput} inputMode="decimal" value={f.purchase_cost} onChange={(e) => set('purchase_cost')(e.target.value.replace(/[^0-9.]/g, ''))} /></Fld>
              <Fld label="Warranty until" basis={160}><DateField value={f.warranty_until} onChange={set('warranty_until')} /></Fld>
            </div>
            <div data-tour="hr-asset-form-vendor" style={{ ...row, marginTop: 12 }}>
              <Fld label="Vendor" basis={200} grow max={300}><input style={sheetInput} value={f.vendor_name} onChange={(e) => set('vendor_name')(e.target.value)} /></Fld>
              <Fld label="Invoice no." basis={150}><input style={sheetInput} value={f.invoice_no} onChange={(e) => set('invoice_no')(e.target.value)} /></Fld>
            </div>
          </SheetSection>
        </>}
        right={<>
          <SheetSection icon="building" title="Location & Condition">
            <label style={sheetLabel}>Plant</label>
            <SearchableSelect value={f.branch_id} onChange={set('branch_id')} placeholder="All / not set" options={[{ value: '', label: '— Not set —' }, ...branches.map((b) => ({ value: String(b.id), label: b.name }))]} />
            <label style={{ ...sheetLabel, marginTop: 14 }}>Condition</label>
            <select style={sheetInput} value={f.condition} onChange={(e) => set('condition')(e.target.value)}>
              <option value="">—</option>
              {Object.entries(ASSET_CONDITION_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
          </SheetSection>
          <SheetSection icon="chat" title="Remarks" extra={<Optional />}>
            <textarea rows={4} data-tour="hr-asset-form-remarks" style={{ ...sheetInput, resize: 'vertical' }} value={f.remarks} onChange={(e) => set('remarks')(e.target.value)} />
          </SheetSection>
        </>}
      />
    </FormDialog>
  )
}

// ── Issue ───────────────────────────────────────────────────────────────────

export function IssueAssetDialog({
  open, asset, people, onClose, onDone,
}: {
  open: boolean
  asset: HrAsset | null
  people: DirectoryUser[]
  onClose: () => void
  onDone: (a: HrAsset) => void
}) {
  const [userId, setUserId] = useState('')
  const [issuedOn, setIssuedOn] = useState(todayIso())
  const [expectedReturn, setExpectedReturn] = useState('')
  const [condition, setCondition] = useState('')
  const [remarks, setRemarks] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string[]>([])

  useEffect(() => {
    if (!open) return
    setUserId(''); setIssuedOn(todayIso()); setExpectedReturn(''); setCondition(asset?.condition || 'good'); setRemarks(''); setError([])
  }, [open, asset])

  const submit = async () => {
    if (!asset) return
    if (!userId) { setError(['Pick the employee who is receiving this asset.']); return }
    setSaving(true); setError([])
    try {
      const a = await hrApi.issueAsset(asset.id, {
        user_id: Number(userId), issued_on: issuedOn || null, expected_return_on: expectedReturn || null,
        condition_on_issue: condition || null, remarks: remarks || null,
      })
      onDone(a)
    } catch (err) {
      setError(extractErrorMessages(err, 'The asset could not be issued.'))
    } finally {
      setSaving(false)
    }
  }

  return (
    <FormDialog
      open={open}
      title={`Issue ${asset?.asset_code || ''}`}
      subtitle={asset ? `${asset.name} will be recorded against the employee and listed under their My Assets.` : undefined}
      icon="user"
      onClose={onClose}
      busy={saving}
      bare
      footer={<>
        <button type="button" style={sheetBtn('secondary', SHEET.INK, saving)} onClick={onClose} disabled={saving}>Cancel</button>
        <button type="button" data-tour="hr-asset-issue-save" style={sheetBtn('primary', SHEET.BLUE, saving)} onClick={submit} disabled={saving}><SheetIcon name="send" size={16} />{saving ? 'Issuing…' : 'Issue asset'}</button>
      </>}
    >
      <div style={{ padding: '20px 24px' }}>
        <ErrorBanner error={error} />
        <SheetSection icon="user" title="Issue To">
          <div data-tour="hr-asset-issue-to">
            <label style={sheetLabel}>Employee <Req /></label>
            <SearchableSelect value={userId} onChange={setUserId} placeholder="Search employee…" options={people.map((p) => ({ value: String(p.id), label: `${p.name}${p.department ? ` · ${p.department}` : ''} (${p.email})` }))} />
          </div>
        </SheetSection>
        <SheetSection icon="calendar" title="Handover">
          <div data-tour="hr-asset-issue-dates" style={row}>
            <Fld label="Issued on" basis={160}><DateField value={issuedOn} onChange={setIssuedOn} /></Fld>
            <Fld label="Expected return" basis={160}><DateField value={expectedReturn} onChange={setExpectedReturn} /></Fld>
            <Fld label="Condition" basis={130}>
              <select style={sheetInput} value={condition} onChange={(e) => setCondition(e.target.value)}>
                {Object.entries(ASSET_CONDITION_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
            </Fld>
          </div>
          <label style={{ ...sheetLabel, marginTop: 14 }}>Remarks <Optional /></label>
          <textarea rows={2} data-tour="hr-asset-issue-remarks" style={{ ...sheetInput, resize: 'vertical' }} value={remarks} onChange={(e) => setRemarks(e.target.value)} placeholder="Charger, bag, accessories handed over…" />
        </SheetSection>
      </div>
    </FormDialog>
  )
}

// ── Return ──────────────────────────────────────────────────────────────────

export function ReturnAssetDialog({
  open, asset, onClose, onDone,
}: {
  open: boolean
  asset: HrAsset | null
  onClose: () => void
  onDone: (a: HrAsset) => void
}) {
  const [returnedOn, setReturnedOn] = useState(todayIso())
  const [condition, setCondition] = useState('good')
  const [nextStatus, setNextStatus] = useState('in_stock')
  const [remarks, setRemarks] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string[]>([])

  useEffect(() => {
    if (!open) return
    setReturnedOn(todayIso()); setCondition(asset?.condition || 'good'); setNextStatus('in_stock'); setRemarks(''); setError([])
  }, [open, asset])

  useEffect(() => {
    if (condition === 'damaged') setNextStatus((s) => (s === 'in_stock' ? 'under_repair' : s))
  }, [condition])

  const submit = async () => {
    if (!asset) return
    setSaving(true); setError([])
    try {
      const a = await hrApi.returnAsset(asset.id, { returned_on: returnedOn || null, condition_on_return: condition, next_status: nextStatus, remarks: remarks || null })
      onDone(a)
    } catch (err) {
      setError(extractErrorMessages(err, 'The return could not be recorded.'))
    } finally {
      setSaving(false)
    }
  }

  return (
    <FormDialog
      open={open}
      title={`Receive back ${asset?.asset_code || ''}`}
      subtitle={asset ? `From ${asset.current_holder_name || 'the employee'}${asset.issued_on ? `, issued ${fmtDate(asset.issued_on)}` : ''}.` : undefined}
      icon="undo"
      onClose={onClose}
      busy={saving}
      bare
      footer={<>
        <button type="button" style={sheetBtn('secondary', SHEET.INK, saving)} onClick={onClose} disabled={saving}>Cancel</button>
        <button type="button" data-tour="hr-asset-return-save" style={sheetBtn('primary', SHEET.BLUE, saving)} onClick={submit} disabled={saving}><SheetIcon name="check" size={16} />{saving ? 'Saving…' : 'Record return'}</button>
      </>}
    >
      <div style={{ padding: '20px 24px' }}>
        <ErrorBanner error={error} />
        <SheetSection icon="undo" title="Return">
          <div data-tour="hr-asset-return-fields" style={row}>
            <Fld label="Returned on" basis={160}><DateField value={returnedOn} onChange={setReturnedOn} /></Fld>
            <Fld label="Condition on return" basis={170}>
              <select style={sheetInput} value={condition} onChange={(e) => setCondition(e.target.value)}>
                {Object.entries(ASSET_CONDITION_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
            </Fld>
            <Fld label="Send to" basis={170}>
              <select style={sheetInput} value={nextStatus} onChange={(e) => setNextStatus(e.target.value)}>
                <option value="in_stock">In stock</option>
                <option value="under_repair">Under repair</option>
                <option value="retired">Retired</option>
              </select>
            </Fld>
          </div>
          <label style={{ ...sheetLabel, marginTop: 14 }}>Remarks <Optional /></label>
          <textarea rows={2} data-tour="hr-asset-return-remarks" style={{ ...sheetInput, resize: 'vertical' }} value={remarks} onChange={(e) => setRemarks(e.target.value)} placeholder="Missing charger, screen scratch…" />
        </SheetSection>
      </div>
    </FormDialog>
  )
}
