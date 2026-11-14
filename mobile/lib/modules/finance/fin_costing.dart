import 'package:flutter/material.dart';

import '../../api/api.dart';
import '../../theme.dart';
import '../../ui/app_frame.dart';
import '../../ui/form.dart';
import '../../ui/format.dart';
import '../../ui/widgets.dart';
import 'fin_common.dart';

/// Finance › Costing & Profitability (portal finance/costing/page.tsx +
/// ProductCostingTabs + ProfitabilityTabs).
class FinCostingPage extends StatelessWidget {
  const FinCostingPage({super.key});

  @override
  Widget build(BuildContext context) => FinTabbedPage(
        title: 'Costing & Profitability',
        subtitle:
            'Product cost estimates and standard prices, work-order plan vs actual, profit centres with a plant / business-line P&L, and contribution margin per sales order, machine, product and customer.',
        noAccessText:
            "You don't have view permission on Product Costing, Profit Centres or Profitability (Finance & Accounting › Controlling). Ask an admin to grant it in Organization › Role & Permissions.",
        tabs: [
          FinSubTab('Cost Estimates', (_) => const _Estimates(), permTab: 'product_costing'),
          FinSubTab('Order Variance', (_) => const _OrderVariance(), permTab: 'product_costing.order_variance'),
          FinSubTab('Profit Centres', (_) => const _ProfitCentres(), permTab: 'profit_centers'),
          FinSubTab('Profit Centre P&L', (_) => const _PcPl(), permTab: 'profit_centers.pl_report'),
          FinSubTab('Profitability', (_) => const _Profitability(), permTab: 'profitability'),
        ],
      );
}

const _pc = '/accounts/product-costing';
const _red = Color(0xFFDC2626);
const _green = Color(0xFF16A34A);
const _estLabels = {'draft': 'Draft', 'marked': 'Marked', 'released': 'Released', 'superseded': 'Superseded', 'cancelled': 'Cancelled'};
const _estHex = {
  'draft': Color(0xFF64748B), 'marked': Color(0xFFB45309), 'released': Color(0xFF16A34A), 'superseded': Color(0xFF0369A1), 'cancelled': Color(0xFF64748B),
};
const _sourceLabels = {
  'sub_estimate': 'Sub-assembly estimate', 'sub_rollup': 'Rolled up', 'job_work': 'Job work receipt', 'standard': 'Standard cost',
  'moving_average': 'Moving average', 'activity_rate': 'Activity rate', 'workstation_rate': 'Work centre rate', 'costing_sheet': 'Costing sheet', 'none': 'No cost',
};
const _componentLabels = {'material': 'Material', 'job_work': 'Job work', 'labour': 'Labour', 'overhead': 'Overhead'};
const _woLabels = {'draft': 'Draft', 'released': 'Released', 'in_progress': 'In progress', 'completed': 'Completed', 'closed': 'Closed'};

Color? _varColor(Object? v) {
  final n = toD(v);
  return n > 0.005 ? _red : (n < -0.005 ? _green : null);
}

// ── Cost estimates ───────────────────────────────────────────────────────────

class _Estimates extends StatefulWidget {
  const _Estimates();

  @override
  State<_Estimates> createState() => _EstimatesState();
}

class _EstimatesState extends State<_Estimates> {
  final _list = GlobalKey<ApiListViewState>();
  String? _status;

  Future<void> _run() async {
    List<Json> items;
    try {
      items = asRows(await Api.get('$_pc/costable-items'));
    } catch (e) {
      if (mounted) showSnack(context, ApiClient.describe(e), error: true);
      return;
    }
    int? itemId;
    int? bomId;
    DateTime? date = DateTime.now();
    final lot = TextEditingController();
    final mat = TextEditingController();
    final lab = TextEditingController();
    final remarks = TextEditingController();
    Json? est;
    if (!mounted) return;
    final ok = await showFormSheet(
      context,
      title: 'Run a cost estimate',
      saveLabel: 'Run estimate',
      builder: (ctx, setS) {
        final item = items.where((i) => toInt(i['item_id']) == itemId).firstOrNull;
        return [
          const Text('Costs one lot of a product from its production BOM and routing on the costing date.', style: TextStyle(color: Brand.muted)),
          const Caps('Item'),
          AppSelect<int>(
            label: 'Item (has a production BOM)',
            required: true,
            value: itemId,
            options: [
              for (final i in items)
                Option(toInt(i['item_id'])!, '${i['item_code']} — ${i['item_name']}',
                    subtitle: i['standard_cost'] != null ? 'Standard ${inr(i['standard_cost'])}' : 'No standard price'),
            ],
            onChanged: (o) => setS(() {
              itemId = o?.value;
              bomId = null;
            }),
          ),
          if (item != null)
            AppSelect<int>(
              label: 'BOM version',
              value: bomId,
              valueLabel: bomId == null ? 'Default (released BOM)' : null,
              options: [
                for (final b in listOf(item['boms']))
                  Option(toInt(b['id'])!, '${b['bom_number']} v${b['version']} (${b['status']})', subtitle: 'Base qty ${b['base_quantity']}'),
              ],
              onChanged: (o) => setS(() => bomId = o?.value),
            ),
          DateField(label: 'Costing date', value: date, onChanged: (d) => setS(() => date = d)),
          AppTextField(label: 'Lot size', controller: lot, keyboardType: AppTextField.number, hint: 'Blank = BOM base'),
          const Caps('Overhead'),
          AppTextField(label: 'Material OH %', controller: mat, keyboardType: AppTextField.number, hint: 'Blank = costing sheet'),
          AppTextField(label: 'Labour OH %', controller: lab, keyboardType: AppTextField.number, hint: 'Blank = costing sheet'),
          AppTextField(label: 'Remarks', controller: remarks),
        ];
      },
      onSave: () async {
        if (itemId == null) throw 'Pick the item to cost.';
        est = asJson(await Api.post('$_pc/estimates', data: {
          'item_id': itemId,
          'bom_id': ?bomId,
          if (date != null) 'costing_date': apiDate(date!),
          if (lot.text.trim().isNotEmpty) 'lot_size': double.tryParse(lot.text),
          if (mat.text.trim().isNotEmpty) 'material_overhead_pct': double.tryParse(mat.text),
          if (lab.text.trim().isNotEmpty) 'labour_overhead_pct': double.tryParse(lab.text),
          if (remarks.text.trim().isNotEmpty) 'remarks': remarks.text.trim(),
        }));
      },
    );
    if (ok && est != null && mounted) {
      showSnack(context, '${est!['estimate_number']} costed: ${inr(est!['total_cost'])} for a lot of ${est!['lot_size']} (unit ${inr(est!['unit_cost'])}).');
      _list.currentState?.reload();
      await openScreen(context, _EstimateScreen(id: toInt(est!['id'])!));
      _list.currentState?.reload();
    }
  }

  @override
  Widget build(BuildContext context) => Scaffold(
        backgroundColor: Colors.transparent,
        floatingActionButton: finCan('product_costing', 'create') ? CreateFab(label: 'Run cost estimate', onPressed: _run) : null,
        body: ApiListView(
          key: _list,
          searchHint: 'Search estimate or item',
          load: (p, s) async => ApiPage(asRows(await Api.get('$_pc/estimates', query: {'search': s, 'status': _status}))),
          header: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
            const InfoBanner(
                'A cost estimate costs one lot of a product from its production BOM and routing on the costing date: components (a sub-assembly takes its own released estimate, '
                'else its BOM is rolled up), job-work charges, routing hours × activity rate, and costing-sheet overhead. Mark it, then a controller releases it — that sets the '
                "item's standard price from the chosen date and keeps the old price in the history. No journal is posted (periodic inventory)."),
            ChipRow([
              for (final e in _estLabels.entries)
                CountChip(e.value, null,
                    selected: _status == e.key,
                    color: _estHex[e.key],
                    onTap: () => setState(() {
                          _status = _status == e.key ? null : e.key;
                          _list.currentState?.reload();
                        })),
            ]),
          ]),
          emptyText: 'No cost estimates yet.',
          itemBuilder: (ctx, r, reload) => RecordCard(
            code: '${r['estimate_number']}',
            title: '${r['item_code']} — ${r['item_name']}',
            subtitle: '${r['bom_number'] ?? ''}${r['bom_version'] != null ? ' v${r['bom_version']}' : ''}',
            trailing: FinStatusPill(r['status'], labels: _estLabels, colors: _estHex),
            meta: [
              ('Costing date', fmtDate(r['costing_date'])),
              ('Lot', fmtNumber(r['lot_size'])),
              ('Material', inr(r['material_cost'])),
              ('Job work', inr(r['job_work_cost'])),
              ('Labour', inr(r['labour_cost'])),
              ('Overhead', inr(r['overhead_cost'])),
              ('Unit cost', inr(r['unit_cost'])),
              if (r['valid_from'] != null) ('Valid', '${fmtDate(r['valid_from'])} → ${r['valid_to'] != null ? fmtDate(r['valid_to']) : 'open'}'),
            ],
            onTap: () async {
              await openScreen(ctx, _EstimateScreen(id: toInt(r['id'])!));
              reload();
            },
          ),
        ),
      );
}

class _EstimateScreen extends StatefulWidget {
  const _EstimateScreen({required this.id});
  final int id;

  @override
  State<_EstimateScreen> createState() => _EstimateScreenState();
}

class _EstimateScreenState extends State<_EstimateScreen> {
  int _tick = 0;

  Future<void> _act(Future<dynamic> Function() fn, String done) async {
    if (await runAction(context, fn, success: done)) setState(() => _tick++);
  }

  @override
  Widget build(BuildContext context) => ApiLoader<(Json, List<Json>)>(
        key: ValueKey(_tick),
        load: () async {
          final e = asJson(await Api.get('$_pc/estimates/${widget.id}'));
          final h = finCanFeature('product_costing', 'price_history', 'view')
              ? asRows(await Api.get('$_pc/price-history', query: {'item_id': e['item_id']}))
              : <Json>[];
          return (e, h);
        },
        builder: (ctx, data, _) {
          final (e, history) = data;
          final n = '${e['estimate_number']}';
          final s = e['status'];
          final canMark = finCan('product_costing', 'edit');
          final actions = <Widget>[
            if (s == 'draft' && canMark)
              actionBtn('Mark for release', () => _act(() => Api.post('$_pc/estimates/${e['id']}/mark'), '$n marked — a controller can now release it.'),
                  primary: true),
            if (s == 'marked' && finCan('product_costing', 'approve'))
              actionBtn('Release to standard price', () async {
                DateTime from = DateTime.now();
                final ok = await showFormSheet(
                  context,
                  title: 'Release $n',
                  saveLabel: 'Release',
                  builder: (c, setS) => [
                    Text('${e['item_code']} — ${e['item_name']}', style: const TextStyle(color: Brand.muted)),
                    Text(
                        'Standard price of ${e['item_code']}: ${e['current_standard_cost'] == null ? 'not set' : inr(e['current_standard_cost'])} → ${inr(e['unit_cost'])}. '
                        'The previously released price ends the day before the date below. No journal is posted.'),
                    DateField(label: 'Valid from', required: true, value: from, onChanged: (d) => setS(() => from = d ?? from)),
                  ],
                  onSave: () async => Api.post('$_pc/estimates/${e['id']}/release', data: {'valid_from': apiDate(from)}),
                );
                if (ok && context.mounted) {
                  showSnack(context, "$n released — the item's standard price is updated.");
                  setState(() => _tick++);
                }
              }, primary: true),
            if (s == 'marked' && canMark)
              actionBtn('Unmark', () async {
                final ok = await confirmDialog(context,
                    title: 'Remove the mark?', message: "The estimate goes back to draft and can't be released until it is marked again.", confirmLabel: 'Unmark');
                if (ok) _act(() => Api.post('$_pc/estimates/${e['id']}/unmark'), '$n is a draft again.');
              }),
            if ((s == 'draft' || s == 'marked') && finCan('product_costing', 'delete'))
              actionBtn('Cancel estimate', () async {
                final reason = await promptDialog(context,
                    title: 'Cancel cost estimate', message: 'Why is this estimate being cancelled? (kept on the audit trail)', confirmLabel: 'Cancel estimate');
                if (reason != null) _act(() => Api.post('$_pc/estimates/${e['id']}/cancel', data: {'reason': reason}), '$n cancelled.');
              }, danger: true),
          ];
          final lines = listOf(e['lines']);
          final warnings = [for (final w in (e['warnings'] is List ? e['warnings'] as List : const [])) '$w'];
          return SubPage(
            title: n,
            bottom: actions.isEmpty ? null : ActionBar(actions),
            body: ListView(padding: const EdgeInsets.only(top: 12, bottom: 24), children: [
              padded(Wrap(spacing: 8, runSpacing: 6, crossAxisAlignment: WrapCrossAlignment.center, children: [
                FinStatusPill(s, labels: _estLabels, colors: _estHex),
                Text('${e['item_code']} — ${e['item_name']}', style: const TextStyle(fontWeight: FontWeight.w600)),
              ])),
              padded(Text(
                  'BOM ${e['bom_number'] ?? ''} v${e['bom_version'] ?? ''} · costing date ${fmtDate(e['costing_date'])} · lot ${fmtNumber(e['lot_size'])}'
                  '${e['created_by_name'] != null ? ' · by ${e['created_by_name']}' : ''}'
                  '${e['released_by_name'] != null ? ' · released by ${e['released_by_name']} ${fmtDate(e['released_at'])}' : ''}'
                  '${e['cancelled_reason'] != null ? ' · cancelled: ${e['cancelled_reason']}' : ''}',
                  style: const TextStyle(fontSize: 12, color: Brand.muted))),
              StatGrid([
                StatCard('Material', inr(e['material_cost'])),
                StatCard('Job work', inr(e['job_work_cost'])),
                StatCard('Labour', inr(e['labour_cost'])),
                StatCard('Overhead (${e['material_overhead_pct']}% / ${e['labour_overhead_pct']}%)', inr(e['overhead_cost'])),
                StatCard('Total (lot)', inr(e['total_cost'])),
                StatCard('Unit cost', inr(e['unit_cost']), tone: const Color(0xFF0F766E)),
                StatCard('Current standard', e['current_standard_cost'] == null ? '—' : inr(e['current_standard_cost'])),
              ]),
              if (warnings.isNotEmpty) InfoBanner('Check before marking:\n${warnings.map((w) => '• $w').join('\n')}', tone: Tone.warning),
              SectionTitle('Cost lines (${lines.length})'),
              for (final l in lines)
                Padding(
                  padding: EdgeInsets.only(left: ((toInt(l['level']) ?? 0) * 10).toDouble().clamp(0, 40)),
                  child: RecordCard(
                    code: 'L${l['level']} · ${l['line_type']}',
                    title: '${l['item_code'] ?? ''} ${l['description'] ?? l['operation_name'] ?? ''}'.trim(),
                    subtitle: _sourceLabels['${l['cost_source']}'] ?? '${l['cost_source']}',
                    meta: [
                      ('Qty', '${fmtNumber(l['quantity'])} ${l['uom'] ?? ''}'),
                      ('Unit', inr(l['unit_cost'])),
                      if (toD(l['material_amount']) != 0) ('Material', inr(l['material_amount'])),
                      if (toD(l['job_work_amount']) != 0) ('Job work', inr(l['job_work_amount'])),
                      if (toD(l['labour_amount']) != 0) ('Labour', inr(l['labour_amount'])),
                      if (toD(l['overhead_amount']) != 0) ('Overhead', inr(l['overhead_amount'])),
                      ('Amount', inr(l['amount'])),
                    ],
                  ),
                ),
              if (history.isNotEmpty) ...[
                const SectionTitle('Standard price history'),
                for (final h in history)
                  RecordCard(
                    title: inr(h['standard_cost']),
                    subtitle: '${h['estimate_number'] ?? h['source'] ?? ''}${h['released_by_name'] != null ? ' · ${h['released_by_name']}' : ''}',
                    meta: [
                      ('Valid from', fmtDate(h['valid_from'])),
                      ('Valid to', h['valid_to'] != null ? fmtDate(h['valid_to']) : 'open'),
                      ('Previous', h['previous_cost'] == null ? '—' : inr(h['previous_cost'])),
                    ],
                  ),
              ],
            ]),
          );
        },
      );
}

// ── Order variance ───────────────────────────────────────────────────────────

class _OrderVariance extends StatefulWidget {
  const _OrderVariance();

  @override
  State<_OrderVariance> createState() => _OrderVarianceState();
}

class _OrderVarianceState extends State<_OrderVariance> {
  final _list = GlobalKey<ApiListViewState>();
  String? _status;

  @override
  Widget build(BuildContext context) => ApiListView(
        key: _list,
        load: (p, s) async => ApiPage(asRows(await Api.get('$_pc/work-orders', query: {'status': _status}))),
        header: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
          const InfoBanner(
              "Plan = the product's released cost estimate × planned quantity. Target = the same for the quantity completed (planned quantity while nothing is completed). "
              'Actual = material issued − returned at the value actually issued, labour booked on the shop floor, and overhead from the period-end run. Positive variance = over target.'),
          ChipRow([
            for (final e in _woLabels.entries)
              CountChip(e.value, null,
                  selected: _status == e.key,
                  onTap: () => setState(() {
                        _status = _status == e.key ? null : e.key;
                        _list.currentState?.reload();
                      })),
          ]),
        ]),
        emptyText: 'No work orders.',
        itemBuilder: (ctx, r, _) => RecordCard(
          code: '${r['wo_number']}',
          title: '${r['product_label']}',
          trailing: StatusBadge(_woLabels['${r['status']}'] ?? r['status']),
          meta: [
            ('Planned', fmtNumber(r['quantity_planned'])),
            ('Done', fmtNumber(r['quantity_completed'])),
            ('Plan from', '${r['estimate_number'] ?? r['plan_source'] ?? '—'}'),
            ('Plan', inr(r['plan_total'])),
            ('Target', inr(r['target_total'])),
            ('Actual', inr(r['actual_total'])),
            ('Variance', '${inr(r['total_variance'])}${r['total_variance_pct'] != null ? ' (${r['total_variance_pct']}%)' : ''}'),
          ],
          onTap: () => openScreen(ctx, _VarianceScreen(id: toInt(r['work_order_id'])!, number: '${r['wo_number']}')),
        ),
      );
}

class _VarianceScreen extends StatelessWidget {
  const _VarianceScreen({required this.id, required this.number});
  final int id;
  final String number;

  @override
  Widget build(BuildContext context) => SubPage(
        title: number,
        body: ApiLoader<Json>(
          load: () async => asJson(await Api.get('$_pc/work-orders/$id')),
          builder: (ctx, v, _) {
            final split = asJson(v['variance_split']);
            return ListView(padding: const EdgeInsets.only(top: 12, bottom: 24), children: [
              padded(Text('${v['product_label']} · ${_woLabels['${v['status']}'] ?? v['status']} · ${v['target_basis'] ?? ''}',
                  style: const TextStyle(color: Brand.muted))),
              if (v['plan_message'] != null) InfoBanner('${v['plan_message']}', tone: Tone.warning),
              StatGrid([
                StatCard('Target', inr(v['target_total'])),
                StatCard('Actual', inr(v['actual_total'])),
                StatCard('Variance', '${inr(v['total_variance'])}${v['total_variance_pct'] != null ? ' (${v['total_variance_pct']}%)' : ''}',
                    tone: _varColor(v['total_variance'])),
                StatCard('Input quantity var.', inr(split['input_quantity']), tone: _varColor(split['input_quantity'])),
                StatCard('Input price var.', inr(split['input_price']), tone: _varColor(split['input_price'])),
                StatCard('Resource usage var.', inr(split['resource_usage']), tone: _varColor(split['resource_usage'])),
                StatCard('Labour rate var.', inr(split['rate']), tone: _varColor(split['rate'])),
                StatCard('Scrap (at plan)', inr(v['scrap_variance'])),
                StatCard('Received to stock', inr(v['relieved_to_stock'])),
                StatCard('Open WIP', inr(v['open_wip'])),
              ]),
              const SectionTitle('Cost components'),
              for (final c in listOf(v['components']))
                RecordCard(
                  title: _componentLabels['${c['component']}'] ?? '${c['component']}',
                  trailing: StatusBadge(inr(c['variance']), color: _varColor(c['variance'])),
                  meta: [
                    ('Plan', inr(c['plan'])),
                    ('Target', inr(c['target'])),
                    ('Actual', inr(c['actual'])),
                    ('Var. %', c['variance_pct'] == null ? '—' : '${c['variance_pct']}%'),
                  ],
                ),
              if (listOf(v['materials']).isNotEmpty) const SectionTitle('Materials'),
              for (final m in listOf(v['materials']))
                RecordCard(
                  code: '${m['item_code'] ?? ''}',
                  title: '${m['item_name'] ?? ''}${m['planned'] == false ? ' (not planned)' : ''}',
                  trailing: StatusBadge(inr(m['total_variance']), color: _varColor(m['total_variance'])),
                  meta: [
                    ('Target qty', '${fmtNumber(m['target_qty'])} ${m['uom'] ?? ''}'),
                    ('Actual qty', fmtNumber(m['actual_qty'])),
                    ('Plan rate', inr(m['plan_rate'])),
                    ('Target', inr(m['target_amount'])),
                    ('Actual', inr(m['actual_amount'])),
                    ('Qty var.', inr(m['quantity_variance'])),
                    ('Price var.', inr(m['price_variance'])),
                  ],
                ),
              if (listOf(v['labour']).isNotEmpty) const SectionTitle('Labour'),
              for (final l in listOf(v['labour']))
                RecordCard(
                  title: '${l['workstation']}',
                  trailing: StatusBadge(inr(l['total_variance']), color: _varColor(l['total_variance'])),
                  meta: [
                    ('Target h', fmtNumber(l['target_hours'])),
                    ('Actual h', fmtNumber(l['actual_hours'])),
                    ('Plan rate', inr(l['plan_rate'])),
                    ('Target', inr(l['target_amount'])),
                    ('Actual', inr(l['actual_amount'])),
                    ('Usage var.', inr(l['usage_variance'])),
                    ('Rate var.', inr(l['rate_variance'])),
                  ],
                ),
            ]);
          },
        ),
      );
}

// ── Profit centres ───────────────────────────────────────────────────────────

class _ProfitCentres extends StatefulWidget {
  const _ProfitCentres();

  @override
  State<_ProfitCentres> createState() => _ProfitCentresState();
}

class _ProfitCentresState extends State<_ProfitCentres> {
  int _tick = 0;

  Future<void> _form(Json meta, List<Json> rows, {Json? p}) async {
    final code = TextEditingController(text: '${p?['code'] ?? ''}');
    final name = TextEditingController(text: '${p?['name'] ?? ''}');
    String segment = '${p?['segment'] ?? 'machines'}';
    int? branch = toInt(p?['branch_id']);
    int? parent = toInt(p?['parent_id']);
    DateTime? from = isoToDate(p?['valid_from']);
    DateTime? to = isoToDate(p?['valid_to']);
    String status = '${p?['status'] ?? 'active'}';
    bool isDefault = p?['is_default'] == true;
    final desc = TextEditingController(text: '${p?['description'] ?? ''}');
    final ok = await showFormSheet(
      context,
      title: p != null ? 'Edit ${p['code']}' : 'New profit centre',
      builder: (ctx, setS) => [
        const Text('Per plant and business line (new machines, service, spares), plus a corporate default.', style: TextStyle(color: Brand.muted)),
        const Caps('Profit centre'),
        AppTextField(label: 'Code', required: true, controller: code, hint: 'PC-P1-MAC'),
        AppTextField(label: 'Name', required: true, controller: name),
        AppSelect<String>(
            label: 'Business line',
            value: segment,
            clearable: false,
            options: [for (final s in listOf(meta['segments'])) Option('${s['value']}', '${s['label']}')],
            onChanged: (o) => setS(() => segment = o?.value ?? segment)),
        AppSelect<int>(
            label: 'Plant',
            value: branch,
            valueLabel: branch == null ? 'Company-wide' : null,
            options: [for (final b in listOf(meta['branches'])) Option(toInt(b['id'])!, '${b['code']} — ${b['name']}')],
            onChanged: (o) => setS(() => branch = o?.value)),
        AppTextField(label: 'Description', controller: desc),
        const Caps('Hierarchy'),
        AppSelect<int>(
            label: 'Parent',
            value: parent,
            valueLabel: parent == null ? '— none —' : null,
            options: [
              for (final r in rows)
                if (toInt(r['id']) != toInt(p?['id'])) Option(toInt(r['id'])!, '${r['code']} — ${r['name']}'),
            ],
            onChanged: (o) => setS(() => parent = o?.value)),
        const Caps('Validity & status'),
        DateField(label: 'Valid from', value: from, onChanged: (d) => setS(() => from = d)),
        DateField(label: 'Valid to', value: to, onChanged: (d) => setS(() => to = d)),
        AppSelect<String>(
            label: 'Status',
            value: status,
            clearable: false,
            options: const [Option('active', 'Active'), Option('inactive', 'Inactive')],
            onChanged: (o) => setS(() => status = o?.value ?? status)),
        CheckField(
            label: 'Company default (catches lines nothing else derives a profit centre for)', value: isDefault, onChanged: (v) => setS(() => isDefault = v)),
      ],
      onSave: () async {
        requireField(code.text, 'Code');
        requireField(name.text, 'Name');
        final payload = {
          'code': code.text.trim(),
          'name': name.text.trim(),
          'segment': segment,
          'branch_id': branch,
          'parent_id': parent,
          'valid_from': dateOrNull(from),
          'valid_to': dateOrNull(to),
          'status': status,
          'is_default': isDefault,
          'description': desc.text.trim().isEmpty ? null : desc.text.trim(),
        };
        if (p != null) {
          await Api.patch('/accounts/profit-centers/${p['id']}', data: payload);
        } else {
          await Api.post('/accounts/profit-centers', data: payload);
        }
      },
    );
    if (ok) {
      if (mounted) showSnack(context, 'Profit centre ${code.text.trim().toUpperCase()} saved.');
      setState(() => _tick++);
    }
  }

  Future<void> _assign(Json payload, List<Json> rows, int? current) async {
    int? pc = current;
    final ok = await showFormSheet(
      context,
      title: 'Assign profit centre',
      builder: (ctx, setS) => [
        AppSelect<int>(
          label: 'Profit centre',
          value: pc,
          valueLabel: pc == null ? '— none —' : null,
          options: [for (final r in rows) Option(toInt(r['id'])!, '${r['code']} — ${r['name']}')],
          onChanged: (o) => setS(() => pc = o?.value),
        ),
      ],
      onSave: () async => Api.post('/accounts/profit-centers/assign', data: {...payload, 'profit_center_id': pc}),
    );
    if (ok) {
      if (mounted) showSnack(context, 'Assignment saved — new postings derive the profit centre from it.');
      setState(() => _tick++);
    }
  }

  @override
  Widget build(BuildContext context) {
    final canAssign = finCanFeature('profit_centers', 'assignment', 'edit');
    return ApiLoader<(List<Json>, Json)>(
      key: ValueKey(_tick),
      load: () async => (asRows(await Api.get('/accounts/profit-centers')), asJson(await Api.get('/accounts/profit-centers/meta'))),
      builder: (ctx, data, _) {
        final (rows, meta) = data;
        String pcCode(Object? id) => rows.where((r) => toInt(r['id']) == toInt(id)).map((r) => '${r['code']}').firstOrNull ?? '—';
        return Scaffold(
          backgroundColor: Colors.transparent,
          floatingActionButton: finCan('profit_centers', 'create') ? CreateFab(label: 'New profit centre', onPressed: () => _form(meta, rows)) : null,
          body: ListView(padding: const EdgeInsets.only(bottom: 88), children: [
            const InfoBanner(
                "Every journal line gets a profit centre at posting: the one picked on the line, else its cost centre's (or the cost centre's plant default), else the "
                "internal order's cost centre's, else the sales order / service request behind a sales invoice (plant + business line), else the company default. "
                'Set one profit centre as the company default so nothing is left unassigned.'),
            if (canAssign)
              padded(actionBtn('Fill blanks on past postings', () async {
                final ok = await confirmDialog(context,
                    title: 'Fill profit centre on past postings?',
                    message:
                        "Posted journal lines that have no profit centre get one derived with today's master data. Lines that already have one are never changed, and balances don't move.",
                    confirmLabel: 'Fill blanks');
                if (!ok || !context.mounted) return;
                try {
                  final r = asJson(await Api.post('/accounts/profit-centers/rederive', data: {}));
                  if (context.mounted) {
                    showSnack(context,
                        'Profit centre filled on ${r['lines_updated']} line(s); ${r['lines_still_unassigned']} still unassigned (set a company default profit centre to catch them).');
                  }
                } catch (e) {
                  if (context.mounted) showSnack(context, 'Could not fill profit centres. ${ApiClient.describe(e)}', error: true);
                }
              })),
            if (rows.isEmpty)
              const EmptyView('No profit centres yet — create one per plant and business line (new machines, service, spares) plus a corporate default.'),
            for (final p in sortByCode(rows, 'code'))
              RecordCard(
                code: '${p['code']}${p['is_default'] == true ? ' · DEFAULT' : ''}',
                title: '${p['name']}',
                subtitle: '${p['segment_label'] ?? ''} · ${p['branch_name'] ?? 'Company-wide'}',
                trailing: StatusBadge(p['status']),
                meta: [
                  ('Parent', txt(p['parent_code'])),
                  (
                    'Validity',
                    p['valid_from'] != null || p['valid_to'] != null
                        ? '${p['valid_from'] != null ? fmtDate(p['valid_from']) : '…'} → ${p['valid_to'] != null ? fmtDate(p['valid_to']) : 'open'}'
                        : 'Always'
                  ),
                  ('Cost centres', (p['cost_center_codes'] is List && (p['cost_center_codes'] as List).isNotEmpty) ? (p['cost_center_codes'] as List).join(', ') : '—'),
                ],
                onTap: () => showModalBottomSheet<void>(
                  context: ctx,
                  builder: (s) => SafeArea(
                    child: Column(mainAxisSize: MainAxisSize.min, children: [
                      if (finCan('profit_centers', 'edit'))
                        ListTile(title: const Text('Edit'), onTap: () {
                          Navigator.pop(s);
                          _form(meta, rows, p: p);
                        }),
                      if (finCan('profit_centers', 'delete'))
                        ListTile(
                          title: const Text('Delete', style: TextStyle(color: Brand.danger)),
                          onTap: () async {
                            Navigator.pop(s);
                            final ok = await confirmDialog(context,
                                title: 'Delete ${p['code']}?',
                                message: 'Only a profit centre nothing points at can be deleted. One with postings should be set inactive instead.',
                                confirmLabel: 'Delete',
                                danger: true);
                            if (ok && context.mounted &&
                                await runAction(context, () => Api.delete('/accounts/profit-centers/${p['id']}'), success: '${p['code']} deleted.')) {
                              setState(() => _tick++);
                            }
                          },
                        ),
                    ]),
                  ),
                ),
              ),
            const SectionTitle('Cost centre → profit centre'),
            if (listOf(meta['cost_centers']).isEmpty) padded(const Text('No cost centres (Organization › Plants).', style: TextStyle(color: Brand.muted))),
            for (final c in listOf(meta['cost_centers']))
              RecordCard(
                title: '${c['code']} — ${c['name']}',
                meta: [('Profit centre', pcCode(c['profit_center_id']))],
                onTap: canAssign ? () => _assign({'cost_center_id': c['id']}, rows, toInt(c['profit_center_id'])) : null,
              ),
            const SectionTitle('Plant default profit centre'),
            for (final b in listOf(meta['branches']))
              RecordCard(
                title: '${b['code']} — ${b['name']}',
                meta: [('Default profit centre', pcCode(b['default_profit_center_id']))],
                onTap: canAssign ? () => _assign({'branch_id': b['id']}, rows, toInt(b['default_profit_center_id'])) : null,
              ),
          ]),
        );
      },
    );
  }
}

// ── Profit centre P&L ────────────────────────────────────────────────────────

class _PcPl extends StatefulWidget {
  const _PcPl();

  @override
  State<_PcPl> createState() => _PcPlState();
}

class _PcPlState extends State<_PcPl> {
  DateTime? _from = fyStart();
  DateTime? _to = DateTime.now();
  String _group = 'profit_center';
  int _tick = 0;

  @override
  Widget build(BuildContext context) => ListView(padding: const EdgeInsets.only(bottom: 24), children: [
        DateRangeRow(from: _from, to: _to, onChanged: (f, t) => setState(() {
              _from = f;
              _to = t;
            })),
        padded(Row(children: [
          Expanded(
            child: AppSelect<String>(
              label: 'Columns',
              value: _group,
              clearable: false,
              options: const [Option('profit_center', 'Profit centre'), Option('plant', 'Plant'), Option('segment', 'Business line')],
              onChanged: (o) => setState(() {
                _group = o?.value ?? _group;
                _tick++;
              }),
            ),
          ),
          const SizedBox(width: 8),
          actionBtn('Show', () => setState(() => _tick++), primary: true),
        ])),
        ApiLoader<Json>(
          key: ValueKey('pl$_tick'),
          load: () async => asJson(await Api.get('/accounts/profit-centers/report/pl',
              query: {'from_date': dateOrNull(_from), 'to_date': dateOrNull(_to), 'group_by': _group})),
          builder: (ctx, d, _) {
            final cols = listOf(d['columns']);
            final ti = asJson(d['total_income']);
            final te = asJson(d['total_expenses']);
            final pr = asJson(d['profit']);
            return Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
              if (d['unassigned_lines'] == true)
                const InfoBanner(
                    'Some posted lines have no profit centre (column "Unassigned"). Set a company default profit centre and use "Fill blanks on past postings" on the Profit Centres tab.',
                    tone: Tone.warning),
              StatGrid([
                StatCard('Income', inr(d['grand_total_income'])),
                StatCard('Expenses', inr(d['grand_total_expenses'])),
                StatCard('Profit', inr(d['grand_profit']), tone: toD(d['grand_profit']) < 0 ? _red : _green),
              ]),
              for (final c in cols)
                DetailSection('${c['label']}', children: [
                  AmountRow('Income', inr(ti['${c['key']}'] ?? 0)),
                  AmountRow('Expenses', inr(te['${c['key']}'] ?? 0)),
                  AmountRow('Profit', inr(pr['${c['key']}'] ?? 0), bold: true, color: toD(pr['${c['key']}']) < 0 ? _red : null),
                ]),
              const SectionTitle('By head'),
              for (final r in listOf(d['rows']))
                _HeadCard(row: r, cols: cols),
            ]);
          },
        ),
      ]);
}

class _HeadCard extends StatefulWidget {
  const _HeadCard({required this.row, required this.cols});
  final Json row;
  final List<Json> cols;

  @override
  State<_HeadCard> createState() => _HeadCardState();
}

class _HeadCardState extends State<_HeadCard> {
  bool _open = false;

  @override
  Widget build(BuildContext context) {
    final r = widget.row;
    final amounts = asJson(r['amounts']);
    return DetailSection(
      '${r['label']}${r['income'] == true ? ' (income)' : ''}',
      action: TextButton(onPressed: () => setState(() => _open = !_open), child: Text(_open ? 'Hide ledgers' : 'Ledgers')),
      children: [
        for (final c in widget.cols)
          if (toD(amounts['${c['key']}']) != 0) AmountRow('${c['label']}', inr(amounts['${c['key']}'])),
        AmountRow('Total', inr(r['total']), bold: true),
        if (_open)
          for (final l in listOf(r['ledgers'])) AmountRow('${l['code']} — ${l['name']}', inr(l['total']), color: Brand.muted),
      ],
    );
  }
}

// ── Profitability ────────────────────────────────────────────────────────────

const _groups = {'sales_order': 'Sales order', 'machine': 'Machine', 'product': 'Product', 'customer': 'Customer'};
const _kindLabels = {'revenue': 'Revenue', 'production_cost': 'Production cost', 'direct_cost': 'Direct material', 'service_cost': 'Service spares'};

class _Profitability extends StatefulWidget {
  const _Profitability();

  @override
  State<_Profitability> createState() => _ProfitabilityState();
}

class _ProfitabilityState extends State<_Profitability> {
  String _group = 'sales_order';
  DateTime? _from;
  DateTime? _to;
  int _tick = 0;

  void _drill(Json r) {
    final key = r['key'];
    openScreen(
      context,
      SubPage(
        title: 'Line items — ${r['label'] ?? 'Not linked'}',
        body: ApiLoader<Json>(
          load: () async => asJson(await Api.get('/accounts/reports/profitability/line-items', query: {
            'group_by': _group,
            'key': key == null ? null : '$key',
            'from_date': dateOrNull(_from),
            'to_date': dateOrNull(_to),
          })),
          builder: (ctx, d, _) {
            final items = listOf(d['items']);
            return ListView(padding: const EdgeInsets.only(top: 12, bottom: 24), children: [
              if (items.isEmpty) const EmptyView('No line items.'),
              for (final i in items)
                RecordCard(
                  code: _kindLabels['${i['kind']}'] ?? '${i['kind']}',
                  title: '${i['ref']}',
                  meta: [('Date', fmtDate(i['date'])), ('Amount', inr(i['amount']))],
                ),
            ]);
          },
        ),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final isSO = _group == 'sales_order';
    final canDrill = finCanFeature('profitability', 'line_items', 'view');
    return ListView(padding: const EdgeInsets.only(bottom: 24), children: [
      const InfoBanner(
          "Revenue = posted sales invoices (taxable value, less credit notes) billed from the order / for the machine. Cost = work orders of the machine's RRV build "
          '(material, labour, overhead; a sub-assembly counted once), material issued straight to the machine, and spares consumed on its service requests. '
          "Leave the dates empty for the order's whole life. Quoted margin = order value − order lines at the product's standard price on the order date."),
      padded(AppSelect<String>(
        label: 'Margin per',
        value: _group,
        clearable: false,
        options: [for (final e in _groups.entries) Option(e.key, e.value)],
        onChanged: (o) => setState(() {
          _group = o?.value ?? _group;
          _tick++;
        }),
      )),
      DateRangeRow(
          from: _from,
          to: _to,
          fromLabel: 'From (optional)',
          toLabel: 'To (optional)',
          onChanged: (f, t) => setState(() {
                _from = f;
                _to = t;
              })),
      padded(Align(alignment: Alignment.centerRight, child: actionBtn('Show', () => setState(() => _tick++), primary: true))),
      ApiLoader<Json>(
        key: ValueKey('pf$_tick'),
        load: () async => asJson(await Api.get('/accounts/reports/profitability',
            query: {'group_by': _group, 'from_date': dateOrNull(_from), 'to_date': dateOrNull(_to)})),
        builder: (ctx, d, _) {
          final rows = listOf(d['rows']);
          final tm = toD(d['total_margin']);
          return Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
            StatGrid([
              StatCard('Revenue', inr(d['total_revenue'])),
              StatCard('Cost', inr(d['total_cost'])),
              StatCard('Contribution margin', inr(tm), tone: tm < 0 ? _red : _green),
              StatCard('Margin %', d['total_margin_pct'] == null ? '—' : '${d['total_margin_pct']}%'),
            ]),
            if (rows.isEmpty) const EmptyView('Nothing to show for this selection.'),
            for (final r in rows)
              RecordCard(
                title: '${r['label'] ?? 'Not linked'}',
                subtitle: isSO && (r['lines_without_standard_price'] is List) && (r['lines_without_standard_price'] as List).isNotEmpty
                    ? '* No standard price: ${(r['lines_without_standard_price'] as List).join(', ')}'
                    : (r['so_status'] as String?),
                trailing: StatusBadge(inr(r['contribution_margin']), color: toD(r['contribution_margin']) < 0 ? _red : _green),
                meta: [
                  ('Revenue', inr(r['revenue'])),
                  ('Production', inr(r['production_cost'])),
                  ('Direct material', inr(r['direct_cost'])),
                  ('Service', inr(r['service_cost'])),
                  ('Total cost', inr(r['total_cost'])),
                  ('Margin %', r['margin_pct'] == null ? '—' : '${r['margin_pct']}%'),
                  if (isSO) ...[
                    ('Quoted value', inr(r['quoted_revenue'])),
                    ('Planned cost', inr(r['planned_cost'])),
                    ('Quoted %', r['quoted_margin_pct'] == null ? '—' : '${r['quoted_margin_pct']}%'),
                    ('Δ % pts', r['margin_pct_deviation'] == null ? '—' : '${r['margin_pct_deviation']}'),
                  ],
                ],
                onTap: canDrill ? () => _drill(r) : null,
              ),
            if (isSO)
              padded(const Text('* some order lines have no standard price yet — release a cost estimate for that product (Cost Estimates tab).',
                  style: TextStyle(fontSize: 11.5, color: Brand.muted))),
          ]);
        },
      ),
    ]);
  }
}
