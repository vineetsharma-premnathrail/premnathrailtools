import 'package:flutter/material.dart';

import '../../modules.dart';
import '../../ui/app_frame.dart';
import '../../ui/perms.dart';
import '../../ui/widgets.dart';
import 'quality_capa.dart';
import 'quality_common.dart';
import 'quality_complaints.dart';
import 'quality_dashboard.dart';
import 'quality_documents.dart';
import 'quality_final_inspection.dart';
import 'quality_first_articles.dart';
import 'quality_gauges.dart';
import 'quality_in_process.dart';
import 'quality_inspection_calls.dart';
import 'quality_lots.dart';
import 'quality_masters.dart';
import 'quality_ncr.dart';
import 'quality_plans.dart';
import 'quality_reports.dart';
import 'quality_settings.dart';
import 'quality_standards.dart';
import 'quality_supplier.dart';

/// Quality - native copy of frontend/src/app/dashboard/quality/ (tabs and
/// order from components/quality/QualityNav.tsx; Settings is the gear).
class QualityModuleHome extends StatelessWidget {
  const QualityModuleHome({super.key, required this.module});
  final ErpModule module;

  @override
  Widget build(BuildContext context) {
    final v = qualityTabVisible;
    return ModuleScaffold(
      module: module,
      topActions: [
        if (v('settings'))
          IconButton(
            tooltip: 'Quality settings',
            icon: const Icon(Icons.settings_outlined),
            onPressed: () => openScreen(context, const QualitySettingsScreen()),
          ),
      ],
      tabs: [
        ModuleTab(label: 'Dashboard', icon: Icons.dashboard_outlined, visible: v('dashboard'), builder: (_) => const QualityDashboardTab()),
        ModuleTab(label: 'My Inspections', icon: Icons.inbox_outlined, visible: v('my_inspections'), builder: (_) => const LotsTab(mine: true)),
        ModuleTab(label: 'Inspection Lots', icon: Icons.check_circle_outline, visible: v('inspection_lots'), builder: (_) => const LotsTab()),
        ModuleTab(label: 'NCR', icon: Icons.warning_amber_rounded, visible: v('ncr'), builder: (_) => const NcrTab()),
        ModuleTab(label: 'Inspection Plans', icon: Icons.assignment_outlined, visible: v('inspection_plans'), builder: (_) => const InspectionPlansTab()),
        ModuleTab(label: 'Masters', icon: Icons.storage_outlined, visible: v('masters'), builder: (_) => const MastersTab()),
        ModuleTab(
            label: 'Gauges',
            icon: Icons.track_changes_outlined,
            visible: v('masters') && Perm.canFeature('quality', 'masters', 'calibration', 'view'),
            builder: (_) => const GaugesTab()),
        ModuleTab(label: 'In-process', icon: Icons.settings_suggest_outlined, visible: v('in_process_inspection'), builder: (_) => const InProcessTab()),
        ModuleTab(label: 'First Article', icon: Icons.gps_fixed_rounded, visible: v('first_article'), builder: (_) => const FirstArticlesTab()),
        ModuleTab(label: 'Inspection Calls', icon: Icons.workspace_premium_outlined, visible: v('inspection_calls'), builder: (_) => const InspectionCallsTab()),
        ModuleTab(label: 'RRV Final Inspections', icon: Icons.cancel_outlined, visible: v('final_inspection'), builder: (_) => const FinalInspectionTab()),
        ModuleTab(label: 'CAPA', icon: Icons.build_outlined, visible: v('capa'), builder: (_) => const CapaTab()),
        ModuleTab(label: 'Complaints', icon: Icons.chat_bubble_outline_rounded, visible: v('complaints'), builder: (_) => const ComplaintsTab()),
        ModuleTab(label: 'Supplier Quality', icon: Icons.local_shipping_outlined, visible: v('supplier_quality'), builder: (_) => const SupplierQualityTab()),
        ModuleTab(label: 'Standards', icon: Icons.menu_book_outlined, visible: v('standards'), builder: (_) => const StandardsTab()),
        ModuleTab(label: 'Documents', icon: Icons.description_outlined, visible: v('documents'), builder: (_) => const DocumentsTab()),
        ModuleTab(label: 'Reports', icon: Icons.bar_chart_rounded, visible: v('reports'), builder: (_) => const ReportsTab()),
      ],
    );
  }
}