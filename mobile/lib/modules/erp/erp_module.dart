import 'package:flutter/material.dart';

import '../../modules.dart';
import '../../ui/app_frame.dart';
import '../../ui/widgets.dart';
import 'dashboard_tab.dart';
import 'erp_common.dart';
import 'recycle_bin_tab.dart';
import 'reports_tab.dart';
import 'service_requests_tab.dart';
import 'settings_screen.dart';

/// Service Module - native copy of frontend/src/app/dashboard/erp/ with the
/// portal's ErpNav tabs (Dashboard, Service Requests, Contracts, Reports,
/// Recycle Bin) and Settings as the gear next to the bell.
class ServiceModuleHome extends StatefulWidget {
  const ServiceModuleHome({super.key, required this.module});
  final ErpModule module;

  @override
  State<ServiceModuleHome> createState() => _ServiceModuleHomeState();
}

class _ServiceModuleHomeState extends State<ServiceModuleHome> {
  // Bumped to jump to the Service Requests tab from the Dashboard's "View all".
  int _initial = 0;
  int _key = 0;

  @override
  Widget build(BuildContext context) {
    final tabs = <ModuleTab>[
      ModuleTab(
        label: 'Dashboard',
        icon: Icons.grid_view_rounded,
        visible: ErpPerm.tabVisible('dashboard'),
        builder: (_) => ServiceDashboardTab(onViewAll: () {
          setState(() {
            _initial = 1;
            _key++;
          });
        }),
      ),
      ModuleTab(
        label: 'Service Requests',
        icon: Icons.description_outlined,
        visible: ErpPerm.tabVisible('service_requests'),
        builder: (_) => const ServiceRequestsTab(),
      ),
      ModuleTab(
        label: 'Contracts',
        icon: Icons.verified_user_outlined,
        visible: ErpPerm.tabVisible('service_contracts'),
        builder: (_) => const _ContractsUpcoming(),
      ),
      ModuleTab(
        label: 'Reports',
        icon: Icons.bar_chart_rounded,
        visible: ErpPerm.tabVisible('reports'),
        builder: (_) => const ServiceReportsTab(),
      ),
      ModuleTab(
        label: 'Recycle Bin',
        icon: Icons.delete_outline_rounded,
        visible: ErpPerm.tabVisible('recycle_bin'),
        builder: (_) => const ServiceRecycleBinTab(),
      ),
    ];
    // "View all" index counts visible tabs only.
    final visible = tabs.where((t) => t.visible).toList();
    var initial = 0;
    if (_initial == 1) {
      final i = visible.indexWhere((t) => t.label == 'Service Requests');
      initial = i < 0 ? 0 : i;
    }
    return ModuleScaffold(
      key: ValueKey(_key),
      module: widget.module,
      initialTab: initial,
      tabs: tabs,
      topActions: [
        if (ErpPerm.tabVisible('settings'))
          IconButton(
            tooltip: 'Service settings',
            icon: const Icon(Icons.settings_outlined),
            onPressed: () => openScreen(context, const ServiceSettingsScreen()),
          ),
      ],
    );
  }
}

/// Portal shows Contracts greyed out with an "Upcoming" pill
/// (SERVICE_CONTRACTS_ENABLED = false).
class _ContractsUpcoming extends StatelessWidget {
  const _ContractsUpcoming();

  @override
  Widget build(BuildContext context) => const Column(
        mainAxisAlignment: MainAxisAlignment.center,
        children: [
          UpcomingPill(),
          EmptyView('Service contracts (AMC / CMC) are coming soon.', icon: Icons.verified_user_outlined),
        ],
      );
}