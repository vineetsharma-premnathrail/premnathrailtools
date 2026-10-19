'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { useRequireApp } from '@/hooks/useAuth'
import { serviceContractsApi } from '@/lib/sdServiceApi'
import { extractErrorMessages } from '@/lib/validation'
import { recordPath } from '@/lib/recordRef'
import ErpNav from '@/components/erp/ErpNav'
import ServiceContractForm, { contractToForm, formToPayload, ContractFormValue } from '@/components/erp/ServiceContractForm'

export default function NewServiceContractPage() {
  const { isAuthorized, isLoading } = useRequireApp('erp')
  const router = useRouter()
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string[]>([])

  if (isLoading || !isAuthorized) return null

  const save = async (f: ContractFormValue) => {
    if (!f.customer_id) { setError(['Pick the customer the contract is with.']); return }
    setSaving(true)
    try {
      const c = await serviceContractsApi.create(formToPayload(f))
      router.push(recordPath('/dashboard/erp/service-contracts', c))
    } catch (e) {
      setError(extractErrorMessages(e, 'Could not save the contract.'))
      setSaving(false)
    }
  }

  return (
    <div style={{ padding: 24 }}>
      <ServiceContractForm variant="page" nav={<ErpNav />} title="New service contract"
        subtitle="Saved as a draft with its billing plan; send it for approval from the contract page."
        error={error} initial={contractToForm(null)} saving={saving} onSave={save} onCancel={() => router.push('/dashboard/erp/service-contracts')} />
    </div>
  )
}
