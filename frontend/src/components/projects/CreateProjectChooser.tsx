'use client'

// "+ Create Project" asks what is being created first: a customer-order project
// (PM form: project + machine) or a prototype / research project (R&D form).
// A card the user may not use stays visible but disabled, with the real reason and the fix.
import { useRouter } from 'next/navigation'
import { useCan } from '@/lib/permissions'
import { FormSheet, SHEET, SheetIcon, SheetIconName, sheetBtn } from '@/components/shared/FormSheet'

export const NEW_PROJECT_HREF = '/dashboard/projects/new'
export const NEW_PROTOTYPE_HREF = '/dashboard/rnd/projects/new?from=pm'

const NO_PROJECT_RIGHT = 'You need Project Management › All Projects › Create. Ask an admin to grant it in Organization › Role & Permissions (Partners and Directors have it by default).'
const NO_PROTOTYPE_RIGHT = 'You need R&D › Prototype / Research › Create. Ask an admin to grant it in Organization › Role & Permissions.'

/** Which of the two forms the user may open. `canProject` comes from GET /projects/meta (can_create). */
export function useProjectCreateRights(canProject: boolean) {
  const { can } = useCan()
  const canPrototype = can('rnd', 'projects', 'create')
  return { canProject, canPrototype, any: canProject || canPrototype }
}

function ChoiceCard({ icon, title, meaning, reason, tour, onChoose }: {
  icon: SheetIconName; title: string; meaning: string; reason?: string; tour: string; onChoose: () => void
}) {
  const disabled = !!reason
  return (
    // ui-audit-ignore-next-line custom-button — a large choice card, not an action button
    <button type="button" data-tour={tour} aria-disabled={disabled} onClick={() => { if (!disabled) onChoose() }}
      style={{
        flex: '1 1 240px', minWidth: 220, textAlign: 'left', fontFamily: 'inherit', padding: 20, borderRadius: 16,
        border: `1.5px solid ${disabled ? SHEET.LINE : '#c7d2fe'}`, background: disabled ? SHEET.SOFT : '#fff',
        cursor: disabled ? 'not-allowed' : 'pointer', display: 'flex', flexDirection: 'column', gap: 10,
        boxShadow: disabled ? 'none' : '0 4px 14px rgba(99,102,241,0.12)',
      }}>
      <span style={{ width: 44, height: 44, borderRadius: 12, background: disabled ? '#cbd5e1' : '#6366f1', display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>
        <SheetIcon name={icon} size={24} color="#fff" />
      </span>
      <span style={{ fontSize: 17, fontWeight: 700, color: disabled ? SHEET.MUTED : SHEET.INK }}>{title}</span>
      <span style={{ fontSize: 13.5, color: SHEET.BODY, lineHeight: 1.45 }}>{meaning}</span>
      {reason && <span role="note" style={{ fontSize: 12.5, color: '#b45309', lineHeight: 1.45 }}>{reason}</span>}
    </button>
  )
}

export default function CreateProjectChooser({ canProject, onClose }: { canProject: boolean; onClose: () => void }) {
  const router = useRouter()
  const rights = useProjectCreateRights(canProject)
  return (
    <FormSheet icon="flag" title="Create Project" subtitle="What are you creating?" width={640} busy={false} onClose={onClose} tour="pm-create-chooser"
      footer={<button type="button" style={sheetBtn('secondary')} onClick={onClose}>Cancel</button>}>
      <div style={{ padding: '20px 24px', display: 'flex', flexWrap: 'wrap', gap: 16 }}>
        <ChoiceCard icon="truck" title="New Project" tour="pm-create-choice-project"
          meaning="A customer order: the project and its machine are created together, then you add milestones."
          reason={rights.canProject ? undefined : NO_PROJECT_RIGHT}
          onChoose={() => router.push(NEW_PROJECT_HREF)} />
        <ChoiceCard icon="tool" title="New Prototype" tour="pm-create-choice-prototype"
          meaning="Research and development work with no customer order: R&D tasks, documents and budget."
          reason={rights.canPrototype ? undefined : NO_PROTOTYPE_RIGHT}
          onChoose={() => router.push(NEW_PROTOTYPE_HREF)} />
      </div>
    </FormSheet>
  )
}
