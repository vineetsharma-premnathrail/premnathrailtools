import 'package:flutter/material.dart';

import '../../api/api.dart';
import '../../theme.dart';
import '../../ui/app_frame.dart';
import '../../ui/files.dart';
import '../../ui/form.dart';
import '../../ui/format.dart';
import '../../ui/widgets.dart';
import 'fin_common.dart';
import 'fin_gst.dart' show FinPeriodPicker;
import 'fin_journals.dart';

/// Finance › Controlling (portal finance/controlling/page.tsx).
class FinControllingPage extends StatelessWidget {
  const FinControllingPage({super.key});

  @override
  Widget build(BuildContext context) => FinTabbedPage(
        title: 'Controlling',
        subtitle:
            'Cost-centre planning and plan vs actual, activity rates for production costing, assessment & distribution cycles, and costing-sheet overhead on work orders.',
        noAccessText:
            "You don't have view permission on any Controlling tab (Finance & Accounting › Controlling). Ask an admin to grant it in the Permission Matrix.",
        tabs: [
          FinSubTab('Planning', (_) => const _Planning(), permTab: 'co_planning'),
          FinSubTab('Plan vs Actual', (_) => const _PlanVsActual(), permTab: 'co_planning.plan_vs_actual'),
          FinSubTab('Activity Rates', (_) => const _Rates(), permTab: 'activity_rates'),
          FinSubTab('Allocations', (_) => const _Allocations(), permTab: 'allocations'),
          FinSubTab('Overhead', (_) => const _Overhead(), permTab: 'overhead'),
        ],
      );
}

const _b = '/accounts/co';
const _statusLabels = {'draft': 'Draft', 'locked': 'Locked', 'posted': 'Posted', 'reversed': 'Reversed', 'active': 'Active', 'inactive': 'Inactive'};
const _statusHex = {
  'draft': Color(0xFFB45309), 'locked': Color(0xFF15803D), 'posted': Color(0xFF15803D), 'reversed': Color(0xFF64748B),
  'active': Color(0xFF15803D), 'inactive': Color(0xFF64748B),
};
const _basisLabels = {'fixed_percent': 'Fixed %', 'headcount': 'Headcount', 'activity_hours': 'Activity hours'};
const _red = Color(0xFFDC2626);
const _green = Color(0xFF15803D);

Widget _pill(Object? s) => FinStatusPill(s, labels: _statusLabels, colors: _statusHex);

String _currentFy() {
  final s = fyStart();
  return '${s.year}-${((s.year + 1) % 100).toString().padLeft(2, '0')}';
}

List<String> _fyOptions() {
  final y = fyStart().year;
  return [for (final s in [y - 1, y, y + 1]) '$s-${((s + 1) % 100).toString().padLeft(2, '0')}'];
}

Future<List<Option<int>>> _ccOptions(String q) async =>
    (await FinLookups.costCentres()).where((o) => q.isEmpty || o.label.toLowerCase().contains(q.toLowerCase())).toList();

Future<List<Option<int>>> _plOptions(String q, {bool expenseOnly = false}) async => (await FinLookups.ledgerOptions(
        filter: (a) => expenseOnly ? a['account_type'] == 'expense' : (a['account_type'] == 'expense' || a['account_type'] == 'revenue')))
    .where((o) => q.isEmpty || o.label.toLowerCase().contains(q.toLowerCase()))
    .toList();

// ── Planning ─────────────────────────────────────────────────────────────────

class _Planning extends StatefulWidget {
  const _Planning();

  @override
  State<_Planning> createState() => _PlanningState();
}

class _PlanningState extends State<_Planning> {
  String _fy = _currentFy();
  List<Json> _versions = [];
  int? _selected;
  Json? _grid;
  List<Json> _rows = [];
  bool _dirty = false;
  bool _busy = false;
  String? _error;

  bool get _canEdit => finCan('co_planning', 'edit');
  bool get _canApprove => finCan('co_planning', 'approve');

  @override
  void initState() {
    super.initState();
    _loadVersions();
  }

  Json? get _version => _versions.where((v) => toInt(v['id']) == _selected).firstOrNull;

  Future<void> _loadVersions() async {
    try {
      final v = asRows(await Api.get('$_b/plan-versions', query: {'financial_year': _fy}));
      setState(() {
        _versions = v;
        if (_selected == null || !v.any((x) => toInt(x['id']) == _selected)) {
          _selected = toInt((v.where((x) => x['is_primary'] == true).firstOrNull ?? v.firstOrNull)?['id']);
        }
      });
      await _loadGrid();
    } catch (e) {
      setState(() => _error = 'Could not load the plan versions. ${ApiClient.describe(e)}');
    }
  }

  Future<void> _loadGrid() async {
    if (_selected == null) {
      setState(() {
        _grid = null;
        _rows = [];
      });
      return;
    }
    try {
      final g = asJson(await Api.get('$_b/plan-versions/$_selected/grid'));
      setState(() {
        _grid = g;
        _rows = [for (final r in listOf(g['rows'])) {...r, 'amounts': {...asJson(r['amounts'])}}];
        _dirty = false;
      });
    } catch (e) {
      setState(() => _error = 'Could not load the plan. ${ApiClient.describe(e)}');
    }
  }

  Future<void> _act(Future<dynamic> Function() fn, String ok) async {
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      await fn();
      if (mounted) showSnack(context, ok);
      await _loadVersions();
    } catch (e) {
      setState(() => _error = ApiClient.describe(e));
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  double _rowTotal(Json r) => asJson(r['amounts']).values.fold<double>(0, (s, v) => s + toD(v));

  Future<void> _editRow(int i) async {
    final g = _grid!;
    final periods = [for (final p in (g['periods'] as List)) '$p'];
    final labels = [for (final p in (g['period_labels'] as List)) '$p'];
    final r = _rows[i];
    final ctrls = {for (final p in periods) p: TextEditingController(text: toD(asJson(r['amounts'])[p]) == 0 ? '' : '${asJson(r['amounts'])[p]}')};
    final editable = _version?['status'] != 'locked' && _canEdit;
    final ok = await showFormSheet(
      context,
      title: '${r['cost_center_code']} · ${r['gl_account_code']}',
      saveLabel: editable ? 'Done' : 'Close',
      builder: (ctx, setS) => [
        Text('${r['cost_center_name']} — ${r['gl_account_name']}', style: const TextStyle(color: Brand.muted)),
        if (editable)
          Row(children: [
            TextButton(
              onPressed: () => setS(() {
                final total = periods.fold<double>(0, (s, p) => s + (double.tryParse(ctrls[p]!.text) ?? 0));
                final each = round2(total / periods.length);
                for (var k = 0; k < periods.length; k++) {
                  ctrls[periods[k]]!.text = '${k == periods.length - 1 ? round2(total - each * (periods.length - 1)) : each}';
                }
              }),
              child: const Text('Spread evenly'),
            ),
          ]),
        for (var k = 0; k < periods.length; k++)
          AppTextField(
              label: labels.length > k ? labels[k] : periods[k],
              controller: ctrls[periods[k]],
              enabled: editable,
              keyboardType: const TextInputType.numberWithOptions(decimal: true, signed: true)),
      ],
      onSave: () async {
        if (!editable) return;
        setState(() {
          _rows[i] = {
            ..._rows[i],
            'amounts': {for (final p in periods) p: double.tryParse(ctrls[p]!.text) ?? 0},
          };
          _dirty = true;
        });
      },
    );
    if (ok) setState(() {});
  }

  Future<void> _addRow() async {
    int? cc;
    String? ccL;
    int? gl;
    String? glL;
    await showFormSheet(
      context,
      title: 'Add plan row',
      saveLabel: 'Add row',
      builder: (ctx, setS) => [
        AppSelect<int>(
            label: 'Cost centre',
            required: true,
            value: cc,
            valueLabel: ccL,
            loadOptions: _ccOptions,
            onChanged: (o) => setS(() {
                  cc = o?.value;
                  ccL = o?.label;
                })),
        AppSelect<int>(
            label: 'Ledger (P&L)',
            required: true,
            value: gl,
            valueLabel: glL,
            loadOptions: (q) => _plOptions(q),
            onChanged: (o) => setS(() {
                  gl = o?.value;
                  glL = o?.label;
                })),
      ],
      onSave: () async {
        if (cc == null || gl == null) throw 'Pick both the cost centre and the ledger for the new row.';
        if (_rows.any((r) => toInt(r['cost_center_id']) == cc && toInt(r['gl_account_id']) == gl)) {
          throw 'That cost centre and ledger already have a row.';
        }
        final c = (ccL ?? '').split(' — ');
        final l = (glL ?? '').split(' — ');
        setState(() {
          _rows.add({
            'cost_center_id': cc,
            'cost_center_code': c.first,
            'cost_center_name': c.length > 1 ? c[1] : '',
            'gl_account_id': gl,
            'gl_account_code': l.first,
            'gl_account_name': l.length > 1 ? l[1] : '',
            'amounts': <String, dynamic>{},
          });
          _dirty = true;
        });
      },
    );
  }

  Future<void> _newVersion() async {
    final code = TextEditingController();
    final name = TextEditingController();
    String type = _versions.isEmpty ? 'original' : 'revised';
    String copy = _versions.isEmpty ? 'none' : 'version';
    int? copyFrom = _selected;
    String? copyFy;
    final uplift = TextEditingController(text: '0');
    bool primary = false;
    Json? created;
    final ok = await showFormSheet(
      context,
      title: 'New plan version — $_fy',
      saveLabel: 'Create',
      builder: (ctx, setS) => [
        const Text("An empty plan, a copy of another version, or a year's actuals with an uplift.", style: TextStyle(color: Brand.muted)),
        AppTextField(label: 'Code', required: true, controller: code, hint: '0 / R1'),
        AppTextField(label: 'Name', required: true, controller: name, hint: 'Original budget'),
        AppSelect<String>(
            label: 'Type',
            value: type,
            clearable: false,
            options: const [Option('original', 'Original'), Option('revised', 'Revised')],
            onChanged: (o) => setS(() => type = o?.value ?? type)),
        AppSelect<String>(
            label: 'Start from',
            value: copy,
            clearable: false,
            options: const [Option('none', 'Empty plan'), Option('version', 'Copy a plan version'), Option('actuals', "A year's actuals")],
            onChanged: (o) => setS(() => copy = o?.value ?? copy)),
        if (copy == 'version')
          AppSelect<int>(
              label: 'Version to copy',
              required: true,
              value: copyFrom,
              options: [for (final v in _versions) Option(toInt(v['id'])!, '${v['code']} — ${v['name']}')],
              onChanged: (o) => setS(() => copyFrom = o?.value)),
        if (copy == 'actuals')
          AppSelect<String>(
              label: 'Actuals of FY',
              required: true,
              value: copyFy,
              options: [for (final f in _fyOptions()) Option(f, f)],
              onChanged: (o) => setS(() => copyFy = o?.value)),
        if (copy != 'none') AppTextField(label: 'Uplift %', controller: uplift, keyboardType: AppTextField.number),
        CheckField(label: 'Make it the primary version for $_fy', value: primary, onChanged: (v) => setS(() => primary = v)),
      ],
      onSave: () async {
        created = asJson(await Api.post('$_b/plan-versions', data: {
          'code': code.text.trim(),
          'name': name.text.trim(),
          'financial_year': _fy,
          'version_type': type,
          'is_primary': primary,
          'uplift_pct': double.tryParse(uplift.text) ?? 0,
          if (copy == 'version') 'copy_from_version_id': copyFrom,
          if (copy == 'actuals') 'copy_actuals_from_fy': copyFy,
        }));
      },
    );
    if (ok && created != null) {
      _selected = toInt(created!['id']);
      if (mounted) showSnack(context, 'Plan version ${created!['code']} created.');
      _loadVersions();
    }
  }

  @override
  Widget build(BuildContext context) {
    final v = _version;
    final locked = v?['status'] == 'locked';
    final editable = v != null && !locked && _canEdit;
    final g = _grid;
    final periods = g == null ? <String>[] : [for (final p in (g['periods'] as List)) '$p'];
    final labels = g == null ? <String>[] : [for (final p in (g['period_labels'] as List)) '$p'];
    final actions = <(String, VoidCallback)>[
      if (finCan('co_planning', 'create')) ('+ New version', _newVersion),
      if (v != null && finCan('co_planning', 'export'))
        ('Download Excel', () => finDownload(context, '$_b/plan-versions/${v['id']}/export', 'CO-plan-${v['financial_year']}-${v['code']}.xlsx')),
      if (v != null && !locked && finCan('co_planning', 'import'))
        ('Upload Excel', () async {
          final f = await Files.pickFile(extensions: ['xlsx']);
          if (f != null) _act(() => finUpload('$_b/plan-versions/${v['id']}/import', f), 'Plan imported from ${f.filename}.');
        }),
      if (v != null && v['is_primary'] != true && _canEdit)
        ('Make primary', () => _act(() => Api.patch('$_b/plan-versions/${v['id']}', data: {'is_primary': true}), '${v['code']} is now the primary version.')),
      if (v != null && !locked && _canApprove && !_dirty) ('Lock', () => _act(() => Api.post('$_b/plan-versions/${v['id']}/lock'), '${v['code']} locked.')),
      if (v != null && locked && _canApprove)
        ('Unlock', () async {
          final reason = await promptDialog(context,
              title: 'Unlock plan version', message: 'Say why the agreed plan is being reopened — it goes on the audit trail.', confirmLabel: 'Unlock');
          if (reason != null) _act(() => Api.post('$_b/plan-versions/${v['id']}/unlock', data: {'reason': reason}), '${v['code']} unlocked.');
        }),
      if (v != null && !locked && finCan('co_planning', 'delete'))
        ('Delete', () async {
          final ok = await confirmDialog(context,
              title: 'Delete plan version?', message: 'Plan version ${v['code']} and all its plan lines will be deleted.', confirmLabel: 'Delete', danger: true);
          if (ok) {
            _selected = null;
            _act(() => Api.delete('$_b/plan-versions/${v['id']}'), 'Plan version deleted.');
          }
        }),
    ];
    final periodTotals = {for (final p in periods) p: _rows.fold<double>(0, (s, r) => s + toD(asJson(r['amounts'])[p]))};
    return Scaffold(
      backgroundColor: Colors.transparent,
      bottomNavigationBar: editable
          ? SafeArea(
              child: Container(
                padding: const EdgeInsets.fromLTRB(16, 8, 16, 8),
                decoration: const BoxDecoration(color: Colors.white, border: Border(top: BorderSide(color: Brand.border))),
                child: ActionBar([
                  actionBtn('+ Add row', _addRow),
                  actionBtn(_busy ? 'Saving…' : 'Save plan', _busy || !_dirty
                      ? null
                      : () => _act(
                          () => Api.put('$_b/plan-versions/${v['id']}/grid', data: {
                                'rows': [
                                  for (final r in _rows) {'cost_center_id': r['cost_center_id'], 'gl_account_id': r['gl_account_id'], 'amounts': r['amounts']},
                                ],
                              }),
                          'Plan saved.'),
                      primary: true),
                ]),
              ),
            )
          : null,
      body: ListView(padding: const EdgeInsets.only(bottom: 24), children: [
        const InfoBanner(
            "Plan each cost centre's costs (and income) by ledger and month. Costs are positive, income negative — the same sign as actuals. Keep one primary version per year: Plan vs Actual uses it by default. Lock a version once it's agreed; a later change is a new \"revised\" version copied from it."),
        if (_error != null) padded(ErrorBanner(_error!)),
        padded(Row(children: [
          Expanded(
            child: AppSelect<String>(
              label: 'Financial year',
              value: _fy,
              clearable: false,
              options: [for (final f in _fyOptions()) Option(f, f)],
              onChanged: (o) {
                _fy = o?.value ?? _fy;
                _selected = null;
                _loadVersions();
              },
            ),
          ),
          const SizedBox(width: 8),
          if (actions.isNotEmpty)
            PopupMenuButton<int>(
              icon: const Icon(Icons.more_vert_rounded),
              onSelected: (i) => actions[i].$2(),
              itemBuilder: (_) => [for (var i = 0; i < actions.length; i++) PopupMenuItem(value: i, child: Text(actions[i].$1))],
            ),
        ])),
        padded(AppSelect<int>(
          label: 'Plan version',
          value: _selected,
          valueLabel: _versions.isEmpty ? 'No versions for $_fy' : null,
          options: [
            for (final x in _versions)
              Option(toInt(x['id'])!, '${x['code']} — ${x['name']}', subtitle: '${x['version_type']}${x['is_primary'] == true ? ', primary' : ''}'),
          ],
          onChanged: (o) {
            if (_dirty) showSnack(context, 'Unsaved plan changes were dropped.');
            _selected = o?.value;
            _loadGrid();
          },
        )),
        if (v != null) padded(Align(alignment: Alignment.centerLeft, child: _pill(v['status']))),
        if (g != null) ...[
          if (_rows.isEmpty)
            EmptyView(editable ? 'No plan yet — add a row below, or upload the Excel template.' : 'No plan lines in this version.'),
          for (var i = 0; i < _rows.length; i++)
            RecordCard(
              code: '${_rows[i]['cost_center_code']} — ${_rows[i]['cost_center_name']}',
              title: '${_rows[i]['gl_account_code']} — ${_rows[i]['gl_account_name']}',
              meta: [
                for (var k = 0; k < periods.length; k++)
                  if (toD(asJson(_rows[i]['amounts'])[periods[k]]) != 0) (labels.length > k ? labels[k] : periods[k], inr(asJson(_rows[i]['amounts'])[periods[k]])),
                ('Total', inr(_rowTotal(_rows[i]))),
              ],
              trailing: editable
                  ? IconButton(
                      tooltip: 'Remove',
                      icon: const Icon(Icons.delete_outline_rounded, color: Brand.danger),
                      onPressed: () => setState(() {
                            _rows.removeAt(i);
                            _dirty = true;
                          }))
                  : null,
              onTap: () => _editRow(i),
            ),
          if (_rows.isNotEmpty)
            DetailSection('Total', children: [
              for (var k = 0; k < periods.length; k++) AmountRow(labels.length > k ? labels[k] : periods[k], inr(periodTotals[periods[k]])),
              AmountRow('Total', inr(periodTotals.values.fold<double>(0, (a, b) => a + b)), bold: true),
            ]),
        ],
      ]),
    );
  }
}

// ── Plan vs actual ───────────────────────────────────────────────────────────

class _PlanVsActual extends StatefulWidget {
  const _PlanVsActual();

  @override
  State<_PlanVsActual> createState() => _PlanVsActualState();
}

class _PlanVsActualState extends State<_PlanVsActual> {
  String _fy = _currentFy();
  int? _version;
  String? _from;
  String? _to;
  int? _cc;
  String? _ccL;

  List<String> get _months {
    final y = int.parse(_fy.substring(0, 4));
    return [
      for (var i = 0; i < 12; i++)
        () {
          final m = ((3 + i) % 12) + 1;
          final yy = m >= 4 ? y : y + 1;
          return '$yy-${m.toString().padLeft(2, '0')}';
        }(),
    ];
  }

  @override
  Widget build(BuildContext context) => ListView(padding: const EdgeInsets.only(bottom: 24), children: [
        const InfoBanner(
            'Variance = actual − plan. On a cost, a positive variance is an overspend (red); on income it is a shortfall. Actuals are posted journal lines carrying the cost centre, including CO allocations.'),
        padded(AppSelect<String>(
          label: 'Financial year',
          value: _fy,
          clearable: false,
          options: [for (final f in _fyOptions()) Option(f, f)],
          onChanged: (o) => setState(() {
            _fy = o?.value ?? _fy;
            _version = null;
            _from = _to = null;
          }),
        )),
        ApiLoader<List<Json>>(
          key: ValueKey('v$_fy'),
          load: () async => asRows(await Api.get('$_b/plan-versions', query: {'financial_year': _fy})),
          builder: (ctx, versions, _) {
            final def = versions.where((x) => x['is_primary'] == true).firstOrNull ?? versions.firstOrNull;
            final vid = _version ?? toInt(def?['id']);
            return Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
              padded(AppSelect<int>(
                label: 'Plan version',
                value: vid,
                valueLabel: versions.isEmpty ? 'No versions for $_fy' : null,
                clearable: false,
                options: [
                  for (final v in versions) Option(toInt(v['id'])!, '${v['code']} — ${v['name']}${v['is_primary'] == true ? ' (primary)' : ''}'),
                ],
                onChanged: (o) => setState(() => _version = o?.value),
              )),
              padded(Row(children: [
                Expanded(
                    child: AppSelect<String>(
                        label: 'From month',
                        value: _from,
                        valueLabel: _from ?? 'FY start',
                        options: [for (final m in _months) Option(m, periodLabel(m))],
                        onChanged: (o) => setState(() => _from = o?.value))),
                const SizedBox(width: 8),
                Expanded(
                    child: AppSelect<String>(
                        label: 'To month',
                        value: _to,
                        valueLabel: _to ?? 'FY end',
                        options: [for (final m in _months) Option(m, periodLabel(m))],
                        onChanged: (o) => setState(() => _to = o?.value))),
              ])),
              padded(AppSelect<int>(
                label: 'Cost centre (with sub-centres)',
                value: _cc,
                valueLabel: _ccL ?? 'All cost centres',
                loadOptions: _ccOptions,
                onChanged: (o) => setState(() {
                  _cc = o?.value;
                  _ccL = o?.label;
                }),
              )),
              if (vid == null)
                const EmptyView('Pick a plan version.')
              else
                ApiLoader<Json>(
                  key: ValueKey('pva$vid$_from$_to$_cc'),
                  load: () async => asJson(await Api.get('$_b/plan-vs-actual',
                      query: {'version_id': vid, 'from_period': _from, 'to_period': _to, 'cost_center_id': _cc})),
                  builder: (c2, d, _) {
                    final rows = listOf(d['rows']);
                    return Column(children: [
                      StatGrid([
                        StatCard('Plan', inr(d['total_plan'])),
                        StatCard('Actual', inr(d['total_actual'])),
                        StatCard('Variance', inr(d['total_variance']), tone: toD(d['total_variance']) > 0 ? _red : _green),
                        StatCard('Variance %', d['total_variance_pct'] == null ? '—' : '${d['total_variance_pct']}%'),
                      ]),
                      if (rows.isEmpty) const EmptyView('No plan or actuals for this selection.'),
                      for (final r in rows)
                        () {
                          final bad = r['account_type'] == 'expense' ? toD(r['variance']) > 0 : toD(r['variance']) < 0;
                          return RecordCard(
                            code: '${r['cost_center_code']} — ${r['cost_center_name']}',
                            title: '${r['gl_account_code']} — ${r['gl_account_name']}',
                            trailing: StatusBadge(inr(r['variance']), color: bad ? _red : _green),
                            meta: [
                              ('Plan', inr(r['plan'])),
                              ('Actual', inr(r['actual'])),
                              ('Var. %', r['variance_pct'] == null ? '—' : '${r['variance_pct']}%'),
                            ],
                          );
                        }(),
                    ]);
                  },
                ),
            ]);
          },
        ),
      ]);
}

// ── Activity rates ───────────────────────────────────────────────────────────

class _Rates extends StatefulWidget {
  const _Rates();

  @override
  State<_Rates> createState() => _RatesState();
}

class _RatesState extends State<_Rates> {
  int _tick = 0;

  Future<void> _form({Json? r}) async {
    List<Json> types = [];
    try {
      types = asRows(await Api.get('$_b/activity-types'));
    } catch (_) {}
    String type = '${r?['activity_type'] ?? (types.isNotEmpty ? types.first['value'] : 'MCH')}';
    String object = r == null || r['workstation_id'] != null ? 'workstation' : 'cost_center';
    int? ws = toInt(r?['workstation_id']);
    String? wsL = r?['workstation_label'] as String?;
    int? cc = toInt(r?['cost_center_id']);
    String? ccL = r?['cost_center_label'] as String?;
    DateTime? from = isoToDate(r?['valid_from']);
    DateTime? to = isoToDate(r?['valid_to']);
    final fixed = TextEditingController(text: r == null ? '' : '${r['fixed_rate']}');
    final variable = TextEditingController(text: r == null ? '' : '${r['variable_rate']}');
    final notes = TextEditingController(text: '${r?['notes'] ?? ''}');
    if (!mounted) return;
    final ok = await showFormSheet(
      context,
      title: r != null ? 'Edit activity rate' : 'Add activity rate',
      builder: (ctx, setS) => [
        const Text('Hour rate for production costing, valid within one financial year.', style: TextStyle(color: Brand.muted)),
        const Caps('Activity'),
        AppSelect<String>(
            label: 'Activity type',
            required: true,
            value: type,
            clearable: false,
            options: [for (final t in types) Option('${t['value']}', '${t['value']} — ${t['label']}')],
            onChanged: (o) => setS(() => type = o?.value ?? type)),
        AppSelect<String>(
            label: 'Rate for',
            required: true,
            value: object,
            clearable: false,
            options: const [Option('workstation', 'Workstation'), Option('cost_center', 'Cost centre')],
            onChanged: (o) => setS(() => object = o?.value ?? object)),
        if (object == 'workstation')
          AppSelect<int>(
            label: 'Workstation',
            required: true,
            value: ws,
            valueLabel: wsL,
            loadOptions: (q) async {
              final rows = asRows(await Api.get('/production/workstations'));
              return [
                for (final w in rows)
                  if (q.isEmpty || '${w['code']} ${w['name']}'.toLowerCase().contains(q.toLowerCase())) Option(toInt(w['id'])!, '${w['code']} — ${w['name']}'),
              ];
            },
            onChanged: (o) => setS(() {
              ws = o?.value;
              wsL = o?.label;
            }),
          )
        else
          AppSelect<int>(
              label: 'Cost centre',
              required: true,
              value: cc,
              valueLabel: ccL,
              loadOptions: _ccOptions,
              onChanged: (o) => setS(() {
                    cc = o?.value;
                    ccL = o?.label;
                  })),
        const Caps('Rate & validity'),
        DateField(label: 'Valid from', required: true, value: from, onChanged: (d) => setS(() => from = d)),
        DateField(label: 'Valid to', value: to, onChanged: (d) => setS(() => to = d)),
        AppTextField(label: 'Fixed ₹/h', controller: fixed, keyboardType: AppTextField.number),
        AppTextField(label: 'Variable ₹/h', controller: variable, keyboardType: AppTextField.number),
        AppTextField(label: 'Notes', controller: notes),
      ],
      onSave: () async {
        final payload = {
          'activity_type': type,
          'workstation_id': object == 'workstation' ? ws : null,
          'cost_center_id': object == 'cost_center' ? cc : null,
          'valid_from': dateOrNull(from),
          'valid_to': dateOrNull(to),
          'fixed_rate': double.tryParse(fixed.text) ?? 0,
          'variable_rate': double.tryParse(variable.text) ?? 0,
          'notes': notes.text.trim().isEmpty ? null : notes.text.trim(),
        };
        if (r != null) {
          await Api.put('$_b/activity-rates/${r['id']}', data: payload);
        } else {
          await Api.post('$_b/activity-rates', data: payload);
        }
      },
    );
    if (ok) setState(() => _tick++);
  }

  @override
  Widget build(BuildContext context) => Scaffold(
        backgroundColor: Colors.transparent,
        floatingActionButton: finCan('activity_rates', 'create') ? CreateFab(label: 'Add rate', onPressed: () => _form()) : null,
        body: ApiLoader<List<Json>>(
          key: ValueKey(_tick),
          load: () async => asRows(await Api.get('$_b/activity-rates')),
          builder: (ctx, rows, _) => ListView(padding: const EdgeInsets.only(bottom: 88), children: [
            const InfoBanner(
                "Activity prices for production costing. A time log is costed at the rate valid on its date: the workstation's own rate, else its cost centre's, else the workstation's flat hourly rate. A plain hour (no activity type) costs machine + labour hour. Rates belong to one financial year; fixed vs variable split shows how much is capacity cost."),
            if (rows.isEmpty) const EmptyView("No activity rates yet — production uses each workstation's flat hourly rate until you add some."),
            for (final r in rows)
              RecordCard(
                code: '${r['activity_type']} ${r['activity_label'] ?? ''}',
                title: '${r['workstation_label'] ?? r['cost_center_label']}${r['workstation_label'] != null ? ' (workstation)' : ' (cost centre)'}',
                meta: [
                  ('FY', txt(r['financial_year'])),
                  ('Valid', '${fmtDate(r['valid_from'])} → ${r['valid_to'] != null ? fmtDate(r['valid_to']) : 'open'}'),
                  ('Fixed ₹/h', inr(r['fixed_rate'])),
                  ('Variable ₹/h', inr(r['variable_rate'])),
                  ('Rate ₹/h', inr(r['rate'])),
                  ('Fixed %', '${r['fixed_share_pct']}%'),
                ],
                onTap: () => showModalBottomSheet<void>(
                  context: ctx,
                  builder: (s) => SafeArea(
                    child: Column(mainAxisSize: MainAxisSize.min, children: [
                      if (finCan('activity_rates', 'edit'))
                        ListTile(title: const Text('Edit'), onTap: () {
                          Navigator.pop(s);
                          _form(r: r);
                        }),
                      if (finCan('activity_rates', 'delete'))
                        ListTile(
                          title: const Text('Delete', style: TextStyle(color: Brand.danger)),
                          onTap: () async {
                            Navigator.pop(s);
                            final ok = await confirmDialog(context,
                                title: 'Delete activity rate?',
                                message:
                                    'The ${r['activity_type']} rate of ${r['workstation_label'] ?? r['cost_center_label']} will be deleted. Time logs already booked keep the rate they were booked at.',
                                confirmLabel: 'Delete',
                                danger: true);
                            if (ok && context.mounted && await runAction(context, () => Api.delete('$_b/activity-rates/${r['id']}'))) setState(() => _tick++);
                          },
                        ),
                    ]),
                  ),
                ),
              ),
          ]),
        ),
      );
}

// ── Allocations ──────────────────────────────────────────────────────────────

class _Seg {
  _Seg([Json? s])
      : name = TextEditingController(text: '${s?['name'] ?? ''}'),
        sender = toInt(s?['sender_cost_center_id']),
        senderL = s?['sender_label'] as String?,
        ledgers = [for (final g in (s?['sender_gl_account_ids'] is List ? s!['sender_gl_account_ids'] as List : const [])) toInt(g)!],
        basis = '${s?['basis'] ?? 'fixed_percent'}',
        activity = s?['activity_type'] as String?,
        receivers = [
          for (final r in listOf(s?['receivers']))
            (toInt(r['cost_center_id']), r['label'] as String?, TextEditingController(text: r['percent'] == null ? '' : '${r['percent']}')),
        ] {
    if (receivers.isEmpty) receivers.add((null, null, TextEditingController()));
  }
  final TextEditingController name;
  int? sender;
  String? senderL;
  final List<int> ledgers;
  String basis;
  String? activity;
  final List<(int?, String?, TextEditingController)> receivers;
}

class _Allocations extends StatefulWidget {
  const _Allocations();

  @override
  State<_Allocations> createState() => _AllocationsState();
}

class _AllocationsState extends State<_Allocations> {
  String _period = currentPeriod();
  int _tick = 0;

  bool get _canApprove => finCan('allocations', 'approve');

  Future<void> _testRun(Json c) async {
    Json res;
    try {
      res = asJson(await Api.post('$_b/allocation-cycles/${c['id']}/run', data: {'period': _period, 'test_run': true}));
    } catch (e) {
      if (mounted) showSnack(context, 'Test run of ${c['code']} failed. ${ApiClient.describe(e)}', error: true);
      return;
    }
    if (!mounted) return;
    final canPost = _canApprove && res['already_posted_run_id'] == null && toD(res['total_amount']) > 0;
    await openScreen(
      context,
      SubPage(
        title: 'Test run — ${c['code']} · ${res['period']}',
        bottom: canPost
            ? ActionBar([
                actionBtn('Post allocation', () async {
                  try {
                    final r = asJson(await Api.post('$_b/allocation-cycles/${c['id']}/run', data: {'period': _period, 'test_run': false}));
                    if (!mounted) return;
                    Navigator.of(context).pop();
                    showSnack(context, '${c['code']} $_period posted as ${r['entry_number']} (${inr(r['total_amount'])}).');
                    setState(() => _tick++);
                  } catch (e) {
                    if (mounted) showSnack(context, 'Could not post the allocation. ${ApiClient.describe(e)}', error: true);
                  }
                }, primary: true),
              ])
            : null,
        body: ListView(padding: const EdgeInsets.only(top: 12, bottom: 24), children: [
          StatGrid([StatCard('Amount', inr(res['total_amount']))]),
          if (res['already_posted_run_id'] != null)
            InfoBanner('This cycle is already posted for ${res['period']}. Reverse that run below before posting again.', tone: Tone.warning),
          for (final m in (res['messages'] is List ? res['messages'] as List : const [])) InfoBanner('$m', tone: Tone.warning),
          for (final s in listOf(res['segments']))
            DetailSection('${s['name']}: ${s['sender_label']} sends ${inr(s['allocated'])} of ${inr(s['sender_amount'])} (${_basisLabels['${s['basis']}'] ?? s['basis']})',
                children: [
                  for (final r in listOf(s['receivers']))
                    AmountRow('${r['label']} · basis ${r['basis_value']} · ${toD(r['share_pct']).toStringAsFixed(2)}%', inr(r['amount'])),
                ]),
        ]),
      ),
    );
  }

  Future<void> _form({Json? c}) async {
    final code = TextEditingController(text: '${c?['code'] ?? ''}');
    final name = TextEditingController(text: '${c?['name'] ?? ''}');
    String method = '${c?['method'] ?? 'distribution'}';
    int? assess = toInt(c?['assessment_gl_account_id']);
    String? assessL = c?['assessment_gl_label'] as String?;
    String status = '${c?['status'] ?? 'active'}';
    DateTime? from = isoToDate(c?['valid_from']);
    DateTime? to = isoToDate(c?['valid_to']);
    final segs = c == null ? [_Seg()] : [for (final s in listOf(c['segments'])) _Seg(s)];
    if (segs.isEmpty) segs.add(_Seg());
    final ok = await showFormSheet(
      context,
      title: c != null ? 'Edit cycle ${c['code']}' : 'New allocation cycle',
      saveLabel: 'Save cycle',
      builder: (ctx, setS) => [
        const Text("Move a month's actual cost from service cost centres to the cost centres that use them.", style: TextStyle(color: Brand.muted)),
        const Caps('Cycle'),
        AppTextField(label: 'Code', required: true, controller: code, hint: 'DIST-ADMIN'),
        AppTextField(label: 'Name', required: true, controller: name),
        AppSelect<String>(
            label: 'Method',
            required: true,
            value: method,
            clearable: false,
            options: const [Option('distribution', 'Distribution'), Option('assessment', 'Assessment')],
            onChanged: (o) => setS(() => method = o?.value ?? method)),
        if (method == 'assessment')
          AppSelect<int>(
              label: 'Assessment ledger',
              required: true,
              value: assess,
              valueLabel: assessL,
              loadOptions: (q) => _plOptions(q, expenseOnly: true),
              onChanged: (o) => setS(() {
                    assess = o?.value;
                    assessL = o?.label;
                  })),
        AppSelect<String>(
            label: 'Status',
            value: status,
            clearable: false,
            options: const [Option('active', 'Active'), Option('inactive', 'Inactive')],
            onChanged: (o) => setS(() => status = o?.value ?? status)),
        DateField(label: 'Valid from', value: from, onChanged: (d) => setS(() => from = d)),
        DateField(label: 'Valid to', value: to, onChanged: (d) => setS(() => to = d)),
        Row(children: [
          const Caps('Segments'),
          const Spacer(),
          TextButton(onPressed: () => setS(() => segs.add(_Seg())), child: const Text('+ Add segment')),
        ]),
        for (var i = 0; i < segs.length; i++)
          Container(
            padding: const EdgeInsets.all(10),
            decoration: BoxDecoration(border: Border.all(color: Brand.border), borderRadius: BorderRadius.circular(12), color: Brand.background),
            child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
              Row(children: [
                Expanded(child: AppTextField(label: 'Segment ${i + 1} name', controller: segs[i].name)),
                if (segs.length > 1)
                  IconButton(icon: const Icon(Icons.delete_outline_rounded, color: Brand.danger), onPressed: () => setS(() => segs.removeAt(i))),
              ]),
              const SizedBox(height: 8),
              AppSelect<int>(
                  label: 'Sender cost centre',
                  required: true,
                  value: segs[i].sender,
                  valueLabel: segs[i].senderL,
                  loadOptions: _ccOptions,
                  onChanged: (o) => setS(() {
                        segs[i].sender = o?.value;
                        segs[i].senderL = o?.label;
                      })),
              const SizedBox(height: 8),
              AppSelect<String>(
                  label: 'Basis',
                  value: segs[i].basis,
                  clearable: false,
                  options: [for (final e in _basisLabels.entries) Option(e.key, e.value)],
                  onChanged: (o) => setS(() => segs[i].basis = o?.value ?? segs[i].basis)),
              if (segs[i].basis == 'activity_hours') ...[
                const SizedBox(height: 8),
                AppSelect<String>(
                    label: 'Activity',
                    value: segs[i].activity,
                    valueLabel: segs[i].activity ?? 'All',
                    options: const [Option('MCH', 'MCH'), Option('LAB', 'LAB'), Option('SET', 'SET')],
                    onChanged: (o) => setS(() => segs[i].activity = o?.value)),
              ],
              const SizedBox(height: 8),
              Text('Sender ledgers (blank = every expense ledger)', style: const TextStyle(fontSize: 12, color: Brand.muted)),
              Wrap(spacing: 6, children: [
                for (final g in segs[i].ledgers)
                  InputChip(label: Text(FinLookups.ledgerLabel(g)), onDeleted: () => setS(() => segs[i].ledgers.remove(g))),
              ]),
              AppSelect<int>(
                  label: '+ Add ledger',
                  value: null,
                  loadOptions: (q) => _plOptions(q, expenseOnly: true),
                  onChanged: (o) => setS(() {
                        if (o != null && !segs[i].ledgers.contains(o.value)) segs[i].ledgers.add(o.value);
                      })),
              const SizedBox(height: 8),
              const Caps('Receivers *'),
              for (var k = 0; k < segs[i].receivers.length; k++)
                Padding(
                  padding: const EdgeInsets.only(top: 6),
                  child: Row(children: [
                    Expanded(
                      child: AppSelect<int>(
                          label: 'Receiver cost centre',
                          value: segs[i].receivers[k].$1,
                          valueLabel: segs[i].receivers[k].$2,
                          loadOptions: _ccOptions,
                          onChanged: (o) => setS(() => segs[i].receivers[k] = (o?.value, o?.label, segs[i].receivers[k].$3))),
                    ),
                    if (segs[i].basis == 'fixed_percent') ...[
                      const SizedBox(width: 6),
                      SizedBox(width: 80, child: AppTextField(label: '%', controller: segs[i].receivers[k].$3, keyboardType: AppTextField.number)),
                    ],
                    IconButton(icon: const Icon(Icons.close_rounded, color: Brand.danger), onPressed: () => setS(() => segs[i].receivers.removeAt(k))),
                  ]),
                ),
              Align(
                alignment: Alignment.centerLeft,
                child: TextButton(
                    onPressed: () => setS(() => segs[i].receivers.add((null, null, TextEditingController()))), child: const Text('+ Add receiver')),
              ),
            ]),
          ),
      ],
      onSave: () async {
        final payload = {
          'code': code.text.trim(),
          'name': name.text.trim(),
          'method': method,
          'assessment_gl_account_id': method == 'assessment' ? assess : null,
          'valid_from': dateOrNull(from),
          'valid_to': dateOrNull(to),
          'status': status,
          'notes': c?['notes'],
          'segments': [
            for (final s in segs)
              {
                'name': s.name.text.trim(),
                'sender_cost_center_id': s.sender ?? 0,
                'sender_gl_account_ids': s.ledgers,
                'basis': s.basis,
                'activity_type': s.basis == 'activity_hours' ? s.activity : null,
                'receivers': [
                  for (final r in s.receivers)
                    if (r.$1 != null) {'cost_center_id': r.$1, 'percent': s.basis == 'fixed_percent' ? double.tryParse(r.$3.text) ?? 0 : null},
                ],
              },
          ],
        };
        if (c != null) {
          await Api.put('$_b/allocation-cycles/${c['id']}', data: payload);
        } else {
          await Api.post('$_b/allocation-cycles', data: payload);
        }
      },
    );
    if (ok) setState(() => _tick++);
  }

  @override
  Widget build(BuildContext context) => Scaffold(
        backgroundColor: Colors.transparent,
        floatingActionButton: finCan('allocations', 'create') ? CreateFab(label: 'New cycle', onPressed: () => _form()) : null,
        body: ListView(padding: const EdgeInsets.only(bottom: 88), children: [
          const InfoBanner(
              "Cycles move a month's actual cost from service cost centres (admin, maintenance, stores…) to the cost centres that use them. Distribution moves each ledger as it is; assessment moves the total on one assessment ledger. P&L totals never change. Always test-run first; a posted run is one journal you can reverse and run again."),
          FinPeriodPicker(period: _period, label: 'Period', onChanged: (p) => setState(() => _period = p)),
          ApiLoader<List<Json>>(
            key: ValueKey('c$_tick'),
            load: () async => asRows(await Api.get('$_b/allocation-cycles')),
            builder: (ctx, cycles, _) => Column(children: [
              if (cycles.isEmpty) const EmptyView("No allocation cycles yet — use + New cycle to share a cost centre's costs out to others."),
              for (final c in cycles)
                RecordCard(
                  code: '${c['code']}',
                  title: '${c['name']}',
                  subtitle: [
                    '${c['method_label'] ?? c['method']}${c['assessment_gl_label'] != null ? ' · ${c['assessment_gl_label']}' : ''}',
                    for (final s in listOf(c['segments']))
                      '${s['sender_label']} → ${listOf(s['receivers']).map((r) => r['label']).join(', ')} (${_basisLabels['${s['basis']}'] ?? s['basis']})',
                  ].join('\n'),
                  trailing: _pill(c['status']),
                  meta: [('Last posted', txt(c['last_posted_period']))],
                  onTap: () => showModalBottomSheet<void>(
                    context: ctx,
                    builder: (s) => SafeArea(
                      child: Column(mainAxisSize: MainAxisSize.min, children: [
                        ListTile(title: Text('Test run $_period'), onTap: () {
                          Navigator.pop(s);
                          _testRun(c);
                        }),
                        if (finCan('allocations', 'edit'))
                          ListTile(title: const Text('Edit'), onTap: () {
                            Navigator.pop(s);
                            _form(c: c);
                          }),
                        if (finCan('allocations', 'delete'))
                          ListTile(
                            title: const Text('Delete', style: TextStyle(color: Brand.danger)),
                            onTap: () async {
                              Navigator.pop(s);
                              final ok = await confirmDialog(context,
                                  title: 'Delete cycle?',
                                  message: "Cycle ${c['code']} will be deleted. A cycle that has been run can't be deleted — set it Inactive instead.",
                                  confirmLabel: 'Delete',
                                  danger: true);
                              if (ok && context.mounted && await runAction(context, () => Api.delete('$_b/allocation-cycles/${c['id']}'))) {
                                setState(() => _tick++);
                              }
                            },
                          ),
                      ]),
                    ),
                  ),
                ),
            ]),
          ),
          const SectionTitle('Runs'),
          ApiLoader<List<Json>>(
            key: ValueKey('r$_tick'),
            load: () async => asRows(await Api.get('$_b/allocation-runs')),
            builder: (ctx, runs, _) => Column(children: [
              if (runs.isEmpty) const EmptyView('No runs posted yet.'),
              for (final r in runs)
                RecordCard(
                  code: '${r['entry_number'] ?? ''}${r['reversal_entry_number'] != null ? ' · reversed by ${r['reversal_entry_number']}' : ''}',
                  title: '${r['cycle_code']} — ${r['cycle_name']}',
                  subtitle: r['reversal_reason'] as String?,
                  trailing: _pill(r['status']),
                  meta: [('Period', '${r['accounting_period']}'), ('Amount', inr(r['total_amount']))],
                  onTap: () => showModalBottomSheet<void>(
                    context: ctx,
                    builder: (s) => SafeArea(
                      child: Column(mainAxisSize: MainAxisSize.min, children: [
                        if (r['journal_entry_id'] != null)
                          ListTile(title: const Text('Open voucher'), onTap: () {
                            Navigator.pop(s);
                            openScreen(context, FinVoucherScreen(entryId: toInt(r['journal_entry_id'])!));
                          }),
                        if (finCanFeature('allocations', 'reversal', 'cancel') && r['status'] == 'posted')
                          ListTile(
                            title: const Text('Reverse', style: TextStyle(color: Brand.danger)),
                            onTap: () async {
                              Navigator.pop(s);
                              final reason = await promptDialog(context,
                                  title: 'Reverse allocation run',
                                  message:
                                      'Posts a reversal of ${r['entry_number']} dated the same day, putting the cost back on the senders. You can then run the cycle again.',
                                  confirmLabel: 'Reverse');
                              if (reason != null && context.mounted &&
                                  await runAction(context, () => Api.post('$_b/allocation-runs/${r['id']}/reverse', data: {'reason': reason}),
                                      success: 'Run ${r['cycle_code']} ${r['accounting_period']} reversed.')) {
                                setState(() => _tick++);
                              }
                            },
                          ),
                      ]),
                    ),
                  ),
                ),
            ]),
          ),
        ]),
      );
}

// ── Overhead ─────────────────────────────────────────────────────────────────

class _Overhead extends StatefulWidget {
  const _Overhead();

  @override
  State<_Overhead> createState() => _OverheadState();
}

class _OverheadState extends State<_Overhead> {
  String _period = currentPeriod();
  int _tick = 0;
  Json? _preview;
  bool _busy = false;

  Future<void> _run(bool test) async {
    setState(() => _busy = true);
    try {
      final r = asJson(await Api.post('$_b/overhead-runs', data: {'period': _period, 'test_run': test}));
      setState(() {
        if (test) {
          _preview = r;
        } else {
          _preview = null;
          _tick++;
        }
      });
      if (!test && mounted) showSnack(context, 'Overhead for $_period applied to ${listOf(r['rows']).length} work order(s): ${inr(r['total_overhead'])}.');
    } catch (e) {
      if (mounted) showSnack(context, 'The overhead run failed. ${ApiClient.describe(e)}', error: true);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _form({Json? r}) async {
    int? branch = toInt(r?['branch_id']);
    String? branchL = r?['branch_name'] as String?;
    DateTime? from = isoToDate(r?['valid_from']);
    DateTime? to = isoToDate(r?['valid_to']);
    final mat = TextEditingController(text: r == null ? '' : '${r['material_overhead_pct']}');
    final lab = TextEditingController(text: r == null ? '' : '${r['labour_overhead_pct']}');
    final notes = TextEditingController(text: '${r?['notes'] ?? ''}');
    final ok = await showFormSheet(
      context,
      title: r != null ? 'Edit costing-sheet row' : 'Add costing-sheet row',
      builder: (ctx, setS) => [
        const Text('Overhead % on material and on labour / machine cost, per plant.', style: TextStyle(color: Brand.muted)),
        AppSelect<int>(
          label: 'Plant',
          value: branch,
          valueLabel: branchL ?? 'All plants',
          loadOptions: (q) async {
            final rows = asRows(await Api.get('/organization/branches'));
            return [for (final b in rows) if (q.isEmpty || '${b['name']}'.toLowerCase().contains(q.toLowerCase())) Option(toInt(b['id'])!, '${b['name']}')];
          },
          onChanged: (o) => setS(() {
            branch = o?.value;
            branchL = o?.label;
          }),
        ),
        const Text('A row without a plant applies to every plant without its own.', style: TextStyle(fontSize: 12, color: Brand.muted)),
        DateField(label: 'Valid from', value: from, onChanged: (d) => setS(() => from = d)),
        DateField(label: 'Valid to', value: to, onChanged: (d) => setS(() => to = d)),
        AppTextField(label: 'Material overhead %', controller: mat, keyboardType: AppTextField.number),
        AppTextField(label: 'Labour overhead %', controller: lab, keyboardType: AppTextField.number),
        AppTextField(label: 'Notes (how the % was derived)', controller: notes),
      ],
      onSave: () async {
        final payload = {
          'branch_id': branch,
          'valid_from': dateOrNull(from),
          'valid_to': dateOrNull(to),
          'material_overhead_pct': double.tryParse(mat.text) ?? 0,
          'labour_overhead_pct': double.tryParse(lab.text) ?? 0,
          'notes': notes.text.trim().isEmpty ? null : notes.text.trim(),
        };
        if (r != null) {
          await Api.put('$_b/costing-sheet/${r['id']}', data: payload);
        } else {
          await Api.post('$_b/costing-sheet', data: payload);
        }
      },
    );
    if (ok) setState(() => _tick++);
  }

  @override
  Widget build(BuildContext context) {
    final p = _preview;
    return ListView(padding: const EdgeInsets.only(bottom: 24), children: [
      const InfoBanner(
          "The costing sheet puts production overhead on work orders: a % on material and a % on labour/machine cost, per plant (a row without a plant applies to every plant without its own). The month-end run adds it to each order's actual cost — so it is in WIP and in finished-goods cost. BOM standard cost and work-order estimates show the same overhead. Nothing is posted to the ledger (periodic inventory)."),
      SectionTitle('Costing sheet', action: finCan('overhead', 'create') ? TextButton(onPressed: () => _form(), child: const Text('+ Add row')) : null),
      ApiLoader<List<Json>>(
        key: ValueKey('s$_tick'),
        load: () async => asRows(await Api.get('$_b/costing-sheet')),
        builder: (ctx, sheet, _) => Column(children: [
          if (sheet.isEmpty) const EmptyView('No costing-sheet rows — work orders carry no overhead.'),
          for (final r in sheet)
            RecordCard(
              title: '${r['branch_name'] ?? 'All plants'}',
              subtitle: r['notes'] as String?,
              meta: [
                ('Valid', '${fmtDate(r['valid_from'])} → ${r['valid_to'] != null ? fmtDate(r['valid_to']) : 'open'}'),
                ('Material overhead', '${r['material_overhead_pct']}%'),
                ('Labour overhead', '${r['labour_overhead_pct']}%'),
              ],
              onTap: finCan('overhead', 'edit') ? () => _form(r: r) : null,
            ),
        ]),
      ),
      FinPeriodPicker(period: _period, label: 'Period', onChanged: (v) => setState(() {
            _period = v;
            _preview = null;
          })),
      padded(Wrap(spacing: 8, children: [
        actionBtn('Test run', _busy ? null : () => _run(true)),
        if (finCan('overhead', 'approve') && p != null && p['period'] == _period && p['already_posted_run_id'] == null && listOf(p['rows']).isNotEmpty)
          actionBtn('Apply overhead for $_period', _busy ? null : () => _run(false), primary: true),
      ])),
      if (p != null) ...[
        if (p['already_posted_run_id'] != null)
          InfoBanner('Overhead is already applied for ${p['period']}. Reverse that run below to apply it again.', tone: Tone.warning),
        for (final m in (p['messages'] is List ? p['messages'] as List : const [])) InfoBanner('$m', tone: Tone.warning),
        if (listOf(p['rows']).isEmpty) EmptyView('No work order gets overhead for ${p['period']}.'),
        for (final r in listOf(p['rows']))
          RecordCard(
            code: '${r['wo_number']}',
            title: 'Overhead ${inr(r['amount'])}',
            meta: [
              ('Material', inr(r['material_base'])),
              ('Mat. %', '${r['material_overhead_pct']}%'),
              ('Labour', inr(r['labour_base'])),
              ('Lab. %', '${r['labour_overhead_pct']}%'),
            ],
          ),
        if (listOf(p['rows']).isNotEmpty) DetailSection('Total', children: [AmountRow('Overhead', inr(p['total_overhead']), bold: true)]),
      ],
      const SectionTitle('Overhead runs'),
      ApiLoader<List<Json>>(
        key: ValueKey('runs$_tick'),
        load: () async => asRows(await Api.get('$_b/overhead-runs')),
        builder: (ctx, runs, _) => Column(children: [
          if (runs.isEmpty) const EmptyView('No overhead runs yet.'),
          for (final r in runs)
            RecordCard(
              title: periodLabel('${r['accounting_period']}'),
              subtitle: r['reversal_reason'] as String?,
              trailing: _pill(r['status']),
              meta: [('Orders', '${r['order_count']}'), ('Overhead', inr(r['total_overhead']))],
              onTap: finCanFeature('overhead', 'reversal', 'cancel') && r['status'] == 'posted'
                  ? () async {
                      final reason = await promptDialog(context,
                          title: 'Reverse overhead run',
                          message: 'Takes the ${r['accounting_period']} overhead back off every work order. Blocked once that period is closed.',
                          confirmLabel: 'Reverse');
                      if (reason != null && context.mounted &&
                          await runAction(context, () => Api.post('$_b/overhead-runs/${r['id']}/reverse', data: {'reason': reason}),
                              success: 'Overhead ${r['accounting_period']} reversed.')) {
                        setState(() => _tick++);
                      }
                    }
                  : null,
            ),
        ]),
      ),
    ]);
  }
}
