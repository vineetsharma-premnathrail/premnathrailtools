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

/// Production › RRV Builds - portal rrv-builds/ (list, new, rework, [id])
/// and components/production/rrvMeta.ts.

const rrvTestTypes = <String, String>{
  'static_inspection': 'Static inspection (dimensions & weight)',
  'rail_gauge_check': 'Rail gauge & wheel profile check',
  'guide_wheel_deployment': 'Rail guide-wheel deployment / retraction',
  'brake_test_road': 'Brake test — road mode',
  'brake_test_rail': 'Brake test — rail mode',
  'road_trial': 'Road trial',
  'rail_trial': 'Rail trial',
  'load_test': 'Load / towing test',
  'emergency_stop': 'Emergency stop & interlocks',
  'lighting_signalling': 'Lighting, horn & signalling',
  'hydraulic_function': 'Hydraulic functions',
  'electrical_function': 'Electrical functions',
  'other': 'Other',
};
const rrvDefaultTests = [
  'static_inspection', 'guide_wheel_deployment', 'brake_test_road', 'brake_test_rail', 'road_trial', 'rail_trial', 'emergency_stop',
];
const _buildLabels = <String, String>{
  'planned': 'Planned', 'in_progress': 'In Progress', 'on_hold': 'On Hold', 'completed': 'Completed', 'handed_over': 'Handed Over', 'cancelled': 'Cancelled',
};
const _buildHex = <String, Color>{
  'planned': cGrey, 'in_progress': cBlue, 'on_hold': cAmber, 'completed': cPurple, 'handed_over': cGreen, 'cancelled': cGrey,
};
const _stageLabels = <String, String>{'not_started': 'Not Started', 'in_progress': 'In Progress', 'completed': 'Completed', 'not_applicable': 'N/A'};
const _stageHex = <String, Color>{'not_started': cGrey, 'in_progress': cBlue, 'completed': cGreen, 'not_applicable': Color(0xFFA8A29E)};
const _reworkLabels = <String, String>{
  'open': 'Open', 'in_progress': 'In Progress', 'done': 'Awaiting Verification', 'verified': 'Verified', 'cancelled': 'Cancelled',
};
const _reworkHex = <String, Color>{'open': cRed, 'in_progress': cAmber, 'done': cPurple, 'verified': cGreen, 'cancelled': Color(0xFFA8A29E)};
const _resultHex = <String, Color>{'pass': cGreen, 'fail': cRed, 'pending': cGrey};
const _phaseLabels = <String, String>{'plan': 'Plan', 'build': 'Build', 'verify': 'Verify', 'close': 'Close'};
const _eventLabels = <String, String>{
  'created': 'created the build', 'updated': 'updated the build', 'on_hold': 'put the build on hold', 'resumed': 'resumed the build',
  'cancelled': 'cancelled the build', 'stage_started': 'started', 'stage_completed': 'completed', 'signoff_requested': 'sent for sign-off',
  'stage_not_applicable': 'marked N/A', 'stage_reopened': 'reopened', 'work_order_linked': 'linked work order',
  'work_order_unlinked': 'unlinked work order', 'final_inspection_requested': 'requested final inspection', 'test_recorded': 'recorded test',
  'test_deleted': 'deleted test', 'rework_raised': 'raised rework', 'rework_started': 'started rework', 'rework_done': 'finished rework',
  'rework_verified': 'verified rework', 'rework_rejected': 'sent rework back', 'rework_cancelled': 'cancelled rework',
  'completed': 'completed the RRV', 'handed_over': 'handed the RRV over',
};

Widget _buildPill(Object? s) => Pill(_buildLabels['$s'] ?? humanize(s), _buildHex['$s'] ?? cGrey);
Widget _reworkPill(Object? s) => Pill(_reworkLabels['$s'] ?? humanize(s), _reworkHex['$s'] ?? cGrey);

const _rrvTabs = <(String, String)>[
  ('planned,in_progress,on_hold,completed', 'Open'),
  ('in_progress', 'In Progress'),
  ('on_hold', 'On Hold'),
  ('completed', 'Ready for Handover'),
  ('handed_over', 'Handed Over'),
  ('cancelled', 'Cancelled'),
  ('', 'All'),
];

class RrvBuildsTab extends StatefulWidget {
  const RrvBuildsTab({super.key});

  @override
  State<RrvBuildsTab> createState() => _RrvBuildsTabState();
}

class _RrvBuildsTabState extends State<RrvBuildsTab> {
  final _list = GlobalKey<ApiListViewState>();
  String _status = _rrvTabs.first.$1;
  bool _overdue = false;

  void _reload() => _list.currentState?.reload();

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: Colors.transparent,
      floatingActionButton: ProdPerm.can('rrv_builds', 'create')
          ? CreateFab(
              label: 'New RRV Build',
              onPressed: () async {
                final id = await showNewRrvBuild(context);
                if (id != null) {
                  _reload();
                  if (context.mounted) openScreen(context, RrvBuildDetail(id: id));
                }
              })
          : null,
      body: ApiListView(
        key: _list,
        searchHint: 'Search build no., model, customer, serial, chassis or PO…',
        emptyText: 'No RRV builds here. Start one with “+ New RRV Build”.',
        load: (p, s) => Api.list('/production/rrv-builds', query: {'status': _status, 'search': s, if (_overdue) 'overdue': true}),
        header: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
          const Padding(
            padding: EdgeInsets.fromLTRB(16, 0, 16, 4),
            child: Hint('One record per Rail-cum-Road Vehicle — from planning through assembly, testing and rework to customer handover.'),
          ),
          ChipRow([
            for (final (k, l) in _rrvTabs)
              CountChip(l, null, selected: _status == k, onTap: () {
                setState(() => _status = k);
                _reload();
              }),
          ]),
          ChipRow([
            CountChip('Past target handover only', null, selected: _overdue, color: cRed, onTap: () {
              setState(() => _overdue = !_overdue);
              _reload();
            }),
            CountChip('Rework Orders →', null, onTap: () => openScreen(context, const ReworkOrdersScreen())),
          ]),
          const SizedBox(height: 6),
        ]),
        itemBuilder: (ctx, b, reload) {
          final total = n(b['stages_total']);
          final pct = total > 0 ? (n(b['stages_done']) / total * 100).round() : 0;
          return RecordCard(
            code: '${b['build_number']}${normPriority(b['priority']) == 'urgent' ? ' · URGENT' : ''}',
            title: txt(b['rrv_model']),
            subtitle: '${txt(b['customer_name'])}${b['customer_po_number'] != null ? ' · PO ${b['customer_po_number']}' : ''}',
            trailing: _buildPill(b['status']),
            meta: [
              ('Serial · Chassis', '${b['vehicle_serial_number'] ?? b['machine_label'] ?? '—'} · ${b['chassis_number'] ?? 'no chassis no. yet'}'),
              ('Progress', '${fq(b['stages_done'])} / ${fq(total)} stages ($pct%)'),
              ('Current Stage', b['status'] == 'handed_over' ? '—' : txt(b['current_stage_label'])),
              ('Rework', n(b['open_rework_count']) > 0 ? '${fq(b['open_rework_count'])} open' : '—'),
              ('Target Handover', '${fmtDate(b['target_handover_date'])}${b['is_overdue'] == true ? ' · overdue' : ''}'),
            ],
            onTap: () async {
              await Navigator.of(ctx).push(MaterialPageRoute(builder: (_) => RrvBuildDetail(id: idOf(b['id'])!)));
              reload();
            },
          );
        },
      ),
    );
  }
}

/// New RRV Build (portal rrv-builds/new). Returns the new build id.
Future<int?> showNewRrvBuild(BuildContext context) async {
  final model = TextEditingController();
  final customer = TextEditingController();
  final po = TextEditingController();
  DateTime? poDate;
  final orderRef = TextEditingController();
  final machine = Pick();
  final serial = TextEditingController();
  final chassis = TextEditingController();
  final engine = TextEditingController();
  final year = TextEditingController();
  final me = Perm.userId;
  final manager = Pick(me, me == null ? null : (Perm.user['name']?.toString()));
  final branch = Pick();
  var priority = 'standard';
  DateTime? start;
  DateTime? targetCompletion;
  DateTime? targetHandover;
  final warranty = TextEditingController(text: '12');
  final remarks = TextEditingController();
  final tests = <String>{...rrvDefaultTests};
  final machines = LookupCache('/production/lookups/projects');
  final users = LookupCache('/production/lookups/users');
  final branches = LookupCache('/production/lookups/branches');
  assigneeFilter('production:rrv_builds.build_manager').then((f) => users.filter = f);
  int? id;
  final saved = await showFormSheet(
    context,
    title: 'New RRV Build',
    saveLabel: 'Create RRV Build',
    builder: (ctx, setS) => [
      const Hint('Creates the build with its 12-stage checklist. Work orders, tests and handover are added from the build page.'),
      const Caps('Vehicle & Order'),
      AppTextField(label: 'RRV model', required: true, controller: model, hint: 'e.g. PR-RRV 4x4 Tower Wagon'),
      AppTextField(label: 'Customer', controller: customer, hint: 'e.g. Northern Railway'),
      AppTextField(label: 'Customer PO no.', controller: po),
      DateField(label: 'PO date', value: poDate, onChanged: (d) => setS(() => poDate = d)),
      AppTextField(label: 'Order / tender ref.', controller: orderRef, hint: 'LOI / tender / inquiry no.'),
      const Caps('Vehicle Identity'),
      lookupSelect('Existing machine in ERP (optional)', machines, machine, setS),
      AppTextField(
          label: 'Vehicle serial no.',
          controller: serial,
          enabled: machine.id == null,
          hint: machine.id != null ? 'from machine' : 'e.g. PR-RRV-2026-014'),
      AppTextField(label: 'Chassis no.', controller: chassis),
      AppTextField(label: 'Engine no.', controller: engine),
      AppTextField(label: 'Year', controller: year, hint: '${DateTime.now().year}'),
      const Hint(
          'If no machine is picked, the vehicle is registered in the ERP machine registry automatically at RRV Completion, using the serial and chassis numbers — so Service can raise warranty tickets against it after handover.'),
      const Caps('Plan'),
      lookupSelect('Build manager', users, manager, setS),
      lookupSelect('Plant', branches, branch, setS),
      AppSelect<String>(
        label: 'Priority',
        value: priority,
        clearable: false,
        options: [for (final e in priorityLabels.entries) Option(e.key, e.value)],
        onChanged: (o) => setS(() => priority = o?.value ?? priority),
      ),
      DateField(label: 'Planned start', value: start, onChanged: (d) => setS(() => start = d)),
      DateField(label: 'Target completion', value: targetCompletion, onChanged: (d) => setS(() => targetCompletion = d)),
      DateField(label: 'Target handover', value: targetHandover, onChanged: (d) => setS(() => targetHandover = d)),
      const Caps('Required Vehicle Tests'),
      for (final e in rrvTestTypes.entries)
        CheckField(label: e.value, value: tests.contains(e.key), onChanged: (v) => setS(() => v ? tests.add(e.key) : tests.remove(e.key))),
      const Hint(
          'The Vehicle Testing stage can only be completed once the latest record of each ticked test is a pass. This can be changed later on the build.'),
      AppTextField(label: 'Warranty (months)', controller: warranty, keyboardType: TextInputType.number),
      AppTextField(label: 'Remarks', controller: remarks, maxLines: 3, hint: 'Special customer requirements, variant, deviations…'),
    ],
    onSave: () async {
      if (model.text.trim().length < 2) throw 'Enter the RRV model (e.g. PR-RRV 4x4 Tower Wagon).';
      if (tests.isEmpty) throw 'Pick at least one vehicle test the RRV must pass before handover.';
      final months = int.tryParse(warranty.text.trim());
      if (months == null || months < 0 || months > 120) throw 'Warranty must be a whole number of months between 0 and 120.';
      String? b(TextEditingController c) => c.text.trim().isEmpty ? null : c.text.trim();
      String? d(DateTime? x) => x == null ? null : apiDate(x);
      final r = mapOf(await Api.post('/production/rrv-builds', data: {
        'rrv_model': model.text.trim(),
        'customer_name': b(customer),
        'customer_po_number': b(po),
        'customer_po_date': d(poDate),
        'order_reference': b(orderRef),
        'erp_project_id': machine.id,
        'vehicle_serial_number': b(serial),
        'chassis_number': b(chassis),
        'engine_number': b(engine),
        'year_of_manufacture': b(year),
        'branch_id': branch.id,
        'build_manager_id': manager.id,
        'priority': priority,
        'planned_start_date': d(start),
        'target_completion_date': d(targetCompletion),
        'target_handover_date': d(targetHandover),
        'warranty_months': months,
        'required_tests': [for (final k in rrvTestTypes.keys) if (tests.contains(k)) k],
        'remarks': b(remarks),
      }));
      id = idOf(r['id']);
    },
  );
  return saved ? id : null;
}

const _reworkTabs = <(String, String)>[
  ('open,in_progress,done', 'Open'),
  ('done', 'Awaiting Verification'),
  ('verified', 'Verified'),
  ('cancelled', 'Cancelled'),
  ('', 'All'),
];

/// Every rework order across all vehicles (portal rrv-builds/rework).
class ReworkOrdersScreen extends StatefulWidget {
  const ReworkOrdersScreen({super.key});

  @override
  State<ReworkOrdersScreen> createState() => _ReworkOrdersScreenState();
}

class _ReworkOrdersScreenState extends State<ReworkOrdersScreen> {
  final _list = GlobalKey<ApiListViewState>();
  String _status = _reworkTabs.first.$1;
  bool _mine = false;

  @override
  Widget build(BuildContext context) {
    return SubPage(
      title: 'Rework Orders',
      body: ApiListView(
        key: _list,
        emptyText:
            '${_mine ? 'No rework assigned to you in this view.' : 'No rework orders in this view.'} Rework is raised from a build’s Tests or Rework tab, or automatically when a test or inspection fails.',
        load: (p, s) => Api.list('/production/rrv-builds/rework', query: {'status': _status, if (_mine) 'mine': true}),
        header: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
          const Padding(
            padding: EdgeInsets.fromLTRB(16, 12, 16, 4),
            child: Hint('Every rework across all vehicles — raised from failed tests, failed inspections, or manually.'),
          ),
          ChipRow([
            for (final (k, l) in _reworkTabs)
              CountChip(l, null, selected: _status == k, onTap: () {
                setState(() => _status = k);
                _list.currentState?.reload();
              }),
            CountChip('Assigned to me', null, selected: _mine, onTap: () {
              setState(() => _mine = !_mine);
              _list.currentState?.reload();
            }),
          ]),
          const SizedBox(height: 6),
        ]),
        itemBuilder: (ctx, r, reload) => RecordCard(
          code: txt(r['rework_number']),
          title: txt(r['title']),
          subtitle: '${txt(r['build_number'])} · ${txt(r['rrv_model'])}',
          trailing: _reworkPill(r['status']),
          meta: [
            ('Source', '${txt(r['source_label'])}${r['inspection_number'] != null ? ' · ${r['inspection_number']}' : ''}'),
            ('Assigned to', txt(r['assigned_to_name'])),
            ('Due', '${fmtDate(r['due_date'])}${r['is_overdue'] == true ? ' · overdue' : ''}'),
          ],
          onTap: () async {
            await Navigator.of(ctx).push(MaterialPageRoute(builder: (_) => RrvBuildDetail(id: idOf(r['build_id'])!, initialTab: 'rework')));
            reload();
          },
        ),
      ),
    );
  }
}

// ── Detail ───────────────────────────────────────────────────────────────────

class RrvBuildDetail extends StatefulWidget {
  const RrvBuildDetail({super.key, required this.id, this.initialTab = 'stages'});
  final int id;
  final String initialTab;

  @override
  State<RrvBuildDetail> createState() => _RrvBuildDetailState();
}

class _RrvBuildDetailState extends State<RrvBuildDetail> {
  Json? _b;
  bool _loading = true;
  bool _busy = false;
  Object? _error;
  late String _tab = widget.initialTab;
  Json? _consumption;
  Object? _consumptionError;
  List<Json> _linkable = [];
  final _users = LookupCache('/production/lookups/users');
  final _reworkUsers = LookupCache('/production/lookups/users');
  bool Function(int) _allowStage = (_) => true;

  bool _rf(String f, String a) => ProdPerm.feat('rrv_builds', f, a);
  bool get _seeCosts => _rf('costs', 'view');
  bool _can(String a) => (_b?['allowed_actions'] is List) && (_b!['allowed_actions'] as List).contains(a);

  @override
  void initState() {
    super.initState();
    assigneeFilter('production:rrv_builds.stages').then((f) => _allowStage = f);
    assigneeFilter('production:rrv_builds.rework').then((f) => _reworkUsers.filter = f);
    _load();
  }

  Future<void> _load() async {
    try {
      final d = mapOf(await Api.get('/production/rrv-builds/${widget.id}'));
      if (mounted) {
        setState(() {
          _b = d;
          _loading = false;
          _error = null;
        });
      }
      if (_tab == 'work_orders') _loadWoTab();
    } catch (e) {
      if (mounted) {
        setState(() {
          _error = e;
          _loading = false;
        });
      }
    }
  }

  Future<void> _loadWoTab() async {
    final b = _b;
    if (b == null || !_rf('work_orders', 'view')) return;
    try {
      final c = mapOf(await Api.get('/production/rrv-builds/${b['id']}/material-consumption'));
      if (mounted) {
        setState(() {
        _consumption = c;
        _consumptionError = null;
        });
      }
    } catch (e) {
      if (mounted) {
        setState(() {
        _consumption = null;
        _consumptionError = e;
        });
      }
    }
    try {
      final rows = rowsOf(await Api.get('/production/work-orders', query: {'status': 'draft,released,in_progress,completed'}));
      final pid = b['erp_project_id'];
      if (mounted) {
        setState(() => _linkable =
            rows.where((w) => w['rrv_build_id'] == null && (pid == null || w['erp_project_id'] == null || w['erp_project_id'] == pid)).toList());
      }
    } catch (_) {
      if (mounted) setState(() => _linkable = []);
    }
  }

  /// Runs an action that returns the build; snack with the result.
  Future<bool> _act(Future<dynamic> Function() fn, String done) async {
    setState(() => _busy = true);
    try {
      final r = await fn();
      if (r is Map && r['id'] != null && mounted) setState(() => _b = mapOf(r));
      if (mounted) showSnack(context, done);
      if (_tab == 'work_orders') _loadWoTab();
      return true;
    } catch (e) {
      if (mounted) showSnack(context, ApiClient.describe(e), error: true);
      return false;
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  /// Portal ReasonSheet; `need` = required (min 3 chars) message.
  Future<String?> _ask(String title, String message, String field, String confirm, {String? need}) async {
    final v = await promptDialog(context, title: title, message: message, label: field, required: need != null, confirmLabel: confirm);
    if (v == null) return null;
    if (need != null && v.length < 3) {
      if (mounted) showSnack(context, need, error: true);
      return null;
    }
    return v;
  }

  List<BarAction> _actions(Json b) => [
        if (_can('resume')) BarAction('Resume', primary: true, () => _act(() => Api.post('/production/rrv-builds/${b['id']}/resume'), '${b['build_number']} resumed.')),
        if (_can('certificate'))
          BarAction('Handover Certificate (PDF)', primary: !_can('resume'), () {
            runAction(context, () => Files.downloadAndOpen('/production/rrv-builds/${b['id']}/handover-certificate', 'RRV-Handover-${b['build_number']}.pdf'));
          }),
        if (_can('edit') && b['status'] != 'completed') BarAction('Edit Details', () => _editDetails(b)),
        if (_can('hold'))
          BarAction('Put on Hold', () async {
            final v = await _ask('Put Build on Hold', 'Stage work stops until it is resumed.', 'Reason', 'Put on Hold',
                need: 'Give a reason for putting the build on hold.');
            if (v != null) await _act(() => Api.post('/production/rrv-builds/${b['id']}/hold', data: {'reason': v}), '${b['build_number']} is on hold.');
          }),
        if (_can('cancel'))
          BarAction('Cancel Build', danger: true, () async {
            final v = await _ask('Cancel this Build',
                'The build is kept on record as cancelled. Running work orders must be completed or cancelled first.', 'Reason', 'Cancel Build',
                need: 'Give a reason for cancelling the build.');
            if (v != null) await _act(() => Api.post('/production/rrv-builds/${b['id']}/cancel', data: {'reason': v}), '${b['build_number']} cancelled.');
          }),
        if (_can('delete'))
          BarAction('Delete', danger: true, () async {
            final ok = await confirmDialog(context,
                title: 'Delete this build?',
                message: '${b['build_number']} hasn\'t started and has no work orders or tests, so it will be deleted.',
                confirmLabel: 'Delete',
                danger: true);
            if (!ok || !mounted) return;
            final done = await runAction(context, () => Api.delete('/production/rrv-builds/${b['id']}'));
            if (done && mounted) Navigator.of(context).pop();
          }),
      ];

  Future<void> _editDetails(Json b) async {
    final model = TextEditingController(text: b['rrv_model']?.toString() ?? '');
    final machine = Pick(idOf(b['erp_project_id']), b['machine_label']?.toString());
    final serial = TextEditingController(text: b['vehicle_serial_number']?.toString() ?? '');
    final chassis = TextEditingController(text: b['chassis_number']?.toString() ?? '');
    final engine = TextEditingController(text: b['engine_number']?.toString() ?? '');
    final year = TextEditingController(text: b['year_of_manufacture']?.toString() ?? '');
    final customer = TextEditingController(text: b['customer_name']?.toString() ?? '');
    final po = TextEditingController(text: b['customer_po_number']?.toString() ?? '');
    DateTime? poDate = parseDate(b['customer_po_date']);
    final orderRef = TextEditingController(text: b['order_reference']?.toString() ?? '');
    final manager = Pick(idOf(b['build_manager_id']), b['build_manager_name']?.toString());
    var priority = normPriority(b['priority']);
    DateTime? start = parseDate(b['planned_start_date']);
    DateTime? tc = parseDate(b['target_completion_date']);
    DateTime? th = parseDate(b['target_handover_date']);
    final remarks = TextEditingController(text: b['remarks']?.toString() ?? '');
    final machines = LookupCache('/production/lookups/projects');
    final managers = LookupCache('/production/lookups/users');
    assigneeFilter('production:rrv_builds.build_manager').then((f) => managers.filter = (id) => f(id) || id == idOf(b['build_manager_id']));
    final saved = await showFormSheet(
      context,
      title: 'Edit Build Details',
      builder: (ctx, setS) => [
        Hint('${b['build_number']} — ${b['rrv_model']}'),
        const Caps('Vehicle'),
        AppTextField(label: 'RRV model', required: true, controller: model),
        lookupSelect('Machine in ERP', machines, machine, setS),
        AppTextField(label: 'Vehicle serial no.', controller: serial, enabled: machine.id == null),
        if (machine.id != null) const Hint('The serial number comes from the linked ERP machine.'),
        AppTextField(label: 'Chassis no.', controller: chassis),
        AppTextField(label: 'Engine no.', controller: engine),
        AppTextField(label: 'Year', controller: year),
        const Caps('Customer & Order'),
        AppTextField(label: 'Customer', controller: customer),
        AppTextField(label: 'Customer PO no.', controller: po),
        DateField(label: 'PO date', value: poDate, onChanged: (d) => setS(() => poDate = d)),
        AppTextField(label: 'Order / tender ref.', controller: orderRef),
        const Caps('Planning'),
        lookupSelect('Build manager', managers, manager, setS),
        AppSelect<String>(
          label: 'Priority',
          value: priority,
          clearable: false,
          options: [for (final e in priorityLabels.entries) Option(e.key, e.value)],
          onChanged: (o) => setS(() => priority = o?.value ?? priority),
        ),
        DateField(label: 'Planned start', value: start, onChanged: (d) => setS(() => start = d)),
        DateField(label: 'Target completion', value: tc, onChanged: (d) => setS(() => tc = d)),
        DateField(label: 'Target handover', value: th, onChanged: (d) => setS(() => th = d)),
        AppTextField(label: 'Remarks', controller: remarks, maxLines: 3),
      ],
      onSave: () async {
        if (model.text.trim().isEmpty) throw 'RRV model is required - fill it in and save again.';
        String? t(TextEditingController c) => c.text.trim().isEmpty ? null : c.text.trim();
        String? d(DateTime? x) => x == null ? null : apiDate(x);
        final r = await Api.patch('/production/rrv-builds/${b['id']}', data: {
          'rrv_model': model.text.trim(),
          'customer_name': t(customer),
          'customer_po_number': t(po),
          'customer_po_date': d(poDate),
          'order_reference': t(orderRef),
          'erp_project_id': machine.id,
          'vehicle_serial_number': t(serial),
          'chassis_number': t(chassis),
          'engine_number': t(engine),
          'year_of_manufacture': t(year),
          'build_manager_id': manager.id,
          'priority': priority,
          'planned_start_date': d(start),
          'target_completion_date': d(tc),
          'target_handover_date': d(th),
          'remarks': t(remarks),
        });
        if (mounted) setState(() => _b = mapOf(r));
      },
    );
    if (saved && mounted) showSnack(context, 'Build details saved.');
  }

  @override
  Widget build(BuildContext context) {
    final b = _b;
    final actions = b == null ? const <BarAction>[] : _actions(b);
    return SubPage(
      title: b == null ? 'RRV Build' : '${b['build_number']} — ${b['rrv_model']}',
      bottom: actions.isEmpty ? null : BottomActions(actions, busy: _busy),
      body: DetailBody(loading: _loading, error: _error, onRefresh: _load, children: b == null ? const [] : _body(b)),
    );
  }

  List<Widget> _body(Json b) {
    final total = n(b['stages_total']);
    final pct = total > 0 ? (n(b['stages_done']) / total * 100).round() : 0;
    final tabs = <(String, String)>[
      ('stages', 'Stages'),
      if (_rf('work_orders', 'view')) ('work_orders', 'Work Orders & Material (${rowsOf(b['work_orders']).length})'),
      if (_rf('tests', 'view')) ('tests', 'Tests (${rowsOf(b['tests']).length})'),
      if (_rf('rework', 'view')) ('rework', 'Rework (${fq(b['open_rework_count'])} open)'),
      if (_rf('handover', 'view')) ('handover', 'Handover'),
      if (_rf('timeline', 'view')) ('timeline', 'Timeline'),
    ];
    final shown = tabs.any((t) => t.$1 == _tab) ? _tab : 'stages';
    return [
      if (b['status'] == 'on_hold') Notice(Text('On hold: ${txt(b['hold_reason'])}', style: const TextStyle(color: Color(0xFF92400E)))),
      if (b['status'] == 'cancelled') Notice(color: cRed, Text('Cancelled: ${txt(b['cancel_reason'])}', style: const TextStyle(color: Color(0xFFB91C1C)))),
      DetailSection(txt(b['rrv_model']), children: [
        Text(
            'Build of one ${b['rrv_model']}${b['customer_name'] != null ? ' for ${b['customer_name']}' : ''} — from the first work order through tests to handover.',
            style: const TextStyle(fontSize: 13.5)),
        const SizedBox(height: 8),
        Wrap(spacing: 6, runSpacing: 6, children: [
          _buildPill(b['status']),
          if (b['is_overdue'] == true) const Pill('Overdue', cRed),
          Pill('${priorityLabel(b['priority'])} priority', priorityHex[normPriority(b['priority'])]!),
        ]),
        const SizedBox(height: 6),
        KV('Handover due', fmtDate(b['target_handover_date'])),
        KV('Build manager', txt(b['build_manager_name']), bold: true),
      ]),
      DetailSection('Progress', children: [
        Row(children: [Expanded(child: Bar(pct, height: 7)), const SizedBox(width: 10), Text('${fq(b['stages_done'])} of ${fq(total)}')]),
        if (b['current_stage_label'] != null && b['status'] != 'handed_over') FieldRow('Current stage', b['current_stage_label']),
      ]),
      DetailSection('Customer & order', children: [
        FieldRow('Customer', b['customer_name']),
        FieldRow('Customer PO',
            b['customer_po_number'] != null ? '${b['customer_po_number']}${b['customer_po_date'] != null ? ' · ${fmtDate(b['customer_po_date'])}' : ''}' : null),
        if (b['order_reference'] != null) FieldRow('Order reference', b['order_reference']),
        if (b['order_project_number'] != null) FieldRow('Project', projectUnitText(b)),
      ]),
      DetailSection('Vehicle', children: [
        FieldRow('Machine / serial', b['machine_label'] ?? b['vehicle_serial_number'] ?? 'Registered when the build is completed'),
        FieldRow('Chassis number', b['chassis_number']),
        FieldRow('Engine number', b['engine_number']),
        if (b['year_of_manufacture'] != null) FieldRow('Year of manufacture', b['year_of_manufacture']),
      ]),
      DetailSection('Schedule', children: [
        FieldRow('Planned start', b['planned_start_date'] != null ? fmtDate(b['planned_start_date']) : null),
        FieldRow('Target completion', b['target_completion_date'] != null ? fmtDate(b['target_completion_date']) : null),
        if (b['remarks'] != null) FieldRow('Remarks', b['remarks']),
      ]),
      SubTabs(
          tabs: tabs,
          selected: shown,
          onSelect: (k) {
            setState(() => _tab = k);
            if (k == 'work_orders') _loadWoTab();
          }),
      if (shown == 'stages') ...[
        ApprovalSection(entityType: 'production_rrv_build', entityId: widget.id, title: 'Sign-off approval', onChanged: _load),
        DetailSection('Build stages', children: [for (final s in rowsOf(b['stages'])) _stageRow(b, s)]),
      ],
      if (shown == 'work_orders') ..._woTab(b),
      if (shown == 'tests') ..._testsTab(b),
      if (shown == 'rework') _reworkTab(b),
      if (shown == 'handover') _handoverTab(b),
      if (shown == 'timeline')
        DetailSection('Timeline', children: [
          for (final e in rowsOf(b['events']))
            LineCard(
              title: '${e['actor_name'] ?? 'System'} ${_eventLabels['${e['action']}'] ?? humanize(e['action']).toLowerCase()}',
              subtitle: '${e['comment'] != null ? '${e['comment']} · ' : ''}${fmtDateTime(e['created_at'])}',
            ),
        ]),
    ];
  }

  Widget _stageRow(Json b, Json s) {
    final done = s['status'] == 'completed' || s['status'] == 'not_applicable';
    final key = '${s['stage_key']}';
    final signOff = key == 'rrv_completion' || key == 'handover';
    final canWork = _can('stages');
    final problems = (s['gate_problems'] is List) ? (s['gate_problems'] as List).map((e) => '$e').toList() : <String>[];
    final current = idOf(s['assignee_id']);
    final label = txt(s['label']);
    return LineCard(
      title: '${done ? '✓' : s['sequence']}  $label',
      subtitle: [
        s['assignee_name'] != null ? 'Assigned to ${s['assignee_name']}' : 'Unassigned',
        if (s['planned_end_date'] != null) 'due ${fmtDate(s['planned_end_date'])}',
        if (s['completed_at'] != null)
          '${s['status'] == 'not_applicable' ? 'marked N/A' : 'done'} by ${txt(s['completed_by_name'])} on ${fmtDate(s['completed_at'])}',
      ].join(' · '),
      trailing: Pill(_stageLabels['${s['status']}'] ?? humanize(s['status']), _stageHex['${s['status']}'] ?? cGrey),
      lines: [
        Wrap(spacing: 8, runSpacing: 2, children: [
          Text((_phaseLabels['${s['phase']}'] ?? '').toUpperCase(), style: const TextStyle(fontSize: 11, color: Brand.muted, letterSpacing: .4)),
          if (signOff) const Text('manager sign-off', style: TextStyle(fontSize: 11, color: cPurple, fontWeight: FontWeight.w600)),
          if (s['is_overdue'] == true) const Text('overdue', style: TextStyle(fontSize: 11, color: cRed, fontWeight: FontWeight.w700)),
        ]),
        if (s['remarks'] != null) Hint(txt(s['remarks'])),
        if (!done && problems.isNotEmpty)
          for (final p in problems) Hint('• $p', color: const Color(0xFF92400E)),
        if (!done && problems.isEmpty && b['status'] != 'cancelled') const Hint('Ready to complete.', color: Color(0xFF15803D)),
        if (key == 'final_inspection')
          Hint(
              'Quality: ${b['final_inspection_number'] != null ? '${b['final_inspection_number']} — ${humanize(b['final_inspection_status']).toLowerCase()}' : 'not requested yet'}'),
        if (canWork && !done) ...[
          const SizedBox(height: 6),
          AppSelect<int>(
            label: 'Assign…',
            value: current,
            valueLabel: s['assignee_name']?.toString(),
            loadOptions: (q) async => (await _users.search(q)).where((o) => _allowStage(o.value) || o.value == current).toList(),
            onChanged: (o) => _act(() => Api.patch('/production/rrv-builds/${b['id']}/stages/$key', data: {'assignee_id': o?.value}), '$label assigned.'),
          ),
        ],
      ],
      actions: [
        if (canWork && key == 'final_inspection' && !done && (b['final_inspection_number'] == null || b['final_inspection_status'] == 'failed'))
          miniBtn(b['final_inspection_status'] == 'failed' ? 'Request re-inspection' : 'Request final inspection', _busy
              ? null
              : () => _act(() => Api.post('/production/rrv-builds/${b['id']}/request-final-inspection'),
                  'Final inspection requested — Quality has been notified.')),
        if (canWork && s['status'] == 'not_started')
          miniBtn('Start', _busy ? null : () => _act(() => Api.post('/production/rrv-builds/${b['id']}/stages/$key/start'), '$label started.')),
        if (canWork && !done && (!signOff || _can('sign_off') || _can('request_sign_off')))
          miniBtn(signOff && !_can('sign_off') ? 'Request Sign-off' : 'Complete', _busy || problems.isNotEmpty
              ? null
              : () async {
                  final msg = key == 'rrv_completion'
                      ? 'The vehicle is registered (or updated) in the ERP machine registry with its serial and chassis numbers.'
                      : key == 'handover'
                          ? 'The machine goes live in the registry with delivery, handover and warranty dates, and Service is notified.'
                          : 'Add any remarks for the record.';
                  final v = await _ask('Complete $label', msg, 'Remarks (optional)', 'Complete');
                  if (v == null) return;
                  final requesting = signOff && !_can('sign_off');
                  await _act(() => Api.post('/production/rrv-builds/${b['id']}/stages/$key/complete', data: {'remarks': v.isEmpty ? null : v}),
                      requesting ? '$label sent for sign-off to the build manager / production managers.' : '$label completed.');
                }, primary: true),
        if (canWork && !done && s['na_allowed'] == true)
          miniBtn('N/A', _busy
              ? null
              : () async {
                  final v = await _ask('Mark $label N/A', 'Only for vehicles where this stage genuinely doesn’t apply.', 'Reason', 'Mark N/A',
                      need: 'Say why this stage doesn’t apply to this vehicle.');
                  if (v != null) await _act(() => Api.post('/production/rrv-builds/${b['id']}/stages/$key/not-applicable', data: {'reason': v}), '$label marked N/A.');
                }),
        if (done && _can('sign_off') && b['status'] != 'handed_over')
          miniBtn('Reopen', _busy
              ? null
              : () async {
                  final v = await _ask('Reopen $label', 'Later stages must not be done. Reopening RRV Completion moves the build back to in progress.',
                      'Reason', 'Reopen',
                      need: 'Say why the stage is being reopened.');
                  if (v != null) await _act(() => Api.post('/production/rrv-builds/${b['id']}/stages/$key/reopen', data: {'reason': v}), '$label reopened.');
                }, danger: true),
      ],
    );
  }

  List<Widget> _woTab(Json b) {
    final wos = rowsOf(b['work_orders']);
    final hasMain = wos.any((w) => w['build_role'] == 'main' && w['status'] != 'cancelled');
    final c = _consumption;
    final integ = mapOf(b['integration']);
    return [
      DetailSection('Linked work orders (${wos.length})', children: [
        if (_can('link_work_order'))
          btnWrap([
            if (!hasMain)
              miniBtn('+ Main Work Order', () async {
                await openNewWorkOrder(context, rrvBuildId: idOf(b['id']), buildRole: 'main');
                _load();
              }, primary: true),
            if (_linkable.isNotEmpty) miniBtn('Link Existing', _busy ? null : () => _linkExisting(b, hasMain)),
            miniBtn('+ Sub-Assembly Work Order', () async {
              await openNewWorkOrder(context, rrvBuildId: idOf(b['id']), buildRole: 'sub_assembly');
              _load();
            }),
          ]),
        if (wos.isEmpty) emptyLine('No work orders yet. Raise the main (final vehicle assembly) work order first, then one per sub-assembly.'),
        for (final w in wos)
          LineCard(
            title: txt(w['wo_number']),
            subtitle: '${w['build_role'] == 'main' ? 'Main assembly' : 'Sub-assembly'} · ${txt(w['product_code'])} — ${txt(w['product_name'])}',
            onTap: () => openScreen(context, WorkOrderDetail(id: idOf(w['id'])!)),
            trailing: woStatusPill(w['status']),
            lines: [
              KV('Operations', '${fq(w['operations_done'])} / ${fq(w['operations_total'])}'),
              KV('Material', n(w['outstanding_lines']) > 0 ? '${fq(w['outstanding_lines'])} line(s) to issue' : 'all issued',
                  color: n(w['outstanding_lines']) > 0 ? cBrown : const Color(0xFF15803D)),
              KV('Due', fmtDate(w['planned_end_date'])),
            ],
            actions: [
              if (_can('link_work_order'))
                miniBtn('Unlink', _busy
                    ? null
                    : () => _act(() => Api.delete('/production/rrv-builds/${b['id']}/work-orders/${w['id']}'), '${w['wo_number']} unlinked.')),
            ],
          ),
      ]),
      DetailSection('Material consumption (all linked work orders)', children: [
        if (c == null) _consumptionError != null ? errorLine(_consumptionError!) : const Hint('Loading…'),
        if (c != null && rowsOf(c['rows']).isEmpty) emptyLine('No material lines yet — they come from the linked work orders\' BOMs.'),
        if (c != null && rowsOf(c['rows']).isNotEmpty) ...[
          Hint(
              '${fq(c['lines_fully_issued'])} of ${fq(c['total_required_lines'])} items fully issued${_seeCosts && c['total_consumed_value'] != null ? ' · consumed value ${inr(c['total_consumed_value'])}' : ''}'),
          for (final r in rowsOf(c['rows']))
            LineCard(
              title: '${txt(r['item_code'])} ${txt(r['item_name'])}',
              subtitle: (r['work_orders'] is List) ? (r['work_orders'] as List).join(', ') : null,
              trailing: Text(fq(r['consumed_qty']), style: const TextStyle(fontWeight: FontWeight.w700)),
              lines: [
                KV('Required', '${fq(r['required_qty'])} ${r['uom'] ?? ''}'.trim()),
                KV('Issued', fq(r['issued_qty'])),
                KV('Returned', fq(r['returned_qty'])),
                KV('Consumed', fq(r['consumed_qty']), bold: true),
                KV('Still to issue', fq(r['outstanding_qty']), color: n(r['outstanding_qty']) > 0 ? cBrown : null),
                if (_seeCosts) KV('Value (₹)', inr(r['consumed_value'] ?? 0)),
              ],
            ),
        ],
      ]),
      if (rowsOf(integ['electrical_jobs']).isNotEmpty || rowsOf(integ['hydraulic_systems']).isNotEmpty)
        DetailSection('Electrical & hydraulic (from their modules)', children: [
          for (final j in rowsOf(integ['electrical_jobs'])) KV('Electrical ${j['job_number']} — ${txt(j['title'])}', humanize(j['status'])),
          for (final s in rowsOf(integ['hydraulic_systems'])) KV('Hydraulic ${s['system_number']} — ${txt(s['name'])}', humanize(s['status'])),
        ]),
    ];
  }

  Future<void> _linkExisting(Json b, bool hasMain) async {
    int? woId;
    String? woLabel;
    var role = 'sub_assembly';
    final saved = await showFormSheet(
      context,
      title: 'Link Existing Work Order',
      saveLabel: 'Link',
      builder: (ctx, setS) => [
        Hint('${b['build_number']} — ${b['rrv_model']}'),
        AppSelect<int>(
          label: 'Work order',
          required: true,
          value: woId,
          valueLabel: woLabel,
          options: [
            for (final w in _linkable)
              Option(idOf(w['id'])!,
                  '${w['wo_number']} — ${w['product_code'] ?? ''} ${w['product_name'] ?? ''} (${woStatusLabels['${w['status']}'] ?? w['status']})'),
          ],
          onChanged: (o) => setS(() {
            woId = o?.value;
            woLabel = o?.label;
          }),
        ),
        Hint('Open work orders not yet on a build${b['erp_project_id'] != null ? ', for the same machine (or none)' : ''}.'),
        AppSelect<String>(
          label: 'As',
          value: role,
          clearable: false,
          options: [const Option('sub_assembly', 'Sub-assembly'), if (!hasMain) const Option('main', 'Main assembly')],
          onChanged: (o) => setS(() => role = o?.value ?? role),
        ),
      ],
      onSave: () async {
        if (woId == null) throw 'Work order is required - pick one and save again.';
        final r = await Api.post('/production/rrv-builds/${b['id']}/work-orders/$woId', data: {'build_role': role});
        if (mounted) setState(() => _b = mapOf(r));
      },
    );
    if (saved && mounted) {
      showSnack(context, 'Work order linked.');
      _loadWoTab();
    }
  }

  List<Widget> _testsTab(Json b) {
    final status = mapOf(b['test_status']);
    final tests = rowsOf(b['tests']);
    return [
      DetailSection('Required tests', children: [
        btnWrap([
          if (_can('record_test')) miniBtn('+ Record Test', _busy ? null : () => _recordTest(b), primary: true),
          if (_can('edit') && b['status'] != 'completed') miniBtn('Change', _busy ? null : () => _changeRequired(b)),
        ]),
        const SizedBox(height: 8),
        Wrap(spacing: 6, runSpacing: 6, children: [
          for (final e in status.entries)
            Pill('${e.value == 'pass' ? '✓' : e.value == 'fail' ? '✗' : '○'} ${rrvTestTypes[e.key] ?? e.key}', _resultHex['${e.value}'] ?? cGrey),
        ]),
      ]),
      DetailSection('Test history (${tests.length})', children: [
        if (tests.isEmpty) emptyLine('No tests recorded yet.'),
        for (final t in tests)
          LineCard(
            title: '${txt(t['test_label'])}${t['retest_of_id'] != null ? ' · retest' : ''}',
            subtitle: '${fmtDate(t['test_date'])} · ${txt(t['tested_by_name'])}${t['witnessed_by'] != null ? ' · witnessed by ${t['witnessed_by']}' : ''}',
            trailing: Pill('${t['result']}'.toUpperCase(), _resultHex['${t['result']}'] ?? cGrey),
            lines: [
              if (t['rework_number'] != null) Hint('${t['rework_number']}', color: cRed),
              KV('Expected', txt(t['expected'])),
              KV('Observed', txt(t['observed'])),
              if (t['remarks'] != null) KV('Remarks', txt(t['remarks'])),
            ],
            actions: [
              if (_can('record_test') && _rf('tests', 'delete') && t['rework_number'] == null)
                miniBtn('Delete', _busy
                    ? null
                    : () async {
                        final ok = await confirmDialog(context, title: 'Delete this test record?', message: 'The test record is removed from the build.', confirmLabel: 'Delete', danger: true);
                        if (ok) await _act(() => Api.delete('/production/rrv-builds/${b['id']}/tests/${t['id']}'), 'Test record deleted.');
                      }, danger: true),
            ],
          ),
      ]),
    ];
  }

  Future<void> _recordTest(Json b) async {
    var type = 'road_trial';
    DateTime date = DateTime.now();
    var result = 'pass';
    final expected = TextEditingController();
    final observed = TextEditingController();
    final witness = TextEditingController();
    final remarks = TextEditingController();
    final assignee = Pick();
    var label = '';
    final saved = await showFormSheet(
      context,
      title: 'Record a Test',
      saveLabel: 'Record Test',
      builder: (ctx, setS) => [
        Hint('${b['build_number']} — ${b['rrv_model']}'),
        AppSelect<String>(
          label: 'Test',
          required: true,
          value: type,
          options: [for (final e in rrvTestTypes.entries) Option(e.key, e.value)],
          onChanged: (o) => setS(() => type = o?.value ?? type),
        ),
        DateField(label: 'Date', required: true, value: date, onChanged: (d) => setS(() => date = d ?? date)),
        AppSelect<String>(
          label: 'Result',
          required: true,
          value: result,
          options: const [Option('pass', 'Pass'), Option('fail', 'Fail')],
          onChanged: (o) => setS(() => result = o?.value ?? result),
        ),
        const Caps('Readings'),
        AppTextField(label: 'Expected / acceptance', controller: expected, hint: 'e.g. stop within 30 m at 25 km/h'),
        AppTextField(label: 'Observed', required: result == 'fail', controller: observed, hint: 'e.g. stopped in 27 m'),
        const Caps('Witness'),
        AppTextField(label: 'Witnessed by', controller: witness, hint: 'e.g. RDSO inspector, customer rep.'),
        if (result == 'fail') ...[
          const Caps('Rework', color: cRed),
          AppSelect<int>(
            label: 'Rework assigned to',
            value: assignee.id,
            valueLabel: assignee.label,
            loadOptions: _reworkUsers.search,
            onChanged: (o) => setS(() => assignee.set(o)),
          ),
          const Hint('A failed test raises a rework order automatically. It can only be verified after a passing retest.', color: Color(0xFF92400E)),
        ],
        AppTextField(label: 'Remarks', controller: remarks),
      ],
      onSave: () async {
        Json? prev;
        for (final t in rowsOf(b['tests'])) {
          if (t['test_type'] == type) {
            prev = t;
            break;
          }
        }
        String? t(TextEditingController c) => c.text.trim().isEmpty ? null : c.text.trim();
        final r = await Api.post('/production/rrv-builds/${b['id']}/tests', data: {
          'test_type': type,
          'test_date': apiDate(date),
          'result': result,
          'expected': t(expected),
          'observed': t(observed),
          'witnessed_by': t(witness),
          'remarks': t(remarks),
          'retest_of_id': prev != null && prev['result'] == 'fail' ? prev['id'] : null,
          'rework_assignee_id': result == 'fail' ? assignee.id : null,
        });
        label = rrvTestTypes[type] ?? type;
        if (mounted) setState(() => _b = mapOf(r));
      },
    );
    if (saved && mounted) {
      showSnack(context, result == 'fail' ? '$label failed — a rework order was raised automatically.' : '$label recorded as a pass.');
    }
  }

  Future<void> _changeRequired(Json b) async {
    final sel = <String>{...((b['required_tests'] is List) ? (b['required_tests'] as List).map((e) => '$e') : const <String>[])};
    final saved = await showFormSheet(
      context,
      title: 'Required Tests',
      builder: (ctx, setS) => [
        Hint('${b['build_number']} — ${b['rrv_model']}'),
        const Caps('Tests this vehicle must pass'),
        for (final e in rrvTestTypes.entries)
          CheckField(label: e.value, value: sel.contains(e.key), onChanged: (v) => setS(() => v ? sel.add(e.key) : sel.remove(e.key))),
        const Hint('Keep at least one required test.'),
      ],
      onSave: () async {
        if (sel.isEmpty) throw 'Keep at least one required test.';
        final r = await Api.patch('/production/rrv-builds/${b['id']}', data: {
          'required_tests': [for (final k in rrvTestTypes.keys) if (sel.contains(k)) k],
        });
        if (mounted) setState(() => _b = mapOf(r));
      },
    );
    if (saved && mounted) showSnack(context, 'Required tests updated.');
  }

  Widget _reworkTab(Json b) {
    final rows = rowsOf(b['rework_orders']);
    final canAct = _can('stages') || _can('record_test');
    return DetailSection('Rework orders (${rows.length})',
        action: _can('raise_rework') ? miniBtn('+ Raise Rework', _busy ? null : () => _raiseRework(b)) : null,
        children: [
          if (rows.isEmpty) emptyLine('No rework on this build. Failed tests and failed inspections raise rework here automatically.'),
          for (final rw in rows)
            LineCard(
              title: '${rw['rework_number']} · ${txt(rw['title'])}${rw['is_overdue'] == true ? ' · overdue' : ''}',
              subtitle:
                  '${txt(rw['source_label'])}${rw['inspection_number'] != null ? ' ${rw['inspection_number']}' : ''}${rw['wo_number'] != null ? ' · ${rw['wo_number']}' : ''} · ${rw['assigned_to_name'] != null ? 'assigned to ${rw['assigned_to_name']}' : 'unassigned'}${rw['due_date'] != null ? ' · due ${fmtDate(rw['due_date'])}' : ''}',
              trailing: _reworkPill(rw['status']),
              lines: [
                if (rw['defect_description'] != null) Hint('Defect: ${rw['defect_description']}'),
                if (rw['corrective_action'] != null)
                  Hint('Action: ${rw['corrective_action']}${rw['done_by_name'] != null ? ' — ${rw['done_by_name']}, ${fq(rw['hours_spent'])} h' : ''}'),
                if (rw['verification_remarks'] != null)
                  Hint('${rw['status'] == 'verified' ? 'Verified by ${rw['verified_by_name']}' : 'Sent back'}: ${rw['verification_remarks']}',
                      color: rw['status'] == 'verified' ? const Color(0xFF15803D) : const Color(0xFFB91C1C)),
                if (rw['cancel_reason'] != null) Hint('Cancelled: ${rw['cancel_reason']}'),
              ],
              actions: canAct ? _reworkActions(rw) : const [],
            ),
        ]);
  }

  List<Widget> _reworkActions(Json rw) {
    final s = '${rw['status']}';
    final no = '${rw['rework_number']}';
    final id = rw['id'];
    return [
      if (s == 'open' && _rf('rework', 'edit'))
        miniBtn('Start', _busy ? null : () => _act(() => Api.post('/production/rrv-builds/rework/$id/start'), '$no started.')),
      if ((s == 'open' || s == 'in_progress') && _rf('rework', 'edit')) miniBtn('Mark Done', _busy ? null : () => _finishRework(rw)),
      if (s == 'done' && _rf('rework', 'approve'))
        miniBtn('Verify', _busy
            ? null
            : () async {
                final v = await _ask('Verify $no', 'Confirms the defect is fixed. The failed check must already have passed again.',
                    'Verification remarks (optional)', 'Verify');
                if (v != null) await _act(() => Api.post('/production/rrv-builds/rework/$id/verify', data: {'remarks': v.isEmpty ? null : v}), '$no verified.');
              }, primary: true),
      if (s == 'done' && _rf('rework', 'reject'))
        miniBtn('Send Back', _busy
            ? null
            : () async {
                final v = await _ask('Send $no Back', 'Goes back to in progress for the fitter.', 'What is still wrong', 'Send Back',
                    need: 'Say what is still wrong — the fitter sees it.');
                if (v != null) await _act(() => Api.post('/production/rrv-builds/rework/$id/reject-verification', data: {'reason': v}), '$no sent back.');
              }),
      if (_can('sign_off') && _rf('rework', 'cancel') && ['open', 'in_progress', 'done'].contains(s))
        miniBtn('Cancel', _busy
            ? null
            : () async {
                final v = await _ask('Cancel $no', 'Cancelling skips verification — only for rework raised by mistake.', 'Reason', 'Cancel Rework',
                    need: 'Give a reason for cancelling the rework.');
                if (v != null) await _act(() => Api.post('/production/rrv-builds/rework/$id/cancel', data: {'reason': v}), '$no cancelled.');
              }, danger: true),
    ];
  }

  Future<void> _raiseRework(Json b) async {
    final title = TextEditingController();
    final details = TextEditingController();
    final assignee = Pick();
    DateTime? due;
    final saved = await showFormSheet(
      context,
      title: 'Raise Rework',
      saveLabel: 'Raise',
      builder: (ctx, setS) => [
        Hint('${b['build_number']} — ${b['rrv_model']}'),
        const Caps('Defect', color: cRed),
        AppTextField(label: 'What needs fixing', required: true, controller: title, hint: 'e.g. Hydraulic hose chafing near boom pivot'),
        AppTextField(label: 'Defect details', controller: details, maxLines: 3),
        const Caps('Assignment'),
        AppSelect<int>(
          label: 'Assign to',
          value: assignee.id,
          valueLabel: assignee.label,
          loadOptions: _reworkUsers.search,
          onChanged: (o) => setS(() => assignee.set(o)),
        ),
        DateField(label: 'Due', value: due, onChanged: (d) => setS(() => due = d)),
      ],
      onSave: () async {
        if (title.text.trim().length < 3) throw 'Give the rework a short title (what needs fixing).';
        final r = await Api.post('/production/rrv-builds/${b['id']}/rework', data: {
          'title': title.text.trim(),
          'defect_description': details.text.trim().isEmpty ? null : details.text.trim(),
          'assigned_to_id': assignee.id,
          'due_date': due == null ? null : apiDate(due!),
        });
        if (mounted) setState(() => _b = mapOf(r));
      },
    );
    if (saved && mounted) showSnack(context, 'Rework order raised.');
  }

  Future<void> _finishRework(Json rw) async {
    final action = TextEditingController();
    final cause = TextEditingController(text: rw['root_cause']?.toString() ?? '');
    final hours = TextEditingController();
    final saved = await showFormSheet(
      context,
      title: 'Mark Rework Done',
      saveLabel: 'Mark Done',
      builder: (ctx, setS) => [
        Hint('${rw['rework_number']} · ${_b?['build_number'] ?? ''}'),
        AppTextField(label: 'Corrective action', required: true, controller: action, maxLines: 3),
        AppTextField(label: 'Root cause', controller: cause),
        AppTextField(label: 'Hours spent', controller: hours, keyboardType: AppTextField.number),
        const Hint('Someone else must then verify the fix.'),
      ],
      onSave: () async {
        if (action.text.trim().length < 3) throw 'Describe the corrective action taken.';
        final r = await Api.post('/production/rrv-builds/rework/${rw['id']}/done', data: {
          'corrective_action': action.text.trim(),
          'root_cause': cause.text.trim().isEmpty ? null : cause.text.trim(),
          'hours_spent': numOf(hours.text) ?? 0,
        });
        if (mounted) setState(() => _b = mapOf(r));
      },
    );
    if (saved && mounted) showSnack(context, 'Rework marked done — someone else must now verify it.');
  }

  Widget _handoverTab(Json b) {
    return DetailSection('Production handover',
        action: _can('edit') && _rf('handover', 'edit') && b['status'] != 'handed_over' && b['status'] != 'cancelled'
            ? miniBtn('Edit', _busy ? null : () => _editHandover(b))
            : null,
        children: [
          if (_can('certificate')) ...[
            const Hint(
                'Handover certificate — make it a Word document to add wording, photos or customer-specific notes; “Handover Certificate (PDF)” then prints that version.'),
            const SizedBox(height: 6),
            btnWrap([
              miniBtn('Open certificate (PDF)', () {
                runAction(context, () => Files.downloadAndOpen('/production/rrv-builds/${b['id']}/handover-certificate', 'RRV-Handover-${b['build_number']}.pdf'));
              }),
              if (_can('edit_certificate'))
                miniBtn('Edit as Word in portal', () {
                  runAction(context, () => Files.openInPortal('/dashboard/production/rrv-builds/${b['id']}'));
                }),
            ]),
            const SizedBox(height: 8),
          ],
          FieldRow('Handover date', b['handover_date'] != null ? fmtDate(b['handover_date']) : null),
          FieldRow('Commissioning date', b['commissioning_date'] != null ? fmtDate(b['commissioning_date']) : null),
          FieldRow('Handed over to',
              [b['handed_over_to_name'], b['handed_over_to_organization']].where((x) => x != null && '$x'.isNotEmpty).join(', ')),
          FieldRow('Location', b['handover_location']),
          FieldRow('Customer acceptance ref.', b['customer_acceptance_ref']),
          FieldRow('Warranty', '${fq(b['warranty_months'])} months from handover'),
          if (b['handed_over_at'] != null) FieldRow('Signed off', '${txt(b['handed_over_by_name'])} · ${fmtDateTime(b['handed_over_at'])}'),
          if (b['handover_remarks'] != null) FieldRow('Remarks', b['handover_remarks']),
          const SizedBox(height: 8),
          const Hint(
              'Fill these in, then complete the Production Handover stage (manager sign-off). That makes the machine active in the ERP registry with its delivery, handover and warranty dates, and issues the handover certificate.'),
        ]);
  }

  Future<void> _editHandover(Json b) async {
    DateTime? hd = parseDate(b['handover_date']);
    DateTime? cd = parseDate(b['commissioning_date']);
    final name = TextEditingController(text: b['handed_over_to_name']?.toString() ?? '');
    final org = TextEditingController(text: (b['handed_over_to_organization'] ?? b['customer_name'])?.toString() ?? '');
    final loc = TextEditingController(text: b['handover_location']?.toString() ?? '');
    final acc = TextEditingController(text: b['customer_acceptance_ref']?.toString() ?? '');
    final warranty = TextEditingController(text: '${b['warranty_months'] ?? 12}');
    final remarks = TextEditingController(text: b['handover_remarks']?.toString() ?? '');
    final saved = await showFormSheet(
      context,
      title: 'Handover Details',
      builder: (ctx, setS) => [
        Hint('${b['build_number']} — ${b['rrv_model']}'),
        const Caps('Dates'),
        DateField(label: 'Handover date', value: hd, onChanged: (d) => setS(() => hd = d)),
        DateField(label: 'Commissioning date', value: cd, onChanged: (d) => setS(() => cd = d)),
        const Caps('Handed Over To'),
        AppTextField(label: 'Name', controller: name, hint: 'e.g. Sr. DEN (Works)'),
        AppTextField(label: 'Organisation', controller: org),
        AppTextField(label: 'Location', controller: loc, hint: 'Depot / site'),
        const Caps('Acceptance & Warranty'),
        AppTextField(label: 'Customer acceptance ref.', controller: acc),
        AppTextField(label: 'Warranty (months)', controller: warranty, keyboardType: TextInputType.number),
        const Hint('Whole months, 0–120, counted from handover.'),
        AppTextField(label: 'Remarks', controller: remarks, maxLines: 3),
      ],
      onSave: () async {
        final months = int.tryParse(warranty.text.trim());
        if (months == null || months < 0 || months > 120) throw 'Warranty must be a whole number of months between 0 and 120.';
        String? t(TextEditingController c) => c.text.trim().isEmpty ? null : c.text.trim();
        final r = await Api.patch('/production/rrv-builds/${b['id']}', data: {
          'handover_date': hd == null ? null : apiDate(hd!),
          'commissioning_date': cd == null ? null : apiDate(cd!),
          'handed_over_to_name': t(name),
          'handed_over_to_organization': t(org),
          'handover_location': t(loc),
          'customer_acceptance_ref': t(acc),
          'warranty_months': months,
          'handover_remarks': t(remarks),
        });
        if (mounted) setState(() => _b = mapOf(r));
      },
    );
    if (saved && mounted) showSnack(context, 'Handover details saved.');
  }
}
