'use client'

import { useAuth } from '@/hooks/useAuth'
import { useCan } from '@/lib/permissions'
import { CrmActivity } from '@/types'
import ManagedDocumentPanel from '@/components/shared/ManagedDocumentPanel'
import { RichText } from '@/components/RichTextEditor'
import { InfoRow, ActivityPhotos } from '@/components/crm/ui'
import { FormSheet, SheetSection, SHEET, sheetBtn } from '@/components/shared/FormSheet'

export default function ActivityViewDialog({ activity, onClose }: { activity: CrmActivity | null; onClose: () => void }) {
  const { user } = useAuth()
  const { can } = useCan()
  if (!activity) return null
  const tab = activity.related_module === 'inquiry' || activity.related_module === 'tender' ? 'inquiries_tenders' : 'organizations'
  const canModify = (user?.role === 'admin' || activity.created_by_id === user?.id) && can('crm', tab, 'edit')
  const dateSlug = (activity.created_at || '').slice(0, 10).replace(/-/g, '') || 'undated'
  return (
    <FormSheet width={600} icon="chat" title={activity.activity_type || 'Follow Up'} subtitle={activity.subject || 'Follow-up details'} onClose={onClose} busy={false}
      footer={<button type="button" onClick={onClose} style={sheetBtn('secondary', SHEET.INK)}>Close</button>}>
      <div style={{ padding: '20px 24px' }}>
        <SheetSection icon="list" title="Details">
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            {activity.created_at && <InfoRow label="Created" value={new Date(activity.created_at).toLocaleString('en-GB')} />}
            <InfoRow label="Subject" value={activity.subject || 'Not provided'} />
            {!!activity.contact_names?.length && <InfoRow label="Contact Person(s)" value={activity.contact_names.join(', ')} />}
            <InfoRow label="Next Follow-up Date" value={activity.next_followup || 'To Be Decided'} />
            <InfoRow label="Status" value={activity.status || 'Open'} />
          </div>
        </SheetSection>
        <SheetSection icon="chat" title="Observation / Remarks">
          {activity.remarks ? <RichText html={activity.remarks} style={{ fontSize: 13, color: SHEET.INK }} /> : <p style={empty}>Not provided</p>}
        </SheetSection>
        <SheetSection icon="flag" title="Action Plan">
          {activity.action_plan ? <RichText html={activity.action_plan} style={{ fontSize: 13, color: SHEET.INK }} /> : <p style={empty}>Not provided</p>}
        </SheetSection>
        <SheetSection icon="clip" title="Photos">
          {activity.attachments?.length ? <ActivityPhotos attachments={activity.attachments} /> : <p style={empty}>Not provided</p>}
        </SheetSection>
        <SheetSection icon="doc" title="Minutes of Meeting">
          <ManagedDocumentPanel entityType="crm_activity_mom" entityId={activity.id} revision={activity.mom_revision} canModify={canModify} recordLabel="follow-up" downloadName={`MOM_${dateSlug}_${activity.id}`} />
        </SheetSection>
      </div>
    </FormSheet>
  )
}

const empty: React.CSSProperties = { fontSize: 13, color: SHEET.MUTED, margin: 0 }
