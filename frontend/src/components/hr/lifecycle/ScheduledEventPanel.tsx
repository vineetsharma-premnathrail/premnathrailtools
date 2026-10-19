'use client'

import { useState } from 'react'
import { hrOrgApi } from '@/lib/api'
import { extractErrorMessages } from '@/lib/validation'
import { secondaryBtnStyle } from '@/components/shared/ui'
import PromptDialog from '@/components/erp/PromptDialog'
import { Banner, dmy, h3, hint, sectionStyle } from '@/components/hr/hcmUi'

/** PA40: a transfer / promotion / confirmation completed before its effective
 * date waits here and is applied by the daily job on that date. HR can apply
 * it early with a reason (audited). */
export default function ScheduledEventPanel({ eventId, eventNo, effectiveDate, canApply, onApplied }: {
  eventId: number; eventNo: string; effectiveDate: string | null; canApply: boolean; onApplied: () => void
}) {
  const [open, setOpen] = useState(false)
  const [error, setError] = useState<string[]>([])
  const apply = async (reason: string) => {
    setOpen(false)
    try { await hrOrgApi.applyNow(eventId, reason); onApplied() }
    catch (err) { setError(extractErrorMessages(err, `Couldn't apply ${eventNo}.`)) }
  }
  return (
    <div style={sectionStyle}>
      <Banner errors={error} />
      <h3 style={h3}>Scheduled for {dmy(effectiveDate)}</h3>
      <p style={hint}>HR completed this event before its effective date, so nothing has changed yet. It is applied automatically early on {dmy(effectiveDate)} with the options chosen at completion, and the assignment history gets a new period from that date.</p>
      {canApply && <button type="button" style={secondaryBtnStyle} onClick={() => setOpen(true)}>Apply now</button>}
      <PromptDialog open={open} title={`Apply ${eventNo} now?`} requireValue confirmLabel="Apply now" danger={false}
        message={`The change takes effect today instead of ${dmy(effectiveDate)}. Say why — it is kept in the audit trail.`}
        placeholder="Reason (required)…" onConfirm={apply} onCancel={() => setOpen(false)} />
    </div>
  )
}
