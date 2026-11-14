import 'package:flutter/material.dart';

import '../../modules.dart';
import '../../record_router.dart';
import '../../ui/app_frame.dart';
import '../../ui/widgets.dart';
import 'item_rates.dart';
import 'mis.dart';
import 'my_lines.dart';
import 'p2p_common.dart';
import 'purchase_orders.dart';
import 'requisitions.dart';
import 'rfq.dart';
import 'settings.dart';
import 'vendors.dart';

/// Procurement - native copy of frontend/src/app/dashboard/p2p/ (P2PNav tabs,
/// Settings as the gear next to the bell).
class ProcurementModuleHome extends StatelessWidget {
  const ProcurementModuleHome({super.key, required this.module, this.initialTabLabel});
  final ErpModule module;

  /// Tab to open first (links from alerts / approvals); null = the first tab.
  final String? initialTabLabel;

  @override
  Widget build(BuildContext context) => FutureBuilder<({bool pr, bool po})>(
        future: P2pAccess.flags(),
        builder: (ctx, s) {
          final flags = s.data ?? (pr: false, po: false);
          final purchase = P2pAccess.isPurchaseTeam;
          final admin = P2pAccess.isAdmin;
          final accounts = P2pAccess.apps.contains('accounts');
          final settingsAllowed = P2pAccess.tab('settings') &&
              (admin || P2pAccess.apps.contains('p2p') || purchase);
          return startOnTab(ModuleScaffold(
            key: ValueKey('p2p-${s.connectionState == ConnectionState.done}'),
            module: module,
            topActions: [
              if (settingsAllowed)
                IconButton(
                  tooltip: 'Purchase settings',
                  icon: const Icon(Icons.settings_outlined),
                  onPressed: () => openScreen(ctx, const P2pSettingsScreen()),
                ),
            ],
            tabs: [
              ModuleTab(
                label: 'Purchase Requisitions',
                icon: Icons.description_outlined,
                visible: P2pAccess.tab('purchase_requisitions'),
                builder: (_) => RequisitionsTab(prApprover: flags.pr),
              ),
              ModuleTab(
                label: 'My Lines',
                icon: Icons.checklist_rounded,
                visible: P2pAccess.tab('purchase_requisitions') &&
                    (purchase || admin) &&
                    P2pAccess.feat('purchase_requisitions', 'my_lines', 'view'),
                builder: (_) => const MyLinesTab(),
              ),
              ModuleTab(
                label: 'Vendors',
                icon: Icons.person_outline_rounded,
                visible: P2pAccess.tab('vendors') && (purchase || accounts || admin),
                builder: (_) => const VendorsTab(),
              ),
              ModuleTab(
                label: 'R.F.Q',
                icon: Icons.send_outlined,
                visible: P2pAccess.tab('rfq') && purchase,
                builder: (_) => const RfqTab(),
              ),
              ModuleTab(
                label: 'Purchase Orders',
                icon: Icons.assignment_outlined,
                visible: P2pAccess.tab('purchase_orders') && (purchase || flags.po),
                builder: (_) => PurchaseOrdersTab(poApprover: flags.po),
              ),
              ModuleTab(
                label: 'Item Rates',
                icon: Icons.bar_chart_rounded,
                visible: P2pAccess.tab('vendors') && purchase && P2pAccess.feat('vendors', 'info_records', 'view'),
                builder: (_) => const ItemRatesTab(),
              ),
              ModuleTab(
                label: 'M.I.S Report',
                icon: Icons.insert_chart_outlined_rounded,
                visible: P2pAccess.tab('mis') && purchase,
                builder: (_) => const MisTab(),
              ),
            ],
          ), initialTabLabel);
        },
      );
}
