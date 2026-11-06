import '../../api/api.dart';

/// Where a notification opens in the portal - a copy of NotificationBell's
/// link rules (frontend/src/components/erp/NotificationBell.tsx and
/// hr/hrNotificationLink.ts). Paths use the signed record ref
/// (entity_id_ref) the API sends beside entity_id, never the raw id.

typedef _Link = String Function(String ref);

const myApprovalsPath = '/dashboard/approvals';
const myTasksPath = '/dashboard/projects/my-tasks';

final Map<String, _Link> _typeLink = {
  'p2p_po_approval_pending': (r) => '/dashboard/p2p/$r?from=po-approval',
  'p2p_po_approved': (r) => '/dashboard/p2p/$r?from=po-approval',
  'pm_project_task': (r) => '/dashboard/projects/$r?tab=Milestones',
  'pm_dept_task': (_) => myTasksPath,
  'pm_subtask': (_) => myTasksPath,
  'pm_task_remark': (_) => myTasksPath,
  'pm_goal_due_soon': (_) => myTasksPath,
  'pm_goal_due_today': (_) => myTasksPath,
  'pm_goal_overdue': (_) => myTasksPath,
  'pm_project_task_done': (r) => '/dashboard/projects/$r?tab=Milestones',
  'req_mention_crm_inquiry': (r) => '/dashboard/crm/inquiries/$r',
  'req_mention_crm_tender': (r) => '/dashboard/crm/tenders/$r',
  'req_mention_rnd_inquiry': (r) => '/dashboard/rnd/requirements/inquiry/$r',
  'req_mention_rnd_tender': (r) => '/dashboard/rnd/requirements/tender/$r',
  'hr_approval_rerouted': (_) => '/dashboard/hr/approvals',
};

final Map<String, _Link> _entityLink = {
  'access_review': (_) => '/dashboard/organization/access-reviews',
  'job_run': (_) => '/dashboard/organization/monitor',
  'p2p_request': (r) => '/dashboard/p2p/$r?from=approval',
  'p2p_purchase_order': (r) => '/dashboard/p2p/purchase-orders/$r',
  'hyd_circuit': (r) => '/dashboard/hydraulic/circuits/$r',
  'hyd_bom': (r) => '/dashboard/hydraulic/bom/$r',
  'hyd_test': (r) => '/dashboard/hydraulic/testing/$r',
  'electrical_drawing_revision': (r) => '/dashboard/electrical/approval/electrical_drawing_revision/$r',
  'electrical_bom_item': (r) => '/dashboard/electrical/approval/electrical_bom_item/$r',
  'service_request': (r) => '/dashboard/erp/service-requests/$r',
  'project': (r) => '/dashboard/projects/service-projects/$r',
  'erp_machine': (r) => '/dashboard/projects/service-projects/$r',
  'organization': (r) => '/dashboard/crm/organizations/$r',
  'inquiry': (r) => '/dashboard/crm/inquiries/$r',
  'rnd_req_inquiry': (r) => '/dashboard/rnd/requirements/inquiry/$r',
  'rnd_req_tender': (r) => '/dashboard/rnd/requirements/tender/$r',
  'design_rnd_requirement': (_) => '/dashboard/design',
  'electrical_rnd_requirement': (_) => '/dashboard/electrical',
  'hydraulic_rnd_requirement': (_) => '/dashboard/hydraulic',
  'tender': (r) => '/dashboard/crm/tenders/$r',
  'activity': (_) => '/dashboard/crm/followups',
  'design_document': (r) => '/dashboard/design/documents/$r',
  'design_ecn': (r) => '/dashboard/design/change-notices/$r',
  'design_bom': (r) => '/dashboard/design/boms/$r',
  'maintenance_request': (r) => '/dashboard/maintenance/requests/$r',
  'maintenance_work_order': (r) => '/dashboard/maintenance/work-orders/$r',
  'maintenance_pm_plan': (r) => '/dashboard/maintenance/schedule/$r',
  'maintenance_spare': (_) => '/dashboard/maintenance/spares',
  'maintenance_asset': (r) => '/dashboard/maintenance/assets/$r',
  'sales_order': (_) => '/dashboard/sales',
  'sales_amendment': (_) => '/dashboard/sales',
  'crm_quotation': (r) => '/dashboard/crm/quotations/$r',
  'sales_extension': (_) => '/dashboard/sales',
  'pm_project': (r) => '/dashboard/projects/$r',
  'pm_milestone': (r) => '/dashboard/projects/milestones/$r',
  'pm_task': (r) => '/dashboard/projects/tasks/$r',
  'stock_adjustment': (r) => '/dashboard/store/adjustments/$r',
  'material_return': (r) => '/dashboard/store/returns/$r',
  'store_pre_po_receipt': (_) => '/dashboard/p2p/purchase-orders?view=before_po',
  'production_bom': (r) => '/dashboard/production/bom/$r',
  'production_work_order': (r) => '/dashboard/production/work-orders/$r',
  'production_rrv_build': (r) => '/dashboard/production/rrv-builds/$r',
  'quality_ncr': (r) => '/dashboard/quality/ncr/$r',
  'quality_inspection_plan': (r) => '/dashboard/quality/inspection-plans/$r',
  'quality_approved_vendor': (r) => '/dashboard/quality/supplier-quality/$r',
  'quality_capa': (r) => '/dashboard/quality/capa/$r',
  'quality_complaint': (r) => '/dashboard/quality/complaints/$r',
  'quality_inspection_lot': (r) => '/dashboard/quality/lots/$r',
  'quality_first_article': (r) => '/dashboard/quality/first-articles/$r',
  'quality_inspection_call': (r) => '/dashboard/quality/inspection-calls/$r',
  'accounts_journal_entry': (_) => '/dashboard/finance/ledger',
  'accounts_vendor_invoice': (_) => '/dashboard/finance/purchase',
  'accounts_ar_transaction': (_) => '/dashboard/finance/sales',
  'accounts_party_note': (_) => myApprovalsPath,
  'accounts_period_close': (_) => '/dashboard/finance/ledger',
  'accounts_depreciation_run': (_) => '/dashboard/finance/assets',
  'accounts_year_end_close': (_) => '/dashboard/finance/reports',
  'accounts_bank_guarantee': (_) => '/dashboard/finance/banking?tab=guarantees',
  'accounts_payment': (_) => '/dashboard/finance/payments',
  'accounts_payment_proposal': (_) => '/dashboard/finance/payments/runs',
  'accounts_credit_release': (_) => '/dashboard/finance/outstanding/credit',
  'accounts_collection_note': (_) => '/dashboard/finance/outstanding/collections',
  'accounts_dispute': (_) => '/dashboard/finance/outstanding/disputes',
  'accounts_internal_order': (_) => '/dashboard/finance/masters',
  'inventory_valuation': (_) => '/dashboard/finance/inventory',
  'product_cost_estimate': (_) => '/dashboard/finance/costing',
  'stock_transfer': (r) => '/dashboard/store/transfers/$r',
  'store_material_issue': (r) => '/dashboard/store/issues/$r',
  'p2p_goods_receipt': (r) => '/dashboard/store/grn/$r',
  'store_item': (r) => '/dashboard/store/$r',
  'p2p_po_amendment': (r) => '/dashboard/p2p/purchase-orders/amendments/$r',
  'electrical_job': (r) => '/dashboard/electrical/jobs/$r',
  'erp_service_contract': (r) => '/dashboard/erp/service-contracts/$r',
  'design_ecr': (r) => '/dashboard/design/change-requests/$r',
  'design_request': (r) => '/dashboard/design/requests/$r',
  'design_submission': (r) => '/dashboard/design/reviews/submissions/$r',
  'quality_inspection': (r) => '/dashboard/quality/final-inspection/$r',
  'quality_gauge': (_) => '/dashboard/quality/gauges',
  'quality_supplier_scorecard': (_) => '/dashboard/quality/supplier-quality',
  'quality_vendor_audit': (_) => '/dashboard/quality/supplier-quality',
  'rnd_project': (r) => '/dashboard/rnd/projects/$r',
  'rnd_pm_project': (r) => '/dashboard/rnd/project-tasks/$r',
  'rnd_prototype': (r) => '/dashboard/rnd/prototypes/$r',
  'role': (r) => '/dashboard/organization/roles/$r',
  'user': (_) => '/dashboard/organization/users',
  'company': (_) => '/dashboard/organization/info',
};

const _deletedTypeLink = {
  'sr_deleted': '/dashboard/erp/recycle-bin',
  'project_deleted': '/dashboard/erp/recycle-bin',
  'organization_deleted': '/dashboard/crm/organizations',
  'inquiry_deleted': '/dashboard/crm/inquiries?type=inquiry',
  'tender_deleted': '/dashboard/crm/inquiries?type=tender',
};

final Map<String, _Link> _hrEntityLink = {
  'hr_leave_request': (_) => '/dashboard/hr/me/leave',
  'hr_leave_balance': (_) => '/dashboard/hr/me/leave',
  'hr_attendance': (_) => '/dashboard/hr/me/attendance',
  'hr_attendance_regularization': (_) => '/dashboard/hr/me/attendance',
  'hr_travel_request': (_) => '/dashboard/hr/me/travel',
  'hr_expense_claim': (r) => '/dashboard/hr/me/claims/$r',
  'hr_asset': (_) => '/dashboard/hr/me/assets',
  'hr_visitor': (_) => '/dashboard/hr/visitors',
  'hr_lifecycle_event': (r) => '/dashboard/hr/lifecycle/$r',
  'hr_safety_incident': (r) => '/dashboard/hr/safety/$r',
  'hr_overtime': (_) => '/dashboard/hr/me/attendance',
  'hr_attendance_period': (_) => '/dashboard/hr/attendance',
  'hr_employee_profile': (_) => '/dashboard/hr',
  'user_document': (_) => '/dashboard/hr',
};

// Entity links that need the record itself (the rest go to a list page).
const _needsRef = {
  'hr_expense_claim', 'hr_lifecycle_event', 'hr_safety_incident',
};

String? _rndRequirementHref(Json n, String? ref) {
  if (n['entity_id'] == null || ref == null) return null;
  final source = '${n['entity_type'] ?? ''}'.contains('tender') ? 'tender' : 'inquiry';
  switch (n['notification_type']) {
    case 'rnd_requirement_accepted':
    case 'rnd_requirement_returned':
      return source == 'tender' ? '/dashboard/crm/tenders/$ref' : '/dashboard/crm/inquiries/$ref';
    case 'rnd_review_reminder':
      return '/dashboard/rnd/requirements/$source/$ref';
  }
  return null;
}

String? _hrHref(Json n, String? ref) {
  final type = '${n['entity_type'] ?? ''}';
  if (!type.startsWith('hr_') && type != 'user_document') return null;
  final title = '${n['title'] ?? ''}';
  final forApprover = const {'hr_travel_submitted', 'hr_expense_submitted'}.contains(n['notification_type']) ||
      RegExp(r'waiting for you|awaiting your approval|^approval needed:|^escalated:|^overdue approval:', caseSensitive: false)
          .hasMatch(title);
  if (forApprover && type != 'hr_expense_claim') return '/dashboard/hr/approvals';
  final build = _hrEntityLink[type];
  if (build == null || (_needsRef.contains(type) && ref == null)) return null;
  return build(ref ?? '');
}

/// The portal page a notification opens, or null when it has none.
String? alertLink(Json n) {
  final type = '${n['notification_type'] ?? ''}';
  final entity = '${n['entity_type'] ?? ''}';
  final ref = n['entity_id_ref'] is String ? n['entity_id_ref'] as String : null;
  final hasId = n['entity_id'] != null && ref != null;
  return _deletedTypeLink[type] ??
      _rndRequirementHref(n, ref) ??
      (hasId ? _typeLink[type]?.call(ref) : null) ??
      (entity.isNotEmpty && hasId ? _entityLink[entity]?.call(ref) : null) ??
      _hrHref(n, ref) ??
      (type == 'approval' ? myApprovalsPath : null);
}

const _moduleLabels = {
  'approvals': 'My Approvals',
  'erp': 'Service Module',
  'rnd': 'R&D',
  'crm': 'CRM',
  'p2p': 'Procurement',
  'store': 'Store & Inventory',
  'projects': 'Project Management',
  'finance': 'Finance & Accounting',
  'organization': 'Organization',
  'production': 'Production',
  'maintenance': 'Maintenance',
  'electrical': 'Electrical',
  'hydraulic': 'Hydraulic & Pneumatic',
  'hr': 'HR & Admin',
  'quality': 'Quality',
  'design': 'Design',
  'sales': 'Sales',
};

/// Module a portal path belongs to ("Procurement"), or null.
String? moduleOfLink(String? path) {
  if (path == null) return null;
  final parts = path.split('?').first.split('/').where((p) => p.isNotEmpty).toList();
  if (parts.length < 2 || parts[0] != 'dashboard') return null;
  return _moduleLabels[parts[1]];
}
