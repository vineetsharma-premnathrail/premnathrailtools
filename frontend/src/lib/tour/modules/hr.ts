import type { TourEntry } from '../registry'

// Tour entries for the hr module's pages. Checked after the core list in
// registry.ts, so a route already covered there keeps its existing tour.
// ── hr-b: leave, attendance, holidays, approvals, assets, travel, claims, visitors ──

// Several HR pages open their forms inline or in a dialog on the same URL, so
// the route alone can't tell list and form apart — probing for the open
// form's own Save button picks the tour that matches what is on screen.
const hrHas = (tour: string) =>
  typeof document !== 'undefined' && !!document.querySelector(`[data-tour="${tour}"]`)

const HR_B_ENTRIES: TourEntry[] = [
  {
    pattern: /^\/dashboard\/hr\/approvals$/,
    load: () => import('../configs/hrApprovals'),
  },
  {
    pattern: /^\/dashboard\/hr\/assets\/[A-Za-z0-9_-]{19}$/,
    load: () => hrHas('hr-asset-issue-save') ? import('../configs/hrAssetIssueForm')
      : hrHas('hr-asset-return-save') ? import('../configs/hrAssetReturnForm')
        : hrHas('hr-asset-form-save') ? import('../configs/hrAssetForm')
          : import('../configs/hrAssetDetail'),
  },
  {
    pattern: /^\/dashboard\/hr\/assets$/,
    load: () => hrHas('hr-asset-form-save') ? import('../configs/hrAssetForm') : import('../configs/hrAssetsList'),
  },
  {
    pattern: /^\/dashboard\/hr\/attendance$/,
    load: () => hrHas('hr-att-edit-save') ? import('../configs/hrAttendanceEdit') : import('../configs/hrAttendanceAdmin'),
  },
  {
    pattern: /^\/dashboard\/hr\/holidays$/,
    load: () => hrHas('hr-hol-form-save') ? import('../configs/hrHolidayForm')
      : hrHas('hr-hol-bulk-save') ? import('../configs/hrHolidayBulk')
        : hrHas('hr-hol-copy-save') ? import('../configs/hrHolidayCopy')
          : import('../configs/hrHolidays'),
  },
  {
    pattern: /^\/dashboard\/hr\/leave$/,
    load: () => hrHas('hr-leave-form-submit') ? import('../configs/hrLeaveApplyForm')
      : hrHas('hr-leave-allot-save') ? import('../configs/hrLeaveAllot')
        : hrHas('hr-leave-adjust-save') ? import('../configs/hrLeaveAdjust')
          : import('../configs/hrLeaveAdmin'),
  },
  {
    pattern: /^\/dashboard\/hr\/me\/leave$/,
    load: () => hrHas('hr-leave-form-submit') ? import('../configs/hrLeaveApplyForm') : import('../configs/hrMyLeave'),
  },
  {
    pattern: /^\/dashboard\/hr\/me\/attendance$/,
    load: () => hrHas('hr-myatt-reg-submit') ? import('../configs/hrMyAttendanceCorrection') : import('../configs/hrMyAttendance'),
  },
  {
    pattern: /^\/dashboard\/hr\/me\/assets$/,
    load: () => import('../configs/hrMyAssets'),
  },
  {
    pattern: /^\/dashboard\/hr\/me\/travel$/,
    load: () => hrHas('hr-travel-form-save') ? import('../configs/hrTravelForm') : import('../configs/hrMyTravel'),
  },
  {
    pattern: /^\/dashboard\/hr\/(me\/claims|travel\/claims)\/[A-Za-z0-9_-]{19}$/,
    load: () => hrHas('hr-claim-header-save') ? import('../configs/hrClaimHeaderForm') : import('../configs/hrClaimDetail'),
  },
  {
    pattern: /^\/dashboard\/hr\/me\/claims$/,
    load: () => hrHas('hr-claim-header-save') ? import('../configs/hrClaimHeaderForm') : import('../configs/hrMyClaims'),
  },
  {
    pattern: /^\/dashboard\/hr\/travel$/,
    load: () => import('../configs/hrTravelAdmin'),
  },
  {
    pattern: /^\/dashboard\/hr\/visitors$/,
    load: () => hrHas('hr-visitor-form-save') ? import('../configs/hrVisitorForm')
      : hrHas('hr-visitor-checkin-save') ? import('../configs/hrVisitorCheckIn')
        : hrHas('hr-visitors-board-date') ? import('../configs/hrVisitorsBoard')
          : import('../configs/hrVisitorsList'),
  },
]

// ── hr-a: dashboard, employees, my profile, lifecycle, masters, org chart ──

// HR Masters swaps its section (Designations / Grades / Shifts / Leave Types /
// Checklist Templates) in place via pills — probe which panel is on screen.
const loadHrMastersSection = () =>
  hrHas('hr-mst-grade-section') ? import('../configs/hrMastersGrades')
    : hrHas('hr-mst-shift-section') ? import('../configs/hrMastersShifts')
      : hrHas('hr-mst-lt-section') ? import('../configs/hrMastersLeaveTypes')
        : hrHas('hr-mst-cl-section') ? import('../configs/hrMastersChecklists')
          : import('../configs/hrMastersDesignations')

const HR_A_ENTRIES: TourEntry[] = [
  {
    pattern: /^\/dashboard\/hr$/,
    load: () => import('../configs/hrDashboard'),
  },
  {
    // My HR profile edits inline on the same URL (the "Edit My Details" form).
    pattern: /^\/dashboard\/hr\/me$/,
    load: () => hrHas('hr-me-save-btn') ? import('../configs/hrMyProfileEdit') : import('../configs/hrMyProfile'),
  },
  {
    pattern: /^\/dashboard\/hr\/employees\/[A-Za-z0-9_-]{19}\/edit$/,
    load: () => import('../configs/hrEmployeeForm'),
  },
  {
    pattern: /^\/dashboard\/hr\/employees\/[A-Za-z0-9_-]{19}$/,
    load: () => import('../configs/hrEmployeeDetail'),
  },
  {
    pattern: /^\/dashboard\/hr\/employees$/,
    load: () => import('../configs/hrEmployeesList'),
  },
  {
    pattern: /^\/dashboard\/hr\/org-chart$/,
    load: () => import('../configs/hrOrgChart'),
  },
  {
    pattern: /^\/dashboard\/hr\/lifecycle\/new$/,
    load: () => import('../configs/hrLifecycleForm'),
  },
  {
    // "Edit details" opens inline on the event's own URL.
    pattern: /^\/dashboard\/hr\/lifecycle\/[A-Za-z0-9_-]{19}$/,
    load: () => hrHas('hr-lcd-edit-save-btn') ? import('../configs/hrLifecycleEditForm') : import('../configs/hrLifecycleDetail'),
  },
  {
    pattern: /^\/dashboard\/hr\/lifecycle$/,
    load: () => import('../configs/hrLifecycleList'),
  },
  {
    pattern: /^\/dashboard\/hr\/masters$/,
    load: () => loadHrMastersSection(),
  },
]

export const ENTRIES: TourEntry[] = [...HR_B_ENTRIES, ...HR_A_ENTRIES]
