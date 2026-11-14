import 'package:flutter/material.dart';

import '../../modules.dart';
import '../../record_router.dart';
import '../../ui/app_frame.dart';
import '../../ui/widgets.dart';
import 'rnd_common.dart';
import 'rnd_dashboard.dart';
import 'rnd_projects.dart';
import 'rnd_requirements.dart';
import 'rnd_tasks_tab.dart';
import 'rnd_tools.dart';

/// R&D - native copy of frontend/src/app/dashboard/rnd/ (tabs as RndNav.tsx).
class RndModuleHome extends StatelessWidget {
  const RndModuleHome({super.key, required this.module, this.initialTabLabel});
  final ErpModule module;

  /// Tab to open first (links from alerts); null = the Dashboard.
  final String? initialTabLabel;

  @override
  Widget build(BuildContext context) {
    final settings = RndPerm.view('requirements') && RndPerm.feature('requirements', 'settings', 'view');
    return startOnTab(_scaffold(context, settings), initialTabLabel);
  }

  ModuleScaffold _scaffold(BuildContext context, bool settings) {
    return ModuleScaffold(
      module: module,
      topActions: [
        if (settings)
          IconButton(
            tooltip: 'R&D settings',
            icon: const Icon(Icons.settings_outlined),
            onPressed: () => openScreen(context, const RndSettingsScreen()),
          ),
      ],
      tabs: [
        ModuleTab(
          label: 'Dashboard',
          icon: Icons.grid_view_rounded,
          visible: RndPerm.view('dashboard'),
          builder: (_) => const RndDashboard(),
        ),
        ModuleTab(
          label: 'Requirements',
          icon: Icons.assignment_outlined,
          visible: RndPerm.view('requirements'),
          builder: (_) => const RequirementsList(),
        ),
        ModuleTab(
          label: 'R&D Tasks',
          icon: Icons.checklist_rounded,
          visible: RndPerm.view('tasks'),
          builder: (_) => const RndTasksTab(),
        ),
        ModuleTab(
          label: 'Prototype / Research',
          icon: Icons.science_outlined,
          visible: RndPerm.view('projects'),
          builder: (_) => const ProjectsList(),
        ),
        ModuleTab(
          label: 'Engineering Tools',
          icon: Icons.build_outlined,
          visible: RndPerm.view('all'),
          builder: (_) => const EngineeringTools(),
        ),
      ],
    );
  }
}
