'use client'

import Select from '@/components/shared/Select'
import { useCallback, useEffect, useState } from 'react'
import { accountsApi, hrClaimFinanceApi } from '@/lib/api'
import { useCan } from '@/lib/permissions'
import { extractErrorMessages } from '@/lib/validation'
import { primaryBtnStyle, secondaryBtnStyle } from '@/components/shared/ui'
import DateField from '@/components/erp/DateField'
import { Banner, Pill, PortalModal, dmy, h3, hint, localIso, sectionStyle } from '@/components/hr/hcmUi'
import { SheetSection, SheetIcon, Req, SHEET, sheetBtn, sheetInput, sheetLabel } from '@/components/shared/FormSheet'

type Posting = {
  id: number; claim_no: string; status: string; total_amount: number; posted_je_number: string | null
  payment_voucher_number: string | null; posting_error: string | null; paid_on: string | null
}
type Bank = { id: number; bank_name: string; account_no?: string | null; account_kind: string; status: string }

/** PR05: the claim's accounting — approval journal (Dr expense / Cr employee
 * payable) and the payment voucher that clears the payable. Finance users only. */
export default function ClaimFinancePanel({ claimId, claimStatus }: { claimId: number; claimStatus?: string }) {
  const { can } = useCan()
  const canView = can('accounts', 'payments', 'view')
  const canPay = can('accounts', 'payments', 'create')
  const canPost = can('accounts', 'journal_vouchers', 'create')
  const [p, setP] = useState<Posting | null>(null)
  const [error, setError] = useState<string[]>([])
  const [open, setOpen] = useState(false)
  const [banks, setBanks] = useState<Bank[]>([])
  const [form, setForm] = useState({ bank_account_id: '', payment_mode: 'neft', paid_on: localIso(), payment_reference: '' })

  const load = useCallback(() => {
    if (!canView) return
    hrClaimFinanceApi.get(claimId).then((r) => { setP(r); setError([]) })
      .catch((err) => setError(extractErrorMessages(err, "Couldn't load the claim's accounting.")))
  }, [claimId, canView])
  useEffect(() => { load() }, [load, claimStatus])

  if (!canView || !p || !['approved', 'paid'].includes(p.status)) return null

  const openPay = async () => {
    setOpen(true)
    try { setBanks(((await accountsApi.listBankAccounts()) as Bank[]).filter((b) => b.status === 'active')) }
    catch (err) { setError(extractErrorMessages(err, "Couldn't load the bank / cash accounts.")) }
  }
  const pay = async () => {
    if (!form.bank_account_id) { setError(['Pick the bank or cash account the money is paid from.']); return }
    try {
      setP(await hrClaimFinanceApi.pay(claimId, { ...form, bank_account_id: Number(form.bank_account_id), payment_reference: form.payment_reference || null }))
      setOpen(false); setError([])
    } catch (err) { setError(extractErrorMessages(err, "Couldn't record the payment.")) }
  }
  const post = async () => {
    try { setP(await hrClaimFinanceApi.post(claimId)); setError([]) }
    catch (err) { setError(extractErrorMessages(err, "Couldn't post the claim to accounts.")) }
  }

  return (
    <div style={sectionStyle}>
      {!open && <Banner errors={error} />}
      <h3 style={h3}>Finance posting</h3>
      <div style={{ display: 'flex', gap: 24, flexWrap: 'wrap', fontSize: 13, marginBottom: 10 }}>
        <div><b>Approval journal:</b> {p.posted_je_number ? <Pill label={p.posted_je_number} hex="#16A34A" /> : <Pill label="Not posted" hex="#F59E0B" />}</div>
        <div><b>Payment voucher:</b> {p.payment_voucher_number ? <><Pill label={p.payment_voucher_number} hex="#16A34A" /> {dmy(p.paid_on)}</> : '—'}</div>
      </div>
      {p.posting_error && !p.posted_je_number && <p style={{ ...hint, color: '#b91c1c' }}>Couldn&apos;t post on approval: {p.posting_error}</p>}
      <div style={{ display: 'flex', gap: 10 }}>
        {!p.posted_je_number && canPost && <button type="button" style={secondaryBtnStyle} onClick={post}>Post to accounts</button>}
        {p.status === 'approved' && canPay && <button type="button" style={primaryBtnStyle} onClick={openPay}>Pay by voucher</button>}
      </div>
      <PortalModal open={open} icon="rupee" iconColor="#16A34A" title={`Pay ${p.claim_no} — ₹${p.total_amount.toLocaleString('en-IN', { minimumFractionDigits: 2 })}`}
        subtitle="Records a payment voucher Dr Employee reimbursements payable / Cr the bank or cash account, numbered in the FY payment series."
        onClose={() => setOpen(false)}
        footer={<>
          <button type="button" style={sheetBtn('secondary', SHEET.INK)} onClick={() => setOpen(false)}>Cancel</button>
          <button type="button" style={sheetBtn('primary', '#16A34A')} onClick={pay}><SheetIcon name="check" size={16} />Record payment</button>
        </>}>
        <Banner errors={error} />
        <SheetSection icon="building" title="Paid From">
          <label style={sheetLabel}>Bank / cash account <Req /></label>
          <Select value={form.bank_account_id} onChange={(e) => {
            const b = banks.find((x) => String(x.id) === e.target.value)
            setForm({ ...form, bank_account_id: e.target.value, payment_mode: b?.account_kind === 'cash' ? 'cash' : form.payment_mode === 'cash' ? 'neft' : form.payment_mode })
          }} style={sheetInput}>
            <option value="">Pick an account…</option>
            {banks.map((b) => <option key={b.id} value={b.id}>{b.bank_name}{b.account_no ? ` — ${b.account_no}` : ''}</option>)}
          </Select>
        </SheetSection>
        <SheetSection icon="rupee" title="Payment">
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
            <div style={{ flex: '0 1 140px' }}>
              <label style={sheetLabel}>Mode</label>
              <Select value={form.payment_mode} onChange={(e) => setForm({ ...form, payment_mode: e.target.value })} style={sheetInput}>
                {['neft', 'rtgs', 'imps', 'upi', 'cheque', 'cash'].map((m) => <option key={m} value={m}>{m.toUpperCase()}</option>)}
              </Select>
            </div>
            <div style={{ flex: '0 1 170px' }}><label style={sheetLabel}>Paid on</label><DateField value={form.paid_on} onChange={(v) => setForm({ ...form, paid_on: v })} /></div>
            <div style={{ flex: '1 1 180px', maxWidth: 260 }}><label style={sheetLabel}>Bank reference</label><input value={form.payment_reference} onChange={(e) => setForm({ ...form, payment_reference: e.target.value })} style={sheetInput} /></div>
          </div>
        </SheetSection>
      </PortalModal>
    </div>
  )
}
