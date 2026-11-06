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
import 'mt_work_orders.dart';

// PM Schedule - frontend/src/app/dashboard/maintenance/schedule/** + PmPlanForm.

const _entryHex = <String, Color>{'overdue': kRed, 'due': kAmber, 'upcoming': kBlue, ...woStatusHex};
const _entryLabels = <String, String>{'overdue': 'Overdue', 'due': 'Due — job raised soon', 'upcoming': 'Upcoming', ...woStatusLabels};

class ScheduleTab extends StatefulWidget {
  const ScheduleTab({super.key, this.initialView = 'plans', this.initialDue, this.initialBranch});
  final String initialView;
  final String? initialDue;
  final int? initialBranch;

  @override
  State<ScheduleTab> createState() => _ScheduleTabState();
}

class _ScheduleTabState extends State<ScheduleTab> {
  final _list = GlobalKey<ApiListViewState>();
  late String _view = widget.initialView;
  late int? _branch = widget.initialBranch;
  String? _active = 'active';
  late String? _due = widget.initialDue;
  int _weeks = 8;
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

  Widget _header() => Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          const MtHeader('PM Schedule',
              subtitle: 'Preventive plans raise their work orders automatically every morning, a few days before they fall due.'),
          Padding(
            padding: const EdgeInsets.fromLTRB(16, 4, 16, 4),
            child: SegmentedButton<String>(
              segments: const [ButtonSegment(value: 'plans', label: Text('Plans')), ButtonSegment(value: 'upcoming', label: Text('Upcoming'))],
              selected: {_view},
              showSelectedIcon: false,
              onSelectionChanged: (s) => setState(() => _view = s.first),
            ),
          ),
          filterRow([
            FilterSelect<int>(
                allLabel: 'All plants', value: _branch, options: MtLookups.branches(_lookups), onChanged: (v) => _refilter(() => _branch = v)),
            if (_view == 'plans') ...[
              FilterSelect<String>(
                allLabel: 'All plans',
                value: _active,
                options: const [Option('active', 'Active'), Option('inactive', 'Inactive')],
                onChanged: (v) => _refilter(() => _active = v),
              ),
              FilterSelect<String>(
                allLabel: 'Any due date',
                value: _due,
                options: const [Option('overdue', 'Overdue'), Option('7', 'Due within 7 days'), Option('30', 'Due within 30 days')],
                onChanged: (v) => _refilter(() => _due = v),
              ),
            ] else
              FilterSelect<int>(
                allLabel: 'Next 8 weeks',
                allowAll: false,
                value: _weeks,
                options: const [Option(4, 'Next 4 weeks'), Option(8, 'Next 8 weeks'), Option(13, 'Next 3 months'), Option(26, 'Next 6 months')],
                onChanged: (v) => setState(() => _weeks = v ?? 8),
              ),
          ]),
        ],
      );

  @override
  Widget build(BuildContext context) {
    final body = _view == 'plans'
        ? ApiListView(
            key: _list,
            header: _header(),
            searchHint: 'Search plan, title or asset…',
            load: (page, search) => Api.list('/maintenance/pm-plans', query: {
              'search': search,
              'branch_id': _branch,
              'is_active': _active == null ? null : _active == 'active',
              'overdue': _due == 'overdue' ? true : null,
              'due_within_days': _due != null && _due != 'overdue' ? int.parse(_due!) : null,
            }),
            emptyText: _branch != null || _due != null || _active != 'active'
                ? 'No PM plans match these filters.'
                : 'No PM plans yet. Create one per machine for lubrication, inspections, calibration and other routine servicing.',
            itemBuilder: (ctx, p, reload) {
              final state = str(p['due_state']).isEmpty ? 'scheduled' : str(p['due_state']);
              return RecordCard(
                code: str(p['plan_code']),
                title: str(p['title']),
                subtitle: '${str(p['asset_code'])} ${str(p['asset_name'])}'.trim(),
                trailing: statusPill(pmDueStateLabels, dueHex, state),
                meta: [
                  ('Type', label(woTypeLabels, p['wo_type'])),
                  ('Frequency', txt(p['frequency_label'])),
                  (
                    'Next Due',
                    '${p['trigger_type'] == 'meter' ? '—' : fmtDate(p['next_due_date'])}'
                        '${p['next_due_meter'] != null ? ' (at ${p['next_due_meter']} ${str(p['meter_unit'])}, now ${p['current_meter_reading'] ?? '—'})' : ''}'
                  ),
                  ('Last Done', fmtDate(p['last_done_date'])),
                  ('Technician', str(p['default_assignee_name']).isEmpty ? 'Unassigned' : str(p['default_assignee_name'])),
                  ('Current Job', txt(p['open_work_order_number'])),
                ],
                onTap: () async {
                  await Navigator.of(ctx).push(MaterialPageRoute(builder: (_) => PmPlanDetailScreen(id: asInt(p['id'])!)));
                  reload();
                },
              );
            },
          )
        : _Upcoming(key: ValueKey('up-$_weeks-$_branch'), header: _header(), weeks: _weeks, branch: _branch);
    return withFab(
      body,
      Mt.can('schedule', 'create')
          ? CreateFab(
              label: 'New PM Plan',
              onPressed: () async {
                final p = await pmPlanForm(context);
                if (p != null && context.mounted) {
                  _list.currentState?.reload();
                  openScreen(context, PmPlanDetailScreen(id: asInt(p['id'])!));
                }
              })
          : null,
    );
  }
}

DateTime _monday(DateTime d) => DateTime(d.year, d.month, d.day).subtract(Duration(days: (d.weekday + 6) % 7));
String _iso(DateTime d) => apiDate(d);
String _short(DateTime d) => fmtDate(d).replaceAll(RegExp(r' \d{4}$'), '');

class _Upcoming extends StatelessWidget {
  const _Upcoming({super.key, required this.header, required this.weeks, this.branch});
  final Widget header;
  final int weeks;
  final int? branch;

  @override
  Widget build(BuildContext context) {
    final today = DateTime.now();
    return ApiLoader<List<Json>>(
      load: () async => (await Api.list('/maintenance/pm-plans/calendar', query: {
        'from': _iso(today.subtract(const Duration(days: 60))),
        'to': _iso(today.add(Duration(days: weeks * 7))),
        'branch_id': branch,
      }))
          .rows,
      builder: (ctx, entries, reload) {
        final thisWeek = _monday(today);
        final overdue = entries.where((e) => e['state'] == 'overdue').toList();
        final byWeek = <String, List<Json>>{};
        for (final e in entries) {
          if (e['state'] == 'overdue') continue;
          final d = parseDate(e['date']);
          if (d == null || d.isBefore(thisWeek)) continue;
          byWeek.putIfAbsent(_iso(_monday(d)), () => []).add(e);
        }
        final keys = byWeek.keys.toList()..sort();
        final groups = <(String, List<Json>, Color?)>[
          if (overdue.isNotEmpty) ('Overdue (${overdue.length})', overdue, kRed),
          for (final k in keys)
            (() {
              final start = DateTime.parse(k);
              final end = start.add(const Duration(days: 6));
              final prefix = k == _iso(thisWeek) ? 'This week' : 'Week of ${_short(start)}';
              return ('$prefix · ${_short(start)} – ${_short(end)} (${byWeek[k]!.length})', byWeek[k]!, null);
            })(),
        ];
        return ListView(
          padding: const EdgeInsets.only(bottom: 88),
          children: [
            header,
            if (groups.isEmpty) const EmptyView('Nothing due in this window.'),
            for (final (title, items, tone) in groups)
              DetailSection(title, action: tone == null ? null : Icon(Icons.warning_amber_rounded, color: tone, size: 18), children: [
                for (final e in items)
                  LineItem(
                    title: '${fmtDate(e['date'])} · ${str(e['asset_code'])} ${str(e['asset_name'])}',
                    subtitle: '${e['title']} · ${e['plan_code']} · ${label(woTypeLabels, e['wo_type'])}'
                        '${str(e['assigned_to_name']).isNotEmpty ? '\n${e['assigned_to_name']}' : ''}',
                    badges: [
                      Pill(_entryLabels[e['state']] ?? str(e['state']), _entryHex[e['state']] ?? kGrey),
                      smallText(str(e['wo_number']).isNotEmpty ? str(e['wo_number']) : 'Not raised yet',
                          color: str(e['wo_number']).isNotEmpty ? kOrange : Brand.muted, weight: FontWeight.w600),
                    ],
                    onTap: () => openScreen(
                        ctx,
                        e['work_order_id'] != null
                            ? WorkOrderDetailScreen(id: asInt(e['work_order_id'])!)
                            : PmPlanDetailScreen(id: asInt(e['plan_id'])!)),
                  ),
              ]),
          ],
        );
      },
    );
  }
}

// ── PM plan detail (schedule/[id]) ───────────────────────────────────────────

class PmPlanDetailScreen extends StatefulWidget {
  const PmPlanDetailScreen({super.key, required this.id});
  final int id;

  @override
  State<PmPlanDetailScreen> createState() => _PmPlanDetailScreenState();
}

class _PmPlanDetailScreenState extends State<PmPlanDetailScreen> {
  Json? _plan;
  Object? _error;
  bool _busy = false;
  String? _notice;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    try {
      final d = asMap(await Api.get('/maintenance/pm-plans/${widget.id}'));
      if (mounted) {
        setState(() {
          _plan = d;
          _error = null;
        });
      }
    } catch (e) {
      if (mounted) setState(() => _error = e);
    }
  }

  Future<void> _run(String kind) async {
    final p = _plan!;
    final String title, message, confirm;
    if (kind == 'delete') {
      title = 'Delete PM plan?';
      message = '${p['plan_code']} will be removed and no more jobs raised from it. Work orders already generated stay on record.';
      confirm = 'Delete';
    } else if (kind == 'generate') {
      title = 'Raise the work order now?';
      message = 'A work order for the ${fmtDate(p['next_due_date'])} due date will be raised now'
          '${str(p['default_assignee_name']).isNotEmpty ? ' and assigned to ${p['default_assignee_name']}' : ' as a draft for you to assign'}.';
      confirm = 'Generate';
    } else {
      final active = p['is_active'] == true;
      title = active ? 'Deactivate PM plan?' : 'Activate PM plan?';
      message = active
          ? 'The scheduler stops raising jobs for ${p['plan_code']}. Any job already open stays open.'
          : "The scheduler will raise ${p['plan_code']}'s next job (due ${fmtDate(p['next_due_date'])}). Check the due date first if the plan was off for a while.";
      confirm = active ? 'Deactivate' : 'Activate';
    }
    final ok = await confirmDialog(context, title: title, message: message, confirmLabel: confirm, danger: kind == 'delete');
    if (!ok || !mounted) return;
    setState(() {
      _busy = true;
      _notice = null;
    });
    try {
      if (kind == 'delete') {
        await Api.delete('/maintenance/pm-plans/${widget.id}');
        if (mounted) Navigator.of(context).pop();
        return;
      }
      if (kind == 'generate') {
        final u = asMap(await Api.post('/maintenance/pm-plans/${widget.id}/generate-now'));
        setState(() {
          _plan = u;
          _notice = str(u?['open_work_order_number']).isNotEmpty
              ? '${u!['open_work_order_number']} raised for the ${fmtDate(u['next_due_date'])} due date.'
              : 'Work order raised.';
        });
      } else {
        final u = asMap(await Api.patch('/maintenance/pm-plans/${widget.id}', data: {'is_active': p['is_active'] != true}));
        setState(() {
          _plan = u;
          _notice = u?['is_active'] == true
              ? '${u!['plan_code']} is active again — the scheduler will raise its jobs.'
              : '${u?['plan_code']} deactivated — no new jobs will be raised.';
        });
      }
    } catch (e) {
      if (mounted) showSnack(context, ApiClient.describe(e), error: true);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final p = _plan;
    final actions = <BarAction>[];
    if (p != null) {
      if (Mt.can('schedule', 'create') && p['is_active'] == true && p['open_work_order_id'] == null) {
        actions.add(BarAction('Generate Now', () => _run('generate'), primary: true));
      }
      if (Mt.can('schedule', 'edit')) {
        actions.add(BarAction('Edit', () async {
          final u = await pmPlanForm(context, initial: p);
          if (u != null && mounted) setState(() => _plan = u);
        }));
        actions.add(BarAction(p['is_active'] == true ? 'Deactivate' : 'Activate', () => _run('toggle')));
      }
      final owner = asInt(p['created_by_id']);
      if (Mt.can('schedule', 'delete') && (Perm.isAdmin || owner == null || owner == Perm.userId)) {
        actions.add(BarAction('Delete', () => _run('delete'), danger: true));
      }
    }
    return SubPage(
      title: p == null ? 'PM Plan' : '${p['plan_code']} — ${p['title']}',
      bottom: actions.isEmpty ? null : ActionBar(actions, busy: _busy),
      body: p == null ? (_error != null ? ErrorView(_error!, onRetry: _load) : const LoadingView()) : RefreshIndicator(onRefresh: _load, child: _body(p)),
    );
  }

  Widget _body(Json p) {
    final due = str(p['due_state']).isEmpty ? 'scheduled' : str(p['due_state']);
    final tasks = asList(p['tasks']);
    final spares = asList(p['spares']);
    final wos = asList(p['recent_work_orders']);
    final lead = asInt(p['lead_days']) ?? 0;
    return ListView(
      padding: const EdgeInsets.only(bottom: 24),
      children: [
        MtHeader('${p['plan_code']} — ${p['title']}', caps: 'Preventive Maintenance Plan', actions: [statusPill(pmDueStateLabels, dueHex, due)]),
        if (_notice != null) NoteBanner(_notice!, color: kGreen),
        if (p['open_work_order_id'] != null)
          NoteBanner(
            "Current job: ${p['open_work_order_number']} (${label(woStatusLabels, p['open_work_order_status'])}). The next one is raised after it's closed.",
            color: kBlue,
            onTap: () => openScreen(context, WorkOrderDetailScreen(id: asInt(p['open_work_order_id'])!)),
          ),
        DetailSection(str(p['title']), children: [
          if (str(p['description']).isNotEmpty) Text(str(p['description'])),
          const SizedBox(height: 6),
          smallText(
            'Every ${str(p['frequency_label']).isNotEmpty ? p['frequency_label'] : '${p['frequency_value']} ${label(pmFrequencyUnitLabels, p['frequency_unit'])}'}'
            ' · Next due ${p['trigger_type'] == 'meter' ? 'by counter' : fmtDate(p['next_due_date'])} · ${p['is_active'] == true ? 'Active' : 'Inactive'}',
            color: due == 'overdue' ? kRed : Brand.heading,
            weight: FontWeight.w600,
          ),
        ]),
        DetailSection('Asset & Job', children: [
          FieldRow(
            'Asset',
            InkWell(
              onTap: () => openScreen(context, AssetDetailScreen(id: asInt(p['asset_id'])!)),
              child: Text([str(p['asset_code']), str(p['asset_name'])].where((s) => s.isNotEmpty).join(' — '),
                  style: const TextStyle(fontWeight: FontWeight.w600, color: kOrange)),
            ),
          ),
          FieldRow('Plant', p['branch_name']),
          FieldRow('Job Type', label(woTypeLabels, p['wo_type'])),
          FieldRow('Default Technician', str(p['default_assignee_name']).isEmpty ? 'Unassigned' : p['default_assignee_name']),
          FieldRow('Estimated Hours', p['estimated_hours'] == null ? null : '${p['estimated_hours']} h'),
          FieldRow('Machine Stop', p['requires_shutdown'] == true ? 'Yes — blocked while the job runs' : 'No'),
        ]),
        DetailSection('Schedule', children: [
          FieldRow('Next Due Counted From', label(pmScheduleBasisLabels, p['schedule_basis'])),
          if (p['next_due_meter'] != null)
            FieldRow('Due at Counter',
                '${p['next_due_meter']} ${str(p['meter_unit'])} (now ${p['current_meter_reading'] ?? '—'}${p['last_done_meter'] != null ? ', last done ${p['last_done_meter']}' : ''})'),
          FieldRow('Job Raised', '$lead day${lead == 1 ? '' : 's'} before due'),
          FieldRow('Last Done',
              p['last_done_date'] == null ? 'Never' : '${fmtDate(p['last_done_date'])}${str(p['last_work_order_number']).isNotEmpty ? ' (${p['last_work_order_number']})' : ''}'),
        ]),
        DetailSection('Checklist', children: [
          if (tasks.isEmpty) mutedText('No checklist — add checks via Edit.'),
          for (var i = 0; i < tasks.length; i++)
            LineItem(title: '${i + 1}. ${tasks[i]['description']}', subtitle: 'Expected: ${txt(tasks[i]['expected_value'])}'),
        ]),
        DetailSection('Spares Kit', children: [
          if (spares.isEmpty) mutedText('No spares kit.'),
          for (final s in spares)
            LineItem(
              title: '${s['item_code']} ${str(s['item_name'])}',
              subtitle: str(s['remarks']).isEmpty ? null : str(s['remarks']),
              trailing: [Text('${fmtQty(s['qty'])} ${str(s['uom'])}', style: const TextStyle(fontWeight: FontWeight.w600))],
            ),
        ]),
        DetailSection('Work Orders From This Plan', children: [
          if (wos.isEmpty)
            mutedText('No work orders yet. The first job is raised $lead day${lead == 1 ? '' : 's'} before '
                '${p['trigger_type'] == 'meter' ? 'the counter falls due' : fmtDate(p['next_due_date'])} — or raise it now with Generate Now.'),
          for (final w in wos)
            LineItem(
              title: str(w['wo_number']),
              subtitle: 'Due ${fmtDate(w['pm_due_date'])} · ${txt(w['assigned_to_name'])} · Done ${fmtDate(w['actual_end'])}',
              badges: [
                statusPill(woStatusLabels, woStatusHex, w['status']),
                if (w['on_time'] != null)
                  w['on_time'] == true ? smallText('On time: Yes', color: kGreen, weight: FontWeight.w600) : smallText('On time: Late', color: kRed, weight: FontWeight.w600),
              ],
              onTap: () => openScreen(context, WorkOrderDetailScreen(id: asInt(w['id'])!)),
            ),
        ]),
      ],
    );
  }
}

// ── PM plan form (PmPlanForm.tsx) ────────────────────────────────────────────

const _pmWoTypes = ['preventive', 'calibration', 'inspection'];

class _Task {
  _Task(String d, String e)
      : desc = TextEditingController(text: d),
        expected = TextEditingController(text: e);
  final TextEditingController desc, expected;
}

class _KitLine {
  _KitLine(this.itemId, this.code, this.name, this.uom, String qty, String remarks)
      : qty = TextEditingController(text: qty),
        remarks = TextEditingController(text: remarks);
  final int itemId;
  final String code, name, uom;
  final TextEditingController qty, remarks;
}

/// New / edit PM plan; returns the saved plan.
Future<Json?> pmPlanForm(BuildContext context, {Json? initial, Json? presetAsset}) async {
  Json lk;
  try {
    lk = await MtLookups.get();
  } catch (e) {
    if (context.mounted) showSnack(context, ApiClient.describe(e), error: true);
    return null;
  }
  final allow = await assigneeFilter('maintenance:schedule.default_assignee');
  var leadDefault = '3';
  if (initial == null) {
    try {
      final s = asMap(await Api.get('/maintenance/settings'));
      final v = asMap(s?['values'])?['default_pm_lead_days'];
      if (v is num) leadDefault = '${v.toInt()}';
    } catch (_) {
      // keep the built-in default of 3
    }
  }
  if (!context.mounted) return null;
  final i = initial;
  int? assetId = asInt(i?['asset_id'] ?? presetAsset?['id']);
  if (presetAsset != null && assetId != null) assetCache[assetId] = presetAsset;
  String? assetText = i != null ? '${str(i['asset_code'])} — ${str(i['asset_name'])}' : (presetAsset == null ? null : assetLabel(presetAsset));
  TextEditingController c(String k, [String def = '']) => TextEditingController(text: i?[k] == null ? def : str(i![k]));
  final title = c('title'), desc = c('description'), freq = c('frequency_value', '1'), lead = c('lead_days', leadDefault);
  final hours = c('estimated_hours'), meterInterval = c('meter_interval'), leadMeter = c('lead_meter'), nextMeter = c('next_due_meter');
  var woType = str(i?['wo_type']).isEmpty ? 'preventive' : str(i!['wo_type']);
  var unit = str(i?['frequency_unit']).isEmpty ? 'month' : str(i!['frequency_unit']);
  var basis = str(i?['schedule_basis']).isEmpty ? 'fixed' : str(i!['schedule_basis']);
  var trigger = str(i?['trigger_type']).isEmpty ? 'calendar' : str(i!['trigger_type']);
  DateTime? nextDue = parseDate(i?['next_due_date']);
  int? assignee = asInt(i?['default_assignee_id']);
  var shutdown = i?['requires_shutdown'] == true;
  var active = i == null ? true : i['is_active'] == true;
  final tasks = [for (final t in asList(i?['tasks'])) _Task(str(t['description']), str(t['expected_value']))];
  final kit = [
    for (final s in asList(i?['spares']))
      _KitLine(asInt(s['store_item_id'])!, str(s['item_code']), str(s['item_name']), str(s['uom']), fmtQty(s['qty']), str(s['remarks'])),
  ];
  String? kitNote;
  Json? saved;
  final techs = [
    for (final t in MtLookups.technicians(lk))
      if (allow(asInt(t['id']) ?? 0) || asInt(t['id']) == asInt(i?['default_assignee_id'])) Option(asInt(t['id'])!, str(t['name'])),
  ];

  final ok = await showFormSheet(
    context,
    title: i == null ? 'New PM Plan' : 'Edit ${i['plan_code']}',
    saveLabel: i == null ? 'Create PM Plan' : 'Save Changes',
    builder: (ctx, setS) {
      final usesMeter = trigger == 'meter' || trigger == 'calendar_or_meter';
      final usesCalendar = trigger != 'meter';
      return [
        hintText(i == null ? 'A recurring preventive job — the work order is raised automatically a few days before it falls due.' : str(i['title'])),
        if (i != null && str(i['open_work_order_number']).isNotEmpty)
          Text(
            '${i['open_work_order_number']} is already open for this plan. Checklist and spares changes apply to the next job onwards, not to ${i['open_work_order_number']}.',
            style: const TextStyle(fontSize: 12.5, color: Color(0xFF1D4ED8)),
          ),
        sheetSection('What & Where'),
        AppSelect<int>(
          label: 'Asset',
          required: true,
          value: assetId,
          valueLabel: assetId != null && assetCache[assetId] != null ? assetLabel(assetCache[assetId]!) : assetText,
          loadOptions: (q) => loadAssetOptions(q),
          onChanged: (o) => setS(() {
            assetId = o?.value;
            assetText = o?.label;
          }),
        ),
        AppTextField(label: 'Title', required: true, controller: title, hint: 'Monthly lubrication & oil level check'),
        AppSelect<String>(
            label: 'Job Type', value: woType, clearable: false, options: optionsOf(woTypeLabels, _pmWoTypes),
            onChanged: (o) => setS(() => woType = o?.value ?? woType)),
        AppTextField(label: 'Instructions', controller: desc, maxLines: 3, hint: 'Safety notes, lock-out steps, reference to the OEM manual…'),
        sheetSection('Schedule'),
        AppSelect<String>(
          label: 'Trigger',
          value: trigger,
          clearable: false,
          options: const [
            Option('calendar', 'Calendar (every N days / months)'),
            Option('meter', 'Counter (every N running hours / km)'),
            Option('calendar_or_meter', 'Calendar or counter — whichever first'),
          ],
          onChanged: (o) => setS(() => trigger = o?.value ?? trigger),
        ),
        if (usesMeter) ...[
          AppTextField(label: 'Counter interval', required: true, controller: meterInterval, keyboardType: AppTextField.number, hint: '500'),
          AppTextField(label: 'Raise early by', controller: leadMeter, keyboardType: AppTextField.number, hint: '50'),
          AppTextField(label: 'Next due at reading', controller: nextMeter, keyboardType: AppTextField.number, hint: 'current + interval'),
          hintText("Counter plans run on the asset's main counter (its meter unit). Every reading entered on the asset — or captured when a job is completed — is checked; the job is raised once the counter reaches the due reading minus the early margin, and closing it restarts the counter from the reading at completion."),
        ],
        if (usesCalendar) ...[
          Row(children: [
            SizedBox(width: 90, child: AppTextField(label: 'Every', required: true, controller: freq, keyboardType: TextInputType.number)),
            const SizedBox(width: 8),
            Expanded(
              child: AppSelect<String>(
                  label: 'Unit', value: unit, clearable: false, options: optionsOf(pmFrequencyUnitLabels),
                  onChanged: (o) => setS(() => unit = o?.value ?? unit)),
            ),
          ]),
          AppSelect<String>(
            label: 'Next Due From',
            value: basis,
            clearable: false,
            options: const [Option('fixed', 'Due date (fixed calendar)'), Option('floating', 'Last completion (floating)')],
            onChanged: (o) => setS(() => basis = o?.value ?? basis),
          ),
          DateField(label: 'Next Due Date', required: true, value: nextDue, onChanged: (d) => setS(() => nextDue = d)),
          AppTextField(label: 'Lead Days', controller: lead, keyboardType: TextInputType.number, onChanged: (_) => setS(() {})),
          hintText('${basis == 'fixed' ? 'Fixed: the next job is due one interval after the previous DUE date, even if it was done late — the calendar stays steady (e.g. every 1st of the month).' : 'Floating: the next job is due one interval after the job was actually DONE — use it when the gap between services matters more than the calendar date.'}'
              ' The work order is raised ${lead.text.isEmpty ? '0' : lead.text} day${lead.text == '1' ? '' : 's'} before the due date.'),
        ],
        sheetSection('Who & How Long'),
        AppSelect<int>(
            label: 'Default Technician', value: assignee, valueLabel: str(i?['default_assignee_name']), options: techs,
            onChanged: (o) => setS(() => assignee = o?.value)),
        AppTextField(label: 'Est. Hours', controller: hours, keyboardType: AppTextField.number),
        CheckField(label: 'Machine must be stopped', value: shutdown, onChanged: (v) => setS(() => shutdown = v)),
        CheckField(label: 'Plan is active', value: active, onChanged: (v) => setS(() => active = v)),
        hintText("With a default technician the job is raised as Assigned and they're notified; without one it's raised as Draft for the planner to assign."
            '${shutdown ? ' The machine (and its Production workstation) is blocked only once the technician starts the job.' : ''}'),
        sheetSection('Checklist (${tasks.length})'),
        if (tasks.isEmpty) hintText('No checks yet. Each line is copied into every work order and the technician marks it OK / Not OK / N/A.'),
        for (var k = 0; k < tasks.length; k++)
          Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
            Padding(padding: const EdgeInsets.only(top: 14, right: 4), child: smallText('${k + 1}.')),
            Expanded(
              child: Column(children: [
                AppTextField(label: 'Check', controller: tasks[k].desc, hint: 'Check hydraulic oil level'),
                const SizedBox(height: 6),
                AppTextField(label: 'Expected', controller: tasks[k].expected, hint: 'e.g. between marks'),
              ]),
            ),
            Column(children: [
              IconButton(
                tooltip: 'Move up',
                icon: const Icon(Icons.arrow_upward_rounded, size: 18),
                onPressed: k == 0 ? null : () => setS(() => tasks.insert(k - 1, tasks.removeAt(k))),
              ),
              IconButton(tooltip: 'Remove', icon: const Icon(Icons.close_rounded, color: kRed), onPressed: () => setS(() => tasks.removeAt(k))),
            ]),
          ]),
        Align(alignment: Alignment.centerLeft, child: smallBtn('+ Add Check', () => setS(() => tasks.add(_Task('', ''))))),
        sheetSection('Spares Kit (${kit.length})', extra: '(optional)'),
        for (var k = 0; k < kit.length; k++)
          Container(
            padding: const EdgeInsets.all(10),
            decoration: BoxDecoration(border: Border.all(color: Brand.border), borderRadius: BorderRadius.circular(12)),
            child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
              Row(children: [
                Expanded(child: Text('${kit[k].code} ${kit[k].name}', style: const TextStyle(fontWeight: FontWeight.w600))),
                IconButton(tooltip: 'Remove', icon: const Icon(Icons.close_rounded, color: kRed), onPressed: () => setS(() => kit.removeAt(k))),
              ]),
              AppTextField(label: 'Qty${kit[k].uom.isNotEmpty ? ' (${kit[k].uom})' : ''}', controller: kit[k].qty, keyboardType: AppTextField.number),
              const SizedBox(height: 6),
              AppTextField(label: 'Remarks', controller: kit[k].remarks),
            ]),
          ),
        AppSelect<int>(
          key: ValueKey('kit-${kit.length}'),
          label: 'Add a spare from Store',
          value: null,
          loadOptions: (q) => loadStoreItemOptions(q),
          onChanged: (o) => setS(() {
            if (o == null) return;
            final it = storeItemCache[o.value]!;
            if (kit.any((x) => x.itemId == o.value)) {
              kitNote = '${it['item_code']} is already in the kit — change its quantity instead.';
              return;
            }
            kitNote = null;
            kit.add(_KitLine(o.value, str(it['item_code']), str(it['item_name']), str(it['uom']), '1', ''));
          }),
        ),
        if (kitNote != null) Text(kitNote!, style: const TextStyle(color: kRed, fontSize: 12.5)),
        hintText("The kit is copied onto each work order as planned spares at the plant's default store. Nothing is reserved or issued until the technician issues it on the job."),
      ];
    },
    onSave: () async {
      final usesMeter = trigger == 'meter' || trigger == 'calendar_or_meter';
      final usesCalendar = trigger != 'meter';
      if (assetId == null) throw 'Pick the asset this plan is for.';
      if (title.text.trim().isEmpty) throw 'Give the plan a title, e.g. "Monthly lubrication & oil level check".';
      if (usesCalendar && nextDue == null) throw 'Enter the next due date — when the first job falls due.';
      final mi = numOrNull(meterInterval.text);
      if (usesMeter && (mi == null || mi.isNaN || mi <= 0)) throw 'Enter the counter interval, e.g. every 500 running hours.';
      final f = int.tryParse(freq.text.trim());
      if (f == null || f < 1) throw 'Frequency must be a whole number of 1 or more.';
      final l = int.tryParse(lead.text.trim());
      if (l == null || l < 0) throw 'Lead days must be 0 or more.';
      final hrs = numOrNull(hours.text);
      if (hrs != null && (hrs.isNaN || hrs < 0)) throw 'Estimated hours must be a positive number.';
      final clean = tasks.where((t) => t.desc.text.trim().isNotEmpty || t.expected.text.trim().isNotEmpty).toList();
      final blank = clean.indexWhere((t) => t.desc.text.trim().isEmpty);
      if (blank >= 0) throw 'Checklist line ${blank + 1} has an expected value but no description.';
      for (final s in kit) {
        final q = numOrNull(s.qty.text);
        if (q == null || q.isNaN || q <= 0) throw 'Quantity for ${s.code} must be greater than 0.';
      }
      final payload = {
        'asset_id': assetId,
        'title': title.text.trim(),
        'description': desc.text.trim().isEmpty ? null : desc.text.trim(),
        'wo_type': woType,
        'frequency_unit': unit,
        'frequency_value': f,
        'schedule_basis': basis,
        'lead_days': l,
        'next_due_date': nextDue == null ? null : apiDate(nextDue!),
        'trigger_type': trigger,
        'meter_interval': usesMeter ? mi : null,
        'lead_meter': usesMeter ? numOrNull(leadMeter.text) : null,
        'next_due_meter': usesMeter ? numOrNull(nextMeter.text) : null,
        'estimated_hours': hrs,
        'default_assignee_id': assignee,
        'requires_shutdown': shutdown,
        'is_active': active,
        'tasks': [
          for (final t in clean)
            {'description': t.desc.text.trim(), 'expected_value': t.expected.text.trim().isEmpty ? null : t.expected.text.trim()},
        ],
        'spares': [
          for (final s in kit)
            {'store_item_id': s.itemId, 'qty': num.parse(s.qty.text.trim()), 'remarks': s.remarks.text.trim().isEmpty ? null : s.remarks.text.trim()},
        ],
      };
      saved = i == null
          ? asMap(await Api.post('/maintenance/pm-plans', data: payload))
          : asMap(await Api.patch('/maintenance/pm-plans/${i['id']}', data: payload));
    },
  );
  for (final x in [title, desc, freq, lead, hours, meterInterval, leadMeter, nextMeter]) {
    x.dispose();
  }
  return ok ? saved : null;
}
