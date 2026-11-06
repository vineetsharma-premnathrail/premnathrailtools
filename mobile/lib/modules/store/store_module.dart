import 'package:flutter/material.dart';

import '../../modules.dart';
import '../../ui/app_frame.dart';
import '../../ui/perms.dart';
import 'store_adjust.dart';
import 'store_common.dart';
import 'store_inward.dart';
import 'store_items.dart';
import 'store_jobwork.dart';
import 'store_outward.dart';
import 'store_settings.dart';
import 'store_stock.dart';

/// Store & Inventory - native copy of frontend/src/app/dashboard/store/.
/// Top tabs = the portal's StoreNav groups (Inventory / Inward / Outward);
/// each group's documents are the pill row underneath. Settings is the gear
/// next to the bell.
class StoreModuleHome extends StatelessWidget {
  const StoreModuleHome({super.key, required this.module});
  final ErpModule module;

  // A page that is a feature of its tab also needs that feature's View.
  static bool _sub(String tab, [String? feature]) =>
      storeTab(tab) && (feature == null || Perm.canFeature('store', tab, feature, 'view'));

  @override
  Widget build(BuildContext context) {
    final inventory = <(String, WidgetBuilder)>[
      if (_sub('items')) ('Item Master', (_) => const ItemsTab()),
      if (_sub('stock')) ('Stock', (_) => const StockTab()),
      if (_sub('stock', 'batches')) ('Batches', (_) => const BatchesTab()),
      if (storeAnyTab(const ['bins', 'stock'])) ('Bins', (_) => const BinsTab()),
      if (_sub('stock', 'serials')) ('Serial Nos.', (_) => const SerialsTab()),
      if (_sub('movements')) ('Movements', (_) => const MovementsTab()),
      if (_sub('adjustments')) ('Adjustments', (_) => const AdjustmentsTab()),
      if (_sub('stock', 'reorder')) ('Reorder', (_) => const ReorderTab()),
      if (_sub('adjustments', 'cycle_count')) ('Physical Count', (_) => const PhysicalCountTab()),
    ];
    final inward = <(String, WidgetBuilder)>[
      if (_sub('grn')) ('GRN & Quality check', (_) => const GrnTab()),
      if (_sub('grn', 'before_po')) ('Before PO', (_) => const BeforePoTab()),
      if (_sub('returns')) ('Returns', (_) => const ReturnsTab()),
    ];
    final outward = <(String, WidgetBuilder)>[
      if (_sub('issues')) ('Issues', (_) => const IssuesTab()),
      if (_sub('issues', 'job_work')) ('Job Work', (_) => const JobWorkTab()),
      if (_sub('transfers')) ('Transfers', (_) => const TransfersTab()),
      if (_sub('reservations')) ('Reservations', (_) => const ReservationsTab()),
    ];
    final showSettings =
        storeAnyTab(const ['settings', 'item_types', 'uoms', 'categories', 'warehouses', 'issue_types']);
    return ModuleScaffold(
      module: module,
      topActions: [
        if (showSettings)
          IconButton(
            tooltip: 'Store settings',
            icon: const Icon(Icons.settings_outlined),
            onPressed: () =>
                Navigator.of(context).push(MaterialPageRoute(builder: (_) => const StoreSettingsScreen())),
          ),
      ],
      tabs: [
        ModuleTab(
            label: 'Inventory',
            icon: Icons.inventory_2_outlined,
            visible: inventory.isNotEmpty,
            builder: (_) => SubTabs(tabs: inventory)),
        ModuleTab(
            label: 'Inward',
            icon: Icons.download_rounded,
            visible: inward.isNotEmpty,
            builder: (_) => SubTabs(tabs: inward)),
        ModuleTab(
            label: 'Outward',
            icon: Icons.upload_rounded,
            visible: outward.isNotEmpty,
            builder: (_) => SubTabs(tabs: outward)),
      ],
    );
  }
}