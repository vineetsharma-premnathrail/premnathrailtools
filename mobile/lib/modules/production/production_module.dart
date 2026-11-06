import 'package:flutter/material.dart';

import '../../modules.dart';
import '../../ui/app_frame.dart';
import 'bom.dart';
import 'dashboard.dart';
import 'planning.dart';
import 'prod_common.dart';
import 'reports.dart';
import 'rrv.dart';
import 'shop_floor.dart';
import 'work_orders.dart';
import 'workstations.dart';

/// Production - native copy of frontend/src/app/dashboard/production/
/// (ProductionNav tabs: Dashboard, RRV Builds, Work Orders, Shop Floor,
/// Planning, BOM & Routing, Workstations, Reports).
class ProductionModuleHome extends StatefulWidget {
  const ProductionModuleHome({super.key, required this.module});
  final ErpModule module;

  @override
  State<ProductionModuleHome> createState() => _ProductionModuleHomeState();
}

class _ProductionModuleHomeState extends State<ProductionModuleHome> {
  int _initial = 0;
  int _gen = 0;

  static const _keys = ['dashboard', 'rrv_builds', 'work_orders', 'shop_floor', 'planning', 'bom', 'workstations', 'reports'];

  void _goTab(String key) {
    final visible = _keys.where(ProdPerm.tab).toList();
    final i = visible.indexOf(key);
    if (i < 0) return;
    setState(() {
      _initial = i;
      _gen++;
    });
  }

  @override
  Widget build(BuildContext context) {
    return ModuleScaffold(
      key: ValueKey(_gen),
      module: widget.module,
      initialTab: _initial,
      tabs: [
        ModuleTab(
            label: 'Dashboard',
            icon: Icons.grid_view_rounded,
            visible: ProdPerm.tab('dashboard'),
            builder: (_) => ProductionDashboardTab(onGoTab: _goTab)),
        ModuleTab(label: 'RRV Builds', icon: Icons.local_shipping_outlined, visible: ProdPerm.tab('rrv_builds'), builder: (_) => const RrvBuildsTab()),
        ModuleTab(label: 'Work Orders', icon: Icons.assignment_outlined, visible: ProdPerm.tab('work_orders'), builder: (_) => const WorkOrdersTab()),
        ModuleTab(label: 'Shop Floor', icon: Icons.settings_outlined, visible: ProdPerm.tab('shop_floor'), builder: (_) => const ShopFloorTab()),
        ModuleTab(label: 'Planning', icon: Icons.calendar_month_outlined, visible: ProdPerm.tab('planning'), builder: (_) => const PlanningTab()),
        ModuleTab(label: 'BOM & Routing', icon: Icons.layers_outlined, visible: ProdPerm.tab('bom'), builder: (_) => const BomTab()),
        ModuleTab(label: 'Workstations', icon: Icons.factory_outlined, visible: ProdPerm.tab('workstations'), builder: (_) => const WorkstationsTab()),
        ModuleTab(label: 'Reports', icon: Icons.bar_chart_rounded, visible: ProdPerm.tab('reports'), builder: (_) => const ReportsTab()),
      ],
    );
  }
}
