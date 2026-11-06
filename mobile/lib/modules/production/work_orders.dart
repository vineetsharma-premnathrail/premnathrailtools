import 'package:flutter/material.dart';

import '../../api/api.dart';
import '../../theme.dart';
import '../../ui/app_frame.dart';
import '../../ui/files.dart';
import '../../ui/form.dart';
import '../../ui/format.dart';
import '../../ui/widgets.dart';
import 'prod_common.dart';
import 'rrv.dart';

/// Production › Work Orders - portal app/dashboard/production/work-orders/
/// (list, new, [id]) and components/production/WorkOrderEngineering.tsx.

const _statusTabs = <(String, String)>[
  ('draft,released,in_progress', 'Open'),
  ('draft', 'Draft'),
  ('released', 'Released'),
  ('in_progress', 'In Progress'),
  ('completed', 'Completed'),
  ('closed', 'Closed'),
  ('cancelled', 'Cancelled'),
  ('', 'All'),
];

const _txnLabels = <String, String>{
  'issue': 'Issued', 'return_in': 'Returned', 'receipt': 'Output received',
  'quality_in': 'Output received (Quality stock)', 'quality_release': 'Released after inspection',
  'quality_block': 'Rejected at inspection (Blocked)', 'quality_hold': 'Held for re-inspection',
  'blocked_release': 'Released from Blocked', 'blocked_to_quality': 'Back to Quality for re-inspection',
};

Color _txnColor(String t) {
  if (t == 'receipt' || t == 'quality_in' || t == 'quality_release') return cGreen;
  if (t == 'quality_block') return cRed;
  if (t == 'issue') return cBlue;
  return cPurple;
}

/// "PEW-78 / 01 · Vehicle 1" (portal ProjectUnitChip).
String projectUnitText(Json r) {
  final no = r['order_project_element_no'];
  final label = r['order_project_element_label'];
  return '${r['order_project_number']}${no != null && '$no'.isNotEmpty ? ' / $no' : ''}${label != null && '$label'.isNotEmpty ? ' · $label' : ''}';
}

// ── List ─────────────────────────────────────────────────────────────────────

class WorkOrdersTab extends StatefulWidget {
  const WorkOrdersTab({super.key});

  @override
  State<WorkOrdersTab> createState() => _WorkOrdersTabState();
}

class _WorkOrdersTabState extends State<WorkOrdersTab> {
  final _list = GlobalKey<ApiListViewState>();
  final _vis = Vis('production:work_orders');
  String _status = _statusTabs.first.$1;
  String _priority = '';
  bool _overdue = false;

  void _reload() => _list.currentState?.reload();

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: Colors.transparent,
      floatingActionButton: ProdPerm.can('work_orders', 'create')
          ? CreateFab(
              label: 'New Work Order',
              onPressed: () async {
                final id = await openNewWorkOrder(context);
                if (id != null) _reload();
              })
          : null,
      body: ApiListView(
        key: _list,
        searchHint: 'Search by WO number or product…',
        emptyText: 'No work orders match this view — change the filters, or use “+ New Work Order” to raise one from an active BOM.',
        load: (page, search) => Api.list('/production/work-orders', query: {
          'status': _status,
          'priority': _priority,
          if (_overdue) 'overdue': true,
          'search': search,
        }),
        header: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            ChipRow([
              for (final (k, l) in _statusTabs)
                CountChip(l, null, selected: _status == k, onTap: () {
                  setState(() => _status = k);
                  _reload();
                }),
            ]),
            ChipRow([
              CountChip('All priorities', null, selected: _priority.isEmpty, onTap: () {
                setState(() => _priority = '');
                _reload();
              }),
              for (final e in priorityLabels.entries)
                CountChip(e.value, null, selected: _priority == e.key, color: priorityHex[e.key], onTap: () {
                  setState(() => _priority = _priority == e.key ? '' : e.key);
                  _reload();
                }),
              CountChip('Overdue only', null, selected: _overdue, color: cRed, onTap: () {
                setState(() => _overdue = !_overdue);
                _reload();
              }),
            ]),
            const SizedBox(height: 6),
          ],
        ),
        itemBuilder: (ctx, r, reload) => RecordCard(
          code: txt(r['wo_number']),
          title: '${txt(r['product_code'])} — ${txt(r['product_name'])}',
          trailing: woStatusPill(r['status']),
          meta: [
            if (_vis.column('work_orders', 'project')) ('Machine / Project', txt(r['project_label'])),
            if (_vis.column('work_orders', 'qty'))
              ('Qty', '${fq(r['quantity_completed'])} / ${fq(r['quantity_planned'])} ${r['product_uom'] ?? ''}'.trim()),
            if (_vis.column('work_orders', 'progress')) ('Progress', '${fq(r['progress_percent'])}%'),
            if (_vis.column('work_orders', 'priority')) ('Priority', priorityLabel(r['priority'])),
            if (_vis.column('work_orders', 'planned_end'))
              ('Planned End', '${fmtDate(r['planned_end_date'])}${r['is_overdue'] == true ? ' · overdue' : ''}'),
          ],
          onTap: () async {
            await Navigator.of(ctx).push(MaterialPageRoute(builder: (_) => WorkOrderDetail(id: idOf(r['id'])!)));
            reload();
          },
        ),
      ),
    );
  }
}

// ── New work order ───────────────────────────────────────────────────────────

/// Portal /work-orders/new (also from a BOM "+ Raise Work Order", Planning
/// "Build", or an RRV build "+ Main / Sub-Assembly Work Order"). Returns the
/// new work order id; opens it unless raised from an RRV build.
Future<int?> openNewWorkOrder(BuildContext context,
    {int? bomId, String? bomLabel, num? quantity, int? rrvBuildId, String buildRole = 'sub_assembly'}) async {
  final vis = Vis('production:work_orders');
  final priorities = vis.options('priority', priorityLabels.keys.toList(), (v) => v);
  final bom = Pick(bomId, bomLabel);
  final qty = TextEditingController(text: quantity != null ? fq(quantity) : '1');
  var priority = priorities.contains('standard') ? 'standard' : priorities.first;
  final project = Pick();
  final branch = Pick();
  final soLine = Pick();
  final unit = UnitPick();
  final source = Pick();
  final target = Pick();
  final supervisor = Pick();
  DateTime? start;
  DateTime? end;
  final remarks = TextEditingController();
  Json? preview;
  int? previewFor;

  final boms = LookupCache('/production/lookups/active-boms');
  final projects = LookupCache('/production/lookups/projects');
  final branches = LookupCache('/production/lookups/branches');
  final locations = LookupCache('/production/lookups/locations');
  final users = LookupCache('/production/lookups/users');
  final soLines = LookupCache('/production/lookups/sales-order-lines');
  assigneeFilter('production:work_orders.supervisor').then((f) => users.filter = f);

  Future<void> loadPreview(StateSetter setS) async {
    final id = bom.id;
    if (id == null) return;
    previewFor = id;
    try {
      final b = mapOf(await Api.get('/production/boms/$id'));
      try {
        setS(() => preview = b);
      } catch (_) {}
    } catch (_) {}
  }

  int? createdId;
  final saved = await showFormSheet(
    context,
    title: 'New Work Order',
    saveLabel: 'Create Draft',
    builder: (ctx, setS) {
      if (bom.id != null && previewFor != bom.id) loadPreview(setS);
      final b = preview != null && preview!['id'] == bom.id ? preview : null;
      final q = numOf(qty.text) ?? 0;
      final base = b == null ? 1 : (n(b['base_quantity']) == 0 ? 1 : n(b['base_quantity']));
      final factor = q / base;
      return [
        const Hint('Build a quantity of one product from its active BOM — saved as a Draft first.'),
        if (rrvBuildId != null)
          Container(
            padding: const EdgeInsets.all(12),
            decoration: BoxDecoration(
                color: cBlue.withValues(alpha: 0.07),
                borderRadius: BorderRadius.circular(10),
                border: Border.all(color: cBlue.withValues(alpha: 0.2))),
            child: Text(
                'This work order will be linked to the RRV build as its ${buildRole == 'main' ? 'main (final vehicle assembly)' : 'sub-assembly'} order and uses the build\'s machine — leave Machine blank.',
                style: const TextStyle(fontSize: 13, color: Color(0xFF1E40AF))),
          ),
        if (vis.section('what_to_build')) ...[
          const Caps('What to Build'),
          lookupSelect('Product / Active BOM', boms, bom, setS, required: true),
          Row(children: [
            Expanded(
                child: AppTextField(
                    label: 'Quantity',
                    required: true,
                    controller: qty,
                    keyboardType: AppTextField.number,
                    onChanged: (_) => setS(() {}))),
            const SizedBox(width: 10),
            Expanded(
              child: AppSelect<String>(
                label: 'Priority',
                value: priority,
                clearable: false,
                options: [for (final p in priorities) Option(p, priorityLabels[p]!)],
                onChanged: (o) => setS(() => priority = o?.value ?? priority),
              ),
            ),
          ]),
        ],
        if (vis.section('built_for')) ...[
          const Caps('Built For'),
          lookupSelect('For Machine / Project (ERP)', projects, project, setS),
          lookupSelect('Plant', branches, branch, setS),
          lookupSelect('Sales Order Line', soLines, soLine, setS, onPicked: (o) {
            if (o != null) {
              setS(() {
                unit
                  ..projectId = null
                  ..elementId = null
                  ..label = null;
              });
            }
          }),
          if (rrvBuildId == null) ...[
            projectUnitSelect('Project — Unit (vehicle / lot)', unit, setS, onPicked: () {
              if (unit.projectId != null) setS(soLine.clear);
            }),
            const Hint('Picking a vehicle / lot fills in its sales order line. Leave both blank for a stock build.'),
          ],
        ],
        if (vis.section('schedule_responsibility')) ...[
          const Caps('Schedule & Responsibility'),
          DateField(label: 'Planned Start', value: start, onChanged: (d) => setS(() => start = d)),
          DateField(label: 'Planned End', value: end, onChanged: (d) => setS(() => end = d)),
          lookupSelect('Supervisor', users, supervisor, setS),
        ],
        if (vis.section('store_locations')) ...[
          const Caps('Store Locations'),
          lookupSelect('Issue Materials From', locations, source, setS),
          lookupSelect('Receive Output Into', locations, target, setS),
          const Hint('Both store locations are required before the work order can be released to the shop floor.'),
        ],
        if (vis.section('remarks'))
          AppTextField(label: 'Remarks', controller: remarks, maxLines: 3, hint: 'e.g. customer special requirements'),
        if (b != null && vis.section('bom_preview')) ...[
          Caps('Preview — ${b['bom_number']} v${b['version']} × ${fq(q)}'),
          Card(
            child: Padding(
              padding: const EdgeInsets.fromLTRB(12, 4, 12, 10),
              child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
                for (final i in rowsOf(b['items']))
                  LineCard(
                    title: '${txt(i['item_code'])} — ${txt(i['item_name'])}',
                    trailing: Text(
                        '${fq(n(i['quantity']) * factor * (1 + n(i['scrap_percent']) / 100))} ${i['uom'] ?? ''}',
                        style: const TextStyle(fontWeight: FontWeight.w600)),
                  ),
                if (rowsOf(b['items']).isEmpty) emptyLine('No components.'),
              ]),
            ),
          ),
          Card(
            child: Padding(
              padding: const EdgeInsets.fromLTRB(12, 4, 12, 10),
              child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
                for (final o in rowsOf(b['operations']))
                  LineCard(
                    title: '${o['sequence']} · ${txt(o['operation_name'])}${o['requires_inspection'] == true ? ' · quality gate' : ''}',
                    subtitle: txt(o['workstation_name']),
                    trailing: Text('${(n(o['setup_hours']) + n(o['run_hours_per_unit']) * q).toStringAsFixed(2)} h',
                        style: const TextStyle(fontWeight: FontWeight.w600)),
                  ),
                if (rowsOf(b['operations']).isEmpty) emptyLine('No routing operations.'),
              ]),
            ),
          ),
        ],
      ];
    },
    onSave: () async {
      if (bom.id == null) throw 'Pick the active BOM to build from.';
      final q = numOf(qty.text) ?? 0;
      if (!(q > 0)) throw 'Planned quantity must be more than zero.';
      if (start != null && end != null && end!.isBefore(start!)) throw 'Planned end date is before the planned start date.';
      final wo = mapOf(await Api.post('/production/work-orders', data: {
        'bom_id': bom.id,
        'quantity_planned': q,
        'priority': priority,
        'erp_project_id': project.id,
        'branch_id': branch.id,
        'source_location_id': source.id,
        'target_location_id': target.id,
        'supervisor_id': supervisor.id,
        'planned_start_date': start == null ? null : apiDate(start!),
        'planned_end_date': end == null ? null : apiDate(end!),
        'remarks': remarks.text.trim().isEmpty ? null : remarks.text.trim(),
        'sales_order_line_id': soLine.id,
        'order_project_element_id': rrvBuildId == null ? unit.elementId : null,
        'rrv_build_id': ?rrvBuildId,
        if (rrvBuildId != null) 'build_role': buildRole,
      }));
      createdId = idOf(wo['id']);
    },
  );
  if (!saved || createdId == null) return null;
  if (rrvBuildId == null && context.mounted) {
    openScreen(context, WorkOrderDetail(id: createdId!));
  }
  return createdId;
}

// ── Log time (shared with the Shop Floor board) ──────────────────────────────

/// Portal "Log Time" FormSheet. True when booked.
Future<bool> showLogTime(BuildContext context,
    {required int woId, required int opId, required String subtitle, String? bookedHint}) async {
  DateTime date = DateTime.now();
  final hours = TextEditingController();
  final good = TextEditingController(text: '0');
  final scrap = TextEditingController(text: '0');
  final remarks = TextEditingController();
  final operator = Pick();
  final users = LookupCache('/production/lookups/users');
  assigneeFilter('production:shop_floor.run_operations').then((f) => users.filter = f);
  return showFormSheet(
    context,
    title: 'Log Time',
    saveLabel: 'Book Time',
    builder: (ctx, setS) => [
      Text(subtitle, style: const TextStyle(fontWeight: FontWeight.w600, color: Brand.heading)),
      const Caps('Time & Output'),
      DateField(label: 'Date', value: date, required: true, onChanged: (d) => setS(() => date = d ?? date)),
      AppTextField(label: 'Hours', required: true, controller: hours, keyboardType: AppTextField.number),
      Wrap(spacing: 8, runSpacing: 6, children: [
        for (final h in const [0.5, 1, 2, 4, 8])
          ActionChip(
            label: Text('${fq(h)} h'),
            onPressed: () => setS(() => hours.text = fq(h)),
          ),
      ]),
      Row(children: [
        Expanded(child: AppTextField(label: 'Good Qty', controller: good, keyboardType: AppTextField.number)),
        const SizedBox(width: 10),
        Expanded(child: AppTextField(label: 'Scrap Qty', controller: scrap, keyboardType: AppTextField.number)),
      ]),
      if (bookedHint != null) Hint(bookedHint),
      const Caps('Operator'),
      AppSelect<int>(
        label: 'Operator (blank = me)',
        value: operator.id,
        valueLabel: operator.label,
        loadOptions: users.search,
        onChanged: (o) => setS(() => operator.set(o)),
      ),
      AppTextField(label: 'Remarks', controller: remarks),
      const Hint('Booked hours × the workstation\'s rate is the order\'s actual labour cost.'),
    ],
    onSave: () async {
      final h = numOf(hours.text) ?? 0;
      if (!(h > 0) || h > 24) throw 'Hours must be more than 0 and at most 24.';
      await Api.post('/production/time-logs', data: {
        'work_order_id': woId,
        'operation_id': opId,
        'log_date': apiDate(date),
        'hours': h,
        'qty_good': numOf(good.text) ?? 0,
        'qty_scrap': numOf(scrap.text) ?? 0,
        'operator_id': operator.id,
        'remarks': remarks.text.trim().isEmpty ? null : remarks.text.trim(),
      });
    },
  );
}

// ── Detail ───────────────────────────────────────────────────────────────────

class WorkOrderDetail extends StatefulWidget {
  const WorkOrderDetail({super.key, required this.id});
  final int id;

  @override
  State<WorkOrderDetail> createState() => _WorkOrderDetailState();
}

class _WorkOrderDetailState extends State<WorkOrderDetail> {
  final _vis = Vis('production:work_orders');
  Json? _wo;
  List<Json> _movements = [];
  List<Json> _logs = [];
  Json? _costing;
  bool _loading = true;
  bool _busy = false;
  Object? _error;
  String _tab = 'materials';

  bool _wof(String f, String a) => ProdPerm.feat('work_orders', f, a);
  bool get _canApprove => _wof('release', 'approve');
  bool get _canSubmitRelease => _wof('release', 'submit');
  bool get _canFinish => _wof('lifecycle', 'approve');
  bool get _canCancel => _wof('lifecycle', 'cancel');
  bool get _canEdit => ProdPerm.can('work_orders', 'edit');
  bool get _canPrint => _wof('job_card', 'print');
  bool get _canIssue => _wof('materials', 'create');
  bool get _canReturn => _wof('materials', 'edit');
  bool get _canReceive => _wof('output', 'create');
  bool get _canRunFloor => ProdPerm.feat('shop_floor', 'run_operations', 'edit');
  bool get _canLinkJobWork => ProdPerm.feat('shop_floor', 'job_work', 'edit');
  bool get _seeMaterials => _wof('materials', 'view');
  bool get _seeOperations => _wof('operations', 'view');
  bool get _seeOutput => _wof('output', 'view');
  bool get _seeTime => _wof('time_logs', 'view');
  bool get _seeCosting => _wof('costs', 'view');

  int get _id => widget.id;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    try {
      final r = await Future.wait<dynamic>([
        Api.get('/production/work-orders/$_id'),
        _seeOutput ? Api.get('/production/work-orders/$_id/stock-movements') : Future<dynamic>.value(const []),
        _seeTime ? Api.get('/production/time-logs', query: {'work_order_id': _id}) : Future<dynamic>.value(const []),
        _seeCosting ? Api.get('/production/work-orders/$_id/costing') : Future<dynamic>.value(null),
      ]);
      if (!mounted) return;
      setState(() {
        _wo = mapOf(r[0]);
        _movements = rowsOf(r[1]);
        _logs = rowsOf(r[2]);
        _costing = r[3] == null ? null : mapOf(r[3]);
        _loading = false;
        _error = null;
      });
    } catch (e) {
      if (mounted) {
        setState(() {
          _error = e;
          _loading = false;
        });
      }
    }
  }

  Future<void> _act(Future<void> Function() fn, {String? success}) async {
    setState(() => _busy = true);
    final ok = await runAction(context, fn, success: success);
    if (ok) await _load();
    if (mounted) setState(() => _busy = false);
  }

  Future<void> _confirmThen(String title, String message, String label, Future<void> Function() fn,
      {String? success, bool danger = false}) async {
    final ok = await confirmDialog(context, title: title, message: message, confirmLabel: label, danger: danger);
    if (ok) await _act(fn, success: success);
  }

  List<BarAction> _actions(Json wo) {
    final status = '${wo['status']}';
    final editable = ['draft', 'released', 'in_progress'].contains(status);
    return [
      if (status == 'draft' && (_canApprove || _canSubmitRelease))
        BarAction(_canApprove ? 'Release to Shop Floor' : 'Submit for Release', primary: true, () {
          _confirmThen(
            _canApprove ? 'Release to shop floor?' : 'Submit for release?',
            _canApprove
                ? 'Its operations appear on the Shop Floor board and its material is reserved in Store (as much as is free). The planned quantity locks.'
                : 'A work-order approver is asked to release it. It stays a draft (locked for editing) until they decide.',
            _canApprove ? 'Release' : 'Submit',
            () => Api.post('/production/work-orders/$_id/release'),
            success: _canApprove
                ? 'Released to the shop floor.'
                : 'Release submitted — a work-order approver has been asked to approve it.',
          );
        }),
      if (status == 'in_progress' && _canFinish)
        BarAction('Complete Work Order', primary: true, () {
          _confirmThen(
            'Complete work order?',
            'Marks production finished with ${fq(wo['quantity_completed'])} of ${fq(wo['quantity_planned'])} received. Remember to return any unused material.',
            'Complete',
            () => Api.post('/production/work-orders/$_id/complete'),
            success: 'Work order completed.',
          );
        }),
      if (status == 'completed' && _canFinish)
        BarAction('Close Work Order', primary: true, () {
          _confirmThen('Close work order?', 'Closing locks the work order and its costs for reporting. This cannot be undone.',
              'Close', () => Api.post('/production/work-orders/$_id/close'),
              success: 'Work order closed.');
        }),
      if (editable && _canEdit) BarAction('Edit Details', () => _edit(wo)),
      if (_canPrint)
        BarAction('Print Job Card', () async {
          await runAction(context,
              () => Files.downloadAndOpen('/production/work-orders/$_id/job-card', 'Job-Card-${wo['wo_number']}.pdf'));
        }),
      if (editable && status != 'draft' && _canCancel)
        BarAction('Cancel Work Order', danger: true, () async {
          final reason = await promptDialog(context,
              title: 'Cancel Work Order',
              message: 'Any issued material must be returned to Store first. The reason is kept on the record.',
              label: 'Reason for cancelling',
              confirmLabel: 'Cancel Work Order');
          if (reason != null) {
            await _act(() => Api.post('/production/work-orders/$_id/cancel', data: {'reason': reason}),
                success: 'Work order cancelled.');
          }
        }),
      if (status == 'draft' && ProdPerm.canDeleteOwn('work_orders', wo['created_by_id']))
        BarAction('Delete Draft', danger: true, () async {
          final ok = await confirmDialog(context,
              title: 'Delete draft work order?',
              message: 'This draft and its planned material and operations will be removed.',
              confirmLabel: 'Delete',
              danger: true);
          if (!ok || !mounted) return;
          final done = await runAction(context, () => Api.delete('/production/work-orders/$_id'));
          if (done && mounted) Navigator.of(context).pop();
        }),
    ];
  }

  // ── Edit ──

  Future<void> _edit(Json wo) async {
    final draft = wo['status'] == 'draft';
    final qty = TextEditingController(text: fq(wo['quantity_planned']));
    final current = normPriority(wo['priority']);
    final allowed = _vis.options('priority', priorityLabels.keys.toList(), (v) => v);
    var priority = current;
    final project = Pick(idOf(wo['erp_project_id']), wo['project_label']?.toString());
    final unit = UnitPick()
      ..projectId = idOf(wo['order_project_id'])
      ..elementId = idOf(wo['order_project_element_id'])
      ..label = wo['order_project_number'] != null ? projectUnitText(wo) : null;
    final origElement = unit.elementId;
    final source = Pick(idOf(wo['source_location_id']), wo['source_location_name']?.toString());
    final target = Pick(idOf(wo['target_location_id']), wo['target_location_name']?.toString());
    final supervisor = Pick(idOf(wo['supervisor_id']), wo['supervisor_name']?.toString());
    DateTime? start = parseDate(wo['planned_start_date']);
    DateTime? end = parseDate(wo['planned_end_date']);
    final remarks = TextEditingController(text: wo['remarks']?.toString() ?? '');
    final projects = LookupCache('/production/lookups/projects');
    final locations = LookupCache('/production/lookups/locations');
    final users = LookupCache('/production/lookups/users');
    assigneeFilter('production:work_orders.supervisor')
        .then((f) => users.filter = (id) => f(id) || id == idOf(wo['supervisor_id']));
    final inRrv = wo['rrv_build_id'] != null;

    final saved = await showFormSheet(
      context,
      title: 'Edit Work Order',
      builder: (ctx, setS) => [
        Hint('${wo['wo_number']} · ${wo['product_code']} — ${wo['product_name']}'),
        const Caps('Order'),
        AppTextField(label: 'Quantity', required: draft, controller: qty, enabled: draft, keyboardType: AppTextField.number),
        if (!draft) const Hint('Locked once released — material is reserved for it.'),
        AppSelect<String>(
          label: 'Priority',
          value: priority,
          clearable: false,
          options: [
            for (final e in priorityLabels.entries)
              if (e.key == current || allowed.contains(e.key)) Option(e.key, e.value),
          ],
          onChanged: (o) => setS(() => priority = o?.value ?? priority),
        ),
        lookupSelect('Machine / Project', projects, project, setS),
        projectUnitSelect('Project — Unit (vehicle / lot)', unit, setS,
            enabled: !inRrv, hint: inRrv ? 'Follows the RRV build' : null),
        if (inRrv) const Hint('Part of an RRV build — it works for the build\'s vehicle.'),
        const Caps('Schedule & Responsibility'),
        DateField(label: 'Planned Start', value: start, onChanged: (d) => setS(() => start = d)),
        DateField(label: 'Planned End', value: end, onChanged: (d) => setS(() => end = d)),
        lookupSelect('Supervisor', users, supervisor, setS),
        const Caps('Store Locations'),
        lookupSelect('Issue Materials From', locations, source, setS),
        lookupSelect('Receive Output Into', locations, target, setS),
        const Hint('Both are needed before the order can be released.'),
        AppTextField(label: 'Remarks', controller: remarks, maxLines: 3),
      ],
      onSave: () async {
        final payload = <String, dynamic>{
          'priority': priority,
          'erp_project_id': project.id,
          'source_location_id': source.id,
          'target_location_id': target.id,
          'supervisor_id': supervisor.id,
          'planned_start_date': start == null ? null : apiDate(start!),
          'planned_end_date': end == null ? null : apiDate(end!),
          'remarks': remarks.text.trim().isEmpty ? null : remarks.text.trim(),
        };
        if (!inRrv && unit.elementId != origElement) payload['order_project_element_id'] = unit.elementId;
        if (draft) {
          final q = numOf(qty.text) ?? 0;
          if (!(q > 0)) throw 'Planned quantity must be more than zero.';
          payload['quantity_planned'] = q;
        }
        await Api.patch('/production/work-orders/$_id', data: payload);
      },
    );
    if (saved && mounted) {
      showSnack(context, 'Work order updated.');
      await _load();
    }
  }

  // ── Materials / output / job work ──

  Future<void> _materials(Json wo, bool issue) async {
    final mats = rowsOf(wo['materials']);
    final ctrls = <int, TextEditingController>{};
    for (final m in mats) {
      num q = 0;
      if (issue) {
        final avail = n(m['available_qty']) > 0 ? n(m['available_qty']) : 0;
        final cap = n(m['reserved_qty']) + avail;
        q = n(m['outstanding_qty']) < cap ? n(m['outstanding_qty']) : cap;
      }
      final itemId = idOf(m['item_id']);
      if (itemId != null) ctrls[itemId] = TextEditingController(text: q > 0 ? fq(q) : '');
    }
    final location = Pick();
    final remarks = TextEditingController();
    final locations = LookupCache('/production/lookups/locations');
    final saved = await showFormSheet(
      context,
      title: issue ? 'Issue Materials from Store' : 'Return Unused Material',
      saveLabel: issue ? 'Post Issue' : 'Post Return',
      builder: (ctx, setS) => [
        Hint('${wo['wo_number']} · ${wo['product_code']} — ${wo['product_name']}'),
        Caps('Lines (${mats.length})'),
        for (final m in mats)
          if (ctrls[idOf(m['item_id'])] != null)
            Card(
              child: Padding(
                padding: const EdgeInsets.all(12),
                child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
                  Text('${txt(m['item_code'])} — ${txt(m['item_name'])}',
                      style: const TextStyle(fontWeight: FontWeight.w600, color: Brand.heading)),
                  const SizedBox(height: 4),
                  KV('Required', '${fq(m['required_qty'])} ${m['uom'] ?? ''}'.trim()),
                  KV('Outstanding', fq(m['outstanding_qty']), bold: true),
                  KV('Reserved', fq(m['reserved_qty'])),
                  KV('Free${wo['source_location_name'] != null ? ' at source' : ''}',
                      wo['source_location_id'] != null ? fq(m['available_qty']) : '—'),
                  const SizedBox(height: 8),
                  AppTextField(
                      label: issue ? 'Issue Qty' : 'Return Qty',
                      controller: ctrls[idOf(m['item_id'])],
                      keyboardType: AppTextField.number),
                ]),
              ),
            ),
        if (issue)
          const Hint('Pre-filled with what\'s outstanding, capped at what\'s reserved plus free. If any line is short the whole issue is rejected and nothing moves.'),
        const Caps('Store & Remarks'),
        AppSelect<int>(
          label: issue ? 'Issue From' : 'Return Into',
          value: location.id,
          valueLabel: location.label,
          loadOptions: locations.search,
          onChanged: (o) => setS(() => location.set(o)),
        ),
        Hint('Blank = default — ${wo['source_location_name'] ?? 'not set'}'),
        AppTextField(label: 'Remarks', controller: remarks),
      ],
      onSave: () async {
        final lines = [
          for (final e in ctrls.entries)
            if ((numOf(e.value.text) ?? 0) > 0) {'item_id': e.key, 'quantity': numOf(e.value.text)},
        ];
        if (lines.isEmpty) throw 'Enter a quantity for at least one item to ${issue ? 'issue' : 'return'}.';
        await Api.post('/production/work-orders/$_id/${issue ? 'issue-materials' : 'return-materials'}', data: {
          'lines': lines,
          'location_id': location.id,
          'remarks': remarks.text.trim().isEmpty ? null : remarks.text.trim(),
        });
      },
    );
    if (saved && mounted) {
      showSnack(context, issue ? 'Materials issued from Store.' : 'Materials returned to Store.');
      await _load();
    }
  }

  Future<void> _receive(Json wo) async {
    final remaining = n(wo['quantity_planned']) - n(wo['quantity_completed']);
    final qty = TextEditingController();
    final batch = TextEditingController();
    final remarks = TextEditingController();
    num? done;
    final saved = await showFormSheet(
      context,
      title: 'Receive Finished Goods',
      saveLabel: 'Receive',
      builder: (ctx, setS) => [
        Hint('${wo['wo_number']} · ${wo['product_code']} — ${wo['product_name']}'),
        AppTextField(label: 'Quantity (max ${fq(remaining)})', required: true, controller: qty, keyboardType: AppTextField.number),
        AppTextField(label: 'Batch / Serial', controller: batch, hint: txt(wo['wo_number'])),
        AppTextField(label: 'Remarks', controller: remarks),
        Hint('Received into ${wo['target_location_name'] ?? 'Store'}. Every quality-gate operation must have a passed inspection before output can be received. The batch defaults to the WO number for traceability.'),
      ],
      onSave: () async {
        final q = numOf(qty.text) ?? 0;
        if (!(q > 0)) throw 'Enter the finished quantity to receive.';
        await Api.post('/production/work-orders/$_id/receive-output', data: {
          'quantity': q,
          'batch_number': batch.text.trim().isEmpty ? null : batch.text.trim(),
          'remarks': remarks.text.trim().isEmpty ? null : remarks.text.trim(),
        });
        done = q;
      },
    );
    if (saved && mounted) {
      showSnack(context, '${fq(done)} unit(s) received into Store.');
      await _load();
    }
  }

  Future<void> _linkChallan(Json wo, Json op) async {
    final pick = Pick();
    final challans = LookupCache('/production/lookups/job-work-challans',
        query: op['vendor_id'] != null ? {'vendor_id': op['vendor_id']} : null);
    final saved = await showFormSheet(
      context,
      title: 'Link Job-Work Challan',
      saveLabel: 'Link Challan',
      builder: (ctx, setS) => [
        Hint('Op ${op['sequence']} ${op['operation_name']} · ${wo['wo_number']}'),
        Text.rich(TextSpan(children: [
          const TextSpan(text: 'Vendor: '),
          TextSpan(text: txt(op['vendor_name']), style: const TextStyle(fontWeight: FontWeight.w700)),
          const TextSpan(
              text: '. Issue the material in Store › Issues (type Job Work) first; the step can be confirmed once it comes back (Material Return / Job Work Receipt).'),
        ])),
        lookupSelect('Challan', challans, pick, setS, required: true),
      ],
      onSave: () async {
        if (pick.id == null) throw 'Pick the job-work challan the material went out on.';
        await Api.post('/production/work-orders/$_id/operations/${op['id']}/job-work', data: {'issue_id': pick.id});
      },
    );
    if (saved) await _load();
  }

  // ── Build ──

  @override
  Widget build(BuildContext context) {
    final wo = _wo;
    final actions = wo == null ? const <BarAction>[] : _actions(wo);
    return SubPage(
      title: wo == null ? 'Work Order' : txt(wo['wo_number']),
      bottom: actions.isEmpty ? null : BottomActions(actions, busy: _busy),
      body: DetailBody(
        loading: _loading,
        error: _error,
        onRefresh: _load,
        children: wo == null ? const [] : _body(wo),
      ),
    );
  }

  List<Widget> _body(Json wo) {
    final status = '${wo['status']}';
    final uom = wo['product_uom']?.toString() ?? '';
    final ops = rowsOf(wo['operations']);
    final tabs = <(String, String)>[
      if (_seeMaterials) ('materials', 'Materials${n(wo['shortage_count']) > 0 ? ' (${wo['shortage_count']} short)' : ''}'),
      if (_seeOperations) ('operations', 'Operations (${ops.where((o) => o['status'] == 'completed').length}/${ops.length})'),
      if (_seeOutput) ('output', 'Output & Stock'),
      if (_seeTime) ('time', 'Time Logs (${_logs.length})'),
      if (_seeCosting) ('costing', 'Costing'),
    ];
    final shown = tabs.any((t) => t.$1 == _tab) ? _tab : (tabs.isEmpty ? '' : tabs.first.$1);
    final hasLinks = wo['rrv_build_id'] != null ||
        wo['sales_order_label'] != null ||
        wo['parent_work_order_id'] != null ||
        wo['order_project_number'] != null;
    return [
      _changeFlag(wo),
      ApprovalSection(entityType: 'production_work_order', entityId: _id, title: 'Release approval', onChanged: _load),
      if (_vis.section('detail_summary'))
        DetailSection('${txt(wo['product_code'])} — ${txt(wo['product_name'])}', children: [
          Text(
              'Make ${fq(wo['quantity_planned'])} ${uom.isEmpty ? 'unit(s)' : uom} to BOM ${wo['bom_number']} v${wo['bom_version']} — ${wo['project_label'] != null ? 'for ${wo['project_label']}' : 'a stock build (no machine / project)'}.',
              style: const TextStyle(fontSize: 13.5, color: Brand.body)),
          const SizedBox(height: 8),
          Wrap(spacing: 6, runSpacing: 6, crossAxisAlignment: WrapCrossAlignment.center, children: [
            woStatusPill(status),
            if (wo['is_overdue'] == true) const Pill('Overdue', cRed),
            Pill('${priorityLabel(wo['priority'])} priority', priorityHex[normPriority(wo['priority'])]!),
          ]),
          const SizedBox(height: 6),
          KV('Planned', '${fmtDate(wo['planned_start_date'])} → ${fmtDate(wo['planned_end_date'])}'),
          KV('Supervisor', txt(wo['supervisor_name']), bold: true),
        ]),
      if (_vis.section('detail_progress'))
        DetailSection('Progress', children: [
          Row(children: [
            Expanded(child: Text('${fq(wo['quantity_completed'])} of ${fq(wo['quantity_planned'])} $uom received')),
            Text('${fq(wo['progress_percent'])}%', style: const TextStyle(color: Brand.muted)),
          ]),
          const SizedBox(height: 6),
          Bar(n(wo['progress_percent']), height: 8),
          const SizedBox(height: 6),
          FieldRow('Scrapped', '${fq(wo['quantity_scrapped'])} $uom'),
          FieldRow('Actual start → end',
              '${wo['actual_start_at'] != null ? fmtDateTime(wo['actual_start_at']) : 'Not started'} → ${wo['actual_end_at'] != null ? fmtDateTime(wo['actual_end_at']) : '—'}'),
        ]),
      if (hasLinks && _vis.section('detail_linked'))
        DetailSection('Linked records', children: [
          if (wo['rrv_build_id'] != null)
            FieldRow(
                'RRV build',
                InkWell(
                  onTap: () => openScreen(context, RrvBuildDetail(id: idOf(wo['rrv_build_id'])!)),
                  child: Text(
                      '${wo['rrv_build_number'] ?? '#${wo['rrv_build_id']}'} · ${wo['build_role'] == 'main' ? 'main assembly' : 'sub-assembly'} →',
                      style: const TextStyle(color: cBlue, fontWeight: FontWeight.w600)),
                )),
          if (wo['order_project_number'] != null) FieldRow('Project', projectUnitText(wo)),
          if (wo['sales_order_label'] != null) FieldRow('Sales Order', wo['sales_order_label']),
          if (wo['parent_work_order_id'] != null)
            FieldRow(
                'Parent Work Order',
                InkWell(
                  onTap: () => openScreen(context, WorkOrderDetail(id: idOf(wo['parent_work_order_id'])!)),
                  child: Text('${wo['parent_wo_number'] ?? '#${wo['parent_work_order_id']}'} →',
                      style: const TextStyle(color: cBlue, fontWeight: FontWeight.w600)),
                )),
        ]),
      if (_vis.section('detail_store_locations'))
        DetailSection('Store locations', children: [
          FieldRow('Issue materials from',
              wo['source_location_name'] ?? const Text('Not set — needed before release', style: TextStyle(color: cBrown))),
          FieldRow('Receive output into',
              wo['target_location_name'] ?? const Text('Not set — needed before release', style: TextStyle(color: cBrown))),
        ]),
      if (_vis.section('detail_other'))
        DetailSection('Other details', children: [
          FieldRow('Plant', wo['branch_name']),
          FieldRow('Remarks', wo['remarks']),
          if (wo['cancel_reason'] != null) FieldRow('Cancel reason', wo['cancel_reason']),
          const SizedBox(height: 4),
          Hint('Created by ${txt(wo['created_by_name'])}'),
        ]),
      if (_wof('sub_orders', 'view'))
        DependentOrders(key: ValueKey('dep-${wo['id']}-${wo['status']}'), wo: wo, canCreate: _wof('sub_orders', 'create'), onChanged: _load),
      if (tabs.isNotEmpty) SubTabs(tabs: tabs, selected: shown, onSelect: (k) => setState(() => _tab = k)),
      if (shown == 'materials') _materialsTab(wo),
      if (shown == 'operations') _operationsTab(wo),
      if (shown == 'output') ..._outputTab(wo),
      if (shown == 'time') _timeTab(wo),
      if (shown == 'costing') ..._costingTab(wo),
    ];
  }

  Widget _changeFlag(Json wo) {
    if (wo['change_flag'] == null || '${wo['change_flag']}'.isEmpty) return const SizedBox.shrink();
    final cleared = wo['change_flag_cleared_at'] != null;
    return Notice(
      color: cleared ? cGreen : cAmber,
      Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
        Text(cleared ? 'Engineering change reviewed' : 'Engineering change on this order',
            style: TextStyle(fontWeight: FontWeight.w700, color: cleared ? const Color(0xFF15803D) : cBrown)),
        const SizedBox(height: 4),
        Text('${wo['change_flag']}'),
        if (cleared)
          Padding(
            padding: const EdgeInsets.only(top: 6),
            child: Hint('Resolution (${fmtDateTime(wo['change_flag_cleared_at'])}): ${txt(wo['change_flag_resolution'])}'),
          )
        else if (_canEdit)
          Padding(
            padding: const EdgeInsets.only(top: 8),
            child: miniBtn('Record resolution & clear', _busy
                ? null
                : () async {
                    final text = await promptDialog(context,
                        title: 'Clear Engineering-Change Flag',
                        message:
                            'Say what was done with this order and its WIP (e.g. reworked to the new revision, old parts used up, re-raised on the new BOM).',
                        label: 'Resolution',
                        confirmLabel: 'Clear Flag');
                    if (text == null) return;
                    if (text.length < 3) {
                      if (mounted) showSnack(context, 'Write a short resolution (at least 3 characters).', error: true);
                      return;
                    }
                    await _act(() => Api.post('/production/work-orders/$_id/clear-change-flag', data: {'resolution': text}));
                  }),
          ),
      ]),
    );
  }

  Widget _materialsTab(Json wo) {
    final status = '${wo['status']}';
    final executing = status == 'released' || status == 'in_progress';
    final mats = rowsOf(wo['materials']);
    const t = 'detail_materials';
    return DetailSection('Material Requirement (${mats.length})', children: [
      if (executing && (_canIssue || _canReturn))
        Padding(
          padding: const EdgeInsets.only(bottom: 8),
          child: btnWrap([
            if (_canIssue) miniBtn('Issue from Store', _busy ? null : () => _materials(wo, true), primary: true),
            if (_canIssue && n(wo['shortage_count']) > 0)
              miniBtn('Top Up Reservation', _busy
                  ? null
                  : () => _act(() => Api.post('/production/work-orders/$_id/reserve-materials'),
                      success: 'Reservations topped up from free stock.')),
            if (_canReturn) miniBtn('Return Unused', _busy ? null : () => _materials(wo, false)),
          ]),
        ),
      if (status == 'completed' && _canReturn)
        Padding(padding: const EdgeInsets.only(bottom: 8), child: miniBtn('Return Unused', _busy ? null : () => _materials(wo, false))),
      if (status == 'draft') const Hint('Release the work order to start issuing material from Store.'),
      if (mats.isEmpty) emptyLine('No material lines.'),
      for (final m in mats) _materialLine(wo, m, status, t),
    ]);
  }

  Widget _materialLine(Json wo, Json m, String status, String t) {
    final short = n(m['outstanding_qty']) > n(m['reserved_qty']) + n(m['available_qty']) + 1e-9;
    final showShort = short && n(m['outstanding_qty']) > 0;
    return LineCard(
      title: '${txt(m['item_code'])} — ${txt(m['item_name'])}${n(m['required_qty']) == 0 ? ' · extra' : ''}',
      lines: [
        KV('Required', '${fq(m['required_qty'])} ${m['uom'] ?? ''}'.trim()),
        if (_vis.column(t, 'issued')) KV('Issued', fq(m['issued_qty'])),
        if (_vis.column(t, 'returned')) KV('Returned', fq(m['returned_qty'])),
        KV('Outstanding', fq(m['outstanding_qty']), bold: true),
        if (_vis.column(t, 'reserved')) KV('Reserved', status == 'draft' ? '—' : fq(m['reserved_qty'])),
        if (_vis.column(t, 'free'))
          KV(
            'Free${wo['source_location_name'] != null ? ' at source' : ''}',
            wo['source_location_id'] != null ? '${fq(m['available_qty'])}${showShort ? ' · short' : ''}' : '—',
            color: showShort ? cRed : null,
            bold: showShort,
          ),
      ],
    );
  }

  Widget _operationsTab(Json wo) {
    final ops = rowsOf(wo['operations']);
    return DetailSection('Routing Operations (${ops.length})', children: [
      if (ops.isEmpty) emptyLine('No routing operations.'),
      for (final op in ops) _opLine(wo, op),
    ]);
  }

  Widget _opLine(Json wo, Json op) {
    final status = '${wo['status']}';
    final executing = status == 'released' || status == 'in_progress';
    const t = 'detail_operations';
    final insp = op['inspection_status']?.toString();
    final passed = insp == 'passed' || insp == 'conditionally_passed';
    final gate = op['requires_inspection'] == true;
    final canRequest = executing && gate && op['status'] != 'completed' && (insp == null || insp == 'failed');
    final external = op['control_key'] == 'external';
    final opId = idOf(op['id']) ?? 0;
    return LineCard(
      title: '${op['sequence']} · ${txt(op['operation_name'])}',
      subtitle: op['instructions']?.toString(),
      trailing: Pill(opStatusLabels['${op['status']}'] ?? humanize(op['status']), opStatusHex['${op['status']}'] ?? cGrey),
      lines: [
        if (_vis.column(t, 'workstation')) ...[
          if (external) ...[
            Row(children: [
              const Pill('External', cViolet),
              const SizedBox(width: 6),
              Expanded(child: Text(txt(op['vendor_name']), style: const TextStyle(fontSize: 12.5))),
            ]),
            Hint(
                op['job_work_issue_number'] != null
                    ? '${op['job_work_issue_number']} · ${op['job_work_returned'] == true ? 'material back' : 'at vendor'}'
                    : 'No challan linked',
                color: op['job_work_returned'] == true ? const Color(0xFF15803D) : Brand.muted),
          ] else
            KV('Workstation', txt(op['workstation_name'])),
          if (op['confirmation'] == 'required') const Hint('confirmation required'),
          if (op['confirmation'] == 'none') const Hint('milestone'),
        ],
        if (_vis.column(t, 'hours'))
          KV('Hours (actual / plan)', '${fq(op['actual_hours'])} / ${fq(op['planned_hours'])}',
              color: n(op['actual_hours']) > n(op['planned_hours']) ? cBrown : null),
        if (_vis.column(t, 'good')) KV('Good', fq(op['qty_good'])),
        if (_vis.column(t, 'scrap')) KV('Scrap', fq(op['qty_scrap']), color: n(op['qty_scrap']) > 0 ? cRed : null),
        if (_vis.column(t, 'quality') && gate)
          Padding(
            padding: const EdgeInsets.only(top: 4),
            child: Wrap(spacing: 6, crossAxisAlignment: WrapCrossAlignment.center, children: [
              insp != null ? Pill(inspLabels[insp] ?? humanize(insp), inspHex[insp] ?? cGrey) : const Pill('Gate — not requested', cGrey),
              if (op['inspection_number'] != null) Hint('${op['inspection_number']}'),
            ]),
          ),
      ],
      actions: executing && _canRunFloor && op['status'] != 'completed'
          ? [
              if (op['status'] == 'pending')
                miniBtn('Start', _busy ? null : () => _act(() => Api.post('/production/work-orders/$_id/operations/$opId/start'))),
              if (external && op['job_work_issue_id'] == null && _canLinkJobWork)
                miniBtn('Link Challan', _busy ? null : () => _linkChallan(wo, op)),
              if (op['confirmation'] != 'none')
                miniBtn('Log Time', _busy
                    ? null
                    : () async {
                        final ok = await showLogTime(context,
                            woId: _id, opId: opId, subtitle: 'Op ${op['sequence']} ${op['operation_name']} · ${wo['wo_number']}');
                        if (ok && mounted) {
                          showSnack(context, 'Time booked.');
                          await _load();
                        }
                      }, primary: true),
              if (op['confirmation'] == 'required' && n(op['qty_good']) <= 0)
                miniBtn('Complete (no yield)', _busy
                    ? null
                    : () async {
                        final reason = await promptDialog(context,
                            title: 'Complete Without Yield',
                            message:
                                'This step needs a yield confirmation. Give the reason it produced no good units (e.g. all scrapped, done on another order) — it is kept on the operation.',
                            label: 'Reason',
                            confirmLabel: 'Complete Step');
                        if (reason != null) {
                          await _act(() => Api.post('/production/work-orders/$_id/operations/$opId/complete',
                              data: {'no_yield_reason': reason}));
                        }
                      }),
              if (canRequest)
                miniBtn(insp == 'failed' ? 'Re-inspect' : 'Request Inspection', _busy
                    ? null
                    : () => _act(() => Api.post('/production/work-orders/$_id/operations/$opId/request-inspection'),
                        success: 'Inspection requested — Quality has been notified.')),
              miniBtn('Complete', _busy || (gate && !passed)
                  ? null
                  : () => _act(() => Api.post('/production/work-orders/$_id/operations/$opId/complete', data: {}))),
              if (gate && !passed) const Hint('Complete needs a passed Quality inspection first.'),
            ]
          : const [],
    );
  }

  List<Widget> _outputTab(Json wo) {
    final remaining = n(wo['quantity_planned']) - n(wo['quantity_completed']);
    return [
      if (wo['status'] == 'in_progress' && _canReceive)
        DetailSection('Receive Finished Goods into Store', children: [
          Hint('${fq(remaining)} ${wo['product_uom'] ?? ''} still to receive. Every quality-gate operation must have a passed inspection before output can be received.'),
          const SizedBox(height: 8),
          miniBtn('Receive Output', _busy ? null : () => _receive(wo), primary: true),
        ]),
      DetailSection('Store Ledger Movements (${_movements.length})', children: [
        if (_movements.isEmpty) emptyLine('No stock has moved for this work order yet.'),
        for (final m in _movements)
          LineCard(
            title: '${txt(m['item_code'])} — ${txt(m['item_name'])}',
            subtitle: '${fmtDate(m['transaction_date'])} · ${txt(m['created_by_name'])}',
            trailing: Pill(_txnLabels['${m['transaction_type']}'] ?? humanize(m['transaction_type']), _txnColor('${m['transaction_type']}')),
            lines: [
              KV('Qty', fq(m['quantity']), bold: true),
              if (_seeCosting)
                KV('Order Value',
                    m['order_value'] != null ? '${inr(m['order_value'])}${m['order_unit_cost'] != null ? ' (@ ${inr(m['order_unit_cost'])})' : ''}' : '—'),
              KV('Location', txt(m['location_name'])),
              KV('Batch', txt(m['batch_number'])),
              if (m['remarks'] != null) KV('Remarks', txt(m['remarks'])),
            ],
          ),
      ]),
    ];
  }

  Widget _timeTab(Json wo) {
    final status = '${wo['status']}';
    final executing = status == 'released' || status == 'in_progress';
    final ops = rowsOf(wo['operations']);
    return DetailSection('Time Logs (${_logs.length})', children: [
      if (_logs.isEmpty) emptyLine('No time booked yet. Use "Log Time" on the Operations tab or the Shop Floor board.'),
      for (final l in _logs)
        Builder(builder: (_) {
          Json? op;
          for (final o in ops) {
            if (o['id'] == l['operation_id']) op = o;
          }
          final locked = !executing || op?['status'] == 'completed';
          return LineCard(
            title: txt(l['operation_label']),
            subtitle: '${fmtDate(l['log_date'])} · ${txt(l['workstation_name'])} · ${txt(l['operator_name'])}',
            trailing: Text('${fq(l['hours'])} h', style: const TextStyle(fontWeight: FontWeight.w700)),
            lines: [
              KV('Good', fq(l['qty_good'])),
              KV('Scrap', fq(l['qty_scrap'])),
              if (l['remarks'] != null) KV('Remarks', txt(l['remarks'])),
            ],
            actions: [
              if (!locked && ProdPerm.canDeleteOwn('shop_floor', l['created_by_id']))
                miniBtn('Remove', _busy ? null : () => _act(() => Api.delete('/production/time-logs/${l['id']}'), success: 'Time log removed.'),
                    danger: true),
            ],
          );
        }),
    ]);
  }

  List<Widget> _costingTab(Json wo) {
    final c = _costing;
    if (c == null) return [DetailSection('Costing', children: [emptyLine('No costing yet.')])];
    final variance = n(c['variance']);
    final closed = wo['status'] == 'completed' || wo['status'] == 'closed';
    return [
      KpiGrid([
        KpiCard('Estimated Cost', inr(c['estimated_total_cost']),
            sub: '${inr(c['estimated_material_cost'])} material + ${inr(c['estimated_labour_cost'])} labour'),
        KpiCard('Actual Cost', inr(c['actual_total_cost']),
            sub: '${inr(c['actual_material_cost'])} material + ${inr(c['actual_labour_cost'])} labour'),
        KpiCard('Variance', signedInr(variance),
            color: variance > 0 ? cRed : cGreen,
            sub: c['variance_percent'] != null ? '${n(c['variance_percent']) >= 0 ? '+' : ''}${c['variance_percent']}% vs estimate' : 'No estimate'),
        KpiCard('Cost per Unit', c['cost_per_unit'] != null ? inr(c['cost_per_unit']) : '—',
            sub: 'Hours ${fq(c['actual_hours'])} of ${fq(c['planned_hours'])} planned'),
        KpiCard('Received to Stock', inr(c['cost_relieved'] ?? 0), sub: 'Finished goods are received at the order’s actual cost'),
        KpiCard('Open on Order', inr(c['open_cost'] ?? 0),
            sub: closed ? 'Variance left on the delivered order' : 'Work in progress — counted in closing stock'),
      ]),
      DetailSection('Material Cost by Item (${rowsOf(c['materials']).length})', children: [
        for (final m in rowsOf(c['materials']))
          LineCard(
            title: '${txt(m['item_code'])} — ${txt(m['item_name'])}',
            trailing: Text(inr(m['actual_cost']), style: const TextStyle(fontWeight: FontWeight.w700)),
            lines: [
              KV('Unit Cost', n(m['unit_cost']) > 0 ? inr(m['unit_cost']) : 'not set', color: n(m['unit_cost']) > 0 ? null : cBrown),
              KV('Required', fq(m['required_qty'])),
              KV('Consumed', fq(m['consumed_qty'])),
              KV('Estimated', inr(m['estimated_cost'])),
            ],
          ),
        const SizedBox(height: 8),
        const Hint(
            'Computed live from Store standard (or moving-average) costs, material issued net of returns, and hours × each workstation\'s hourly rate.'),
      ]),
    ];
  }
}

/// Sub-assembly work orders (portal DependentOrdersSection).
class DependentOrders extends StatefulWidget {
  const DependentOrders({super.key, required this.wo, required this.canCreate, required this.onChanged});
  final Json wo;
  final bool canCreate;
  final VoidCallback onChanged;

  @override
  State<DependentOrders> createState() => _DependentOrdersState();
}

class _DependentOrdersState extends State<DependentOrders> {
  List<Json> _rows = [];
  Object? _error;
  bool _net = false;
  bool _busy = false;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    try {
      final d = await Api.get('/production/work-orders/${widget.wo['id']}/dependents');
      if (mounted) setState(() => _rows = rowsOf(d));
    } catch (e) {
      if (mounted) setState(() => _error = e);
    }
  }

  Future<void> _create() async {
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      final d = await Api.post('/production/work-orders/${widget.wo['id']}/sub-orders', data: {'net_free_stock': _net});
      if (mounted) setState(() => _rows = rowsOf(d));
      widget.onChanged();
    } catch (e) {
      if (mounted) setState(() => _error = e);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final open = ['draft', 'released', 'in_progress'].contains(widget.wo['status']);
    if (_rows.isEmpty && !(open && widget.canCreate)) return const SizedBox.shrink();
    return DetailSection('Sub-assembly Work Orders (${_rows.length})', children: [
      const Hint(
          'Make items in this order\'s BOM tree (components with their own active BOM) get their own draft work orders, linked here and to the same machine / sales order. Running it again only adds what\'s missing.'),
      if (open && widget.canCreate) ...[
        CheckField(label: 'Net free stock', value: _net, onChanged: (v) => setState(() => _net = v)),
        miniBtn(_busy ? 'Exploding…' : 'Create sub-assembly orders', _busy ? null : _create),
      ],
      if (_error != null) errorLine(_error!),
      for (final r in _rows)
        LineCard(
          indent: (n(r['level']) - 1).clamp(0, 6) * 14.0,
          title: '${r['wo_number']}',
          subtitle: 'Level ${r['level']} · ${txt(r['product_code'])} — ${txt(r['product_name'])} · Qty ${fq(r['quantity_planned'])}',
          trailing: woStatusPill(r['status']),
          onTap: () => openScreen(context, WorkOrderDetail(id: idOf(r['id'])!)),
        ),
    ]);
  }
}
