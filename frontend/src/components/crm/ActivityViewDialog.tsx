'use client'

import { CrmActivity } from '@/types'
import { RichText } from '@/components/RichTextEditor'
import { InfoRow, ActivityPhotos } from '@/components/crm/ui'

export default function ActivityViewDialog({ activity, onClose }: { activity: CrmActivity | null; onClose: () => void }) {
  if (!activity) return null
  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(20,14,8,0.35)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 200, padding: 16 }}>
      <div onClick={(e) => e.stopPropagation()} style={{ width: '100%', maxWidth: 520, maxHeight: '85vh', overflowY: 'auto', background: '#fff', borderRadius: 18, padding: 24, boxShadow: '0 24px 60px rgba(0,0,0,0.25)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 16 }}>
          <p style={{ fontSize: 16, fontWeight: 700, color: '#1f1108', margin: 0 }}>{activity.activity_type || 'Follow Up'}</p>
          <button onClick={onClose} aria-label="Close" style={{ border: 'none', background: 'transparent', fontSize: 18, cursor: 'pointer', color: '#a8a29e', lineHeight: 1 }}>✕</button>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          {activity.created_at && <InfoRow label="Created" value={new Date(activity.created_at).toLocaleString('en-GB')} />}
          <InfoRow label="Subject" value={activity.subject || 'Not provided'} />
          {!!activity.contact_names?.length && <InfoRow label="Contact Person(s)" value={activity.contact_names.join(', ')} />}
          <InfoRow label="Next Follow-up Date" value={activity.next_followup || 'Not provided'} />
          <div>
            <p style={{ fontSize: 11, fontWeight: 600, letterSpacing: '.05em', textTransform: 'uppercase', color: '#a8a29e', margin: '0 0 4px' }}>Observation / Remarks</p>
            {activity.remarks ? <RichText html={activity.remarks} style={{ fontSize: 13, color: '#1f1108' }} /> : <p style={{ fontSize: 13, color: '#1f1108', margin: 0 }}>Not provided</p>}
          </div>
          <div>
            <p style={{ fontSize: 11, fontWeight: 600, letterSpacing: '.05em', textTransform: 'uppercase', color: '#a8a29e', margin: '0 0 4px' }}>Action Plan</p>
            {activity.action_plan ? <RichText html={activity.action_plan} style={{ fontSize: 13, color: '#1f1108' }} /> : <p style={{ fontSize: 13, color: '#1f1108', margin: 0 }}>Not provided</p>}
          </div>
          <div>
            <p style={{ fontSize: 11, fontWeight: 600, letterSpacing: '.05em', textTransform: 'uppercase', color: '#a8a29e', margin: '0 0 4px' }}>Photos</p>
            {activity.attachments?.length ? <ActivityPhotos attachments={activity.attachments} /> : <p style={{ fontSize: 13, color: '#1f1108', margin: 0 }}>Not provided</p>}
          </div>
        </div>
      </div>
    </div>
  )
}
