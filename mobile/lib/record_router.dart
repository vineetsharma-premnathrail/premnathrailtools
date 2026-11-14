import 'package:flutter/material.dart';

import 'api/api.dart';
import 'modules.dart';
import 'ui/app_frame.dart';
import 'modules/crm/crm_dashboard.dart' as crm;
import 'modules/crm/crm_inquiry_detail.dart' as crm;
import 'modules/crm/crm_module.dart' as crm;
import 'modules/crm/crm_organizations.dart' as crm;
import 'modules/crm/crm_record_tabs.dart' as crm;
import 'modules/design/design_boms.dart' as design;
import 'modules/design/design_changes.dart' as design;
import 'modules/design/design_documents.dart' as design;
import 'modules/design/design_requests.dart' as design;
import 'modules/design/design_reviews.dart' as design;
import 'modules/electrical/electrical_module.dart' as elec;
import 'modules/erp/erp_module.dart' as erp;
import 'modules/erp/sr_detail.dart' as erp;
import 'modules/finance/finance_module.dart' as fin;
import 'modules/home/my_approvals_screen.dart' as home;
import 'modules/home/my_tasks_screen.dart' as home;
import 'modules/hr/assets.dart' as hr;
import 'modules/hr/attendance.dart' as hr;
import 'modules/hr/claims.dart' as hr;
import 'modules/hr/hr_module.dart' as hr;
import 'modules/hr/leave.dart' as hr;
import 'modules/hr/lifecycle_detail.dart' as hr;
import 'modules/hr/safety.dart' as hr;
import 'modules/hr/travel.dart' as hr;
import 'modules/hydraulic/hyd_bom.dart' as hyd;
import 'modules/hydraulic/hyd_circuits.dart' as hyd;
import 'modules/hydraulic/hyd_testing.dart' as hyd;
import 'modules/maintenance/maintenance_module.dart' as mt;
import 'modules/maintenance/mt_assets.dart' as mt;
import 'modules/maintenance/mt_requests.dart' as mt;
import 'modules/maintenance/mt_schedule.dart' as mt;
import 'modules/maintenance/mt_work_orders.dart' as mt;
import 'modules/organization/organization_module.dart' as org;
import 'modules/organization/role_detail.dart' as org;
import 'modules/p2p/p2p_module.dart' as p2p;
import 'modules/p2p/pr_detail.dart' as p2p;
import 'modules/p2p/purchase_orders.dart' as p2p;
import 'modules/production/bom.dart' as prod;
import 'modules/production/rrv.dart' as prod;
import 'modules/production/work_orders.dart' as prod;
import 'modules/projects/department_work.dart' as pm;
import 'modules/projects/machine_screen.dart' as pm;
import 'modules/projects/project_workspace.dart' as pm;
import 'modules/quality/quality_capa.dart' as qa;
import 'modules/quality/quality_complaints.dart' as qa;
import 'modules/quality/quality_final_inspection.dart' as qa;
import 'modules/quality/quality_first_articles.dart' as qa;
import 'modules/quality/quality_inspection_calls.dart' as qa;
import 'modules/quality/quality_lots.dart' as qa;
import 'modules/quality/quality_module.dart' as qa;
import 'modules/quality/quality_ncr.dart' as qa;
import 'modules/quality/quality_plans.dart' as qa;
import 'modules/quality/quality_supplier.dart' as qa;
import 'modules/rnd/rnd_module.dart' as rnd;
import 'modules/rnd/rnd_projects.dart' as rnd;
import 'modules/rnd/rnd_requirements.dart' as rnd;
import 'modules/store/store_adjust.dart' as store;
import 'modules/store/store_grn.dart' as store;
import 'modules/store/store_inward.dart' as store;
import 'modules/store/store_items.dart' as store;
import 'modules/store/store_outward.dart' as store;

/// Opens a portal page path (what a notification, approval or e-mail link
/// points at - `/dashboard/<module>/...`) on the matching NATIVE screen.
///
/// Signed record refs in the path are turned back into ids with
/// `GET /refs/{ref}` when the screen needs one. Returns false only when the
/// app has no native screen for the page (the caller then offers the web
/// portal). Throws a readable message when the link is broken or the
/// record can't be reached - show it with ApiClient.describe.
Future<bool> openPortalLink(BuildContext context, String path) async {
  final target = await _resolve(path);
  if (target == null || !context.mounted) return false;
  await Navigator.of(context).push(MaterialPageRoute(builder: (_) => target));
  return true;
}

/// A module home opened on the tab with [label] (visible tabs only); the
/// first tab when the user can't see that tab.
ModuleScaffold startOnTab(ModuleScaffold s, String? label) {
  if (label == null) return s;
  final i = s.tabs.where((t) => t.visible).toList().indexWhere((t) => t.label == label);
  if (i < 0) return s;
  return ModuleScaffold(key: s.key, module: s.module, tabs: s.tabs, topActions: s.topActions, initialTab: i);
}

// ── Resolution ──────────────────────────────────────────────────────────────

/// Record id from a path segment: a plain number, or a signed ref.
Future<int> _id(String seg) async {
  final n = int.tryParse(seg);
  if (n != null) return n;
  dynamic d;
  try {
    d = await Api.get('/refs/${Uri.encodeComponent(seg)}');
  } catch (e) {
    throw 'This link no longer opens a record - it may have been changed or the record removed. '
        'Open it from its list instead. (${ApiClient.describe(e)})';
  }
  final id = d is Map ? d['id'] : null;
  if (id is int) return id;
  throw 'This link is invalid - it was changed or copied incompletely. Open the record from its list instead.';
}

ErpModule? _module(String key) {
  for (final m in erpModules) {
    if (m.key == key) return m;
  }
  return null;
}

/// Module home, optionally on a tab (only modules that take a start tab).
Widget? _home(String key, [String? tab]) {
  final m = _module(key);
  if (m == null) return null;
  switch (key) {
    case 'finance':
      return fin.FinanceModuleHome(module: m, initialTabLabel: tab);
    case 'organization':
      return org.OrganizationModuleHome(module: m, initialTabLabel: tab);
    case 'quality':
      return qa.QualityModuleHome(module: m, initialTabLabel: tab);
    case 'maintenance':
      return mt.MaintenanceModuleHome(module: m, initialTabLabel: tab);
    case 'hr':
      return hr.HrModuleHome(module: m, initialTabLabel: tab);
    case 'erp':
      return erp.ServiceModuleHome(module: m, initialTabLabel: tab);
    case 'p2p':
      return p2p.ProcurementModuleHome(module: m, initialTabLabel: tab);
    case 'crm':
      return crm.CrmModuleHome(module: m, initialTabLabel: tab);
    case 'rnd':
      return rnd.RndModuleHome(module: m, initialTabLabel: tab);
  }
  return m.screen(m);
}

/// A self-service page (My HR ...) on its own screen.
Widget _page(String title, Widget body) => SubPage(title: title, body: body);

Future<Widget?> _resolve(String path) async {
  final uri = Uri.tryParse(path.trim());
  if (uri == null) return null;
  final seg = uri.pathSegments.where((s) => s.isNotEmpty).toList();
  if (seg.isEmpty || seg[0] != 'dashboard') return null;
  if (seg.length == 1) return null; // the Dashboard itself - the caller is already in the app
  final module = seg[1];
  final rest = seg.sublist(2);
  final q = uri.queryParameters;
  String? at(int i) => i < rest.length ? rest[i] : null;

  switch (module) {
    case 'approvals':
      return const home.MyApprovalsScreen();

    case 'erp':
      switch (at(0)) {
        case null:
          return _home('erp');
        case 'service-requests':
          return at(1) == null ? _home('erp', 'Service Requests') : erp.SrDetailScreen(srId: await _id(at(1)!));
        case 'service-contracts':
          return _home('erp', 'Contracts');
        case 'recycle-bin':
          return _home('erp', 'Recycle Bin');
        case 'reports':
          return _home('erp', 'Reports');
      }
      return null;

    case 'rnd':
      switch (at(0)) {
        case null:
          return _home('rnd');
        case 'requirements':
          final source = at(1);
          if (source == null || at(2) == null) return _home('rnd', 'Requirements');
          return rnd.RequirementDetailScreen(source: source, recordId: await _id(at(2)!));
        case 'projects':
          return at(1) == null ? _home('rnd') : rnd.ProjectDetailScreen(projectId: await _id(at(1)!));
        case 'project-tasks':
          return at(1) == null ? _home('rnd') : rnd.PmProjectTasksScreen(pmProjectId: await _id(at(1)!));
        case 'tasks':
          return _home('rnd');
      }
      // Calculators, prototypes, experiments: web only.
      return null;

    case 'crm':
      switch (at(0)) {
        case null:
          return _home('crm');
        case 'inquiries':
          return at(1) == null
              ? _home('crm', 'Inquiries & Tenders')
              : crm.CrmRecordScreen(kind: crm.CrmKind.inquiry, id: await _id(at(1)!), initialTab: _crmTab(q['tab']));
        case 'tenders':
          return at(1) == null
              ? _home('crm', 'Inquiries & Tenders')
              : crm.CrmRecordScreen(kind: crm.CrmKind.tender, id: await _id(at(1)!), initialTab: _crmTab(q['tab']));
        case 'organizations':
          return at(1) == null ? _home('crm', 'Customer Organizations') : crm.OrganizationScreen(id: await _id(at(1)!));
        case 'quotations':
          if (at(1) == null) return _home('crm', 'Inquiries & Tenders');
          final quote = await Api.get('/crm/quotations/${await _id(at(1)!)}');
          final inquiryId = quote is Map ? quote['inquiry_id'] : null;
          if (inquiryId is! int) return _home('crm', 'Inquiries & Tenders');
          return crm.CrmRecordScreen(kind: crm.CrmKind.inquiry, id: inquiryId, initialTab: 'Quotations');
        case 'followups':
          return crm.FollowUpsScreen(bucket: q['bucket'] ?? 'open');
        case 'products':
          return _home('crm', 'Products');
        case 'reports':
          return _home('crm', 'Reports');
      }
      return null;

    case 'p2p':
      switch (at(0)) {
        case null:
          return _home('p2p');
        case 'purchase-orders':
          if (at(1) == null) return _home('p2p', 'Purchase Orders');
          if (at(1) == 'amendments') return null; // PO amendments: web only
          final poId = await _id(at(1)!);
          final po = await Api.get('/p2p/purchase-orders/$poId');
          final pr = po is Map ? po['p2p_request_id'] : null;
          if (pr is int) return p2p.PrDetailScreen(prId: pr, contextKey: 'po-approval', poId: poId);
          return p2p.PoTrackingDetailScreen(row: {if (po is Map) ...Map<String, dynamic>.from(po), 'po_id': poId});
        case 'vendors':
          return _home('p2p', 'Vendors');
        case 'rfq':
          return _home('p2p', 'R.F.Q');
        case 'my-lines':
          return _home('p2p', 'My Lines');
        case 'item-rates':
          return _home('p2p', 'Item Rates');
        case 'mis':
          return _home('p2p', 'M.I.S Report');
        case 'requisitions':
          return _home('p2p', 'Purchase Requisitions');
      }
      // /dashboard/p2p/<ref> = one requisition.
      return p2p.PrDetailScreen(prId: await _id(at(0)!), contextKey: q['from']);

    case 'store':
      switch (at(0)) {
        case null:
          return _home('store');
        case 'adjustments':
          return at(1) == null ? _home('store') : store.AdjustmentDetailScreen(adjustmentId: await _id(at(1)!));
        case 'returns':
          return at(1) == null ? _home('store') : store.ReturnDetailScreen(returnId: await _id(at(1)!));
        case 'transfers':
          return at(1) == null ? _home('store') : store.TransferDetailScreen(transferId: await _id(at(1)!));
        case 'issues':
          return at(1) == null ? _home('store') : store.IssueDetailScreen(issueId: await _id(at(1)!));
        case 'grn':
          return at(1) == null ? _home('store') : store.GrnDetailScreen(grnId: await _id(at(1)!));
        case 'before-po':
          return at(1) == null ? _home('store') : store.BeforePoDetailScreen(receiptId: await _id(at(1)!));
        case 'items':
        case 'inventory':
        case 'inward':
        case 'outward':
        case 'settings':
          return _home('store');
      }
      // /dashboard/store/<ref> = one item.
      return store.ItemDetailScreen(itemId: await _id(at(0)!));

    case 'projects':
      switch (at(0)) {
        case null:
        case 'all':
        case 'board':
        case 'department':
          return _home('projects');
        case 'my-tasks':
          return const home.MyTasksScreen();
        case 'service-projects':
          return at(1) == null ? _home('projects') : pm.MachineScreen(machineId: await _id(at(1)!));
        case 'milestones':
          return at(1) == null ? _home('projects') : pm.MilestoneWorkspaceScreen(milestoneId: await _id(at(1)!));
        case 'tasks':
          return at(1) == null ? _home('projects') : pm.WorkTaskScreen(taskId: await _id(at(1)!));
      }
      final tab = q['tab'];
      return pm.ProjectWorkspaceScreen(
          projectId: await _id(at(0)!),
          initialTab: tab == null || tab.isEmpty ? null : tab[0].toUpperCase() + tab.substring(1));

    case 'finance':
      const tabs = {
        'masters': 'Masters',
        'ledger': 'Journals',
        'journals': 'Journals',
        'purchase': 'Purchase',
        'sales': 'Sales',
        'payments': 'Payments',
        'banking': 'Bank & Cash',
        'gst': 'GST',
        'outstanding': 'Outstanding',
        'inventory': 'Inventory',
        'assets': 'Assets',
        'currencies': 'Currencies & FX',
        'reports': 'Reports',
        'controlling': 'Controlling',
        'costing': 'Costing & Profitability',
      };
      return _home('finance', tabs[at(0)]);

    case 'organization':
      const tabs = {
        'info': 'Info',
        'branches': 'Branches',
        'department': 'Department',
        'users': 'Users',
        'roles': 'Role & Permissions',
        'workflows': 'Approval Workflows',
        'delegations': 'Delegations',
        'security': 'Security & Sessions',
        'audit-logs': 'Audit Logs',
        'access-reviews': 'Access Reviews',
        'grc': 'Access Risk (SoD)',
        'monitor': 'System Monitor',
        'cockpit': 'Cockpit',
      };
      if (at(0) == 'roles' && at(1) != null) return org.RoleDetailScreen(roleId: await _id(at(1)!));
      if (at(0) == 'approvals') return const home.MyApprovalsScreen();
      return _home('organization', tabs[at(0)]);

    case 'production':
      switch (at(0)) {
        case 'bom':
          if (at(1) != null) return prod.BomDetail(id: await _id(at(1)!));
        case 'work-orders':
          if (at(1) != null) return prod.WorkOrderDetail(id: await _id(at(1)!));
        case 'rrv-builds':
          if (at(1) != null) return prod.RrvBuildDetail(id: await _id(at(1)!));
      }
      return _home('production');

    case 'maintenance':
      switch (at(0)) {
        case null:
          return _home('maintenance');
        case 'requests':
          return at(1) == null ? _home('maintenance', 'Requests') : mt.RequestDetailScreen(id: await _id(at(1)!));
        case 'work-orders':
          return at(1) == null ? _home('maintenance', 'Work Orders') : mt.WorkOrderDetailScreen(id: await _id(at(1)!));
        case 'schedule':
          return at(1) == null ? _home('maintenance', 'PM Schedule') : mt.PmPlanDetailScreen(id: await _id(at(1)!));
        case 'assets':
          return at(1) == null ? _home('maintenance', 'Assets') : mt.AssetDetailScreen(id: await _id(at(1)!));
        case 'spares':
          return _home('maintenance', 'Spares');
        case 'contracts':
          return _home('maintenance', 'AMC & Warranty');
        case 'reports':
          return _home('maintenance', 'Reports');
      }
      return _home('maintenance');

    case 'electrical':
      if (at(0) == 'approval' && at(1) != null && at(2) != null) {
        return elec.ElectricalApprovalLinkScreen(entityType: at(1)!, ref: at(2)!);
      }
      if (at(0) == 'jobs' && at(1) != null) return elec.ElectricalJobScreen(jobId: await _id(at(1)!));
      return _home('electrical');

    case 'hydraulic':
      switch (at(0)) {
        case 'circuits':
          if (at(1) != null) return hyd.HydCircuitDetail(id: await _id(at(1)!));
        case 'bom':
          if (at(1) != null) return hyd.HydBomDetail(id: await _id(at(1)!));
        case 'testing':
          if (at(1) != null) return hyd.HydTestDetail(id: await _id(at(1)!));
      }
      return _home('hydraulic');

    case 'hr':
      switch (at(0)) {
        case null:
          return _home('hr');
        case 'approvals':
          return _home('hr', 'Approvals');
        case 'me':
          switch (at(1)) {
            case 'leave':
              return _page('My Leave', const hr.MyLeavePage());
            case 'attendance':
              return _page('My Attendance', const hr.MyAttendancePage());
            case 'assets':
              return _page('My Assets', const hr.MyAssetsPage());
            case 'claims':
              if (at(2) != null) return hr.ClaimDetailScreen(claimId: await _id(at(2)!));
              return _page('My Claims', const hr.MyClaimsPage());
            case 'travel':
              return Builder(
                builder: (ctx) => _page(
                  'My Travel',
                  hr.MyTravelPage(openClaims: () => openScreenRoute(ctx, _page('My Claims', const hr.MyClaimsPage()))),
                ),
              );
          }
          return _home('hr', 'My HR');
        case 'lifecycle':
          return at(1) == null ? _home('hr', 'Lifecycle') : hr.LifecycleDetailScreen(eventId: await _id(at(1)!));
        case 'safety':
          return at(1) == null ? _home('hr', 'Safety') : hr.IncidentDetailScreen(id: await _id(at(1)!));
        case 'visitors':
          return _home('hr', 'Visitors');
        case 'attendance':
          return _home('hr', 'Attendance');
        case 'leave':
          return _home('hr', 'Leave');
        case 'employees':
          return _home('hr', 'Employees');
        case 'travel':
          return _home('hr', 'Travel & Claims');
        case 'assets':
          return _home('hr', 'Assets');
      }
      return _home('hr');

    case 'quality':
      final id = at(1) == null ? null : await _id(at(1)!);
      switch (at(0)) {
        case null:
          return _home('quality');
        case 'ncr':
          return id == null ? _home('quality', 'NCR') : qa.NcrDetailScreen(id: id);
        case 'inspection-plans':
          return id == null ? _home('quality', 'Inspection Plans') : qa.InspectionPlanDetailScreen(id: id);
        case 'supplier-quality':
          return id == null ? _home('quality', 'Supplier Quality') : qa.AvlDetailScreen(id: id);
        case 'capa':
          return id == null ? _home('quality', 'CAPA') : qa.CapaDetailScreen(id: id);
        case 'complaints':
          return id == null ? _home('quality', 'Complaints') : qa.ComplaintDetailScreen(id: id);
        case 'lots':
          return id == null ? _home('quality', 'Inspection Lots') : qa.LotDetailScreen(id: id);
        case 'first-articles':
          return id == null ? _home('quality', 'First Article') : qa.FirstArticleDetailScreen(id: id);
        case 'inspection-calls':
          return id == null ? _home('quality', 'Inspection Calls') : qa.InspectionCallDetailScreen(id: id);
        case 'final-inspection':
          return id == null ? _home('quality', 'RRV Final Inspections') : qa.FinalInspectionDetailScreen(id: id);
        case 'gauges':
          return _home('quality', 'Gauges');
        case 'standards':
          return _home('quality', 'Standards');
        case 'documents':
          return _home('quality', 'Documents');
        case 'reports':
          return _home('quality', 'Reports');
      }
      return _home('quality');

    case 'design':
      final id = at(1) == null || at(0) == 'reviews' ? null : await _id(at(1)!);
      switch (at(0)) {
        case 'documents':
          if (id != null) return design.DesignDocumentDetail(id: id);
        case 'change-notices':
          if (id != null) return design.DesignChangeNoticeDetail(id: id);
        case 'boms':
          if (id != null) return design.DesignBomDetail(id: id);
        case 'change-requests':
          if (id != null) return design.DesignChangeRequestDetail(id: id);
        case 'requests':
          if (id != null) return design.DesignRequestDetail(id: id);
        case 'reviews':
          if (at(1) == 'submissions' && at(2) != null) {
            return design.DesignSubmissionDetail(id: await _id(at(2)!));
          }
      }
      return _home('design');
  }
  // Retired pages (Sales) and anything unknown: no native screen.
  return null;
}

/// CRM record tab from the portal's ?tab= value.
String? _crmTab(String? tab) => switch (tab) {
      'quotations' => 'Quotations',
      'offers' || 'technical-offers' => 'Technical Offers',
      _ => null,
    };

void openScreenRoute(BuildContext context, Widget screen) =>
    Navigator.of(context).push(MaterialPageRoute(builder: (_) => screen));
