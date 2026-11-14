import 'package:flutter/material.dart';

import '../../api/api.dart';
import '../../theme.dart';
import '../../ui/app_frame.dart';
import '../../ui/form.dart';
import '../../ui/format.dart';
import '../../ui/widgets.dart';
import 'fin_common.dart';
import 'fin_gst.dart' show FinPeriodPicker;
import 'fin_journals.dart';

/// Finance › Inventory (portal finance/inventory/page.tsx).
class FinInventoryPage extends StatelessWidget {
  const FinInventoryPage({super.key});

  @override
  Widget build(BuildContext context) => FinTabbedPage(
        title: 'Inventory Accounting',
        subtitle: 'Stock value from Store, how purchases and sales moved it, and the month-end closing-stock entry (periodic method).',
        tabs: [
          FinSubTab('Stock Value', (_) => const _StockValue(), permTab: 'inventory'),
          FinSubTab('Purchase / Sales Impact', (_) => const _Impact(),
              visible: finCan('inventory', 'view') && finCanFeature('inventory', 'purchase_sales_impact', 'view')),
          FinSubTab('Closing Stock', (_) => const _Closing(), visible: finCan('inventory', 'view') && finCanFeature('inventory', 'closing_stock', 'view')),
        ],
      );
}

const _sourceLabels = {'moving_average': 'Moving avg', 'standard': 'Standard cost', 'manual': 'Manual', 'none': 'No cost'};
const _sourceHex = {'moving_average': Color(0xFF16A34A), 'standard': Color(0xFF0369A1), 'manual': Color(0xFFB45309), 'none': Color(0xFFDC2626)};
const _statusLabels = {'draft': 'Draft', 'posted': 'Posted', 'cancelled': 'Cancelled'};
const _statusHex = {'draft': Color(0xFF94A3B8), 'posted': Color(0xFF16A34A), 'cancelled': Color(0xFF78716C)};

class _StockValue extends StatefulWidget {
  const _StockValue();

  @override
  State<_StockValue> createState() => _StockValueState();
}

class _StockValueState extends State<_StockValue> {
  bool _noCost = false;

  @override
  Widget build(BuildContext context) => ApiLoader<Json>(
        load: () async => asJson(await Api.get('/accounts/inventory/stock-value')),
        builder: (ctx, d, _) {
          final rows = listOf(d['rows']);
          final items = _noCost ? rows.where((r) => r['rate_source'] == 'none').toList() : rows;
          return ListView(padding: const EdgeInsets.only(bottom: 24), children: [
            const InfoBanner(
                "Live value of stock on hand in Store (including quarantine — it is still our stock), at weighted moving-average cost, or the item's "
                'standard cost when no average exists yet. This is what a closing-stock valuation would pick up if created now.'),
            if (d['note'] != null) InfoBanner('${d['note']}', tone: Tone.warning),
            StatGrid([
              StatCard('Stock value (as of ${fmtDate(d['as_of'])})', inr(d['total_value'])),
              StatCard('Items in stock', '${rows.length}', onTap: () => setState(() => _noCost = false)),
              StatCard('Items without cost', '${d['unvalued_items'] ?? 0}',
                  tone: (toInt(d['unvalued_items']) ?? 0) > 0 ? const Color(0xFFB91C1C) : null, active: _noCost, onTap: () => setState(() => _noCost = !_noCost)),
            ]),
            DetailSection('By category', children: [
              for (final c in listOf(d['categories'])) AmountRow('${c['category']} (${c['items']})', inr(c['value'])),
              AmountRow('Total (${rows.length})', inr(d['total_value']), bold: true),
            ]),
            SectionTitle('Items (${items.length})'),
            if (items.isEmpty) EmptyView(_noCost ? 'Every item in stock has a cost. Tap Items without cost again to show all.' : 'No stock on hand in Store.'),
            for (final r in items)
              RecordCard(
                code: '${r['item_code']}',
                title: '${r['item_name']}',
                subtitle: r['category'] as String?,
                trailing: FinStatusPill(r['rate_source'], labels: _sourceLabels, colors: _sourceHex),
                meta: [('Qty', '${fmtNumber(r['quantity'])} ${r['uom'] ?? ''}'), ('Rate', inr(r['rate'])), ('Value', inr(r['value']))],
              ),
          ]);
        },
      );
}

class _Impact extends StatefulWidget {
  const _Impact();

  @override
  State<_Impact> createState() => _ImpactState();
}

class _ImpactState extends State<_Impact> {
  DateTime? _from = DateTime(DateTime.now().year, DateTime.now().month, 1);
  DateTime? _to = DateTime.now();

  @override
  Widget build(BuildContext context) => ListView(padding: const EdgeInsets.only(bottom: 24), children: [
        const InfoBanner(
            'Quantity and taxable value bought (posted purchase invoices) and sold (posted sales invoices) per item in the range. Lines linked to a '
            'Store item are grouped by item; others by their description.'),
        DateRangeRow(from: _from, to: _to, onChanged: (f, t) => setState(() {
              _from = f;
              _to = t;
            })),
        ApiLoader<Json>(
          key: ValueKey('${dateOrNull(_from)}${dateOrNull(_to)}'),
          load: () async => asJson(await Api.get('/accounts/inventory/purchase-sales-impact', query: {'from_date': dateOrNull(_from), 'to_date': dateOrNull(_to)})),
          builder: (ctx, d, _) {
            final rows = listOf(d['rows']);
            return Column(children: [
              StatGrid([StatCard('Purchases (taxable)', inr(d['total_purchases'])), StatCard('Sales (taxable)', inr(d['total_sales']))]),
              if (rows.isEmpty) const EmptyView('No posted purchase or sales invoices in this range.'),
              for (final r in rows)
                RecordCard(
                  title: '${r['description'] ?? (r['store_item_id'] != null ? 'Store item #${r['store_item_id']}' : '—')}',
                  meta: [
                    ('Purchase qty', fmtNumber(r['purchase_qty'])),
                    ('Purchase value', inr(r['purchase_value'])),
                    ('Sales qty', fmtNumber(r['sales_qty'])),
                    ('Sales value', inr(r['sales_value'])),
                  ],
                ),
            ]);
          },
        ),
      ]);
}

class _Closing extends StatefulWidget {
  const _Closing();

  @override
  State<_Closing> createState() => _ClosingState();
}

class _ClosingState extends State<_Closing> {
  int _tick = 0;

  Future<void> _new() async {
    String period = currentPeriod();
    final notes = TextEditingController();
    Json? created;
    final ok = await showFormSheet(
      context,
      title: 'New closing-stock valuation',
      saveLabel: 'Create draft from Store',
      builder: (ctx, setS) => [
        const Text('Snapshot of Store stock on hand at weighted-average cost, as a Draft.', style: TextStyle(color: Brand.muted)),
        FinPeriodPicker(period: period, label: 'Period (month)', onChanged: (p) => setS(() => period = p)),
        const Text('The valuation is dated the last day of that month.', style: TextStyle(fontSize: 12, color: Brand.muted)),
        AppTextField(label: 'Notes', controller: notes, maxLines: 2),
      ],
      onSave: () async {
        created = asJson(await Api.post('/accounts/inventory/valuations',
            data: {'accounting_period': period, 'notes': notes.text.trim().isEmpty ? null : notes.text.trim()}));
      },
    );
    if (ok && created != null && mounted) {
      setState(() => _tick++);
      await openScreen(context, _ValuationScreen(id: toInt(created!['id'])!));
      if (mounted) setState(() => _tick++);
    }
  }

  @override
  Widget build(BuildContext context) => Scaffold(
        backgroundColor: Colors.transparent,
        floatingActionButton: finCanFeature('inventory', 'closing_stock', 'create') ? CreateFab(label: 'New valuation', onPressed: _new) : null,
        body: ApiLoader<List<Json>>(
          key: ValueKey(_tick),
          load: () async => asRows(await Api.get('/accounts/inventory/valuations')),
          builder: (ctx, list, _) => ListView(padding: const EdgeInsets.only(bottom: 88), children: [
            const InfoBanner(
                'Periodic inventory (AS-2): during the month purchases are expensed to Purchase Accounts and nothing posts on store movements. At month end '
                "the stock on hand is valued at weighted average cost and posted as closing stock; it reverses the next day as the new month's opening stock, "
                "so the P&L shows opening + purchases − closing = cost of materials consumed. A draft's quantities can be corrected from a physical count before posting."),
            if (list.isEmpty) const EmptyView('No closing-stock valuations yet — use + New valuation at month end.'),
            for (final v in list)
              RecordCard(
                title: periodLabel('${v['accounting_period']}'),
                subtitle: v['notes'] as String?,
                trailing: FinStatusPill(v['status'], labels: _statusLabels, colors: _statusHex),
                meta: [('Valuation date', fmtDate(v['valuation_date'])), ('Closing stock', inr(v['total_value']))],
                onTap: () async {
                  await openScreen(ctx, _ValuationScreen(id: toInt(v['id'])!));
                  if (mounted) setState(() => _tick++);
                },
              ),
          ]),
        ),
      );
}

class _ValuationScreen extends StatefulWidget {
  const _ValuationScreen({required this.id});
  final int id;

  @override
  State<_ValuationScreen> createState() => _ValuationScreenState();
}

class _ValuationScreenState extends State<_ValuationScreen> {
  int _tick = 0;

  Future<void> _editLine(Json l) async {
    final q = TextEditingController(text: '${l['quantity']}');
    final r = TextEditingController(text: '${l['rate']}');
    final ok = await showFormSheet(
      context,
      title: '${l['item_code'] ?? ''} ${l['item_name']}',
      builder: (ctx, setS) => [
        const Text('Correct the quantity from the physical count, or the rate (it becomes a manual rate).', style: TextStyle(color: Brand.muted)),
        AppTextField(label: 'Qty${l['uom'] != null ? ' (${l['uom']})' : ''}', controller: q, keyboardType: AppTextField.number),
        AppTextField(label: 'Rate (₹)', controller: r, keyboardType: AppTextField.number),
      ],
      onSave: () async {
        final qv = double.tryParse(q.text);
        final rv = double.tryParse(r.text);
        if (qv == null || qv < 0 || rv == null || rv < 0) throw 'Quantity and rate must be numbers of zero or more.';
        await Api.patch('/accounts/inventory/valuation-lines/${l['id']}', data: {
          if (qv != toD(l['quantity'])) 'quantity': qv,
          if (rv != toD(l['rate'])) 'rate': rv,
        });
      },
    );
    if (ok) setState(() => _tick++);
  }

  @override
  Widget build(BuildContext context) => ApiLoader<Json>(
        key: ValueKey(_tick),
        load: () async => asJson(await Api.get('/accounts/inventory/valuations/${widget.id}')),
        builder: (ctx, v, _) {
          final isDraft = v['status'] == 'draft';
          final canPost = isFinanceManager && finCanFeature('inventory', 'closing_stock', 'approve');
          final canCancel = isFinanceManager && finCanFeature('inventory', 'closing_stock', 'cancel');
          final canEditLines = isDraft && finCanFeature('inventory', 'closing_stock', 'edit');
          final lines = listOf(v['lines']);
          final vd = isoToDate(v['valuation_date']);
          final next = vd == null ? '—' : fmtDate(vd.add(const Duration(days: 1)));
          final actions = <Widget>[
            if (canPost && isDraft)
              actionBtn('Post closing stock', () async {
                final ok = await confirmDialog(context,
                    title: 'Post closing stock for ${v['accounting_period']}?',
                    message:
                        "Posts Dr Stock-in-Hand / Cr Changes in Inventories for ${inr(v['total_value'])} on ${fmtDate(v['valuation_date'])}. It reverses automatically on $next, becoming next period's opening stock. After posting, the lines can't be edited — cancel and re-create instead.",
                    confirmLabel: 'Post');
                if (ok && context.mounted && await runAction(context, () => Api.post('/accounts/inventory/valuations/${v['id']}/post'), success: 'Closing stock posted.')) {
                  setState(() => _tick++);
                }
              }, primary: true),
            if (canCancel && v['status'] != 'cancelled')
              actionBtn('Cancel valuation', () async {
                final reason = await promptDialog(context,
                    title: 'Cancel closing stock for ${v['accounting_period']}?',
                    message: v['status'] == 'posted'
                        ? 'The posted entry and its next-day reversal will both be undone with counter-entries on their own dates. Give the reason.'
                        : 'The draft will be marked cancelled. Give the reason.',
                    confirmLabel: 'Cancel valuation');
                if (reason != null && context.mounted &&
                    await runAction(context, () => Api.post('/accounts/inventory/valuations/${v['id']}/cancel', data: {'reason': reason}),
                        success: 'Valuation cancelled.')) {
                  setState(() => _tick++);
                }
              }, danger: true),
          ];
          return SubPage(
            title: 'Closing stock ${v['accounting_period']}',
            bottom: actions.isEmpty ? null : ActionBar(actions),
            body: ListView(padding: const EdgeInsets.only(top: 12, bottom: 24), children: [
              padded(Wrap(spacing: 8, runSpacing: 6, crossAxisAlignment: WrapCrossAlignment.center, children: [
                FinStatusPill(v['status'], labels: _statusLabels, colors: _statusHex),
                Text('Valued on ${fmtDate(v['valuation_date'])} · ${lines.length} item(s)', style: const TextStyle(color: Brand.muted)),
                if (v['journal_entry_id'] != null)
                  TextButton(
                      onPressed: () => openScreen(context, FinVoucherScreen(entryId: toInt(v['journal_entry_id'])!)),
                      child: const Text('View journal voucher')),
              ])),
              if (v['notes'] != null) padded(Text('${v['notes']}')),
              if (!canPost && !canCancel && v['status'] != 'cancelled') const InfoBanner('Only a Finance Manager can post or cancel a closing-stock valuation.'),
              if (isDraft) const InfoBanner('Draft: correct any quantity from the physical count, or a rate (it becomes a manual rate), then post. Tap a line to change it.'),
              StatGrid([StatCard('Closing stock value', inr(v['total_value']))]),
              if (lines.isEmpty) const EmptyView('No items — Store had no stock on hand when this valuation was created.'),
              for (final l in lines)
                RecordCard(
                  code: '${l['item_code'] ?? '—'}',
                  title: '${l['item_name']}',
                  subtitle: l['category'] as String?,
                  trailing: FinStatusPill(l['rate_source'], labels: _sourceLabels, colors: _sourceHex),
                  meta: [('Qty', '${fmtNumber(l['quantity'])} ${l['uom'] ?? ''}'), ('Rate', inr(l['rate'])), ('Value', inr(l['value']))],
                  onTap: canEditLines ? () => _editLine(l) : null,
                ),
            ]),
          );
        },
      );
}
