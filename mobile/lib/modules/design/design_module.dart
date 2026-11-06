import 'package:flutter/material.dart';

import '../../modules.dart';
import '../../ui/app_frame.dart';
import '../../ui/widgets.dart';
import 'design_boms.dart';
import 'design_changes.dart';
import 'design_common.dart';
import 'design_dashboard.dart';
import 'design_documents.dart';
import 'design_library.dart';
import 'design_my_work.dart';
import 'design_reports.dart';
import 'design_requests.dart';
import 'design_reviews.dart';
import 'design_settings.dart';

/// Design - native copy of frontend/src/app/dashboard/design/ (DesignNav):
/// Dashboard, Requests, My Work, Drawings, BOMs, Reviews & Approvals,
/// Changes, Library, Reports; Settings is the gear next to the bell.
class DesignModuleHome extends StatelessWidget {
  const DesignModuleHome({super.key, required this.module});
  final ErpModule module;

  @override
  Widget build(BuildContext context) => ModuleScaffold(
        module: module,
        topActions: [
          if (designTabVisible('settings'))
            Builder(
              builder: (ctx) => IconButton(
                tooltip: 'Design settings',
                icon: const Icon(Icons.settings_outlined),
                onPressed: () => openScreen(ctx, const DesignSettingsScreen()),
              ),
            ),
        ],
        tabs: [
          ModuleTab(
              label: 'Dashboard',
              icon: Icons.dashboard_outlined,
              visible: designTabVisible('dashboard'),
              builder: (_) => const DesignDashboardTab()),
          ModuleTab(
              label: 'Requests',
              icon: Icons.view_kanban_outlined,
              visible: designTabVisible('project_work'),
              builder: (_) => const DesignRequestsTab()),
          ModuleTab(
              label: 'My Work',
              icon: Icons.checklist_rounded,
              visible: designTabVisible('tasks'),
              builder: (_) => const DesignMyWorkTab()),
          ModuleTab(
              label: 'Drawings',
              icon: Icons.architecture_outlined,
              visible: designTabVisible('documents'),
              builder: (_) => const DesignDocumentsTab()),
          ModuleTab(
              label: 'BOMs',
              icon: Icons.layers_outlined,
              visible: designTabVisible('boms'),
              builder: (_) => const DesignBomsTab()),
          ModuleTab(
              label: 'Reviews & Approvals',
              icon: Icons.verified_outlined,
              visible: designTabVisible('reviews'),
              builder: (_) => const DesignReviewsTab()),
          ModuleTab(
              label: 'Changes',
              icon: Icons.sync_alt_rounded,
              visible: designTabVisible('change_notices'),
              builder: (_) => const DesignChangesTab()),
          ModuleTab(
              label: 'Library',
              icon: Icons.menu_book_outlined,
              visible: designTabVisible('library'),
              builder: (_) => const DesignLibraryTab()),
          ModuleTab(
              label: 'Reports',
              icon: Icons.bar_chart_rounded,
              visible: designTabVisible('reports'),
              builder: (_) => const DesignReportsTab()),
        ],
      );
}
