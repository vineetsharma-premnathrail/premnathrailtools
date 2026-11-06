import 'package:flutter/material.dart';

import '../../api/api.dart';
import '../../theme.dart';
import '../../ui/app_frame.dart';
import '../../ui/form.dart';
import '../../ui/format.dart';
import '../../ui/perms.dart';
import '../../ui/widgets.dart';
import 'mt_assets.dart';
import 'mt_common.dart';
import 'mt_requests.dart';
import 'mt_schedule.dart';
import 'mt_wo_cards.dart';

// Work orders - frontend/src/app/dashboard/maintenance/work-orders/**.

/// Work order list (tab body, or a sub-page from a dashboard tile).
class WorkOrdersList extends StatefulWidget {
  const WorkOrdersList({super.key, this.initialStatus, this.initialBranch, this.initialMine = false});
  final String? initialStatus;
  final int? initialBranch;
  final bool initialMine;

  @override
  State<WorkOrdersList> createState() => _WorkOrdersListState();
}

class _WorkOrdersListState extends State<WorkOrdersList> {
  final _list = GlobalKey<ApiListViewState>();
  final _vis = Vis('maintenance:work_orders');
  late String? _status = widget.initialStatus;
  late int? _branch = widget.initialBranch;
  late bool _mine = widget.initialMine;
  late bool _openOnly = widget.initialStatus == null;
  String? _type;
  Json? _lookups;

  @override
  void initState() {
    super.initState();
    MtLookups.tryGet().then((lk) {
      if (mounted) setState(() => _lookups = lk);
    });
  }

  void _refilter(VoidCallback change) {
    setState(change);
    WidgetsBinding.instance.addPostFrameCallback((_) => _list.currentState?.reload());
  }

  Future<ApiPage> _load(int page, String search) => Api.list('/maintenance/work-orders', query: {
        'status': _status,
        'open_only': _status == null && _openOnly ? true : null,
        'wo_type': _type,
        'mine': _mine ? true : null,
        'branch_id': _branch,
        'search': search,
      });

  @override
  Widget build(BuildContext context) {
    final branches = MtLookups.branches(_lookups);
    final header = Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        const MtHeader('Work Orders'),
        filterRow([
          FilterSelect<String>(
            allLabel: 'All types',
            value: _type,
            options: optionsOf(woTypeLabels),
            onChanged: (v) => _refilter(() => _type = v),
          ),
          FilterSelect<String>(
            allLabel: _openOnly ? 'Open + completed' : 'All statuses',
            value: _status,
            options: optionsOf(woStatusLabels),
            onChanged: (v) => _refilter(() => _status = v),
          ),
          if (branches.length > 1 || _branch != null)
            FilterSelect<int>(
              allLabel: 'All plants',
              value: _branch,
              options: branches,
              onChanged: (v) => _refilter(() => _branch = v),
            ),
          if (_status == null) FilterToggle(label: 'Hide closed', value: _openOnly, onChanged: (v) => _refilter(() => _openOnly = v)),
          FilterToggle(label: 'My jobs', value: _mine, onChanged: (v) => _refilter(() => _mine = v)),
        ]),
      ],
    );
    return withFab(
      ApiListView(
        key: _list,
        load: _load,
        header: header,
        searchHint: 'Search by number, title or asset…',
        emptyText: _status != null || _type != null || _mine || _branch != null
            ? 'No work orders match these filters.'
            : 'No open work orders. Breakdown requests become work orders once maintenance picks them up.',
        itemBuilder: (ctx, w, reload) {
          final downtime = w['downtime_minutes'] ?? w['live_downtime_minutes'];
          return RecordCard(
            code: str(w['wo_number']),
            title: _vis.column('work_orders', 'title') ? str(w['title']) : str(w['wo_number']),
            subtitle: _vis.column('work_orders', 'asset') ? '${str(w['asset_code'])} ${str(w['asset_name'])}'.trim() : null,
            trailing: Column(crossAxisAlignment: CrossAxisAlignment.end, children: [
              statusPill(woStatusLabels, woStatusHex, w['status']),
              if (w['awaiting_confirmation'] == true)
                const Padding(
                  padding: EdgeInsets.only(top: 4),
                  child: Text('Awaiting requester', style: TextStyle(fontSize: 11, fontWeight: FontWeight.w700, color: kAmber)),
                ),
            ]),
            meta: [
              if (_vis.column('work_orders', 'type')) ('Type', label(woTypeLabels, w['wo_type'])),
              if (_vis.column('work_orders', 'priority')) ('Priority', priorityText(w['priority'])),
              if (_vis.column('work_orders', 'technician'))
                ('Technician', str(w['assigned_to_name']).isEmpty ? 'Unassigned' : str(w['assigned_to_name'])),
              if (_vis.column('work_orders', 'planned')) ('Planned', fmtDate(w['planned_start'])),
              if (_vis.column('work_orders', 'downtime')) ('Downtime', w['machine_down'] == true ? formatMinutes(downtime) : '—'),
              ('Cost', (asNum(w['total_cost']) ?? 0) != 0 ? formatInr(w['total_cost']) : '—'),
            ],
            onTap: () async {
              await Navigator.of(ctx).push(MaterialPageRoute(builder: (_) => WorkOrderDetailScreen(id: asInt(w['id'])!)));
              reload();
            },
          );
        },
      ),
      Mt.can('work_orders', 'create')
          ? CreateFab(label: 'New Work Order', onPressed: () => newWorkOrder(context, onCreated: () => _list.currentState?.reload()))
          : null,
    );
  }
}

// ── New work order (work-orders/new) ─────────────────────────────────────────

class _CheckLine {
  final description = TextEditingController();
  final expected = TextEditingController();
  void dispose() {
    description.dispose();
    expected.dispose();
  }
}

Future<void> newWorkOrder(BuildContext context, {Json? asset, VoidCallback? onCreated}) async {
  Json? lk;
  try {
    lk = await MtLookups.get();
  } catch (e) {
    if (context.mounted) showSnack(context, ApiClient.describe(e), error: true);
    return;
  }
  final allow = await assigneeFilter('maintenance:work_orders.assign');
  if (!context.mounted) return;
  final vis = Vis('maintenance:work_orders');
  final typeChoices = vis.options('wo_type', woTypeLabels.keys);
  final prChoices = vis.options('priority', priorityLabels.keys);
  int? assetId = asInt(asset?['id']);
  final assetText = asset == null ? null : assetLabel(asset);
  if (assetId != null) assetCache[assetId] = asset!;
  var woType = typeChoices.contains('corrective') ? 'corrective' : typeChoices.first;
  var priority = prChoices.contains('standard') ? 'standard' : prChoices.first;
  final title = TextEditingController();
  final desc = TextEditingController();
  final hours = TextEditingController();
  var machineDown = false;
  DateTime? downSince = DateTime.now();
  int? tech;
  DateTime? plannedStart, plannedEnd;
  final lines = <_CheckLine>[];
  Json? created;
  final techs = [
    for (final t in MtLookups.technicians(lk))
      if (allow(asInt(t['id']) ?? 0)) Option(asInt(t['id'])!, str(t['name'])),
  ];

  final saved = await showFormSheet(
    context,
    title: 'New Work Order',
    saveLabel: 'Create Work Order',
    builder: (ctx, setS) => [
      hintText('For a breakdown someone reported, open their request and use “Create Work Order” instead, so the downtime and sign-off link up.'),
      if (vis.section('job')) ...[
        sheetSection('Job'),
        AppSelect<int>(
          label: 'Asset',
          required: true,
          value: assetId,
          valueLabel: assetId == null ? null : (assetCache[assetId] == null ? assetText : assetLabel(assetCache[assetId]!)),
          loadOptions: (q) => loadAssetOptions(q),
          onChanged: (o) => setS(() => assetId = o?.value),
        ),
        AppSelect<String>(
          label: 'Type',
          value: woType,
          clearable: false,
          options: [for (final k in typeChoices) Option(k, woTypeLabels[k]!)],
          onChanged: (o) => setS(() => woType = o?.value ?? woType),
        ),
        AppSelect<String>(
          label: 'Priority',
          value: priority,
          clearable: false,
          options: [for (final k in prChoices) Option(k, priorityLabels[k]!)],
          onChanged: (o) => setS(() => priority = o?.value ?? priority),
        ),
        AppTextField(label: 'Title', required: true, controller: title, hint: 'Replace worn spindle bearings'),
        AppTextField(label: 'Instructions', controller: desc, maxLines: 4),
        CheckField(
          label: 'Machine is down for this job (tracks downtime and blocks it in Production)',
          value: machineDown,
          onChanged: (v) => setS(() => machineDown = v),
        ),
        if (machineDown)
          DateTimeField(label: 'Down Since', value: downSince, notAfterNow: true, onChanged: (v) => setS(() => downSince = v)),
      ],
      if (vis.section('planning')) ...[
        sheetSection('Planning'),
        AppSelect<int>(label: 'Technician', value: tech, options: techs, onChanged: (o) => setS(() => tech = o?.value)),
        DateField(label: 'Planned Start', value: plannedStart, onChanged: (d) => setS(() => plannedStart = d)),
        DateField(label: 'Planned End', value: plannedEnd, onChanged: (d) => setS(() => plannedEnd = d)),
        AppTextField(label: 'Est. Hours', controller: hours, keyboardType: AppTextField.number),
      ],
      if (vis.section('checklist')) ...[
        sheetSection('Checklist', extra: '(optional)'),
        if (lines.isEmpty) hintText('Each line needs a result (OK / Not OK / N/A) before the job can be completed.'),
        for (var i = 0; i < lines.length; i++)
          Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
            Padding(padding: const EdgeInsets.only(top: 14, right: 6), child: smallText('${i + 1}.')),
            Expanded(
              child: Column(children: [
                AppTextField(label: 'Check', controller: lines[i].description, hint: 'Check belt tension'),
                const SizedBox(height: 6),
                AppTextField(label: 'Expected (optional)', controller: lines[i].expected),
              ]),
            ),
            IconButton(
              tooltip: 'Remove',
              icon: const Icon(Icons.close_rounded, color: kRed),
              onPressed: () => setS(() => lines.removeAt(i).dispose()),
            ),
          ]),
        Align(alignment: Alignment.centerLeft, child: smallBtn('+ Add Line', () => setS(() => lines.add(_CheckLine())))),
      ],
    ],
    onSave: () async {
      if (assetId == null) throw 'Pick the asset this work is on.';
      if (title.text.trim().isEmpty) throw 'Give the work order a title.';
      if (plannedStart != null && plannedEnd != null && plannedEnd!.isBefore(plannedStart!)) {
        throw "Planned end can't be before planned start.";
      }
      final hrs = numOrNull(hours.text);
      if (hrs != null && (hrs.isNaN || hrs < 0)) throw 'Estimated hours must be a positive number.';
      final blank = lines.indexWhere((l) => l.description.text.trim().isEmpty);
      if (blank >= 0) throw 'Checklist line ${blank + 1} is empty — fill it in or remove it.';
      if (machineDown && downSince != null && downSince!.isAfter(DateTime.now())) throw "Downtime start can't be in the future.";
      created = asMap(await Api.post('/maintenance/work-orders', data: {
        'asset_id': assetId,
        'wo_type': woType,
        'priority': priority,
        'title': title.text.trim(),
        'description': desc.text.trim().isEmpty ? null : desc.text.trim(),
        'machine_down': machineDown,
        'downtime_start': machineDown ? isoOf(downSince) : null,
        'assigned_to_id': tech,
        'planned_start': plannedStart == null ? null : apiDate(plannedStart!),
        'planned_end': plannedEnd == null ? null : apiDate(plannedEnd!),
        'estimated_hours': hrs,
        'tasks': [
          for (var i = 0; i < lines.length; i++)
            {
              'sequence': (i + 1) * 10,
              'description': lines[i].description.text.trim(),
              'expected_value': lines[i].expected.text.trim().isEmpty ? null : lines[i].expected.text.trim(),
            },
        ],
      }));
    },
  );
  for (final c in [title, desc, hours]) {
    c.dispose();
  }
  for (final l in lines) {
    l.dispose();
  }
  if (!saved || created == null || !context.mounted) return;
  onCreated?.call();
  openScreen(context, WorkOrderDetailScreen(id: asInt(created!['id'])!));
}

// ── Work order detail (work-orders/[id]) ─────────────────────────────────────

const _steps = ['draft', 'assigned', 'in_progress', 'completed', 'closed'];
const _rcaTypes = ['breakdown', 'corrective'];
const _spareIssueStatuses = ['assigned', 'in_progress', 'on_hold'];
const _labourStatuses = ['assigned', 'in_progress', 'on_hold', 'completed'];
const _results = [('ok', 'OK', kGreen), ('not_ok', 'Not OK', kRed), ('na', 'N/A', kGrey)];

class WorkOrderDetailScreen extends StatefulWidget {
  const WorkOrderDetailScreen({super.key, required this.id});
  final int id;

  @override
  State<WorkOrderDetailScreen> createState() => _WorkOrderDetailScreenState();
}

class _WorkOrderDetailScreenState extends State<WorkOrderDetailScreen> {
  Json? _wo;
  Object? _error;
  bool _busy = false;
  bool _closeOutPending = false;
  int _reloadToken = 0;
  final _vis = Vis('maintenance:work_orders');

  int get id => widget.id;
  bool _wf(String key, [String action = 'view']) => Mt.feat('work_orders', key, action);

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    try {
      final d = await Api.get('/maintenance/work-orders/$id');
      if (!mounted) return;
      setState(() {
        _wo = asMap(d);
        _error = null;
        _reloadToken++;
      });
      _loadApproval();
    } catch (e) {
      if (mounted) setState(() => _error = e);
    }
  }

  Future<void> _loadApproval() async {
    try {
      final st = asMap(await Api.get('/approvals/entity/maintenance_work_order/$id'));
      final cur = asMap(st?['current']);
      if (mounted) setState(() => _closeOutPending = cur?['status'] == 'pending');
    } catch (_) {
      if (mounted) setState(() => _closeOutPending = false);
    }
  }

  /// Every work order action returns the full work order.
  Future<bool> _run(Future<dynamic> Function() fn, {String? success}) async {
    setState(() => _busy = true);
    try {
      final d = await fn();
      if (!mounted) return true;
      if (d is Map) {
        setState(() {
          _wo = Map<String, dynamic>.from(d);
          _reloadToken++;
        });
      }
      _loadApproval();
      if (success != null) showSnack(context, success);
      return true;
    } catch (e) {
      if (mounted) showSnack(context, ApiClient.describe(e), error: true);
      return false;
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _act(String action, [Map<String, dynamic>? payload]) =>
      _run(() => Api.post('/maintenance/work-orders/$id/$action', data: payload ?? {}));

  Future<void> _reasonAction(String which) async {
    final title = which == 'hold' ? 'Put job on hold?' : which == 'reopen' ? 'Reopen this job?' : 'Cancel this work order?';
    final message = which == 'hold'
        ? "Say what you're waiting for — spares, vendor, shutdown window…"
        : which == 'reopen'
            ? 'The job goes back to In Progress.'
            : 'Planned spares are dropped. If it came from a request, the request goes back to Acknowledged.';
    final confirm = which == 'hold' ? 'Put On Hold' : which == 'reopen' ? 'Reopen' : 'Cancel Work Order';
    final reason = await promptDialog(context, title: title, message: message, confirmLabel: confirm);
    if (reason == null) return;
    _act(which, {'reason': reason});
  }

  Future<void> _confirmThen(String title, String message, String label, Future<dynamic> Function() fn, {bool danger = true}) async {
    final ok = await confirmDialog(context, title: title, message: message, confirmLabel: label, danger: danger);
    if (ok) _run(fn);
  }

  // ── Dialogs ──

  Future<void> _assign() async {
    final wo = _wo!;
    Json? lk;
    try {
      lk = await MtLookups.get();
    } catch (e) {
      if (mounted) showSnack(context, ApiClient.describe(e), error: true);
      return;
    }
    final allow = await assigneeFilter('maintenance:work_orders.assign');
    if (!mounted) return;
    final techs = [
      for (final t in MtLookups.technicians(lk))
        if (allow(asInt(t['id']) ?? 0) || asInt(t['id']) == asInt(wo['assigned_to_id'])) Option(asInt(t['id'])!, str(t['name'])),
    ];
    int? tech = wo['status'] == 'draft' ? null : asInt(wo['assigned_to_id']);
    await showFormSheet(
      context,
      title: wo['status'] == 'draft' ? 'Assign technician' : 'Reassign technician',
      saveLabel: 'Assign',
      builder: (ctx, setS) => [
        hintText('${wo['wo_number']} — the technician is notified and the job moves to Assigned.'),
        AppSelect<int>(label: 'Technician', required: true, value: tech, options: techs, onChanged: (o) => setS(() => tech = o?.value)),
        if (techs.isEmpty) hintText('No technicians found. Give maintenance staff the Maintenance module in User Management.'),
      ],
      onSave: () async {
        if (tech == null) throw 'Pick a technician.';
        final d = await Api.post('/maintenance/work-orders/$id/assign', data: {'assigned_to_id': tech});
        if (mounted && d is Map) setState(() => _wo = Map<String, dynamic>.from(d));
      },
    );
  }

  Future<void> _complete() async {
    final wo = _wo!;
    final needsRca = _rcaTypes.contains(wo['wo_type']);
    final failureChoices = _keepCurrent(wo['failure_category'], _vis.options('failure_category', failureCategoryLabels.keys));
    String? failure = str(wo['failure_category']).isEmpty ? null : str(wo['failure_category']);
    final root = TextEditingController(text: str(wo['root_cause']));
    final action = TextEditingController(text: str(wo['action_taken']));
    final meter = TextEditingController();
    DateTime? handedBack = DateTime.now();
    final machineDown = wo['machine_down'] == true;
    final meterUnit = str(wo['asset_meter_unit']);
    await showFormSheet(
      context,
      title: 'Mark job completed',
      saveLabel: 'Mark Completed',
      builder: (ctx, setS) => [
        hintText('${wo['wo_number']} — record what failed and what was done.'),
        sheetSection('Root Cause Analysis', extra: needsRca ? null : '(optional)'),
        AppSelect<String>(
          label: 'Failure Category',
          required: needsRca,
          value: failure,
          options: [for (final k in failureChoices) Option(k, label(failureCategoryLabels, k))],
          onChanged: (o) => setS(() => failure = o?.value),
        ),
        AppTextField(label: 'Root Cause', required: needsRca, controller: root, maxLines: 3, hint: 'Why did it fail?'),
        AppTextField(label: 'Action Taken', required: needsRca, controller: action, maxLines: 3, hint: 'What was done to fix it?'),
        if (machineDown || meterUnit.isNotEmpty) sheetSection('Hand-back'),
        if (machineDown) ...[
          DateTimeField(label: 'Machine Handed Back At', value: handedBack, notAfterNow: true, onChanged: (v) => setS(() => handedBack = v)),
          hintText('Ends the downtime clock.'),
        ],
        if (meterUnit.isNotEmpty) ...[
          AppTextField(
            label: 'Counter reading now ($meterUnit)',
            required: true,
            controller: meter,
            keyboardType: AppTextField.number,
            hint: wo['asset_meter_reading'] != null ? 'Last: ${wo['asset_meter_reading']}' : null,
          ),
          hintText('Booked in the reading history; restarts counter-based PM plans.'),
        ],
      ],
      onSave: () async {
        if (needsRca && (failure == null || root.text.trim().isEmpty || action.text.trim().isEmpty)) {
          throw 'A ${label(woTypeLabels, wo['wo_type']).toLowerCase()} job needs the failure category, root cause and action taken before it can be completed.';
        }
        final pending = asList(wo['tasks']).where((t) => t['result'] == null).length;
        if (pending > 0) {
          throw '$pending checklist line${pending > 1 ? 's have' : ' has'} no result yet — mark each OK, Not OK or N/A first.';
        }
        final m = numOrNull(meter.text);
        if (m != null && m.isNaN) throw 'Counter reading must be a number.';
        final d = await Api.post('/maintenance/work-orders/$id/complete', data: {
          'failure_category': failure,
          'root_cause': root.text.trim().isEmpty ? null : root.text.trim(),
          'action_taken': action.text.trim().isEmpty ? null : action.text.trim(),
          'handed_back_at': machineDown ? isoOf(handedBack) : null,
          'meter_reading': meterUnit.isNotEmpty ? m : null,
        });
        if (mounted && d is Map) setState(() => _wo = Map<String, dynamic>.from(d));
      },
    );
    root.dispose();
    action.dispose();
    meter.dispose();
    _loadApproval();
  }

  List<String> _keepCurrent(Object? current, List<String> choices) {
    final c = str(current);
    return c.isNotEmpty && !choices.contains(c) ? [c, ...choices] : choices;
  }

  Future<void> _editDetails() async {
    final wo = _wo!;
    Json? lk;
    try {
      lk = await MtLookups.get();
    } catch (e) {
      if (mounted) showSnack(context, ApiClient.describe(e), error: true);
      return;
    }
    if (!mounted) return;
    final showCosts = Mt.showCosts;
    final typeChoices = _keepCurrent(wo['wo_type'], _vis.options('wo_type', woTypeLabels.keys));
    final prChoices = _keepCurrent(normPriority(wo['priority']), _vis.options('priority', priorityLabels.keys));
    final title = TextEditingController(text: str(wo['title']));
    final desc = TextEditingController(text: str(wo['description']));
    final hours = TextEditingController(text: str(wo['estimated_hours']));
    final ext = TextEditingController(text: (asNum(wo['external_cost']) ?? 0) == 0 ? '' : str(wo['external_cost']));
    var woType = str(wo['wo_type']);
    var priority = normPriority(wo['priority']);
    DateTime? ps = parseDate(wo['planned_start']), pe = parseDate(wo['planned_end']);
    int? vendor = asInt(wo['external_vendor_id']);
    await showFormSheet(
      context,
      title: 'Edit work order details',
      builder: (ctx, setS) => [
        hintText('${wo['wo_number']} — title, type, plan and outside service.'),
        sheetSection('Basic Information'),
        AppTextField(label: 'Title', required: true, controller: title),
        AppSelect<String>(
          label: 'Type',
          value: woType,
          clearable: false,
          options: [for (final k in typeChoices) Option(k, label(woTypeLabels, k))],
          onChanged: (o) => setS(() => woType = o?.value ?? woType),
        ),
        AppSelect<String>(
          label: 'Priority',
          value: priority,
          clearable: false,
          options: [for (final k in prChoices) Option(k, label(priorityLabels, k))],
          onChanged: (o) => setS(() => priority = o?.value ?? priority),
        ),
        AppTextField(label: 'Instructions', controller: desc, maxLines: 4),
        sheetSection('Schedule'),
        DateField(label: 'Planned Start', value: ps, onChanged: (d) => setS(() => ps = d)),
        DateField(label: 'Planned End', value: pe, onChanged: (d) => setS(() => pe = d)),
        AppTextField(label: 'Est. Hours', controller: hours, keyboardType: AppTextField.number),
        sheetSection('Outside Service', extra: '(optional)'),
        AppSelect<int>(
          label: 'External Service Vendor',
          value: vendor,
          valueLabel: str(wo['external_vendor_name']),
          options: MtLookups.vendors(lk),
          onChanged: (o) => setS(() => vendor = o?.value),
        ),
        if (showCosts) AppTextField(label: 'External Cost (₹)', controller: ext, keyboardType: AppTextField.number),
      ],
      onSave: () async {
        if (title.text.trim().isEmpty) throw 'Title is required.';
        if (ps != null && pe != null && pe!.isBefore(ps!)) throw "Planned end can't be before planned start.";
        final hrs = numOrNull(hours.text);
        final extCost = numOrNull(ext.text) ?? 0;
        if ((hrs != null && (hrs.isNaN || hrs < 0)) || extCost.isNaN || extCost < 0) {
          throw 'Hours and external cost must be positive numbers.';
        }
        final d = await Api.patch('/maintenance/work-orders/$id', data: {
          'title': title.text.trim(),
          'wo_type': woType,
          'priority': priority,
          'description': desc.text.trim().isEmpty ? null : desc.text.trim(),
          'planned_start': ps == null ? null : apiDate(ps!),
          'planned_end': pe == null ? null : apiDate(pe!),
          'estimated_hours': hrs,
          'external_vendor_id': vendor,
          // Only users with Maintenance costs see (and so send) the external cost.
          if (showCosts) 'external_cost': extCost,
        });
        if (mounted && d is Map) setState(() => _wo = Map<String, dynamic>.from(d));
      },
    );
    for (final c in [title, desc, hours, ext]) {
      c.dispose();
    }
  }

  Future<void> _spare(String mode, [Json? spare]) async {
    final wo = _wo!;
    Json? lk;
    try {
      lk = await MtLookups.get();
    } catch (e) {
      if (mounted) showSnack(context, ApiClient.describe(e), error: true);
      return;
    }
    if (!mounted) return;
    final branch = asInt(wo['branch_id']);
    final locs = asList(lk['store_locations'])
      ..sort((a, b) {
        final pa = asInt(a['branch_id']) == branch ? 0 : 1, pb = asInt(b['branch_id']) == branch ? 0 : 1;
        return pa != pb ? pa - pb : str(a['name']).compareTo(str(b['name']));
      });
    int? location = spare != null ? asInt(spare['location_id']) : (locs.isEmpty ? null : asInt(locs.first['id']));
    int? item = spare == null ? null : asInt(spare['store_item_id']);
    final outstanding = spare == null ? 0 : (asNum(spare['qty_planned'])! - asNum(spare['qty_issued'])!);
    final qty = TextEditingController(text: spare == null ? '1' : fmtQty(outstanding > 0 ? outstanding : 1));
    final remarks = TextEditingController();
    final plan = mode == 'plan';
    await showFormSheet(
      context,
      title: plan ? 'Plan a spare' : spare != null ? 'Issue ${spare['item_code']}' : 'Issue spare from Store',
      saveLabel: plan ? 'Add to Plan' : 'Issue',
      builder: (ctx, setS) {
        final uom = spare != null ? str(spare['uom']) : str(storeItemCache[item]?['uom']);
        return [
          hintText(plan
              ? 'Reserve a spare for ${wo['wo_number']} — nothing leaves Store yet.'
              : 'Takes the spare out of Store stock against ${wo['wo_number']}.'),
          if (spare != null)
            Text(
              '${str(spare['item_name'])} from ${str(spare['location_name'])}. Issued so far: ${fmtQty(spare['qty_issued'])} of ${fmtQty(spare['qty_planned'])} planned'
              '${spare['available_qty'] != null ? ' · ${fmtQty(spare['available_qty'])} in stock' : ''}.',
              style: const TextStyle(fontSize: 13),
            )
          else ...[
            sheetSection('Spare Part'),
            AppSelect<int>(
              label: 'Store Location',
              required: true,
              value: location,
              options: [for (final l in locs) Option(asInt(l['id'])!, str(l['name']))],
              onChanged: (o) => setS(() {
                location = o?.value;
                item = null;
              }),
            ),
            AppSelect<int>(
              key: ValueKey('item-$location'),
              label: 'Spare Part',
              required: true,
              value: item,
              valueLabel: item == null ? null : '${storeItemCache[item]?['item_code'] ?? ''} ${storeItemCache[item]?['item_name'] ?? ''}',
              loadOptions: (q) => loadStoreItemOptions(q, locationId: location),
              onChanged: (o) => setS(() => item = o?.value),
            ),
          ],
          sheetSection('Quantity'),
          AppTextField(label: 'Quantity${uom.isNotEmpty ? ' ($uom)' : ''}', required: true, controller: qty, keyboardType: AppTextField.number),
          AppTextField(label: 'Remarks', controller: remarks),
          if (!plan) hintText('This posts an issue in the Store stock ledger against ${wo['wo_number']}.'),
        ];
      },
      onSave: () async {
        final q = numOrNull(qty.text);
        if (q == null || q.isNaN || q <= 0) throw 'Quantity must be greater than 0.';
        if (spare == null && (item == null || location == null)) throw 'Pick the store location and the spare part.';
        final rem = remarks.text.trim().isEmpty ? null : remarks.text.trim();
        final dynamic d;
        if (plan) {
          d = await Api.post('/maintenance/work-orders/$id/spares',
              data: {'store_item_id': item, 'location_id': location, 'qty_planned': q, 'remarks': rem});
        } else {
          d = await Api.post('/maintenance/work-orders/$id/spares/issue',
              data: spare != null
                  ? {'spare_id': spare['id'], 'quantity': q, 'remarks': rem}
                  : {'store_item_id': item, 'location_id': location, 'quantity': q, 'remarks': rem});
        }
        if (mounted && d is Map) setState(() => _wo = Map<String, dynamic>.from(d));
      },
    );
    qty.dispose();
    remarks.dispose();
  }

  Future<void> _returnSpare(Json spare) async {
    final out = asNum(spare['qty_issued'])! - asNum(spare['qty_returned'])!;
    final qty = TextEditingController(text: fmtQty(out));
    await showFormSheet(
      context,
      title: 'Return ${spare['item_code']} to Store',
      saveLabel: 'Return',
      builder: (ctx, setS) => [
        hintText('${fmtQty(out)} ${str(spare['uom'])} still out on this job. Unused quantity goes back to ${str(spare['location_name'])}.'),
        AppTextField(label: 'Quantity', required: true, controller: qty, keyboardType: AppTextField.number),
      ],
      onSave: () async {
        final q = numOrNull(qty.text);
        if (q == null || q.isNaN || q <= 0) throw 'Quantity must be greater than 0.';
        final d = await Api.post('/maintenance/work-orders/$id/spares/return', data: {'spare_id': spare['id'], 'quantity': q});
        if (mounted && d is Map) setState(() => _wo = Map<String, dynamic>.from(d));
      },
    );
    qty.dispose();
  }

  Future<void> _logLabour() async {
    final wo = _wo!;
    Json? lk;
    try {
      lk = await MtLookups.get();
    } catch (e) {
      if (mounted) showSnack(context, ApiClient.describe(e), error: true);
      return;
    }
    final allow = await assigneeFilter('maintenance:work_orders.labour');
    if (!mounted) return;
    final showCosts = Mt.showCosts;
    // Your own time is always allowed (server rule).
    final techs = [
      for (final t in MtLookups.technicians(lk))
        if (allow(asInt(t['id']) ?? 0) || asInt(t['id']) == Perm.userId) Option(asInt(t['id'])!, str(t['name'])),
    ];
    int? tech = asInt(wo['assigned_to_id']);
    DateTime? from, to;
    final hours = TextEditingController();
    final rate = TextEditingController();
    final remarks = TextEditingController();
    await showFormSheet(
      context,
      title: 'Log labour',
      saveLabel: 'Log Time',
      builder: (ctx, setS) => [
        hintText('Time spent on ${wo['wo_number']} — adds to its labour cost.'),
        sheetSection('Technician'),
        AppSelect<int>(label: 'Technician', required: true, value: tech, options: techs, onChanged: (o) => setS(() => tech = o?.value)),
        sheetSection('Time'),
        DateTimeField(label: 'From', value: from, onChanged: (v) => setS(() => from = v)),
        DateTimeField(label: 'To', value: to, onChanged: (v) => setS(() => to = v)),
        AppTextField(label: 'Or Hours', controller: hours, keyboardType: AppTextField.number),
        if (showCosts) AppTextField(label: 'Rate / hr (₹)', controller: rate, keyboardType: AppTextField.number, hint: '0'),
        hintText('Enter the hours, or both a start and end time.'),
        AppTextField(label: 'Remarks', controller: remarks),
      ],
      onSave: () async {
        if (tech == null) throw 'Pick the technician.';
        final h = numOrNull(hours.text);
        if ((h == null || h == 0) && !(from != null && to != null)) throw 'Enter the hours worked, or both a start and end time.';
        if (from != null && to != null && !to!.isAfter(from!)) throw 'End time must be after start time.';
        if (h != null && (h.isNaN || h <= 0 || h > 24)) throw 'Hours must be between 0 and 24 for one entry.';
        final r = numOrNull(rate.text) ?? 0;
        if (r.isNaN || r < 0) throw 'Hourly rate must be zero or more.';
        final d = await Api.post('/maintenance/work-orders/$id/labour', data: {
          'technician_id': tech,
          'start_time': isoOf(from),
          'end_time': isoOf(to),
          'hours': h,
          'hourly_rate': r,
          'remarks': remarks.text.trim().isEmpty ? null : remarks.text.trim(),
        });
        if (mounted && d is Map) setState(() => _wo = Map<String, dynamic>.from(d));
      },
    );
    for (final c in [hours, rate, remarks]) {
      c.dispose();
    }
  }

  Future<void> _addTask() async {
    final text = await promptDialog(context, title: 'Add a check', label: 'Check', confirmLabel: '+ Add', message: 'e.g. Inspect coupling for wear');
    if (text == null || text.trim().isEmpty) return;
    _run(() => Api.post('/maintenance/work-orders/$id/tasks', data: {'description': text.trim()}));
  }

  Future<void> _editTask(Json t) async {
    final measured = TextEditingController(text: str(t['measured_value']));
    final remarks = TextEditingController(text: str(t['remarks']));
    await showFormSheet(
      context,
      title: 'Checklist line ${t['sequence']}',
      builder: (ctx, setS) => [
        Text(str(t['description']), style: const TextStyle(fontWeight: FontWeight.w600)),
        if (str(t['expected_value']).isNotEmpty) hintText('Expected: ${t['expected_value']}'),
        AppTextField(label: 'Measured', controller: measured, hint: 'Reading'),
        AppTextField(label: 'Remarks', controller: remarks),
      ],
      onSave: () async {
        final d = await Api.patch('/maintenance/work-orders/$id/tasks/${t['id']}', data: {
          'measured_value': measured.text.trim().isEmpty ? null : measured.text.trim(),
          'remarks': remarks.text.trim().isEmpty ? null : remarks.text.trim(),
        });
        if (mounted && d is Map) setState(() => _wo = Map<String, dynamic>.from(d));
      },
    );
    measured.dispose();
    remarks.dispose();
  }

  // ── Build ──

  List<BarAction> _actions(Json wo) {
    final s = str(wo['status']);
    final mayEdit = Mt.can('work_orders', 'edit');
    final mayApprove = Mt.can('work_orders', 'approve');
    final editable = s != 'closed' && s != 'cancelled' && mayEdit;
    final awaiting = wo['awaiting_confirmation'] == true;
    return [
      if (mayEdit && _wf('assign', 'edit') && s == 'draft') BarAction('Assign Technician', _assign, primary: true),
      if (mayEdit && s == 'assigned') BarAction('Start Job', () => _act('start'), primary: true),
      if (mayEdit && s == 'in_progress') BarAction('Mark Completed', _complete, primary: true),
      if (mayEdit && s == 'on_hold') BarAction('Resume', () => _act('resume'), primary: true),
      if (mayApprove && _wf('close_out', 'approve') && s == 'completed' && !_closeOutPending)
        BarAction(
          'Verify & Close',
          awaiting
              ? () => showSnack(context,
                  'Waiting for ${str(wo['requester_name']).isEmpty ? 'the requester' : wo['requester_name']} to confirm the machine is OK.',
                  error: true)
              : () => _confirmThen(
                    'Close ${wo['wo_number']}?',
                    'This verifies the job and freezes its cost. The asset returns to Operational if nothing else is open on it.',
                    'Verify & Close',
                    () => Api.post('/maintenance/work-orders/$id/close', data: {}),
                    danger: false,
                  ),
          primary: true,
        ),
      if (mayEdit && s == 'in_progress') BarAction('Put On Hold', () => _reasonAction('hold')),
      if (mayEdit && _wf('assign', 'edit') && const ['assigned', 'in_progress', 'on_hold'].contains(s)) BarAction('Reassign', _assign),
      if (mayApprove && _wf('close_out', 'edit') && s == 'completed' && !_closeOutPending) BarAction('Reopen', () => _reasonAction('reopen')),
      if (editable) BarAction('Edit Details', _editDetails),
      if (mayApprove && _wf('close_out', 'cancel') && const ['draft', 'assigned', 'on_hold'].contains(s))
        BarAction('Cancel', () => _reasonAction('cancel'), danger: true),
    ];
  }

  @override
  Widget build(BuildContext context) {
    final wo = _wo;
    final actions = wo == null ? <BarAction>[] : _actions(wo);
    return SubPage(
      title: str(wo?['wo_number']).isEmpty ? 'Work Order' : str(wo!['wo_number']),
      bottom: actions.isEmpty ? null : ActionBar(actions, busy: _busy),
      body: wo == null
          ? (_error != null ? ErrorView(_error!, onRetry: _load) : const LoadingView())
          : RefreshIndicator(onRefresh: _load, child: _body(wo)),
    );
  }

  Widget _body(Json wo) {
    final s = str(wo['status']);
    final mayEdit = Mt.can('work_orders', 'edit');
    final editable = s != 'closed' && s != 'cancelled' && mayEdit;
    final canIssue = _spareIssueStatuses.contains(s) && mayEdit;
    final canLabour = _labourStatuses.contains(s) && mayEdit;
    final showCosts = Mt.showCosts;
    final downtime = wo['downtime_minutes'] ?? wo['live_downtime_minutes'];
    final tasks = asList(wo['tasks']);
    final spares = asList(wo['spares']);
    final labour = asList(wo['labour_logs']);
    final hasRca = str(wo['failure_category']).isNotEmpty || str(wo['root_cause']).isNotEmpty || str(wo['action_taken']).isNotEmpty;
    return ListView(
      padding: const EdgeInsets.only(bottom: 24),
      children: [
        MtHeader(str(wo['wo_number']), caps: 'Maintenance Work Order', actions: [statusPill(woStatusLabels, woStatusHex, s)]),
        if (s != 'cancelled') _stepper(s),
        if (wo['awaiting_confirmation'] == true)
          NoteBanner(
              'Waiting for ${str(wo['requester_name']).isEmpty ? 'the requester' : wo['requester_name']} to confirm the machine is working (${str(wo['request_number'])}). You can close the job once they confirm.'),
        if (s != 'draft')
          ApprovalSection(
            key: ValueKey('appr-$s-$_reloadToken'),
            entityType: 'maintenance_work_order',
            entityId: id,
            title: 'Close-out approval',
            onChanged: _load,
          ),
        if (s == 'on_hold' && str(wo['hold_reason']).isNotEmpty) NoteBanner('On hold: ${wo['hold_reason']}', color: kPurple),
        if (s == 'cancelled' && str(wo['cancel_reason']).isNotEmpty) NoteBanner('Cancelled: ${wo['cancel_reason']}', color: kRed),
        if (str(wo['requester_comment']).isNotEmpty && s == 'in_progress') NoteBanner('Sent back: ${wo['requester_comment']}', color: kRed),
        if (_vis.section('detail_summary'))
          DetailSection(str(wo['title']), children: [
            if (str(wo['description']).isNotEmpty) Text(str(wo['description']), style: const TextStyle(fontSize: 14)),
            const SizedBox(height: 6),
            Wrap(spacing: 6, runSpacing: 4, crossAxisAlignment: WrapCrossAlignment.center, children: [
              priorityPill(wo['priority']),
              smallText('· ${label(woTypeLabels, wo['wo_type'])}'),
              smallText('· Technician ${str(wo['assigned_to_name']).isEmpty ? 'Unassigned' : wo['assigned_to_name']}',
                  color: Brand.heading, weight: FontWeight.w600),
              if (wo['machine_down'] == true) smallText('· Machine down ${formatMinutes(downtime)}', color: kRed, weight: FontWeight.w600),
            ]),
          ]),
        if (_vis.section('detail_asset_source'))
          DetailSection('Asset & Source', children: [
            FieldRow('Asset', _link([str(wo['asset_code']), str(wo['asset_name'])].where((x) => x.isNotEmpty).join(' — '),
                () => openScreen(context, AssetDetailScreen(id: asInt(wo['asset_id'])!)))),
            FieldRow('Plant', wo['branch_name']),
            FieldRow(
              'From Request',
              wo['request_id'] == null
                  ? null
                  : _link('${str(wo['request_number']).isEmpty ? 'Request' : wo['request_number']}${str(wo['requester_name']).isNotEmpty ? ' · raised by ${wo['requester_name']}' : ''}',
                      () => openScreen(context, RequestDetailScreen(id: asInt(wo['request_id'])!))),
            ),
            if (wo['pm_plan_id'] != null)
              FieldRow(
                'From PM Plan',
                _link('${str(wo['pm_plan_code']).isEmpty ? '#${wo['pm_plan_id']}' : wo['pm_plan_code']}${wo['pm_due_date'] != null ? ' · due ${fmtDate(wo['pm_due_date'])}' : ''}',
                    () => openScreen(context, PmPlanDetailScreen(id: asInt(wo['pm_plan_id'])!))),
              ),
          ]),
        if (_vis.section('detail_schedule'))
          DetailSection('Schedule & Time', children: [
            FieldRow('Planned',
                wo['planned_start'] == null ? null : '${fmtDate(wo['planned_start'])}${wo['planned_end'] != null ? ' → ${fmtDate(wo['planned_end'])}' : ''}'),
            FieldRow('Estimated Hours', wo['estimated_hours'] == null ? null : '${wo['estimated_hours']} h'),
            FieldRow('Started', wo['actual_start'] == null ? null : fmtDateTime(wo['actual_start'])),
            FieldRow('Finished', wo['actual_end'] == null ? null : fmtDateTime(wo['actual_end'])),
            if (wo['machine_down'] == true) FieldRow('Machine Down Since', wo['downtime_start'] == null ? null : fmtDateTime(wo['downtime_start'])),
            if (wo['machine_down'] == true) FieldRow(wo['downtime_minutes'] != null ? 'Downtime' : 'Down For (live)', formatMinutes(downtime)),
            if (wo['verified_at'] != null) FieldRow('Closed By', '${txt(wo['verified_by_name'])} · ${fmtDateTime(wo['verified_at'])}'),
          ]),
        if (hasRca && _vis.section('detail_failure_analysis'))
          DetailSection('Failure Analysis', children: [
            FieldRow('Failure Category', wo['failure_category'] == null ? null : label(failureCategoryLabels, wo['failure_category'])),
            FieldRow('Root Cause', wo['root_cause']),
            FieldRow('Action Taken', wo['action_taken']),
          ]),
        if (_wf('checklist') && _vis.section('detail_checklist')) _checklist(tasks, editable),
        if (_wf('spares') && _vis.section('detail_spares')) _spares(wo, spares, editable, canIssue, showCosts),
        if (_wf('labour') && _vis.section('detail_labour')) _labour(labour, editable, canLabour, showCosts),
        if (showCosts)
          DetailSection('Cost', children: [
            factLine('Spares', formatInr(wo['spares_cost'])),
            factLine('Labour', formatInr(wo['labour_cost'])),
            factLine('External',
                '${formatInr(wo['external_cost'])}${str(wo['external_vendor_name']).isNotEmpty ? ' · ${wo['external_vendor_name']}' : ''}'),
            if ((asNum(wo['procured_cost']) ?? 0) > 0) factLine('Outside service (billed)', formatInr(wo['procured_cost'])),
            factLine('Total', formatInr(wo['total_cost'])),
          ]),
        if (_wf('permits'))
          PermitsSection(
            key: ValueKey('permits-$_reloadToken'),
            woId: id,
            woStatus: s,
            permitRequired: wo['permit_required'] == true,
            assignedToId: asInt(wo['assigned_to_id']),
            onChanged: _load,
          ),
        if (_wf('purchase')) PurchaseSection(key: ValueKey('pr-$_reloadToken'), woId: id, woStatus: s, onChanged: _load),
        if (_wf('documents') && _vis.section('detail_documents'))
          AttachmentsSection(
            title: 'Service Reports & Photos',
            entityType: 'work_order',
            entityId: id,
            canUpload: s != 'closed' && s != 'cancelled' && _wf('documents', 'create'),
            canDelete: _wf('documents', 'delete'),
            defaultDocType: 'service_report',
          ),
      ],
    );
  }

  Widget _link(String text, VoidCallback onTap) =>
      InkWell(onTap: onTap, child: Text(text, style: const TextStyle(fontWeight: FontWeight.w600, color: kOrange)));

  Widget _stepper(String s) {
    final idx = _steps.indexOf(s == 'on_hold' ? 'in_progress' : s);
    return Padding(
      padding: const EdgeInsets.fromLTRB(16, 0, 16, 12),
      child: Wrap(spacing: 4, runSpacing: 6, crossAxisAlignment: WrapCrossAlignment.center, children: [
        for (var i = 0; i < _steps.length; i++) ...[
          Container(
            padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
            decoration: BoxDecoration(
              color: i <= idx ? kGreen.withValues(alpha: 0.1) : const Color(0x0A000000),
              borderRadius: BorderRadius.circular(20),
            ),
            child: Text(
              _steps[i] == 'in_progress' && s == 'on_hold' ? 'On Hold' : woStatusLabels[_steps[i]]!,
              style: TextStyle(fontSize: 11.5, fontWeight: FontWeight.w700, color: i <= idx ? const Color(0xFF15803D) : Brand.muted),
            ),
          ),
          if (i < _steps.length - 1) const Text('→', style: TextStyle(color: Brand.muted, fontSize: 12)),
        ],
      ]),
    );
  }

  Widget _checklist(List<Json> tasks, bool editable) {
    final canResult = editable && _wf('checklist', 'edit');
    final done = tasks.where((t) => t['result'] != null).length;
    return DetailSection(
      'Checklist',
      action: tasks.isEmpty ? null : smallText('$done of ${tasks.length} done'),
      children: [
        for (final t in tasks)
          Container(
            padding: const EdgeInsets.symmetric(vertical: 8),
            decoration: const BoxDecoration(border: Border(top: BorderSide(color: Color(0x14000000)))),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
                  SizedBox(width: 26, child: smallText('${t['sequence']}')),
                  Expanded(
                    child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                      Text(str(t['description']), style: const TextStyle(fontSize: 13.5)),
                      if (str(t['expected_value']).isNotEmpty) smallText('Expected: ${t['expected_value']}'),
                    ]),
                  ),
                  if (canResult)
                    IconButton(
                      tooltip: 'Remove',
                      visualDensity: VisualDensity.compact,
                      icon: const Icon(Icons.delete_outline_rounded, size: 19, color: kRed),
                      onPressed: () => _confirmThen('Remove checklist line?', str(t['description']), 'Remove',
                          () => Api.delete('/maintenance/work-orders/$id/tasks/${t['id']}')),
                    ),
                ]),
                const SizedBox(height: 6),
                Padding(
                  padding: const EdgeInsets.only(left: 26),
                  child: Wrap(spacing: 6, runSpacing: 6, crossAxisAlignment: WrapCrossAlignment.center, children: [
                    for (final (value, text, color) in _results)
                      ChoiceChip(
                        label: Text(text),
                        selected: t['result'] == value,
                        selectedColor: color.withValues(alpha: 0.15),
                        labelStyle: TextStyle(
                            fontSize: 12, fontWeight: FontWeight.w700, color: t['result'] == value ? color : Brand.muted),
                        side: BorderSide(color: t['result'] == value ? color : Brand.border),
                        showCheckmark: false,
                        visualDensity: VisualDensity.compact,
                        onSelected: canResult
                            ? (_) => _run(() => Api.patch('/maintenance/work-orders/$id/tasks/${t['id']}',
                                data: {'result': t['result'] == value ? null : value}))
                            : null,
                      ),
                    InkWell(
                      onTap: canResult ? () => _editTask(t) : null,
                      child: smallText(
                        'Measured: ${txt(t['measured_value'])} · Remarks: ${txt(t['remarks'])}${canResult ? '  ✎' : ''}',
                        color: canResult ? kOrange : Brand.muted,
                      ),
                    ),
                    if (str(t['done_by_name']).isNotEmpty) smallText('By ${t['done_by_name']}'),
                  ]),
                ),
              ],
            ),
          ),
        if (editable && _wf('checklist', 'create'))
          Padding(padding: const EdgeInsets.only(top: 8), child: Align(alignment: Alignment.centerLeft, child: smallBtn('+ Add', _busy ? null : _addTask))),
        if (!editable && tasks.isEmpty) mutedText('No checklist on this job.'),
      ],
    );
  }

  Widget _spares(Json wo, List<Json> spares, bool editable, bool canIssue, bool showCosts) {
    return DetailSection(
      'Spares',
      children: [
        if (editable && _wf('spares', 'create'))
          Wrap(spacing: 8, runSpacing: 8, children: [
            if (canIssue) smallBtn('Issue from Store', _busy ? null : () => _spare('issue')),
            smallBtn('+ Plan Spare', _busy ? null : () => _spare('plan')),
          ]),
        if (spares.isEmpty)
          mutedText('No spares on this job. Issued spares are taken out of Store stock against ${wo['wo_number']}.')
        else
          for (final sp in spares)
            Builder(builder: (_) {
              final outstanding = asNum(sp['qty_issued'])! - asNum(sp['qty_returned'])!;
              final avail = asNum(sp['available_qty']);
              final short = avail != null && avail < asNum(sp['qty_planned'])! - asNum(sp['qty_issued'])!;
              return LineItem(
                title: '${str(sp['item_code'])} ${str(sp['item_name'])}',
                subtitle: [
                  'Store: ${txt(sp['location_name'])}',
                  'Planned ${fmtQty(sp['qty_planned'])} ${str(sp['uom'])}'.trim(),
                  'Issued ${fmtQty(sp['qty_issued'])}',
                  'Returned ${fmtQty(sp['qty_returned'])}',
                  if (showCosts) 'Cost ${formatInr(sp['net_cost'])}',
                  if (str(sp['remarks']).isNotEmpty) str(sp['remarks']),
                ].join(' · '),
                badges: [
                  smallText('In stock: ${avail == null ? '—' : fmtQty(avail)}', color: short ? kRed : Brand.body, weight: FontWeight.w600),
                ],
                trailing: [
                  Wrap(spacing: 6, runSpacing: 6, alignment: WrapAlignment.end, children: [
                    if (canIssue && _wf('spares', 'create')) smallBtn('Issue', _busy ? null : () => _spare('issue', sp)),
                    if (editable && _wf('spares', 'edit') && outstanding > 0) smallBtn('Return', _busy ? null : () => _returnSpare(sp)),
                    if (editable && _wf('spares', 'delete') && (asNum(sp['qty_issued']) ?? 0) == 0)
                      smallBtn(
                        'Remove',
                        _busy
                            ? null
                            : () => _confirmThen('Remove spare line?', '${sp['item_code']} ${str(sp['item_name'])}', 'Remove',
                                () => Api.delete('/maintenance/work-orders/$id/spares/${sp['id']}')),
                        danger: true,
                      ),
                  ]),
                ],
              );
            }),
      ],
    );
  }

  Widget _labour(List<Json> logs, bool editable, bool canLabour, bool showCosts) {
    final canLog = canLabour && _wf('labour', 'create');
    return DetailSection(
      'Labour',
      action: canLog ? smallBtn('+ Log Time', _busy ? null : _logLabour) : null,
      children: [
        if (logs.isEmpty)
          mutedText('No time logged yet.${canLog ? ' Use + Log Time to record hours spent on this job.' : ''}')
        else
          for (final l in logs)
            LineItem(
              title: '${txt(l['technician_name'])} · ${fmtQty(l['hours'])} h',
              subtitle: [
                '${fmtDateTime(l['start_time'])} → ${fmtDateTime(l['end_time'])}',
                if (showCosts) 'Rate ${(asNum(l['hourly_rate']) ?? 0) != 0 ? formatInr(l['hourly_rate']) : '—'}',
                if (showCosts) 'Cost ${(asNum(l['cost']) ?? 0) != 0 ? formatInr(l['cost']) : '—'}',
                if (str(l['remarks']).isNotEmpty) str(l['remarks']),
              ].join(' · '),
              trailing: [
                if (editable && _wf('labour', 'delete'))
                  IconButton(
                    tooltip: 'Delete',
                    icon: const Icon(Icons.delete_outline_rounded, size: 19, color: kRed),
                    onPressed: () => _confirmThen('Delete labour entry?', '${fmtQty(l['hours'])} h by ${str(l['technician_name']).isEmpty ? 'technician' : l['technician_name']}',
                        'Delete', () => Api.delete('/maintenance/work-orders/$id/labour/${l['id']}')),
                  ),
              ],
            ),
      ],
    );
  }
}
