'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { recordPath } from '@/lib/recordRef'
import { useRequireApp } from '@/hooks/useAuth'
import { qualityApi } from '@/lib/api'
import QualityNav from '@/components/quality/QualityNav'
import SearchableSelect from '@/components/erp/SearchableSelect'
import { FormPage, SheetColumns, SheetSection, SheetIcon, SHEET, sheetBtn, sheetInput, sheetLabel, Req, Optional } from '@/components/shared/FormSheet'
import { ErrorBanner, sheetGap } from '@/components/quality/QualityBits'
import { extractErrorMessages } from '@/lib/validation'

interface ItemOpt { id: number; item_code: string; item_name: string }

export default function NewAvlPage() {
  const { isAuthorized, isLoading } = useRequireApp('quality')
  const router = useRouter()
  const [items, setItems] = useState<ItemOpt[]>([])
  const [form, setForm] = useState({ item_id: '', vendor_name: '', remarks: '' })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | string[]>('')

  useEffect(() => {
    if (!isAuthorized) return
    qualityApi.lookupItems('').then(setItems).catch(() => setItems([]))
  }, [isAuthorized])

  const submit = async () => {
    setError('')
    if (!form.item_id || !form.vendor_name.trim()) return setError('Pick the item and enter the vendor name exactly as on the purchase orders.')
    setBusy(true)
    try {
      const a = await qualityApi.createAvl({ item_id: Number(form.item_id), vendor_name: form.vendor_name.trim(), remarks: form.remarks || null })
      router.push(recordPath('/dashboard/quality/supplier-quality', a))
    } catch (err) {
      setError(extractErrorMessages(err, 'Failed to add the vendor.'))
    } finally {
      setBusy(false)
    }
  }

  if (isLoading || !isAuthorized) return null
  const back = () => router.push('/dashboard/quality/supplier-quality')

  return (
    <FormPage nav={<QualityNav />} icon="truck" title="Add Vendor for an Item" subtitle="Quality · Approved vendor list" onBack={back} backTour="qa-avl-new-back"
      footer={<>
        <button type="button" onClick={back} disabled={busy} style={sheetBtn('secondary', SHEET.INK, busy)}>Cancel</button>
        <button type="button" onClick={submit} disabled={busy} style={sheetBtn('primary', SHEET.BLUE, busy)}><SheetIcon name="plus" size={16} />{busy ? 'Saving…' : 'Add to list'}</button>
      </>}>
      <SheetColumns
        left={<>
          <ErrorBanner error={error} />
          <SheetSection icon="truck" title="Vendor">
            <label style={sheetLabel}>Item <Req /></label>
            <SearchableSelect value={form.item_id} onChange={(v) => setForm({ ...form, item_id: v })} placeholder="Select item"
              options={items.map((i) => ({ value: String(i.id), label: `${i.item_code} — ${i.item_name}` }))} />
            <label style={{ ...sheetLabel, ...sheetGap }}>Vendor <Req /></label>
            <input style={sheetInput} value={form.vendor_name} placeholder="Exactly as on the purchase orders" onChange={(e) => setForm({ ...form, vendor_name: e.target.value })} />
            <label style={{ ...sheetLabel, ...sheetGap }}>Remarks <Optional /></label>
            <input style={sheetInput} value={form.remarks} onChange={(e) => setForm({ ...form, remarks: e.target.value })} />
          </SheetSection>
        </>}
        right={<>
          <SheetSection icon="alert" title="How vendors get on the list">
            <p style={{ fontSize: 13, color: SHEET.BODY, margin: 0, lineHeight: 1.55 }}>
              A vendor starts on Trial. Vendors of inspection-controlled items are added automatically on their first receipt and approved by their first article;
              use this to pre-register a vendor (e.g. before a trial order).
            </p>
          </SheetSection>
        </>}
      />
    </FormPage>
  )
}
