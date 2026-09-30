'use client'

import { useCallback, useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { useRequireApp } from '@/hooks/useAuth'
import { hrApi, usersApi } from '@/lib/api'
import { extractErrorMessages } from '@/lib/validation'
import type { HrAsset, HrBranchLookup, DirectoryUser } from '@/types'
import HrNav from '@/components/hr/HrNav'
import ConfirmDialog from '@/components/erp/ConfirmDialog'
import PromptDialog from '@/components/erp/PromptDialog'
import { secondaryBtnStyle, dangerBtnStyle, InfoRow } from '@/components/shared/ui'
import {
  AssetFormDialog, IssueAssetDialog, ReturnAssetDialog, ASSET_CATEGORY_LABELS, ASSET_CONDITION_LABELS,
} from '@/components/hr/admin/AssetDialogs'
import {
  PageHeader, ErrorBanner, SuccessBanner, Pill, EmptyRow, primaryActionStyle, sectionStyle,
  thStyle, tdStyle, fmtDate, fmtINR, fmtDateTime,
} from '@/components/hr/admin/adminUi'
import { TEXT } from '@/lib/theme'

const STATUS_LABELS: Record<string, string> = { in_stock: 'In Stock', issued: 'Issued', under_repair: 'Under Repair', retired: 'Retired', lost: 'Lost' }
const STATUS_HEX: Record<string, string> = { in_stock: '#16A34A', issued: '#2563EB', under_repair: '#F59E0B', retired: '#64748B', lost: '#DC2626' }

type StatusAction = { status: string; label: string; title: string; message: string; danger: boolean }

export default function HrAssetDetailPage() {
  const { isAuthorized, isLoading } = useRequireApp('hr')
  const router = useRouter()
  const params = useParams<{ id: string }>()
  const assetId = Number(params?.id)

  const [asset, setAsset] = useState<HrAsset | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string[]>([])
  const [notice, setNotice] = useState('')
  const [branches, setBranches] = useState<HrBranchLookup[]>([])
  const [people, setPeople] = useState<DirectoryUser[]>([])

  const [editOpen, setEditOpen] = useState(false)
  const [issueOpen, setIssueOpen] = useState(false)
  const [returnOpen, setReturnOpen] = useState(false)
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [statusAction, setStatusAction] = useState<StatusAction | null>(null)
  const [busy, setBusy] = useState(false)

  const load = useCallback(() => {
    if (!assetId) return
    setLoading(true)
    hrApi.getAsset(assetId)
      .then((a) => { setAsset(a); setError([]) })
      .catch((err) => setError(extractErrorMessages(err, 'This asset could not be loaded.')))
      .finally(() => setLoading(false))
  }, [assetId])

  useEffect(() => {
    if (!isAuthorized) return
    load()
    hrApi.branchLookup().then(setBranches).catch(() => setBranches([]))
    usersApi.directory().then(setPeople).catch(() => setPeople([]))
  }, [isAuthorized, load])

  const done = (a: HrAsset, msg: string) => {
    setAsset(a); setNotice(msg); setError([])
  }

  const runStatus = async (remarks: string) => {
    if (!asset || !statusAction) return
    setBusy(true)
    try {
      const a = await hrApi.changeAssetStatus(asset.id, { status: statusAction.status, remarks: remarks || null })
      done(a, `${a.asset_code} is now ${STATUS_LABELS[a.status] || a.status}.`)
    } catch (err) {
      setError(extractErrorMessages(err, 'The status could not be changed.'))
    } finally {
      setBusy(false); setStatusAction(null)
    }
  }

  const runDelete = async () => {
    if (!asset) return
    setBusy(true)
    try {
      await hrApi.deleteAsset(asset.id)
      router.push('/dashboard/hr/assets')
    } catch (err) {
      setError(extractErrorMessages(err, 'The asset could not be deleted.'))
      setDeleteOpen(false)
    } finally {
      setBusy(false)
    }
  }

  if (isLoading || !isAuthorized) return null

  const statusActions: StatusAction[] = []
  if (asset) {
    if (asset.status === 'in_stock') {
      statusActions.push({ status: 'under_repair', label: 'Send for repair', title: 'Send for repair?', message: 'Add where it went and what is wrong (optional).', danger: false })
      statusActions.push({ status: 'retired', label: 'Retire', title: 'Retire this asset?', message: 'Retired assets can no longer be issued. Add a reason (optional).', danger: true })
    }
    if (asset.status === 'under_repair' || asset.status === 'retired' || asset.status === 'lost') {
      statusActions.push({ status: 'in_stock', label: 'Back to stock', title: 'Move back to stock?', message: 'The asset becomes available to issue again. Add a note (optional).', danger: false })
    }
    if (asset.status === 'under_repair') {
      statusActions.push({ status: 'retired', label: 'Retire', title: 'Retire this asset?', message: 'Retired assets can no longer be issued. Add a reason (optional).', danger: true })
    }
    if (asset.status !== 'lost' && asset.status !== 'retired') {
      statusActions.push({
        status: 'lost', label: 'Mark lost', title: 'Mark as lost?',
        message: asset.status === 'issued'
          ? `This closes the issue to ${asset.current_holder_name || 'the employee'} and clears them as holder. Describe what happened.`
          : 'Describe what happened (optional).',
        danger: true,
      })
    }
  }

  return (
    <div>
      <HrNav />

      <PageHeader
        title={asset ? `${asset.asset_code} — ${asset.name}` : 'Asset'}
        subtitle={asset ? [ASSET_CATEGORY_LABELS[asset.category] || asset.category, asset.make, asset.model].filter(Boolean).join(' · ') : undefined}
        actions={<button onClick={() => router.push('/dashboard/hr/assets')} type="button" style={secondaryBtnStyle}>← Back</button>}
      />

      <ErrorBanner error={error} />
      <SuccessBanner message={notice} />

      {loading && !asset ? (
        <div style={sectionStyle}><p style={{ margin: 0, fontSize: 13, color: TEXT.muted }}>Loading…</p></div>
      ) : asset ? (
        <>
          <div style={{ ...sectionStyle, display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
            <Pill hex={STATUS_HEX[asset.status] || '#64748B'} label={STATUS_LABELS[asset.status] || asset.status} />
            <span style={{ fontSize: 13.5, color: TEXT.body, flex: '1 1 260px' }}>
              {asset.status === 'issued'
                ? <>With <b>{asset.current_holder_name}</b> since {fmtDate(asset.issued_on)}{asset.expected_return_on ? `, due back ${fmtDate(asset.expected_return_on)}` : ''}.</>
                : asset.status === 'in_stock' ? 'Available to issue.' : `Not available to issue while ${STATUS_LABELS[asset.status]?.toLowerCase()}.`}
            </span>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              {asset.status === 'in_stock' && <button type="button" style={primaryActionStyle} onClick={() => setIssueOpen(true)}>Issue to employee</button>}
              {asset.status === 'issued' && <button type="button" style={primaryActionStyle} onClick={() => setReturnOpen(true)}>Record return</button>}
              {statusActions.map((s) => (
                <button key={s.status + s.label} type="button" style={s.danger ? dangerBtnStyle : secondaryBtnStyle} onClick={() => setStatusAction(s)} disabled={busy}>{s.label}</button>
              ))}
              <button type="button" style={secondaryBtnStyle} onClick={() => setEditOpen(true)}>Edit</button>
              {asset.status !== 'issued' && <button type="button" style={dangerBtnStyle} onClick={() => setDeleteOpen(true)}>Delete</button>}
            </div>
          </div>

          <div style={{ display: 'flex', gap: 20, flexWrap: 'wrap', alignItems: 'flex-start' }}>
            <div style={{ flex: '1 1 380px', display: 'flex', flexDirection: 'column' }}>
              <div style={sectionStyle}>
                <p style={{ fontSize: 12, fontWeight: 600, letterSpacing: '.05em', textTransform: 'uppercase', color: TEXT.secondary, margin: '0 0 14px' }}>Details</p>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))', gap: 14 }}>
                  <InfoRow label="Asset code" value={asset.asset_code} />
                  <InfoRow label="Category" value={ASSET_CATEGORY_LABELS[asset.category] || asset.category} />
                  <InfoRow label="Serial / IMEI" value={asset.serial_number || '—'} />
                  <InfoRow label="Condition" value={asset.condition ? ASSET_CONDITION_LABELS[asset.condition] || asset.condition : '—'} />
                  <InfoRow label="Plant" value={asset.branch_name || '—'} />
                  <InfoRow label="Added by" value={asset.created_by_name || '—'} />
                </div>
              </div>
            </div>
            <div style={{ flex: '1 1 320px', display: 'flex', flexDirection: 'column' }}>
              <div style={sectionStyle}>
                <p style={{ fontSize: 12, fontWeight: 600, letterSpacing: '.05em', textTransform: 'uppercase', color: TEXT.secondary, margin: '0 0 14px' }}>Purchase</p>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))', gap: 14 }}>
                  <InfoRow label="Purchase date" value={fmtDate(asset.purchase_date)} />
                  <InfoRow label="Cost" value={fmtINR(asset.purchase_cost)} />
                  <InfoRow label="Vendor" value={asset.vendor_name || '—'} />
                  <InfoRow label="Invoice no." value={asset.invoice_no || '—'} />
                  <InfoRow label="Warranty until" value={fmtDate(asset.warranty_until)} />
                </div>
              </div>
            </div>
          </div>

          {asset.remarks && (
            <div style={sectionStyle}>
              <InfoRow label="Remarks" value={asset.remarks} />
            </div>
          )}

          <div style={{ ...sectionStyle, padding: 0, overflow: 'auto' }}>
            <p style={{ fontSize: 12, fontWeight: 600, letterSpacing: '.05em', textTransform: 'uppercase', color: TEXT.secondary, margin: 0, padding: '18px 20px 12px' }}>Assignment history</p>
            <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 820 }}>
              <thead>
                <tr>{['Employee', 'Issued', 'Issued by', 'Expected back', 'Returned', 'Received by', 'Condition (out → in)', 'Remarks'].map((h) => <th key={h} style={thStyle}>{h}</th>)}</tr>
              </thead>
              <tbody>
                {!asset.assignments?.length ? (
                  <EmptyRow colSpan={8} text="Never issued." />
                ) : asset.assignments.map((r) => (
                  <tr key={r.id}>
                    <td style={{ ...tdStyle, fontWeight: 600 }}>{r.user_name || `User #${r.user_id}`}</td>
                    <td style={tdStyle}>{fmtDate(r.issued_on)}</td>
                    <td style={tdStyle}>{r.issued_by_name || '—'}</td>
                    <td style={tdStyle}>{fmtDate(r.expected_return_on)}</td>
                    <td style={tdStyle}>{r.returned_on ? fmtDate(r.returned_on) : <Pill hex="#2563EB" label="With employee" />}</td>
                    <td style={tdStyle}>{r.received_by_name || '—'}</td>
                    <td style={tdStyle}>
                      {(r.condition_on_issue ? ASSET_CONDITION_LABELS[r.condition_on_issue] || r.condition_on_issue : '—')}
                      {' → '}
                      {(r.condition_on_return ? ASSET_CONDITION_LABELS[r.condition_on_return] || r.condition_on_return : '—')}
                    </td>
                    <td style={{ ...tdStyle, whiteSpace: 'pre-wrap', maxWidth: 260 }}>{r.remarks || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p style={{ fontSize: 12, color: TEXT.muted, margin: '-8px 0 0' }}>Last updated {fmtDateTime(asset.updated_at)}</p>
        </>
      ) : null}

      <AssetFormDialog open={editOpen} asset={asset} branches={branches} onClose={() => setEditOpen(false)} onSaved={(a) => { setEditOpen(false); done(a, 'Changes saved.') }} />
      <IssueAssetDialog open={issueOpen} asset={asset} people={people} onClose={() => setIssueOpen(false)} onDone={(a) => { setIssueOpen(false); done(a, `${a.asset_code} issued to ${a.current_holder_name}.`) }} />
      <ReturnAssetDialog open={returnOpen} asset={asset} onClose={() => setReturnOpen(false)} onDone={(a) => { setReturnOpen(false); done(a, `Return recorded. ${a.asset_code} is now ${STATUS_LABELS[a.status]?.toLowerCase()}.`) }} />
      <PromptDialog
        open={!!statusAction}
        title={statusAction?.title || ''}
        message={statusAction?.message}
        placeholder="Remarks (optional)…"
        confirmLabel={statusAction?.label || 'Confirm'}
        danger={!!statusAction?.danger}
        onConfirm={runStatus}
        onCancel={() => setStatusAction(null)}
      />
      <ConfirmDialog
        open={deleteOpen}
        title={`Delete ${asset?.asset_code || 'asset'}?`}
        message="It will be removed from the register. Its issue history is kept for audit."
        confirmLabel={busy ? 'Deleting…' : 'Delete'}
        onConfirm={runDelete}
        onCancel={() => setDeleteOpen(false)}
      />
    </div>
  )
}
