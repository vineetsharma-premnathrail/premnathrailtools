import 'package:flutter/material.dart';

import '../../modules.dart';
import '../../record_router.dart';
import '../../ui/app_frame.dart';
import 'approvals.dart';
import 'assets.dart';
import 'attendance_admin.dart';
import 'dashboard.dart';
import 'employees.dart';
import 'holidays.dart';
import 'hr_common.dart';
import 'leave_admin.dart';
import 'lifecycle.dart';
import 'my_hr.dart';
import 'org_chart.dart';
import 'reports.dart';
import 'safety.dart';
import 'travel.dart';
import 'visitors.dart';

/// HR & Administration - native copy of frontend/src/app/dashboard/hr/.
/// Tabs and their gating follow components/hr/HrNav.tsx: HR-management tabs
/// need the hr app and their sub-tab in tab_access; My HR, Approvals, Org
/// Chart, Holidays and Safety are self-service.
class HrModuleHome extends StatelessWidget {
  const HrModuleHome({super.key, required this.module, this.initialTabLabel});
  final ErpModule module;

  /// Tab to open first (links from alerts / approvals); null = the usual landing tab.
  final String? initialTabLabel;

  @override
  Widget build(BuildContext context) => startOnTab(_scaffold(context), initialTabLabel);

  ModuleScaffold _scaffold(BuildContext context) {
    final hr = isHrUser;
    bool tab(List<String> keys, {bool hrOnly = true}) => (hr || !hrOnly) && hrTabAllowed(keys);
    void goTo(BuildContext ctx, String label) => ModuleScaffold.goToTab(ctx, label);
    return ModuleScaffold(
      module: module,
      // Portal lands HR staff on the Dashboard, everyone else on My HR.
      initialTab: 0,
      topActions: [
        if (tab(['settings']))
          IconButton(
            tooltip: 'HR settings',
            icon: const Icon(Icons.settings_outlined),
            onPressed: () => openPortal(context, '/dashboard/hr/settings'),
          ),
      ],
      tabs: [
        ModuleTab(label: 'Dashboard', icon: Icons.dashboard_outlined, visible: tab(['dashboard']),
            builder: (ctx) => HrDashboardPage(goTo: (l) => goTo(ctx, l))),
        ModuleTab(label: 'My HR', icon: Icons.person_outline_rounded, visible: tab(['me'], hrOnly: false), builder: (_) => const MyHrPage()),
        ModuleTab(label: 'Approvals', icon: Icons.verified_outlined, visible: tab(['approvals', 'me'], hrOnly: false), builder: (_) => const HrApprovalsPage()),
        ModuleTab(label: 'Employees', icon: Icons.groups_outlined, visible: tab(['employees']),
            builder: (ctx) => EmployeesPage(openOrgChart: () => goTo(ctx, 'Org Chart'))),
        ModuleTab(label: 'Org Chart', icon: Icons.account_tree_outlined, visible: tab(['org_chart', 'me'], hrOnly: false),
            builder: (ctx) => OrgChartPage(openEmployees: () => goTo(ctx, 'Employees'))),
        ModuleTab(label: 'Lifecycle', icon: Icons.sync_alt_rounded, visible: tab(['lifecycle']), builder: (_) => const LifecyclePage()),
        ModuleTab(label: 'Leave', icon: Icons.event_busy_outlined, visible: tab(['leave']), builder: (_) => const HrLeavePage()),
        ModuleTab(label: 'Attendance', icon: Icons.schedule_rounded, visible: tab(['attendance']), builder: (_) => const HrAttendancePage()),
        ModuleTab(label: 'Holidays', icon: Icons.celebration_outlined, visible: tab(['holidays', 'me'], hrOnly: false), builder: (_) => const HolidaysPage()),
        ModuleTab(label: 'Assets', icon: Icons.laptop_outlined, visible: tab(['assets']), builder: (_) => const HrAssetsPage()),
        ModuleTab(label: 'Visitors', icon: Icons.badge_outlined, visible: tab(['visitors']), builder: (_) => const VisitorsPage()),
        ModuleTab(label: 'Travel & Claims', icon: Icons.flight_takeoff_rounded, visible: tab(['travel']), builder: (_) => const HrTravelPage()),
        ModuleTab(label: 'Safety', icon: Icons.health_and_safety_outlined, visible: tab(['safety', 'me'], hrOnly: false), builder: (_) => const SafetyPage()),
        ModuleTab(label: 'Reports', icon: Icons.bar_chart_rounded, visible: tab(['reports']), builder: (_) => const HrReportsPage()),
        ModuleTab(label: 'Masters', icon: Icons.storage_outlined, visible: tab(['masters']),
            builder: (_) => const _PortalTab(
                  title: 'Masters',
                  message: 'Grades, designations, shifts, leave types and checklist templates are HR set-up tables, maintained on the web portal.',
                  path: '/dashboard/hr/masters',
                )),
      ],
    );
  }
}

class _PortalTab extends StatelessWidget {
  const _PortalTab({required this.title, required this.message, required this.path});
  final String title;
  final String message;
  final String path;

  @override
  Widget build(BuildContext context) => ListView(padding: const EdgeInsets.only(top: 16), children: [
        PortalOnlyCard(title: title, message: message, path: path),
      ]);
}