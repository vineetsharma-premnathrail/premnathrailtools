import 'package:flutter/material.dart';

import '../../modules.dart';
import '../../ui/app_frame.dart';
import '../../ui/widgets.dart';
import 'fin_assets.dart';
import 'fin_banking.dart';
import 'fin_common.dart';
import 'fin_controlling.dart';
import 'fin_costing.dart';
import 'fin_currencies.dart';
import 'fin_gst.dart';
import 'fin_inventory.dart';
import 'fin_journals.dart';
import 'fin_masters.dart';
import 'fin_outstanding.dart';
import 'fin_payments.dart';
import 'fin_purchase.dart';
import 'fin_reports.dart';
import 'fin_sales.dart';
import 'fin_settings.dart';

/// Finance & Accounting - native copy of frontend/src/app/dashboard/finance/.
/// Tabs = FinanceNav: each shows when the user may view any one of its
/// Permission Matrix tabs (filterTabsByAccess). Settings is the gear next to
/// the bell, never a tab.
class FinanceModuleHome extends StatelessWidget {
  const FinanceModuleHome({super.key, required this.module});
  final ErpModule module;

  static bool _any(List<String> keys) => keys.any((k) => finCan(k, 'view'));

  @override
  Widget build(BuildContext context) => ModuleScaffold(
        module: module,
        topActions: [
          if (_any(const ['settings']))
            IconButton(
              tooltip: 'Finance settings',
              icon: const Icon(Icons.settings_outlined),
              onPressed: () => openScreen(context, const FinSettingsScreen()),
            ),
        ],
        tabs: [
          ModuleTab(
            label: 'Masters',
            icon: Icons.storage_outlined,
            visible: _any(const ['company_fy', 'account_groups', 'ledgers', 'ledger_settings', 'gst_rates',
                'bank_cash_accounts', 'vendors', 'internal_orders', 'opening_balances']),
            builder: (_) => const FinMastersPage(),
          ),
          ModuleTab(
            label: 'Journals',
            icon: Icons.menu_book_outlined,
            visible: _any(const ['journal_vouchers', 'day_book', 'ledger_statement', 'period_close']),
            builder: (_) => const FinJournalsPage(),
          ),
          ModuleTab(
            label: 'Purchase',
            icon: Icons.shopping_cart_outlined,
            visible: _any(const ['purchase_invoices', 'debit_notes']),
            builder: (_) => const FinPurchasePage(),
          ),
          ModuleTab(
            label: 'Sales',
            icon: Icons.sell_outlined,
            visible: _any(const ['sales_invoices', 'credit_notes']),
            builder: (_) => const FinSalesPage(),
          ),
          ModuleTab(
            label: 'Payments',
            icon: Icons.currency_rupee_rounded,
            visible: _any(const ['payments', 'payment_runs']),
            builder: (_) => const FinPaymentsPage(),
          ),
          ModuleTab(
            label: 'Bank & Cash',
            icon: Icons.account_balance_outlined,
            visible: _any(const ['bank_book', 'reconciliation', 'liquidity', 'guarantees']),
            builder: (_) => const FinBankingPage(),
          ),
          ModuleTab(
            label: 'GST',
            icon: Icons.percent_rounded,
            visible: _any(const ['gst']),
            builder: (_) => const FinGstPage(),
          ),
          ModuleTab(
            label: 'Outstanding',
            icon: Icons.groups_outlined,
            visible: _any(const ['outstanding', 'collections', 'disputes', 'credit_management']),
            builder: (_) => const FinOutstandingPage(),
          ),
          ModuleTab(
            label: 'Inventory',
            icon: Icons.inventory_2_outlined,
            visible: _any(const ['inventory']),
            builder: (_) => const FinInventoryPage(),
          ),
          ModuleTab(
            label: 'Assets',
            icon: Icons.build_outlined,
            visible: _any(const ['fixed_assets', 'depreciation', 'tax_depreciation']),
            builder: (_) => const FinAssetsPage(),
          ),
          ModuleTab(
            label: 'Currencies & FX',
            icon: Icons.percent_rounded,
            visible: _any(const ['currencies']),
            builder: (_) => const FinCurrenciesPage(),
          ),
          ModuleTab(
            label: 'Reports',
            icon: Icons.bar_chart_rounded,
            visible: _any(const ['financial_reports', 'year_end_close']),
            builder: (_) => const FinReportsPage(),
          ),
          ModuleTab(
            label: 'Controlling',
            icon: Icons.percent_rounded,
            visible: _any(const ['co_planning', 'activity_rates', 'allocations', 'overhead']),
            builder: (_) => const FinControllingPage(),
          ),
          ModuleTab(
            label: 'Costing & Profitability',
            icon: Icons.bar_chart_rounded,
            visible: _any(const ['product_costing', 'profit_centers', 'profitability']),
            builder: (_) => const FinCostingPage(),
          ),
        ],
      );
}
