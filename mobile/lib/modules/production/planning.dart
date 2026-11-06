import 'package:dio/dio.dart' show Options;
import 'package:flutter/material.dart';

import '../../api/api.dart';
import '../../theme.dart';
import '../../ui/app_frame.dart';
import '../../ui/files.dart';
import '../../ui/form.dart';
import '../../ui/format.dart';
import '../../ui/perms.dart';
import '../../ui/widgets.dart';
import 'prod_common.dart';
import 'work_orders.dart';

/// Production › Planning - portal planning/page.tsx, planning/mrp/page.tsx,
/// StockRequirementsDrawer.tsx and PlannedOrderForm.tsx.

const _planStatusLabels = <String, String>{'draft': 'Draft', 'released': 'Released', 'in_progress': 'In Progress'};

class PlanningTab extends StatefulWidget {
  const PlanningTab({super.key});

  @override
  State<PlanningTab> createState() => _PlanningTabState();
}

class _PlanningTabState extends State<PlanningTab> {
  final _vis = Vis('production:planning');
  bool _includeDraft = true;
  bool _shortOnly = false;
  Json? _data;
  Object? _error;
  bool _loading = true;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    try {
      final d = mapOf(await Api.get('/production/planning', query: {'include_draft': _includeDraft}));
      if (mounted) {
        setState(() {
          _data = d;
          _error = null;
          _loading = false;
        });
      }
    } catch (e) {
      if (mounted) {
        setState(() {
          _error = e;
          _loading = false;
        });
      }
    }
  }

  Future<void> _raisePr(Json r) async {
    final orders = rowsOf(r['orders']);
    final q = <String, String>{
      'store_item_id': '${r['item_id']}',
      'quantity': '${n(r['shortage_qty']).ceil()}',
      'remarks': 'Material shortage for Production work order(s) ${orders.map((o) => o['wo_number']).join(', ')}.',
    };
    final elements = orders.map((o) => o['order_project_element_id']).toSet();
    if (elements.length == 1 && orders.isNotEmpty && orders.first['order_project_element_id'] != null && orders.first['order_project_id'] != null) {
      q['order_project_id'] = '${orders.first['order_project_id']}';
      q['order_project_element_id'] = '${orders.first['order_project_element_id']}';
    }
    await runAction(context, () => Files.openInPortal('/dashboard/p2p/new?${Uri(queryParameters: q).query}'));
  }

  @override
  Widget build(BuildContext context) {
    final d = _data;
    final reqs = rowsOf(d?['requirements']).where((r) => !_shortOnly || n(r['shortage_qty']) > 0).toList();
    const t = 'requirements';
    final canRaisePr = Perm.hasApp('p2p');
    return RefreshIndicator(
      onRefresh: _load,
      child: ListView(
        padding: const EdgeInsets.only(bottom: 32),
        children: [
          PageHeader('Production Planning', actions: [
            miniBtn('MRP & Planned Orders →', () => openScreen(context, const MrpScreen())),
          ]),
          if (_error != null) Padding(padding: const EdgeInsets.fromLTRB(16, 0, 16, 8), child: ErrorBanner(ApiClient.describe(_error!))),
          if (_loading) const LoadingView(),
          if (d != null) ...[
            if (_vis.section('material_requirements'))
              DetailSection('Material Requirements vs Stock (${reqs.length})', children: [
                const Hint('Outstanding component demand of open work orders against Store stock available (on hand − reserved) across all locations.'),
                CheckField(label: 'Include draft orders', value: _includeDraft, onChanged: (v) {
                  setState(() => _includeDraft = v);
                  _load();
                }),
                CheckField(label: 'Shortages only', value: _shortOnly, onChanged: (v) => setState(() => _shortOnly = v)),
                if (reqs.isEmpty)
                  emptyLine(_shortOnly ? 'No shortages — Store can cover every open work order.' : 'No outstanding material on open work orders.'),
                for (final r in reqs) _reqLine(r, t, canRaisePr),
                if (rowsOf(d['requirements']).any((r) => n(r['shortage_qty']) > 0))
                  const Padding(
                    padding: EdgeInsets.only(top: 8),
                    child: Hint(
                        'Use "Raise PR" to request bought-out items from Procurement (pre-filled, you review before submitting), or "Build" to raise a work order for a sub-assembly that has its own BOM. Once stock arrives, open the work order and click "Top Up Reservation".'),
                  ),
              ]),
            if (_vis.section('workstation_load'))
              DetailSection('Workstation Load', children: [
                const Hint('Remaining planned hours of open operations on released and in-progress orders, in working days at each workstation\'s daily capacity.'),
                if (rowsOf(d['workstation_load']).isEmpty) emptyLine('No workstations set up yet.'),
                for (final w in rowsOf(d['workstation_load'])) _loadLine(w),
              ]),
            if (_vis.section('schedule')) _schedule(rowsOf(d['schedule'])),
          ],
        ],
      ),
    );
  }

  Widget _reqLine(Json r, String t, bool canRaisePr) {
    final short = n(r['shortage_qty']) > 0;
    return LineCard(
      title: '${txt(r['item_code'])} — ${txt(r['item_name'])}',
      onTap: () => openScreen(context, StockRequirementsScreen(itemId: idOf(r['item_id'])!)),
      trailing: Text(short ? fq(r['shortage_qty']) : 'Covered',
          style: TextStyle(fontWeight: FontWeight.w700, color: short ? cRed : cGreen)),
      lines: [
        KV('Needed', '${fq(r['outstanding_qty'])} ${r['uom'] ?? ''}'.trim()),
        if (_vis.column(t, 'reserved')) KV('Reserved', fq(r['reserved_qty'])),
        if (_vis.column(t, 'free_stock')) KV('Free Stock', fq(r['available_qty'])),
        KV('Shortage', short ? fq(r['shortage_qty']) : 'Covered', color: short ? cRed : cGreen, bold: true),
        if (_vis.column(t, 'reorder_level')) KV('Reorder Level', txt(r['reorder_level'])),
        if (_vis.column(t, 'for_work_orders'))
          Padding(
            padding: const EdgeInsets.only(top: 4),
            child: Wrap(spacing: 6, runSpacing: 6, children: [
              for (final o in rowsOf(r['orders']))
                InkWell(
                  onTap: () => openScreen(context, WorkOrderDetail(id: idOf(o['work_order_id'])!)),
                  child: Pill('${o['wo_number']}: ${fq(o['outstanding_qty'])}', woStatusHex['${o['status']}'] ?? cGrey),
                ),
            ]),
          ),
      ],
      actions: [
        if (short && r['make_bom_id'] != null)
          miniBtn('Build', () async {
            await openNewWorkOrder(context,
                bomId: idOf(r['make_bom_id']), bomLabel: '${r['item_code']} — ${r['item_name']}', quantity: num.parse(fq(r['shortage_qty'])));
            _load();
          }),
        if (short && r['make_bom_id'] == null && canRaisePr) miniBtn('Raise PR', () => _raisePr(r)),
      ],
    );
  }

  Widget _loadLine(Json w) {
    final days = n(w['load_days']);
    final c = days > 10 ? cRed : (days > 5 ? cAmber : cGreen);
    return LineCard(
      title: txt(w['workstation_name']),
      lines: [
        Bar((days / 15 * 100).clamp(0, 100), color: c, height: 8),
        const SizedBox(height: 4),
        Hint(
            '${fq(w['remaining_hours'])} h · ${fq(w['open_operations'])} op(s)${w['load_days'] != null ? ' · ${fq(w['load_days'])} day(s)' : (n(w['remaining_hours']) > 0 ? ' · no capacity set' : '')}${w['status'] != null && w['status'] != 'active' ? ' · ${humanize(w['status'])}' : ''}'),
      ],
    );
  }

  Widget _schedule(List<Json> rows) {
    final today = DateTime.now();
    final day = DateTime(today.year, today.month, today.day);
    DateTime? start;
    DateTime? end;
    final times = <DateTime>[];
    for (final s in rows) {
      for (final k in ['planned_start_date', 'planned_end_date']) {
        final t = parseDate(s[k]);
        if (t != null) times.add(DateTime(t.year, t.month, t.day));
      }
    }
    if (times.isNotEmpty) {
      times.add(day);
      times.sort();
      start = times.first;
      end = times.last.add(const Duration(days: 1));
    }
    return DetailSection('Schedule', children: [
      const Hint('Open work orders on their planned dates. The orange line is today.'),
      if (rows.isEmpty) emptyLine('No open work orders.'),
      if (start != null && end != null)
        Padding(
          padding: const EdgeInsets.only(top: 6),
          child: Row(children: [
            Expanded(child: Text(fmtDate(start), style: const TextStyle(fontSize: 11, color: Brand.muted))),
            Text(fmtDate(end.subtract(const Duration(days: 1))), style: const TextStyle(fontSize: 11, color: Brand.muted)),
          ]),
        ),
      for (final s in rows) _scheduleLine(s, start, end, day),
    ]);
  }

  Widget _scheduleLine(Json s, DateTime? start, DateTime? end, DateTime day) {
    final c = s['is_overdue'] == true ? cRed : (woStatusHex['${s['status']}'] ?? cGrey);
    final ps = parseDate(s['planned_start_date']) ?? parseDate(s['planned_end_date']);
    final peBase = parseDate(s['planned_end_date']) ?? ps;
    return LineCard(
      title: txt(s['wo_number']),
      subtitle: txt(s['product_name']),
      onTap: () => openScreen(context, WorkOrderDetail(id: idOf(s['work_order_id'])!)),
      trailing: Pill(_planStatusLabels['${s['status']}'] ?? humanize(s['status']), woStatusHex['${s['status']}'] ?? cGrey),
      lines: [
        if (start == null || end == null || ps == null || peBase == null)
          const Hint('No planned dates')
        else
          LayoutBuilder(builder: (ctx, box) {
            final w = box.maxWidth;
            final span = end.difference(start).inMinutes.toDouble();
            final s0 = DateTime(ps.year, ps.month, ps.day);
            final e0 = DateTime(peBase.year, peBase.month, peBase.day).add(const Duration(days: 1));
            final left = (s0.difference(start).inMinutes / span * w).clamp(0.0, w);
            final width = (e0.difference(s0).inMinutes / span * w).clamp(w * 0.015, w - left);
            final todayX = (day.difference(start).inMinutes / span * w).clamp(0.0, w - 2);
            return SizedBox(
              height: 20,
              child: Stack(children: [
                Positioned.fill(
                    child: Container(decoration: BoxDecoration(color: const Color(0x0A000000), borderRadius: BorderRadius.circular(6)))),
                Positioned(
                  left: left,
                  top: 3,
                  bottom: 3,
                  width: width,
                  child: Container(
                    decoration: BoxDecoration(color: c.withValues(alpha: 0.25), border: Border.all(color: c), borderRadius: BorderRadius.circular(5)),
                    alignment: Alignment.centerLeft,
                    child: FractionallySizedBox(widthFactor: (n(s['progress_percent']) / 100).clamp(0, 1).toDouble(), child: Container(color: c)),
                  ),
                ),
                Positioned(left: todayX, top: 0, bottom: 0, width: 2, child: Container(color: Brand.primary)),
              ]),
            );
          }),
      ],
    );
  }
}

// ── MRP ──────────────────────────────────────────────────────────────────────

const _poStatusLabels = <String, String>{'open': 'Open', 'converted': 'Converted'};
const _poStatusHex = <String, Color>{'open': cBlue, 'converted': cGreen};
const _procHex = <String, Color>{'make': cPurple, 'buy': Color(0xFF0891B2)};
const _excHex = <String, Color>{
  'reschedule_in': cAmber, 'reschedule_out': cBlue, 'cancel': cPurple, 'start_in_past': cRed, 'finish_in_past': cRed,
  'below_safety_stock': cAmber, 'no_product_item': cRed, 'item_inactive': cRed, 'bom_cycle': cRed, 'no_lead_time': cGrey,
  'beyond_horizon': cGrey, 'shortage': cRed,
};
const _prCategories = <String, String>{
  '': 'Suggest from Item Master', 'MKT': 'Market Items', 'PNH': 'Pneumatic & Hydraulic', 'RAW': 'Raw Material',
  'ELE': 'Electrical', 'HWC': 'Hardware & Consumables', 'JOB': 'Job Work', 'OTH': 'Others',
};

class MrpScreen extends StatefulWidget {
  const MrpScreen({super.key});

  @override
  State<MrpScreen> createState() => _MrpScreenState();
}

class _MrpScreenState extends State<MrpScreen> {
  final _vis = Vis('production:planning');
  final _branches = LookupCache('/production/lookups/branches');
  final _branch = Pick();
  final _horizon = TextEditingController(text: '365');
  bool _includeDraft = true;
  bool _includeUnassigned = true;
  bool _running = false;
  bool _busy = false;
  String _tab = 'orders';
  List<Json> _runs = [];
  Json? _run;
  List<Json> _orders = [];
  List<Json> _exceptions = [];
  Map<String, String> _excLabels = {};
  String _excCode = '';
  String _status = 'open';
  String _proc = '';
  String _search = '';
  final Set<int> _selected = {};
  Object? _error;

  bool _pf(String f, String a) => ProdPerm.feat('planning', f, a);
  bool get _canRun => _pf('mrp_run', 'edit');
  bool get _canEdit => _pf('planned_orders', 'edit');
  bool get _canDelete => _pf('planned_orders', 'delete');
  bool get _canCreate => _pf('planned_orders', 'create');
  bool get _canToWo => _pf('convert_wo', 'create');
  bool get _canPr => Perm.hasApp('p2p') && _pf('convert_pr', 'create');

  @override
  void initState() {
    super.initState();
    _loadParams();
    _loadAll();
  }

  Future<void> _loadParams() async {
    try {
      final m = mapOf(await Api.get('/production/mrp/parameters'));
      final params = mapOf(m['parameters']);
      if (!mounted) return;
      setState(() {
        _excLabels = {for (final e in mapOf(m['exception_labels']).entries) e.key: '${e.value}'};
        _horizon.text = '${params['planning_horizon_days'] ?? 365}';
        _includeDraft = params['include_draft_work_orders'] == true;
      });
    } catch (_) {}
  }

  @override
  void dispose() {
    _horizon.dispose();
    super.dispose();
  }

  Future<void> _loadAll() async {
    await Future.wait([_loadOrders(), _loadRuns()]);
  }

  Future<void> _loadOrders() async {
    try {
      final d = await Api.get('/production/mrp/planned-orders',
          query: {'status': _status, 'procurement': _proc, 'branch_id': _branch.id, 'search': _search});
      if (mounted) {
        setState(() {
          _orders = rowsOf(d);
          _selected.removeWhere((id) => !_orders.any((o) => o['id'] == id && o['status'] == 'open'));
        });
      }
    } catch (e) {
      if (mounted) setState(() => _error = e);
    }
  }

  Future<void> _loadRuns() async {
    try {
      final rows = rowsOf(await Api.get('/production/mrp/runs', query: {'branch_id': _branch.id}));
      Json? last;
      for (final r in rows) {
        if (r['status'] == 'completed') {
          last = r;
          break;
        }
      }
      final detail = last == null ? null : mapOf(await Api.get('/production/mrp/runs/${last['id']}'));
      if (mounted) {
        setState(() {
          _runs = rows;
          _run = detail;
        });
      }
      await _loadExceptions();
    } catch (e) {
      if (mounted) setState(() => _error = e);
    }
  }

  Future<void> _loadExceptions() async {
    try {
      final d = await Api.get('/production/mrp/exceptions', query: {'run_id': _run?['id'], 'code': _excCode});
      if (mounted) setState(() => _exceptions = rowsOf(d));
    } catch (e) {
      if (mounted) setState(() => _error = e);
    }
  }

  Future<void> _runMrp() async {
    setState(() {
      _running = true;
      _error = null;
    });
    try {
      final res = await Api.dio.post('/production/mrp/run',
          data: {
            'branch_id': _branch.id,
            'include_unassigned': _branch.id != null ? _includeUnassigned : null,
            'planning_horizon_days': int.tryParse(_horizon.text.trim()),
            'include_draft_work_orders': _includeDraft,
          },
          options: Options(receiveTimeout: const Duration(minutes: 5)));
      final run = mapOf(res.data);
      if (mounted) {
        showSnack(context,
            '${run['run_number']} completed: ${run['planned_orders_created']} planned order(s) (${run['make_orders']} make, ${run['buy_orders']} buy), ${run['exceptions_count']} exception message(s).');
        setState(() => _run = run);
      }
      await _loadAll();
    } catch (e) {
      if (mounted) setState(() => _error = e);
    } finally {
      if (mounted) setState(() => _running = false);
    }
  }

  Future<void> _act(Future<void> Function() fn, {String? success}) async {
    setState(() => _busy = true);
    final ok = await runAction(context, fn, success: success);
    if (ok) await _loadOrders();
    if (mounted) setState(() => _busy = false);
  }

  Future<void> _change(Json o) async {
    final qty = TextEditingController(text: fq(o['quantity']));
    DateTime? start = parseDate(o['start_date']);
    DateTime? finish = parseDate(o['finish_date']);
    var firmed = o['firmed'] == true;
    final saved = await showFormSheet(
      context,
      title: 'Change ${o['order_number']}',
      builder: (ctx, setS) => [
        Hint('${o['item_code']} — ${o['item_name']}'),
        AppTextField(label: 'Quantity', controller: qty, keyboardType: AppTextField.number),
        DateField(label: 'Start', value: start, required: true, onChanged: (d) => setS(() => start = d ?? start)),
        DateField(label: 'Finish', value: finish, required: true, onChanged: (d) => setS(() => finish = d ?? finish)),
        CheckField(label: 'Firmed (kept by the next MRP run)', value: firmed, onChanged: (v) => setS(() => firmed = v)),
        const Hint('Changing the quantity or a date firms the order automatically.'),
      ],
      onSave: () async {
        await Api.patch('/production/mrp/planned-orders/${o['id']}', data: {
          'quantity': numOf(qty.text),
          'start_date': start == null ? null : apiDate(start!),
          'finish_date': finish == null ? null : apiDate(finish!),
          'firmed': firmed,
        });
      },
    );
    if (saved) _loadOrders();
  }

  Future<void> _firm(List<int> ids) => _act(() => Api.post('/production/mrp/planned-orders/firm', data: {'planned_order_ids': ids}),
      success: '${ids.length} planned order(s) firmed — the next MRP run keeps them.');

  Future<void> _toPr(List<int> ids) async {
    var category = '';
    var priority = 'standard';
    var draft = false;
    final remarks = TextEditingController();
    Json? result;
    final saved = await showFormSheet(
      context,
      title: 'Convert to purchase requisition',
      saveLabel: 'Raise PR',
      builder: (ctx, setS) => [
        Hint('${ids.length} buy planned order(s) → one requisition per category and project.'),
        const Hint(
            'Lines come from the Item Master. It goes to the Purchase Requisition approvers set in Organization › Approval Workflows unless saved as a draft.'),
        AppSelect<String>(
          label: 'PR Category',
          value: category,
          clearable: false,
          options: [for (final e in _prCategories.entries) Option(e.key, e.value)],
          onChanged: (o) => setS(() => category = o?.value ?? ''),
        ),
        AppSelect<String>(
          label: 'Priority',
          value: priority,
          clearable: false,
          options: [for (final e in priorityLabels.entries) Option(e.key, e.value)],
          onChanged: (o) => setS(() => priority = o?.value ?? priority),
        ),
        CheckField(label: 'Save as draft (submit from Procurement later)', value: draft, onChanged: (v) => setS(() => draft = v)),
        AppTextField(label: 'Remarks', controller: remarks, maxLines: 2),
      ],
      onSave: () async {
        result = mapOf(await Api.post('/production/mrp/planned-orders/convert-to-requisition', data: {
          'planned_order_ids': ids,
          'category_code': category.isEmpty ? null : category,
          'priority': priority,
          'save_as_draft': draft,
          'remarks': remarks.text.trim().isEmpty ? null : remarks.text.trim(),
        }));
      },
    );
    if (!saved || !mounted) return;
    _selected.clear();
    _loadOrders();
    final r = result ?? <String, dynamic>{};
    await showDialog<void>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('Purchase requisition'),
        content: SingleChildScrollView(
          child: Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.start, children: [
            for (final c in rowsOf(r['created']))
              Padding(
                padding: const EdgeInsets.only(bottom: 8),
                child: Text(
                    '${c['p2p_number']} (${humanize(c['status'])}) — ${c['project_label']}, ${c['category_code']}: ${(c['planned_orders'] is List ? c['planned_orders'] as List : const []).join(', ')}'),
              ),
            for (final e in rowsOf(r['errors']))
              Padding(
                padding: const EdgeInsets.only(bottom: 8),
                child: ErrorBanner('${(e['planned_orders'] is List ? e['planned_orders'] as List : const []).join(', ')}: ${e['detail']}'),
              ),
          ]),
        ),
        actions: [TextButton(onPressed: () => Navigator.pop(ctx), child: const Text('Close'))],
      ),
    );
  }

  Future<void> _newOrder() async {
    final allowed = _vis.options('procurement', const ['make', 'buy'], (v) => v);
    final fromBom = allowed.length == 2;
    final item = Pick();
    final qty = TextEditingController();
    DateTime? finish;
    var proc = fromBom ? '' : allowed.first;
    final remarks = TextEditingController();
    final saved = await showFormSheet(
      context,
      title: 'New planned order',
      saveLabel: 'Create',
      builder: (ctx, setS) => [
        const Hint('A manual, firmed planned order for one item.'),
        AppSelect<int>(
          label: 'Item',
          required: true,
          value: item.id,
          valueLabel: item.label,
          loadOptions: (s) => lookupOptions('/production/lookups/items', query: {'search': s.trim(), 'limit': 50}),
          onChanged: (o) => setS(() => item.set(o)),
        ),
        AppTextField(label: 'Quantity', required: true, controller: qty, keyboardType: AppTextField.number),
        DateField(label: 'Needed by (finish)', required: true, value: finish, onChanged: (d) => setS(() => finish = d)),
        AppSelect<String>(
          label: 'Procurement',
          value: proc,
          clearable: false,
          options: [if (fromBom) const Option('', 'From BOM'), for (final p in allowed) Option(p, p == 'make' ? 'Make' : 'Buy')],
          onChanged: (o) => setS(() => proc = o?.value ?? proc),
        ),
        Hint('Manual planned orders are firmed; the start date is back-scheduled from the lead time${_branch.id != null ? ' for the selected plant' : ''}.'),
        AppTextField(label: 'Remarks', controller: remarks),
      ],
      onSave: () async {
        requireField(item.id, 'Item');
        if (!((numOf(qty.text) ?? 0) > 0)) throw 'Quantity is required - enter more than zero and save again.';
        if (finish == null) throw 'Needed by (finish) is required - fill it in and save again.';
        await Api.post('/production/mrp/planned-orders', data: {
          'item_id': item.id,
          'quantity': numOf(qty.text),
          'finish_date': apiDate(finish!),
          'procurement': proc.isEmpty ? null : proc,
          'branch_id': _branch.id,
          'remarks': remarks.text.trim().isEmpty ? null : remarks.text.trim(),
        });
      },
    );
    if (saved) _loadOrders();
  }

  bool _tabShown(String k) {
    const sections = {'orders': 'planned_orders', 'list': 'mrp_list', 'exceptions': 'exceptions', 'log': 'run_log'};
    return k == 'orders' || _vis.section(sections[k]!);
  }

  @override
  Widget build(BuildContext context) {
    final openCount = _orders.where((o) => o['status'] == 'open').length;
    final tabs = <(String, String)>[
      ('orders', 'Planned Orders ($openCount)'),
      if (_tabShown('list')) ('list', 'MRP List'),
      if (_tabShown('exceptions')) ('exceptions', 'Exceptions${_run != null ? ' · ${_run!['exceptions_count']}' : ''}'),
      if (_tabShown('log')) ('log', 'Run Log'),
    ];
    final shown = tabs.any((t) => t.$1 == _tab) ? _tab : 'orders';
    final openSelected = _orders.where((o) => _selected.contains(o['id']) && o['status'] == 'open').toList();
    final selectedBuy = openSelected.where((o) => o['procurement'] == 'buy').toList();
    final actions = <BarAction>[
      if (_canPr && selectedBuy.isNotEmpty)
        BarAction('Convert to PR (${selectedBuy.length})', primary: true, () => _toPr([for (final o in selectedBuy) idOf(o['id'])!])),
      if (_canEdit && openSelected.isNotEmpty)
        BarAction('Firm selected (${openSelected.length})', () => _firm([for (final o in openSelected) idOf(o['id'])!])),
      if (_canCreate) BarAction('+ New planned order', _newOrder),
    ];
    return SubPage(
      title: 'Material Requirements Planning',
      bottom: actions.isEmpty ? null : BottomActions(actions, busy: _busy),
      body: RefreshIndicator(
        onRefresh: _loadAll,
        child: ListView(
          padding: const EdgeInsets.only(top: 12, bottom: 32),
          children: [
            const Padding(
              padding: EdgeInsets.fromLTRB(16, 0, 16, 12),
              child: Hint(
                  'MRP nets Sales Order schedules, RRV builds without work orders, work-order requirements and reservations against stock, open PR / PO and work-order receipts, level by level through the BOMs, and proposes planned orders: make → work order, buy → purchase requisition.'),
            ),
            if (_error != null) Padding(padding: const EdgeInsets.fromLTRB(16, 0, 16, 12), child: ErrorBanner(ApiClient.describe(_error!))),
            if (_vis.section('mrp_run')) _runSection(),
            SubTabs(tabs: tabs, selected: shown, onSelect: (k) => setState(() => _tab = k)),
            if (shown == 'orders') ..._ordersTab(_canEdit || _canPr),
            if (shown == 'list') _listTab(),
            if (shown == 'exceptions') _excTab(),
            if (shown == 'log') _logTab(),
          ],
        ),
      ),
    );
  }

  Widget _runSection() {
    final run = _run;
    return DetailSection('MRP Run', children: [
      AppSelect<int>(
        label: 'Plant (blank = company-wide)',
        value: _branch.id,
        valueLabel: _branch.label,
        loadOptions: _branches.search,
        onChanged: (o) {
          setState(() => _branch.set(o));
          _loadAll();
        },
      ),
      const SizedBox(height: 10),
      AppTextField(label: 'Horizon (days)', controller: _horizon, keyboardType: TextInputType.number),
      CheckField(label: 'Count draft work orders', value: _includeDraft, onChanged: (v) => setState(() => _includeDraft = v)),
      if (_branch.id != null)
        CheckField(label: 'Include documents without a plant', value: _includeUnassigned, onChanged: (v) => setState(() => _includeUnassigned = v)),
      if (_canRun) miniBtn(_running ? 'Running…' : 'Run MRP', _running ? null : _runMrp, primary: true),
      const SizedBox(height: 8),
      Hint(
          '${run != null ? 'Last run ${run['run_number']} — ${run['branch_name'] ?? 'Company-wide'}, ${fmtDateTime(run['finished_at'])} by ${txt(run['run_by_name'])}: ${run['items_planned']} item(s), ${run['planned_orders_created']} planned order(s), ${run['exceptions_count']} exception(s).' : 'MRP has not been run yet for this plant.'} A run replaces the open planned orders of the previous run for the same plant; firmed and converted orders are kept.'),
    ]);
  }

  List<Widget> _ordersTab(bool selectable) {
    const t = 'planned_orders';
    return [
      Padding(
        padding: const EdgeInsets.fromLTRB(16, 4, 16, 4),
        child: SearchField(
            hint: 'Search order, item or demand…',
            onChanged: (v) {
              _search = v.trim();
              _loadOrders();
            }),
      ),
      ChipRow([
        for (final s in const [('open', 'Open'), ('converted', 'Converted'), ('all', 'All')])
          CountChip(s.$2, null, selected: _status == s.$1, onTap: () {
            setState(() => _status = s.$1);
            _loadOrders();
          }),
        for (final p in const [('', 'Make + buy'), ('make', 'Make'), ('buy', 'Buy')])
          CountChip(p.$2, null, selected: _proc == p.$1, onTap: () {
            setState(() => _proc = p.$1);
            _loadOrders();
          }),
      ]),
      DetailSection('Planned Orders (${_orders.length})', children: [
        if (_orders.isEmpty) emptyLine('No planned orders — run MRP to plan the open demand.'),
        for (final o in _orders) _orderLine(o, t, selectable),
      ]),
    ];
  }

  Widget _orderLine(Json o, String t, bool selectable) {
    final id = idOf(o['id'])!;
    return LineCard(
      title: '${o['order_number']}${o['firmed'] == true ? ' · Firmed' : ''}${o['source'] == 'manual' ? ' · Manual' : ''}',
      subtitle:
          '${txt(o['item_code'])} — ${txt(o['item_name'])}${o['parent_order_number'] != null ? ' · component of ${o['parent_order_number']}' : ''}',
      trailing: Column(crossAxisAlignment: CrossAxisAlignment.end, children: [
        Pill(_poStatusLabels['${o['status']}'] ?? humanize(o['status']), _poStatusHex['${o['status']}'] ?? cGrey),
        if (_vis.column(t, 'type')) ...[
          const SizedBox(height: 4),
          Pill(o['procurement'] == 'make' ? 'Make' : 'Buy', _procHex['${o['procurement']}'] ?? cGrey),
        ],
        if (o['status'] == 'open' && selectable)
          Checkbox(
            value: _selected.contains(id),
            onChanged: (v) => setState(() => v == true ? _selected.add(id) : _selected.remove(id)),
          ),
      ]),
      lines: [
        KV('Qty', '${fq(o['quantity'])} ${o['uom'] ?? ''}'.trim(), bold: true),
        if (_vis.column(t, 'start'))
          KV('Start', fmtDate(o['start_date']), color: o['start_in_past'] == true ? cRed : null, bold: o['start_in_past'] == true),
        if (_vis.column(t, 'finish')) KV('Finish', fmtDate(o['finish_date'])),
        if (_vis.column(t, 'pegged'))
          KV('For (pegged demand)', '${txt(o['demand_label'])}${o['order_project_label'] != null ? ' · ${o['order_project_label']}' : ''}'),
        if (o['converted_number'] != null)
          InkWell(
            onTap: o['converted_type'] == 'work_order' && idOf(o['converted_ref_id']) != null
                ? () => openScreen(context, WorkOrderDetail(id: idOf(o['converted_ref_id'])!))
                : null,
            child: KV('Converted to', '${o['converted_number']}', color: cBlue),
          ),
        InkWell(
          onTap: () => openScreen(context, StockRequirementsScreen(itemId: idOf(o['item_id'])!, branchId: _branch.id)),
          child: const Padding(
              padding: EdgeInsets.only(top: 4), child: Text('Stock / requirements list →', style: TextStyle(color: cBlue, fontSize: 12.5))),
        ),
      ],
      actions: o['status'] == 'open'
          ? [
              if (_canEdit) miniBtn('Change', _busy ? null : () => _change(o)),
              if (_canEdit && o['firmed'] != true) miniBtn('Firm', _busy ? null : () => _firm([id])),
              if (o['procurement'] == 'make' && _canToWo) miniBtn('To WO', _busy ? null : () => _toWo(o)),
              if (o['procurement'] == 'buy' && _canPr) miniBtn('To PR', _busy ? null : () => _toPr([id])),
              if (_canDelete)
                miniBtn('Delete', _busy
                    ? null
                    : () async {
                        final ok = await confirmDialog(context,
                            title: 'Delete planned order?',
                            message:
                                '${o['order_number']} (${o['item_code']}, ${fq(o['quantity'])} ${o['uom'] ?? ''}) will be removed. The next MRP run plans the demand again unless it is covered otherwise.',
                            confirmLabel: 'Delete',
                            danger: true);
                        if (ok) await _act(() => Api.delete('/production/mrp/planned-orders/$id'));
                      }, danger: true),
            ]
          : const [],
    );
  }

  Future<void> _toWo(Json o) async {
    final ok = await confirmDialog(context,
        title: 'Convert to work order?',
        message:
            '${o['order_number']} becomes a draft work order for ${fq(o['quantity'])} ${o['uom'] ?? ''} of ${o['item_code']}, ${fmtDate(o['start_date'])} → ${fmtDate(o['finish_date'])}, from the item\'s active BOM.',
        confirmLabel: 'Convert');
    if (!ok) return;
    Json? res;
    await _act(() async {
      res = mapOf(await Api.post('/production/mrp/planned-orders/${o['id']}/convert-to-work-order', data: {}));
    });
    if (res != null && mounted) {
      showSnack(context,
          '${o['order_number']} converted to draft work order ${res!['converted_number']}. Set its stores and release it from Work Orders.');
    }
  }

  Widget _listTab() {
    const t = 'mrp_list';
    final rows = rowsOf(_run?['item_results']);
    return DetailSection('MRP List (${rows.length})', children: [
      if (rows.isEmpty) emptyLine('No MRP run yet for this plant.'),
      for (final r in rows)
        LineCard(
          title: '${txt(r['item_code'])} — ${txt(r['item_name'])}',
          onTap: () => openScreen(context, StockRequirementsScreen(itemId: idOf(r['item_id'])!, branchId: _branch.id)),
          trailing: Pill(r['procurement'] == 'make' ? 'Make' : 'Buy', _procHex['${r['procurement']}'] ?? cGrey),
          lines: [
            if (_vis.column(t, 'level')) KV('Level', txt(r['low_level_code'])),
            KV('Stock', '${fq(r['stock'])} ${r['uom'] ?? ''}'.trim()),
            if (_vis.column(t, 'safety')) KV('Safety', fq(r['safety_stock'])),
            KV('Requirements', fq(r['requirements_qty'])),
            if (_vis.column(t, 'receipts')) KV('Receipts', fq(r['receipts_qty'])),
            if (_vis.column(t, 'planned')) KV('Planned', n(r['planned_orders']) > 0 ? '${fq(r['planned_qty'])} (${r['planned_orders']})' : '—'),
            KV('Ending Available', fq(r['ending_available']), bold: true, color: n(r['ending_available']) < 0 ? cRed : null),
            KV('Exceptions', n(r['exceptions']) > 0 ? '${r['exceptions']}' : '—', color: n(r['exceptions']) > 0 ? cAmber : null),
          ],
        ),
    ]);
  }

  Widget _excTab() {
    return DetailSection('Exceptions (${_exceptions.length})', children: [
      AppSelect<String>(
        label: 'All exception messages',
        value: _excCode.isEmpty ? null : _excCode,
        options: [for (final e in _excLabels.entries) Option(e.key, e.value)],
        onChanged: (o) {
          setState(() => _excCode = o?.value ?? '');
          _loadExceptions();
        },
      ),
      if (_exceptions.isEmpty) emptyLine('No exception messages in the last run.'),
      for (final e in _exceptions)
        LineCard(
          title: e['item_id'] != null ? '${txt(e['item_code'])} — ${txt(e['item_name'])}' : '—',
          onTap: e['item_id'] != null
              ? () => openScreen(context, StockRequirementsScreen(itemId: idOf(e['item_id'])!, branchId: _branch.id))
              : null,
          trailing: Pill(txt(e['label'] ?? e['code']), _excHex['${e['code']}'] ?? cGrey),
          lines: [
            KV('Unit', txt(e['element_ref'])),
            KV('Date', fmtDate(e['element_date'])),
            KV('Suggested', fmtDate(e['suggested_date'])),
            Hint(txt(e['message'])),
          ],
        ),
    ]);
  }

  Widget _logTab() {
    return DetailSection('Run Log', children: [
      if (_runs.isEmpty) emptyLine('No MRP runs yet.'),
      for (final r in _runs)
        LineCard(
          title: '${r['run_number']} · ${r['branch_name'] ?? 'Company-wide'}',
          subtitle: '${fmtDateTime(r['started_at'])} · ${txt(r['run_by_name'])}',
          trailing: Pill(humanize(r['status']), r['status'] == 'completed' ? cGreen : (r['status'] == 'failed' ? cRed : cAmber)),
          lines: [
            for (final l in rowsOf(r['log'])) Hint(txt(l['message']), color: l['level'] == 'error' ? cRed : Brand.muted),
            if (r['error'] != null) Hint(txt(r['error']), color: cRed),
          ],
        ),
    ]);
  }
}

/// Stock / requirements list for one item (portal StockRequirementsDrawer).
class StockRequirementsScreen extends StatelessWidget {
  const StockRequirementsScreen({super.key, required this.itemId, this.branchId});
  final int itemId;
  final int? branchId;

  static const _short = <String, String>{
    'shortage': 'Shortage', 'reschedule_in': 'Bring in', 'reschedule_out': 'Postpone', 'cancel': 'Cancel',
    'finish_in_past': 'Overdue', 'start_in_past': 'Start in past', 'below_safety_stock': 'Below safety',
  };

  @override
  Widget build(BuildContext context) {
    return SubPage(
      title: 'Stock / Requirements List',
      body: ApiLoader<Json>(
        load: () async => mapOf(await Api.get('/production/mrp/stock-requirements/$itemId', query: {'branch_id': branchId})),
        builder: (ctx, d, reload) => ListView(
          padding: const EdgeInsets.only(top: 12, bottom: 32),
          children: [
            DetailSection('${txt(d['item_code'])} — ${txt(d['item_name'])}', children: [
              KV('Procurement', d['procurement'] == 'make' ? 'Make (${d['bom_number']})' : 'Buy', bold: true),
              KV('Stock', '${fq(d['stock'])} ${d['uom'] ?? ''}'.trim()),
              KV('Safety stock', fq(d['safety_stock'])),
              KV('Lead time', d['lead_time_days'] != null ? '${d['lead_time_days']} day(s)' : 'not set'),
              if (n(d['min_order_qty']) > 0) KV('Min. order qty', fq(d['min_order_qty'])),
              KV('Ending available', fq(d['ending_available']), bold: true, color: n(d['ending_available']) < 0 ? cRed : cGreen),
            ]),
            DetailSection('MRP Elements (${rowsOf(d['rows']).length})', children: [
              for (final r in rowsOf(d['rows']))
                LineCard(
                  title: '${txt(r['element_label'])}${r['firmed'] == true ? ' · Firmed' : ''}',
                  subtitle: '${fmtDate(r['date'])} · ${txt(r['reference'])}${r['pegged_to'] != null ? ' · for ${r['pegged_to']}' : ''}',
                  trailing: Column(crossAxisAlignment: CrossAxisAlignment.end, children: [
                    Text(r['element'] == 'stock' ? fq(r['quantity']) : '${n(r['quantity']) > 0 ? '+' : ''}${fq(r['quantity'])}',
                        style: TextStyle(
                            fontWeight: FontWeight.w700,
                            color: r['element'] == 'stock' ? Brand.heading : (n(r['quantity']) < 0 ? cRed : cGreen))),
                    Text('Available ${fq(r['available'])}',
                        style: TextStyle(fontSize: 12, fontWeight: FontWeight.w600, color: n(r['available']) < 0 ? cRed : Brand.muted)),
                  ]),
                  lines: [
                    if (r['exceptions'] is List && (r['exceptions'] as List).isNotEmpty)
                      Wrap(spacing: 4, runSpacing: 4, children: [
                        for (final c in (r['exceptions'] as List)) Pill(_short['$c'] ?? '$c', _excHex['$c'] ?? cGrey),
                      ]),
                  ],
                ),
            ]),
            DetailSection('Exception messages', children: [
              if (rowsOf(d['exceptions']).isEmpty) emptyLine('None — stock and receipts cover every requirement on time.'),
              for (final e in rowsOf(d['exceptions']))
                Padding(
                  padding: const EdgeInsets.symmetric(vertical: 4),
                  child: Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
                    Pill(txt(e['label']), _excHex['${e['code']}'] ?? cGrey),
                    const SizedBox(width: 8),
                    Expanded(child: Text(txt(e['message']), style: const TextStyle(fontSize: 12.5))),
                  ]),
                ),
            ]),
          ],
        ),
      ),
    );
  }
}
