import 'package:flutter/material.dart';

import '../../api/api.dart';
import '../../theme.dart';
import '../../ui/app_frame.dart';
import '../../ui/form.dart';
import '../../ui/format.dart';
import '../../ui/widgets.dart';
import 'hyd_bom.dart';
import 'hyd_circuits.dart';
import 'hyd_common.dart';
import 'hyd_panels.dart';
import 'hyd_testing.dart';

// Portal: /dashboard/hydraulic/systems (+ /new, /[id]) and components/hydraulic/SystemForm.tsx.

const _circuitStatusLabels = {'draft': 'Draft', 'under_review': 'Under Review', 'approved': 'Approved', 'superseded': 'Superseded'};
const _circuitStatusHex = {'draft': '#78716c', 'under_review': '#F59E0B', 'approved': '#16A34A', 'superseded': '#57534e'};
const _bomStatusLabels = {'draft': 'Draft', 'under_review': 'Awaiting Release Approval', 'released': 'Released', 'obsolete': 'Obsolete'};
const _bomStatusHex = {'draft': '#78716c', 'under_review': '#2563EB', 'released': '#16A34A', 'obsolete': '#57534e'};
const _testStatusLabels = {'planned': 'Planned', 'in_progress': 'In Progress'};
const _testStatusHex = {'planned': '#78716c', 'in_progress': '#2563EB'};

class HydSystemsList extends StatefulWidget {
  const HydSystemsList({super.key});

  @override
  State<HydSystemsList> createState() => _HydSystemsListState();
}

class _HydSystemsListState extends State<HydSystemsList> {
  final _list = GlobalKey<ApiListViewState>();
  final _vis = HydVis('hydraulic:systems');
  String _type = '';
  String _status = '';
  int? _count;

  void _refilter(VoidCallback f) {
    setState(f);
    _list.currentState?.reload();
  }

  @override
  Widget build(BuildContext context) {
    final statusOpts = Map.of(systemStatusLabels)..remove('under_maintenance');
    return Scaffold(
      backgroundColor: Colors.transparent,
      floatingActionButton: hydCan('systems', 'create')
          ? CreateFab(
              label: 'New ${_type.isEmpty ? '' : '${systemTypeLabels[_type]} '}System',
              onPressed: () async {
                await openSystemForm(context, defaultType: _type.isEmpty ? 'hydraulic' : _type);
                _list.currentState?.reload();
              },
            )
          : null,
      body: ApiListView(
        key: _list,
        searchHint: 'Search number, name, application or loco / machine serial…',
        load: (page, search) async {
          final p = await Api.list('/hydraulic/systems', query: {'system_type': _type, 'status': _status, 'search': search});
          if (mounted) setState(() => _count = p.rows.length);
          return p;
        },
        header: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
          const PageHeader('Systems', subtitle: 'Hydraulic & Pneumatic'),
          SingleChildScrollView(
            scrollDirection: Axis.horizontal,
            padding: const EdgeInsets.fromLTRB(16, 4, 8, 4),
            child: Row(children: [
              for (final e in {'': 'All', ...systemTypeLabels}.entries)
                CountChip(e.value, null,
                    selected: _type == e.key,
                    color: e.key.isEmpty ? Brand.primary : hx(systemTypeHex[e.key]),
                    onTap: () => _refilter(() => _type = e.key)),
            ]),
          ),
          FilterBar(children: [
            FilterPill(
                label: 'Status',
                value: _status,
                allLabel: 'All statuses',
                options: statusOpts,
                onChanged: (v) => _refilter(() => _status = v)),
          ]),
          if (_count != null) RowCountLine(_count!),
        ]),
        emptyText:
            'No systems match. Add a system (a power pack, brake unit or actuation circuit) to hang its circuits, BOMs and tests on.',
        itemBuilder: (ctx, s, reload) => RecordCard(
          code: txt(s['system_number']),
          title: txt(s['name']),
          trailing: Padding(
              padding: const EdgeInsets.only(left: 8),
              child: pill(systemStatusLabels, systemStatusHex, s['status'])),
          meta: [
            if (_vis.showColumn('systems', 'type')) ('Type', lbl(systemTypeLabels, s['system_type'])),
            if (_vis.showColumn('systems', 'application')) ('Application', txt(s['application'])),
            if (_vis.showColumn('systems', 'project')) ('Project', txt(s['project_label'])),
            if (_vis.showColumn('systems', 'working_pressure'))
              ('Working Pressure', withUnit(s['working_pressure_bar'], 'bar')),
          ],
          onTap: () async {
            await pushPage(ctx, HydSystemDetail(id: toInt(s['id'])!));
            reload();
          },
        ),
      ),
    );
  }
}

/// New / edit system form (portal SystemForm). Returns the saved record.
Future<Json?> openSystemForm(BuildContext context, {Json? initial, String defaultType = 'hydraulic'}) async {
  final vis = HydVis('hydraulic:systems');
  final typeChoices = vis.options('system_type', systemTypeLabels);
  final allowOwner = await hydAssigneeFilter('hydraulic:systems.owner');
  if (!context.mounted) return null;

  final i = initial ?? const <String, dynamic>{};
  var systemType = txt(i['system_type']) != '—' ? i['system_type'] as String : defaultType;
  if (initial == null && !typeChoices.any((e) => e.key == systemType) && typeChoices.isNotEmpty) {
    systemType = typeChoices.first.key;
  }
  var name = (i['name'] ?? '') as String;
  var application = (i['application'] ?? '') as String;
  var status = (i['status'] ?? 'design') as String;
  int? projectId = toInt(i['erp_project_id']);
  String? projectLabel = i['project_label'] as String?;
  int? branchId = toInt(i['branch_id']);
  String? branchLabel = i['branch_name'] as String?;
  int? ownerId = toInt(i['owner_id']);
  String? ownerLabel = i['owner_name'] as String?;
  int? opProjectId = toInt(i['order_project_id']);
  int? opElementId = toInt(i['order_project_element_id']);
  String? opLabel = i['order_project_number'] == null
      ? null
      : '${i['order_project_number']}${i['order_project_element_no'] != null ? ' / ${i['order_project_element_no'].toString().split('/').last}' : ''}${i['order_project_element_label'] != null ? ' · ${i['order_project_element_label']}' : ''}';
  var equipmentRef = (i['equipment_ref'] ?? '') as String;
  final nums = <String, String>{
    'working': numStr(i['working_pressure_bar']),
    'max': numStr(i['max_pressure_bar']),
    'flow': numStr(i['flow_rate']),
    'reservoir': numStr(i['reservoir_capacity_l']),
    'power': numStr(i['prime_mover_kw']),
    'filtration': numStr(i['filtration_micron']),
    'tempMin': numStr(i['operating_temp_min_c']),
    'tempMax': numStr(i['operating_temp_max_c']),
  };
  var fluid = (i['fluid_medium'] ?? '') as String;
  var cleanliness = (i['cleanliness_target'] ?? '') as String;
  var description = (i['description'] ?? '') as String;
  var remarks = (i['remarks'] ?? '') as String;
  final initialOwner = toInt(i['owner_id']);
  Json? saved;

  final statusOpts = [
    for (final e in systemStatusLabels.entries)
      if (e.key != 'under_maintenance' || i['status'] == 'under_maintenance') Option(e.key, e.value),
  ];

  Widget numField(String k, String label, {bool negative = false}) => AppTextField(
        key: ValueKey('sys-$k'),
        label: label,
        initialValue: nums[k],
        keyboardType: negative ? const TextInputType.numberWithOptions(decimal: true, signed: true) : AppTextField.number,
        onChanged: (v) => nums[k] = v,
      );

  final ok = await showFormSheet(
    context,
    title: initial == null ? 'New System' : 'Edit ${i['system_number']}',
    saveLabel: initial == null ? 'Create System' : 'Save Changes',
    builder: (ctx, setS) {
      final pneumatic = systemType == 'pneumatic';
      return [
        if (initial == null)
          const Hint('A hydraulic power pack or pneumatic unit — its circuits, BOMs and tests hang off it.'),
        if (vis.showSection('system')) ...[
          const FormHeading('System'),
          if (initial != null)
            ReadOnlyField(label: 'Type *', value: lbl(systemTypeLabels, systemType), color: hx(systemTypeHex[systemType]))
          else
            AppSelect<String>(
              label: 'Type',
              required: true,
              value: systemType,
              options: [for (final e in typeChoices) Option(e.key, e.value)],
              onChanged: (o) => setS(() => systemType = o?.value ?? systemType),
            ),
          AppTextField(
              label: 'Name',
              required: true,
              initialValue: name,
              hint: pneumatic ? 'Coach door pneumatic unit' : 'Tamping unit hydraulic power pack',
              onChanged: (v) => name = v),
          if (initial == null) const Hint("The system number is generated from the type, and the type can't be changed later."),
          AppTextField(
              label: 'Application',
              initialValue: application,
              hint: pneumatic ? 'Brake / door actuation' : 'Lifting, clamping, steering…',
              onChanged: (v) => application = v),
          AppSelect<String>(
              label: 'Status',
              value: status,
              required: true,
              options: statusOpts,
              onChanged: (o) => setS(() => status = o?.value ?? status)),
        ],
        if (vis.showSection('project_ownership')) ...[
          const FormHeading('Project & Ownership'),
          AppSelect<String>(
            label: 'Project / Unit (optional)',
            value: opProjectId == null ? null : '$opProjectId:${opElementId ?? ''}',
            valueLabel: opLabel,
            loadOptions: (q) async {
              final rows = rowsOf(await Api.get('/projects/units/lookup', query: {'q': q, 'include_projects': true}));
              return [
                for (final r in rows)
                  Option('${r['project_id']}:${r['element_id'] ?? ''}', txt(r['display'])),
              ];
            },
            onChanged: (o) => setS(() {
              if (o == null) {
                opProjectId = null;
                opElementId = null;
                opLabel = null;
              } else {
                final parts = o.value.split(':');
                opProjectId = int.tryParse(parts[0]);
                opElementId = parts.length > 1 ? int.tryParse(parts[1]) : null;
                opLabel = o.label;
              }
            }),
          ),
          AppSelect<int>(
            label: 'ERP Project',
            value: projectId,
            valueLabel: projectLabel,
            loadOptions: hydLookup('/hydraulic/lookups/projects'),
            onChanged: (o) => setS(() {
              projectId = o?.value;
              projectLabel = o?.label;
            }),
          ),
          AppTextField(
              label: 'Loco / Machine Serial',
              initialValue: equipmentRef,
              hint: 'Equipment reference',
              onChanged: (v) => equipmentRef = v),
          AppSelect<int>(
            label: 'Plant',
            value: branchId,
            valueLabel: branchLabel,
            loadOptions: hydLookup('/hydraulic/lookups/branches'),
            onChanged: (o) => setS(() {
              branchId = o?.value;
              branchLabel = o?.label;
            }),
          ),
          AppSelect<int>(
            label: 'Owner',
            value: ownerId,
            valueLabel: ownerLabel,
            loadOptions: hydLookup('/hydraulic/lookups/users',
                where: (u) => toInt(u['id']) == initialOwner || allowOwner(toInt(u['id']) ?? 0)),
            onChanged: (o) => setS(() {
              ownerId = o?.value;
              ownerLabel = o?.label;
            }),
          ),
        ],
        if (vis.showSection('design_parameters')) ...[
          FormHeading('Design Parameters — ${lbl(systemTypeLabels, systemType)}'),
          TwoUp(numField('working', 'Working Pressure (bar)'), numField('max', 'Max Pressure (bar)')),
          TwoUp(numField('flow', 'Flow Rate (${flowUnit(systemType)})'),
              numField('reservoir', pneumatic ? 'Air Receiver Volume (L)' : 'Reservoir Volume (L)')),
          numField('power', 'Motor / Compressor Power (kW)'),
          AppTextField(
              label: 'Fluid / Medium',
              initialValue: fluid,
              hint: pneumatic ? 'Compressed air' : 'ISO VG 46 mineral oil',
              onChanged: (v) => fluid = v),
          TwoUp(
            numField('filtration', 'Filtration (micron)'),
            AppTextField(
                label: 'Cleanliness Target',
                initialValue: cleanliness,
                hint: pneumatic ? '1.4.1 (ISO 8573-1)' : '18/16/13 (ISO 4406)',
                onChanged: (v) => cleanliness = v),
          ),
          TwoUp(numField('tempMin', 'Min Temp (°C)', negative: true), numField('tempMax', 'Max Temp (°C)', negative: true)),
        ],
        if (vis.showSection('description'))
          AppTextField(label: 'Description (optional)', maxLines: 4, initialValue: description, onChanged: (v) => description = v),
        if (vis.showSection('remarks'))
          AppTextField(label: 'Remarks (optional)', maxLines: 3, initialValue: remarks, onChanged: (v) => remarks = v),
      ];
    },
    onSave: () async {
      if (name.trim().isEmpty) throw 'System name is required — e.g. "WDG4 brake actuation unit".';
      final pneumatic = systemType == 'pneumatic';
      final checks = [
        ('working', 'Working pressure', false), ('max', 'Max pressure', false), ('flow', 'Flow rate', false),
        ('reservoir', pneumatic ? 'Air receiver volume' : 'Reservoir volume', false),
        ('power', 'Motor / compressor power', false), ('filtration', 'Filtration rating', false),
        ('tempMin', 'Min operating temperature', true), ('tempMax', 'Max operating temperature', true),
      ];
      final p = <String, num?>{};
      for (final (k, label, neg) in checks) {
        final raw = nums[k]!.trim();
        final n = raw.isEmpty ? null : num.tryParse(raw);
        if (raw.isNotEmpty && n == null) throw '$label must be a number — clear the field or enter a numeric value.';
        if (n != null && !neg && n < 0) throw "$label can't be negative — enter zero or more.";
        p[k] = n;
      }
      if (p['working'] != null && p['max'] != null && p['working']! > p['max']!) {
        throw "Working pressure (${p['working']} bar) can't be higher than the maximum pressure (${p['max']} bar). Check both values.";
      }
      if (p['tempMin'] != null && p['tempMax'] != null && p['tempMin']! > p['tempMax']!) {
        throw 'Minimum operating temperature is higher than the maximum — swap or correct them.';
      }
      final payload = {
        if (initial == null) 'system_type': systemType,
        'name': name.trim(),
        'application': blankToNull(application),
        'status': status,
        'erp_project_id': projectId,
        'order_project_id': opProjectId,
        'order_project_element_id': opElementId,
        'branch_id': branchId,
        'owner_id': ownerId,
        'equipment_ref': blankToNull(equipmentRef),
        'working_pressure_bar': p['working'],
        'max_pressure_bar': p['max'],
        'flow_rate': p['flow'],
        'reservoir_capacity_l': p['reservoir'],
        'prime_mover_kw': p['power'],
        'fluid_medium': blankToNull(fluid),
        'filtration_micron': p['filtration'],
        'cleanliness_target': blankToNull(cleanliness),
        'operating_temp_min_c': p['tempMin'],
        'operating_temp_max_c': p['tempMax'],
        'description': blankToNull(description),
        'remarks': blankToNull(remarks),
      };
      final r = initial == null
          ? await Api.post('/hydraulic/systems', data: payload)
          : await Api.patch('/hydraulic/systems/${i['id']}', data: payload);
      saved = Map<String, dynamic>.from(r as Map);
    },
  );
  if (!ok || saved == null) return null;
  if (initial == null && context.mounted) {
    openScreen(context, HydSystemDetail(id: toInt(saved!['id'])!));
  }
  return saved;
}

/// Related list card on the system page; null rows = no access.
class _Related extends StatefulWidget {
  const _Related({required this.title, required this.path, required this.systemId, required this.empty, required this.row, this.newLabel, this.onNew});
  final String title;
  final String path;
  final int systemId;
  final String empty;
  final Widget Function(BuildContext, Json) row;
  final String? newLabel;
  final VoidCallback? onNew;

  @override
  State<_Related> createState() => _RelatedState();
}

class _RelatedState extends State<_Related> {
  List<Json>? _rows;
  bool _loaded = false;

  @override
  void initState() {
    super.initState();
    Api.get(widget.path, query: {'system_id': widget.systemId}).then((d) {
      if (mounted) {
        setState(() {
          _rows = rowsOf(d);
          _loaded = true;
        });
      }
    }).catchError((_) {
      if (mounted) setState(() => _loaded = true);
    });
  }

  @override
  Widget build(BuildContext context) {
    final rows = _rows;
    return DetailSection(
      '${widget.title}${rows != null ? ' (${rows.length})' : ''}',
      action: rows != null && widget.onNew != null ? linkBtn(widget.newLabel!, widget.onNew) : null,
      children: [
        if (!_loaded)
          const Hint('Loading…')
        else if (rows == null)
          const Hint('Not available — you may not have access to this tab. Ask an admin if you need it.')
        else if (rows.isEmpty)
          Hint(widget.empty)
        else
          for (final r in rows) widget.row(context, r),
      ],
    );
  }
}

class HydSystemDetail extends StatelessWidget {
  const HydSystemDetail({super.key, required this.id});
  final int id;

  @override
  Widget build(BuildContext context) {
    final vis = HydVis('hydraulic:systems');
    final seeCosts = hydSeeCosts();
    return HydDetail(
      fallbackTitle: 'System',
      load: () async => Map<String, dynamic>.from(await Api.get('/hydraulic/systems/$id') as Map),
      title: (s) => txt(s['system_number']),
      actions: (ctx, s, ctl) => [
        if (hydCan('systems', 'edit'))
          secondaryBtn('Edit', () async {
            final r = await openSystemForm(ctx, initial: s);
            if (r != null) {
              ctl.setRecord(r);
              if (ctx.mounted) showSnack(ctx, 'System saved.');
            }
          }),
        if (hydCanDelete('systems', s['created_by_id']))
          dangerBtn('Delete', () async {
            final yes = await confirmDialog(ctx,
                title: 'Delete system?',
                message:
                    '${s['system_number']} will be removed from the systems list and pickers. Its circuits, BOMs and tests keep their link. If the system is just out of use, set its status to Decommissioned instead.',
                confirmLabel: 'Delete',
                danger: true);
            if (!yes || !ctx.mounted) return;
            if (await ctl.run(ctx, () => Api.delete('/hydraulic/systems/$id'), success: 'System deleted.') && ctx.mounted) {
              Navigator.pop(ctx);
            }
          }),
      ],
      sections: (ctx, s, ctl) {
        final pneumatic = s['system_type'] == 'pneumatic';
        final tMin = s['operating_temp_min_c'];
        final tMax = s['operating_temp_max_c'];
        return [
          _OpenServices(systemId: id, onChanged: ctl.reload),
          if (vis.showSection('detail_summary'))
            SummaryCard(
              eyebrow: 'Hydraulic & Pneumatic · System',
              title: txt(s['name']),
              text: (s['description'] as String?)?.isNotEmpty == true
                  ? s['description'] as String
                  : '${lbl(systemTypeLabels, s['system_type'])} system${(s['application'] as String?)?.isNotEmpty == true ? ' for ${s['application']}' : ''}.',
              badges: [
                pill(systemTypeLabels, systemTypeHex, s['system_type']),
                pill(systemStatusLabels, systemStatusHex, s['status']),
              ],
              meta: s['owner_name'] != null ? '· Owner ${s['owner_name']}' : null,
            ),
          if (vis.showSection('detail_where_used'))
            DetailSection('Where it is used', children: [
              FieldRow('Application', s['application']),
              if (s['order_project_number'] != null)
                FieldRow('Project',
                    '${s['order_project_number']}${s['order_project_element_no'] != null ? ' / ${s['order_project_element_no'].toString().split('/').last}' : ''}${s['order_project_element_label'] != null ? ' · ${s['order_project_element_label']}' : ''}'),
              FieldRow('ERP project', s['project_label']),
              FieldRow('Plant', s['branch_name']),
              FieldRow('Loco / machine serial', s['equipment_ref']),
            ]),
          if (vis.showSection('detail_parameters'))
            DetailSection('Design parameters', children: [
              FieldRow('Working pressure', withUnit(s['working_pressure_bar'], 'bar')),
              FieldRow('Max pressure', withUnit(s['max_pressure_bar'], 'bar')),
              FieldRow('Flow rate', withUnit(s['flow_rate'], flowUnit(s['system_type']))),
              FieldRow(pneumatic ? 'Air receiver volume' : 'Reservoir volume', withUnit(s['reservoir_capacity_l'], 'L')),
              FieldRow('Motor / compressor power', withUnit(s['prime_mover_kw'], 'kW')),
              FieldRow('Fluid / medium', s['fluid_medium']),
              FieldRow('Filtration', withUnit(s['filtration_micron'], 'micron')),
              FieldRow('Cleanliness target', s['cleanliness_target']),
              FieldRow('Operating temperature',
                  tMin != null || tMax != null ? '${tMin ?? '—'} to ${tMax ?? '—'} °C' : null),
            ]),
          if ((s['remarks'] as String?)?.isNotEmpty == true && vis.showSection('detail_remarks'))
            DetailSection('Remarks', children: [FieldRow('Remarks', s['remarks'])]),
          if (vis.showSection('detail_circuits'))
            _Related(
              title: 'Circuits',
              path: '/hydraulic/circuits',
              systemId: id,
              newLabel: '+ New circuit',
              onNew: hydCan('circuits', 'create') ? () => openCircuitForm(ctx, defaultSystemId: id, defaultSystemLabel: '${s['system_number']} — ${s['name']}') : null,
              empty: 'No circuit drawings yet — add the circuit diagram so it can go through review and approval.',
              row: (c, r) => MiniRow(
                code: '${r['circuit_number']} Rev ${r['revision']}',
                title: txt(r['title']),
                meta: r['drawing_number'] != null ? 'Dwg ${r['drawing_number']}' : null,
                badge: pill(_circuitStatusLabels, _circuitStatusHex, r['status']),
                onTap: () => openScreen(c, HydCircuitDetail(id: toInt(r['id'])!)),
              ),
            ),
          if (vis.showSection('detail_boms'))
            _Related(
              title: 'Bills of Material',
              path: '/hydraulic/boms',
              systemId: id,
              newLabel: '+ New BOM',
              onNew: hydCan('bom', 'create') ? () => openBomForm(ctx, defaultSystemId: id, defaultSystemLabel: '${s['system_number']} — ${s['name']}', defaultSystemType: s['system_type'] as String?) : null,
              empty: 'No BOM yet — build one from the component master to get a cost roll-up for this system.',
              row: (c, b) => MiniRow(
                code: '${b['bom_number']} Rev ${b['revision']}',
                title: txt(b['title']),
                meta: '${b['line_count'] ?? 0} line(s)${seeCosts && b['total_cost'] != null ? ' · ${inr(b['total_cost'])}' : ''}',
                badge: pill(_bomStatusLabels, _bomStatusHex, b['status']),
                onTap: () => openScreen(c, HydBomDetail(id: toInt(b['id'])!)),
              ),
            ),
          if (vis.showSection('detail_tests'))
            _Related(
              title: 'Tests',
              path: '/hydraulic/tests',
              systemId: id,
              newLabel: '+ New test',
              onNew: hydCan('testing', 'create') ? () => openTestForm(ctx, presetSystemId: id, presetSystemLabel: '${s['system_number']} — ${s['name']}', presetMedium: s['system_type'] as String?) : null,
              empty: 'No tests recorded — plan a pressure, leak or functional test before commissioning.',
              row: (c, t) => MiniRow(
                code: txt(t['test_number']),
                title: txt(t['title']),
                meta: '${lbl(testTypeLabels, t['test_type'])} · ${fmtDate(t['test_date'])}',
                badge: t['status'] == 'completed'
                    ? pill(resultLabels, resultHex, t['result'])
                    : pill(_testStatusLabels, _testStatusHex, t['status']),
                onTap: () => openScreen(c, HydTestDetail(id: toInt(t['id'])!)),
              ),
            ),
          if (vis.showSection('detail_documents'))
            HydDocumentsPanel(
                entityType: 'system', entityId: id, title: 'System Documents', defaultDocType: 'ga_drawing'),
        ];
      },
    );
  }
}

/// Open legacy service records (retired) - shown so they can be cancelled.
class _OpenServices extends StatefulWidget {
  const _OpenServices({required this.systemId, required this.onChanged});
  final int systemId;
  final VoidCallback onChanged;

  @override
  State<_OpenServices> createState() => _OpenServicesState();
}

class _OpenServicesState extends State<_OpenServices> {
  List<Json> _rows = [];

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    try {
      final rows = rowsOf(await Api.get('/hydraulic/service-records', query: {'system_id': widget.systemId}));
      if (mounted) {
        setState(() => _rows = rows.where((r) => r['status'] == 'open' || r['status'] == 'in_progress').toList());
      }
    } catch (_) {
      if (mounted) setState(() => _rows = []);
    }
  }

  Future<void> _cancel(Json r) async {
    final reason = await promptDialog(context,
        title: 'Cancel ${r['record_number']}?',
        message: 'Hydraulic service records are retired. Cancelling returns the system to service.',
        confirmLabel: 'Cancel record');
    if (reason == null || !mounted) return;
    final ok = await runAction(context, () => Api.post('/hydraulic/service-records/${r['id']}/cancel', data: {'reason': reason}),
        success: 'Service record cancelled.');
    if (ok) {
      _load();
      widget.onChanged();
    }
  }

  @override
  Widget build(BuildContext context) {
    if (_rows.isEmpty) return const SizedBox.shrink();
    return Padding(
      padding: const EdgeInsets.fromLTRB(16, 0, 16, 12),
      child: Container(
        padding: const EdgeInsets.all(12),
        decoration: BoxDecoration(
          color: hx('#F59E0B').withValues(alpha: 0.08),
          borderRadius: BorderRadius.circular(12),
          border: Border.all(color: hx('#F59E0B').withValues(alpha: 0.3)),
        ),
        child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          Text('${_rows.length} open legacy service record${_rows.length == 1 ? '' : 's'}',
              style: const TextStyle(fontWeight: FontWeight.w600, color: Color(0xFFB45309))),
          const SizedBox(height: 4),
          const Hint(
              'Hydraulic service records are retired and can no longer be completed. Cancel each one (with a reason) so the system returns to service and can be deleted if needed.'),
          for (final r in _rows)
            MiniRow(
              code: txt(r['record_number']),
              title: (r['reported_problem'] as String?) ?? lbl(serviceTypeLabels, r['service_type']),
              meta: '${lbl(serviceTypeLabels, r['service_type'])} · ${fmtDate(r['service_date'])}',
              badge: StatusBadge(r['status'] == 'in_progress' ? 'In Progress' : 'Open',
                  color: hx(r['status'] == 'in_progress' ? '#2563EB' : '#F59E0B')),
              onTap: () => _cancel(r),
            ),
        ]),
      ),
    );
  }
}
