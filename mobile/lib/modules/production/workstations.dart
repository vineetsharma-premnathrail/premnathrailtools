import 'package:flutter/material.dart';

import '../../api/api.dart';
import '../../ui/app_frame.dart';
import '../../ui/form.dart';
import '../../ui/format.dart';
import '../../ui/widgets.dart';
import 'prod_common.dart';

/// Production › Workstations - portal workstations/ (list, new, [id]) and
/// components/production/WorkstationForm.tsx.

const wsTypeLabels = <String, String>{
  'machine': 'Machine', 'work_center': 'Work Center', 'assembly_bay': 'Assembly Bay',
  'test_bench': 'Test Bench', 'paint_booth': 'Paint Booth', 'other': 'Other',
};
const _wsStatusLabels = <String, String>{'active': 'Active', 'under_maintenance': 'Under Maintenance', 'inactive': 'Inactive'};
const _wsStatusHex = <String, Color>{'active': cGreen, 'under_maintenance': cAmber, 'inactive': cGrey};

Widget _wsPill(Object? s) => Pill(_wsStatusLabels['$s'] ?? humanize(s), _wsStatusHex['$s'] ?? cGrey);

class WorkstationsTab extends StatefulWidget {
  const WorkstationsTab({super.key});

  @override
  State<WorkstationsTab> createState() => _WorkstationsTabState();
}

class _WorkstationsTabState extends State<WorkstationsTab> {
  final _list = GlobalKey<ApiListViewState>();
  String _type = '';
  String _status = '';

  void _reload() => _list.currentState?.reload();

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: Colors.transparent,
      floatingActionButton: ProdPerm.can('workstations', 'create')
          ? CreateFab(
              label: 'New Workstation',
              onPressed: () async {
                final id = await showWorkstationForm(context);
                if (id != null) {
                  _reload();
                  if (context.mounted) openScreen(context, WorkstationDetail(id: id));
                }
              })
          : null,
      body: ApiListView(
        key: _list,
        searchHint: 'Search by code or name…',
        emptyText: 'No workstations yet. Add the machines and work centers your routing operations run on.',
        load: (p, s) => Api.list('/production/workstations', query: {'status': _status, 'workstation_type': _type, 'search': s}),
        header: Column(children: [
          ChipRow([
            CountChip('All types', null, selected: _type.isEmpty, onTap: () {
              setState(() => _type = '');
              _reload();
            }),
            for (final e in wsTypeLabels.entries)
              CountChip(e.value, null, selected: _type == e.key, onTap: () {
                setState(() => _type = _type == e.key ? '' : e.key);
                _reload();
              }),
          ]),
          ChipRow([
            CountChip('All statuses', null, selected: _status.isEmpty, onTap: () {
              setState(() => _status = '');
              _reload();
            }),
            for (final e in _wsStatusLabels.entries)
              CountChip(e.value, null, selected: _status == e.key, color: _wsStatusHex[e.key], onTap: () {
                setState(() => _status = _status == e.key ? '' : e.key);
                _reload();
              }),
          ]),
          const SizedBox(height: 6),
        ]),
        itemBuilder: (ctx, w, reload) => RecordCard(
          code: txt(w['code']),
          title: txt(w['name']),
          trailing: _wsPill(w['status']),
          meta: [
            ('Type', wsTypeLabels['${w['workstation_type']}'] ?? humanize(w['workstation_type'])),
            ('Plant', txt(w['branch_name'])),
            ('Capacity / day', '${fq(w['capacity_hours_per_day'])} h'),
            ('Rate / hr', inr(w['hourly_rate'])),
            ('Open Ops', fq(w['open_operations'])),
          ],
          onTap: () async {
            await Navigator.of(ctx).push(MaterialPageRoute(builder: (_) => WorkstationDetail(id: idOf(w['id'])!)));
            reload();
          },
        ),
      ),
    );
  }
}

/// New / Edit Workstation. Returns the saved id.
Future<int?> showWorkstationForm(BuildContext context, {Json? initial}) async {
  final code = TextEditingController(text: initial?['code']?.toString() ?? '');
  final name = TextEditingController(text: initial?['name']?.toString() ?? '');
  var type = initial?['workstation_type']?.toString() ?? 'machine';
  var status = initial?['status']?.toString() ?? 'active';
  final branch = Pick(idOf(initial?['branch_id']), initial?['branch_name']?.toString());
  final dept = Pick(idOf(initial?['department_id']), initial?['department_name']?.toString());
  final capacity = TextEditingController(text: fq(initial?['capacity_hours_per_day'] ?? 8));
  final rate = TextEditingController(text: fq(initial?['hourly_rate'] ?? 0));
  final description = TextEditingController(text: initial?['description']?.toString() ?? '');
  final branches = LookupCache('/production/lookups/branches');
  final depts = LookupCache('/production/lookups/departments');
  int? id;
  final saved = await showFormSheet(
    context,
    title: initial == null ? 'New Workstation' : 'Edit ${initial['code']}',
    saveLabel: initial == null ? 'Create Workstation' : 'Save Changes',
    builder: (ctx, setS) => [
      Hint(initial == null
          ? 'A machine or work center that routing operations run on.'
          : '${initial['name']} — changes apply to routing, scheduling and costs from now on.'),
      const Caps('Basic Information'),
      AppTextField(label: 'Code', required: true, controller: code, hint: 'WELD-01'),
      AppTextField(label: 'Name', required: true, controller: name, hint: 'Welding Bay 1'),
      AppSelect<String>(
        label: 'Type',
        value: type,
        clearable: false,
        options: [for (final e in wsTypeLabels.entries) Option(e.key, e.value)],
        onChanged: (o) => setS(() => type = o?.value ?? type),
      ),
      AppSelect<String>(
        label: 'Status',
        value: status,
        clearable: false,
        options: [for (final e in _wsStatusLabels.entries) Option(e.key, e.value)],
        onChanged: (o) => setS(() => status = o?.value ?? status),
      ),
      const Caps('Location'),
      lookupSelect('Plant', branches, branch, setS),
      lookupSelect('Department', depts, dept, setS),
      const Caps('Capacity & Cost'),
      Row(children: [
        Expanded(child: AppTextField(label: 'Capacity (hrs/day)', controller: capacity, keyboardType: AppTextField.number)),
        const SizedBox(width: 10),
        Expanded(child: AppTextField(label: 'Hourly Rate (₹)', controller: rate, keyboardType: AppTextField.number)),
      ]),
      const Hint('The hourly rate turns hours booked on this workstation into a work order\'s labour/machine cost.'),
      AppTextField(label: 'Description', controller: description, maxLines: 4, hint: 'Machine make/model, capabilities, tooling…'),
    ],
    onSave: () async {
      if (code.text.trim().isEmpty || name.text.trim().isEmpty) throw 'Code and Name are required.';
      final cap = numOf(capacity.text);
      if (cap == null || cap < 0 || cap > 24) throw 'Capacity must be between 0 and 24 hours per day.';
      final hourly = numOf(rate.text);
      if (hourly == null || hourly < 0) throw 'Hourly rate must be zero or more.';
      final payload = {
        'code': code.text.trim().toUpperCase(),
        'name': name.text.trim(),
        'workstation_type': type,
        'status': status,
        'branch_id': branch.id,
        'department_id': dept.id,
        'capacity_hours_per_day': cap,
        'hourly_rate': hourly,
        'description': description.text.trim().isEmpty ? null : description.text.trim(),
      };
      final r = initial == null
          ? await Api.post('/production/workstations', data: payload)
          : await Api.patch('/production/workstations/${initial['id']}', data: payload);
      id = idOf(mapOf(r)['id']) ?? idOf(initial?['id']);
    },
  );
  return saved ? id : null;
}

class WorkstationDetail extends StatefulWidget {
  const WorkstationDetail({super.key, required this.id});
  final int id;

  @override
  State<WorkstationDetail> createState() => _WorkstationDetailState();
}

class _WorkstationDetailState extends State<WorkstationDetail> {
  Json? _ws;
  bool _loading = true;
  Object? _error;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    try {
      final d = mapOf(await Api.get('/production/workstations/${widget.id}'));
      if (mounted) {
        setState(() {
        _ws = d;
        _loading = false;
        _error = null;
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

  List<BarAction> _actions(Json? ws) => [
      if (ws != null && ProdPerm.can('workstations', 'edit'))
        BarAction('Edit', primary: true, () async {
          final id = await showWorkstationForm(context, initial: ws);
          if (id != null && mounted) {
            showSnack(context, 'Workstation saved.');
            _load();
          }
        }),
      if (ws != null && ProdPerm.canDeleteOwn('workstations', null))
        BarAction('Delete', danger: true, () async {
          final ok = await confirmDialog(context,
              title: 'Delete workstation?',
              message: '${ws['code']} will be removed from routing pickers. Completed work orders and time logs keep their history.',
              confirmLabel: 'Delete',
              danger: true);
          if (!ok || !mounted) return;
          final done = await runAction(context, () => Api.delete('/production/workstations/${widget.id}'));
          if (done && mounted) Navigator.of(context).pop();
        }),
    ];

  @override
  Widget build(BuildContext context) {
    final ws = _ws;
    final actions = _actions(ws);
    return SubPage(
      title: ws == null ? 'Workstation' : '${ws['code']} — ${ws['name']}',
      bottom: actions.isEmpty ? null : BottomActions(actions),
      body: DetailBody(
        loading: _loading,
        error: _error,
        onRefresh: _load,
        children: ws == null
            ? const []
            : [
                DetailSection(txt(ws['name']), children: [
                  Text(
                      txt(ws['description'] ??
                          '${wsTypeLabels['${ws['workstation_type']}'] ?? ws['workstation_type']} where routing operations are planned and their hours booked.'),
                      style: const TextStyle(fontSize: 13.5)),
                  const SizedBox(height: 8),
                  Wrap(spacing: 6, runSpacing: 6, children: [
                    _wsPill(ws['status']),
                    Pill('${ws['code']}', cGrey),
                    Pill(wsTypeLabels['${ws['workstation_type']}'] ?? humanize(ws['workstation_type']), cBlue),
                  ]),
                  const SizedBox(height: 6),
                  Hint(n(ws['open_operations']) > 0
                      ? '${fq(ws['open_operations'])} open operation(s) queued on released / in-progress work orders'
                      : 'No open operations queued right now'),
                ]),
                DetailSection('Where', children: [FieldRow('Plant', ws['branch_name']), FieldRow('Department', ws['department_name'])]),
                DetailSection('Capacity & cost', children: [
                  FieldRow('Capacity per day', '${fq(ws['capacity_hours_per_day'])} h'),
                  FieldRow('Hourly rate', inr(ws['hourly_rate'])),
                ]),
              ],
      ),
    );
  }
}
