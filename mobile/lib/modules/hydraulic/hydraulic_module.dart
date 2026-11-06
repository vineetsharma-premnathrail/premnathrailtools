import 'package:flutter/material.dart';

import '../../modules.dart';
import '../../ui/app_frame.dart';
import 'hyd_bom.dart';
import 'hyd_calculations.dart';
import 'hyd_circuits.dart';
import 'hyd_common.dart';
import 'hyd_components.dart';
import 'hyd_dashboard.dart';
import 'hyd_systems.dart';
import 'hyd_testing.dart';

/// Hydraulic & Pneumatic - native copy of frontend/src/app/dashboard/hydraulic/
/// (sub-nav: components/hydraulic/HydraulicNav.tsx). Maintenance, Service
/// Records and Spare Parts are retired on the portal too (plan rule R5).
class HydraulicModuleHome extends StatelessWidget {
  const HydraulicModuleHome({super.key, required this.module});
  final ErpModule module;

  @override
  Widget build(BuildContext context) => ModuleScaffold(module: module, tabs: [
        ModuleTab(
            label: 'Dashboard',
            icon: Icons.grid_view_rounded,
            visible: hydTabVisible('dashboard'),
            builder: (_) => const HydDashboard()),
        ModuleTab(
            label: 'Systems',
            icon: Icons.water_drop_outlined,
            visible: hydTabVisible('systems'),
            builder: (_) => const HydSystemsList()),
        ModuleTab(
            label: 'Components',
            icon: Icons.view_in_ar_outlined,
            visible: hydTabVisible('components'),
            builder: (_) => const HydComponentsList()),
        ModuleTab(
            label: 'Circuits',
            icon: Icons.memory_outlined,
            visible: hydTabVisible('circuits'),
            builder: (_) => const HydCircuitsList()),
        ModuleTab(
            label: 'BOM',
            icon: Icons.layers_outlined,
            visible: hydTabVisible('bom'),
            builder: (_) => const HydBomList()),
        ModuleTab(
            label: 'Calculations',
            icon: Icons.calculate_outlined,
            visible: hydTabVisible('calculations'),
            builder: (_) => const HydCalculationsList()),
        ModuleTab(
            label: 'Testing',
            icon: Icons.speed_rounded,
            visible: hydTabVisible('testing'),
            builder: (_) => const HydTestsList()),
      ]);
}
