import 'package:flutter/material.dart';

import '../../modules.dart';
import '../../ui/app_frame.dart';
import '../../ui/widgets.dart';
import 'crm_common.dart';
import 'crm_dashboard.dart';
import 'crm_inquiries_list.dart';
import 'crm_organizations.dart';
import 'crm_products.dart';
import 'crm_reports_settings.dart';

/// CRM - native copy of frontend/src/app/dashboard/crm/ (CrmNav tabs, Products with
/// Pricing inside, Settings as the gear next to the bell).
class CrmModuleHome extends StatelessWidget {
  const CrmModuleHome({super.key, required this.module});
  final ErpModule module;

  @override
  Widget build(BuildContext context) => ModuleScaffold(
        module: module,
        topActions: [
          if (CrmPerm.tab('settings') && CrmPerm.can('settings', 'view'))
            IconButton(
              tooltip: 'CRM settings',
              icon: const Icon(Icons.settings_outlined),
              onPressed: () => openScreen(context, const CrmSettingsScreen()),
            ),
        ],
        tabs: [
          ModuleTab(
              label: 'Dashboard', icon: Icons.grid_view_rounded, visible: CrmPerm.tab('dashboard'), builder: (_) => const CrmDashboardTab()),
          ModuleTab(
              label: 'Customer Organizations',
              icon: Icons.apartment_outlined,
              visible: CrmPerm.tab('organizations'),
              builder: (_) => const OrganizationsTab()),
          ModuleTab(
              label: 'Inquiries & Tenders',
              icon: Icons.description_outlined,
              visible: CrmPerm.tab('inquiries_tenders'),
              builder: (_) => const InquiriesTab()),
          ModuleTab(
              label: 'Products',
              icon: Icons.inventory_2_outlined,
              visible: CrmPerm.tab('products') && CrmPerm.can('products', 'view'),
              builder: (_) => const ProductsTab()),
          ModuleTab(label: 'Reports', icon: Icons.bar_chart_rounded, visible: CrmPerm.tab('reports'), builder: (_) => const CrmReportsTab()),
        ],
      );
}