import 'package:flutter/material.dart';

import '../../modules.dart';
import '../../record_router.dart';
import '../../ui/app_frame.dart';
import '../../ui/widgets.dart';
import 'mt_assets.dart';
import 'mt_common.dart';
import 'mt_contracts.dart';
import 'mt_dashboard.dart';
import 'mt_reports.dart';
import 'mt_requests.dart';
import 'mt_scan.dart';
import 'mt_schedule.dart';
import 'mt_settings.dart';
import 'mt_spares.dart';
import 'mt_work_orders.dart';

/// Maintenance - native copy of frontend/src/app/dashboard/maintenance/.
/// Tabs follow MaintenanceNav: production supervisors without the
/// maintenance app only get their own Requests; Settings is the gear.
class MaintenanceModuleHome extends StatelessWidget {
  const MaintenanceModuleHome({super.key, required this.module, this.initialTabLabel});
  final ErpModule module;

  /// Tab to open first (links from alerts / approvals); null = the first tab.
  final String? initialTabLabel;

  @override
  Widget build(BuildContext context) => startOnTab(_scaffold(context), initialTabLabel);

  ModuleScaffold _scaffold(BuildContext context) {
    final mt = Mt.isMaintenanceUser;
    bool show(String key) => (mt || key == 'requests') && Mt.tab(key);
    return ModuleScaffold(
      module: module,
      topActions: [
        IconButton(
          tooltip: 'Find asset by tag code',
          icon: const Icon(Icons.qr_code_2_rounded),
          onPressed: () => openScreen(context, const AssetScanScreen()),
        ),
        if (mt && Mt.tab('settings'))
          IconButton(
            tooltip: 'Maintenance settings',
            icon: const Icon(Icons.settings_outlined),
            onPressed: () => openScreen(context, const MaintenanceSettingsScreen()),
          ),
      ],
      tabs: [
        ModuleTab(label: 'Dashboard', icon: Icons.grid_view_rounded, visible: show('dashboard'), builder: (_) => const MaintenanceDashboard()),
        ModuleTab(label: 'Requests', icon: Icons.warning_amber_rounded, visible: show('requests'), builder: (_) => const RequestsList()),
        ModuleTab(label: 'Work Orders', icon: Icons.build_outlined, visible: show('work_orders'), builder: (_) => const WorkOrdersList()),
        ModuleTab(label: 'Assets', icon: Icons.factory_outlined, visible: show('assets'), builder: (_) => const AssetsList()),
        ModuleTab(label: 'PM Schedule', icon: Icons.calendar_month_outlined, visible: show('schedule'), builder: (_) => const ScheduleTab()),
        ModuleTab(label: 'Spares', icon: Icons.inventory_2_outlined, visible: show('spares'), builder: (_) => const SparesList()),
        ModuleTab(
          label: 'AMC & Warranty',
          icon: Icons.shield_outlined,
          // A feature of Assets (maintenance:assets.contracts) - needs that feature's View too.
          visible: show('assets') && Mt.feat('assets', 'contracts'),
          builder: (_) => const ContractsList(),
        ),
        ModuleTab(label: 'Reports', icon: Icons.bar_chart_rounded, visible: show('reports'), builder: (_) => const ReportsTab()),
      ],
    );
  }
}
