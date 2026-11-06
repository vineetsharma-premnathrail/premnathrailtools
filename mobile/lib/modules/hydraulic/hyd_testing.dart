import 'package:flutter/material.dart';

import '../../api/api.dart';
import '../../theme.dart';
import '../../ui/app_frame.dart';
import '../../ui/form.dart';
import '../../ui/format.dart';
import '../../ui/widgets.dart';
import 'hyd_common.dart';
import 'hyd_panels.dart';

// Portal: /dashboard/hydraulic/testing (+ /new, /[id]) and components/hydraulic/TestForm.tsx.

const testStatusLabels = {'planned': 'Planned', 'in_progress': 'In Progress', 'under_review': 'Awaiting Sign-off', 'completed': 'Completed'};
const testStatusHex = {'planned': '#2563EB', 'in_progress': '#F59E0B', 'under_review': '#9333EA', 'completed': '#16A34A'};
const _readingLabels = {'pass': 'Pass', 'fail': 'Fail', 'na': 'N/A'};
const _readingHex = {'pass': '#16A34A', 'fail': '#DC2626', 'na': '#78716c'};

class HydTestsList extends StatefulWidget {
  const HydTestsList({super.key});

  @override
  State<HydTestsList> createState() => _HydTestsListState();
}

class _HydTestsListState extends State<HydTestsList> {
  final _list = GlobalKey<ApiListViewState>();
  final _vis = HydVis('hydraulic:testing');
  String _medium = '';
  String _type = '';
  String _status = '';
  String _result = '';
  int? _count;

  void _refilter(VoidCallback f) {
    setState(f);
    _list.currentState?.reload();
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: Colors.transparent,
      floatingActionButton: hydCan('testing', 'create')
          ? CreateFab(
              label: 'New Test',
              onPressed: () async {
                await openTestForm(context);
                _list.currentState?.reload();
              })
          : null,
      body: ApiListView(
        key: _list,
        searchHint: 'Search test no., title or serial no…',
        load: (page, search) async {
          final p = await Api.list('/hydraulic/tests', query: {
            'system_type': _medium,
            'test_type': _type,
            'status': _status,
            'result': _result,
            'search': search,
          });
          if (mounted) setState(() => _count = p.rows.length);
          return p;
        },
        header: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
          const PageHeader('Testing & Inspection', subtitle: 'Hydraulic & Pneumatic'),
          FilterBar(children: [
            FilterPill(
                label: 'Medium',
                value: _medium,
                allLabel: 'Hydraulic + Pneumatic',
                options: systemTypeLabels,
                onChanged: (v) => _refilter(() => _medium = v)),
            FilterPill(
                label: 'Test type',
                value: _type,
                allLabel: 'All test types',
                options: testTypeLabels,
                onChanged: (v) => _refilter(() => _type = v)),
            FilterPill(
                label: 'Status',
                value: _status,
                allLabel: 'All statuses',
                options: testStatusLabels,
                onChanged: (v) => _refilter(() => _status = v)),
            FilterPill(
                label: 'Result',
                value: _result,
                allLabel: 'All results',
                options: resultLabels,
                onChanged: (v) => _refilter(() => _result = v)),
          ]),
          if (_count != null) RowCountLine(_count!),
        ]),
        emptyText:
            'No tests match. Plan a pressure, proof, leak or cleanliness test against a system or component to start its test record.',
        itemBuilder: (ctx, t, reload) {
          final failed = toInt(t['failed_readings']) ?? 0;
          final subject = [t['system_number'], t['component_code']].whereType<String>().join(' · ');
          return RecordCard(
            code: txt(t['test_number']),
            title: txt(t['title']),
            trailing: Padding(
              padding: const EdgeInsets.only(left: 8),
              child: Column(crossAxisAlignment: CrossAxisAlignment.end, children: [
                pill(testStatusLabels, testStatusHex, t['status']),
                const SizedBox(height: 4),
                pill(resultLabels, resultHex, t['result']),
              ]),
            ),
            meta: [
              if (_vis.showColumn('tests', 'test_type')) ('Test Type', lbl(testTypeLabels, t['test_type'])),
              if (_vis.showColumn('tests', 'subject'))
                (
                  'Subject',
                  '${subject.isEmpty ? '—' : subject}${t['component_serial'] != null ? ' (S/N ${t['component_serial']})' : ''}'
                ),
              if (_vis.showColumn('tests', 'date')) ('Date', fmtDate(t['test_date'])),
              if (_vis.showColumn('tests', 'test_pressure')) ('Test Pressure', withUnit(t['test_pressure_bar'], 'bar')),
              if (_vis.showColumn('tests', 'failed_readings')) ('Failed Readings', failed > 0 ? '$failed' : '—'),
            ],
            onTap: () async {
              await pushPage(ctx, HydTestDetail(id: toInt(t['id'])!));
              reload();
            },
          );
        },
      ),
    );
  }
}

/// Same rule as the backend's judge_reading.
String? judgeReading(num? min, num? max, num? measured) {
  if (measured == null || (min == null && max == null)) return null;
  if ((min != null && measured < min) || (max != null && measured > max)) return 'fail';
  return 'pass';
}

class _Reading {
  _Reading({
    this.parameter = '',
    this.unit = '',
    this.spec = '',
    this.min = '',
    this.max = '',
    this.measured = '',
    this.measuredText = '',
    this.result = 'na',
    this.remarks = '',
  }) : key = ++_seq;
  static int _seq = 0;
  final int key;
  String parameter, unit, spec, min, max, measured, measuredText, result, remarks;

  String? get auto => judgeReading(numOrNull(min), numOrNull(max), numOrNull(measured));
  bool get blank =>
      parameter.trim().isEmpty &&
      unit.trim().isEmpty &&
      spec.trim().isEmpty &&
      min.trim().isEmpty &&
      max.trim().isEmpty &&
      measured.trim().isEmpty &&
      measuredText.trim().isEmpty &&
      remarks.trim().isEmpty &&
      result == 'na';
}

/// Typical readings per test type — the tester still fills limits and measurements.
const _typical = <String, List<(String, String, String)>>{
  'proof_test': [
    ('Test pressure held', 'bar', 'At test pressure for the full hold time'),
    ('Pressure drop over hold time', 'bar', 'Maximum allowed drop'),
    ('External leakage', '', 'No visible leakage at joints, seals or welds'),
  ],
  'pressure_test': [
    ('Test pressure held', 'bar', 'At test pressure for the full hold time'),
    ('Pressure drop over hold time', 'bar', 'Maximum allowed drop'),
    ('External leakage', '', 'No visible leakage'),
  ],
  'leak_test': [
    ('Pressure decay over hold time', 'bar', 'Maximum allowed decay'),
    ('External leakage', '', 'No visible leakage / bubbles'),
  ],
  'cleanliness_test': [('ISO 4406 code ≥4µm/≥6µm/≥14µm', '', 'e.g. 18/16/13 or cleaner')],
  'relief_valve_setting': [('Cracking pressure', 'bar', 'Set pressure ± tolerance')],
  'cylinder_drift': [('Drift over 10 min', 'mm', 'Maximum drift under rated load')],
};

const _signed = TextInputType.numberWithOptions(decimal: true, signed: true);

/// New / edit test (portal TestForm). Returns the saved record.
Future<Json?> openTestForm(BuildContext context,
    {Json? initial, int? presetSystemId, String? presetSystemLabel, String? presetMedium}) async {
  final vis = HydVis('hydraulic:testing');
  final i = initial ?? const <String, dynamic>{};
  final typeChoices = vis.options('test_type', testTypeLabels);
  final typeOptions = [for (final e in typeChoices) Option(e.key, e.value)];
  if (initial != null && !typeChoices.any((e) => e.key == i['test_type'])) {
    typeOptions.add(Option(i['test_type'] as String, lbl(testTypeLabels, i['test_type'])));
  }
  final mediumChoices = vis.options('system_type', systemTypeLabels);
  final allowTester = await hydAssigneeFilter('hydraulic:testing.tester');
  if (!context.mounted) return null;

  var title = (i['title'] ?? '') as String;
  var testType = (i['test_type'] ?? 'pressure_test') as String;
  if (initial == null && !typeChoices.any((e) => e.key == testType) && typeChoices.isNotEmpty) testType = typeChoices.first.key;
  var medium = (i['system_type'] ?? presetMedium ?? 'hydraulic') as String;
  if (initial == null && !mediumChoices.any((e) => e.key == medium) && mediumChoices.isNotEmpty) medium = mediumChoices.first.key;
  int? systemId = toInt(i['system_id']) ?? presetSystemId;
  String? systemLabel = i['system_number'] != null ? '${i['system_number']} — ${i['system_name'] ?? ''}' : presetSystemLabel;
  int? componentId = toInt(i['component_id']);
  String? componentLabel = i['component_code'] != null ? '${i['component_code']} — ${i['component_name'] ?? ''}' : null;
  var serial = (i['component_serial'] ?? '') as String;
  DateTime? testDate = parseDate(i['test_date']);
  var standard = (i['test_standard'] ?? '') as String;
  var pressure = numStr(i['test_pressure_bar']);
  var hold = numStr(i['hold_time_min']);
  var testMedium = (i['test_medium'] ?? '') as String;
  var ambient = numStr(i['ambient_temp_c']);
  var fluidTemp = numStr(i['fluid_temp_c']);
  int? testedById = toInt(i['tested_by_id']);
  String? testedByLabel = i['tested_by_name'] as String?;
  final initialTester = testedById;
  var witnessed = (i['witnessed_by'] ?? '') as String;
  var observations = (i['observations'] ?? '') as String;
  var remarks = (i['remarks'] ?? '') as String;
  final existing = (i['readings'] as List? ?? const []).whereType<Map>().toList();
  final readings = existing.isEmpty
      ? [_Reading()]
      : [
          for (final r in existing)
            _Reading(
              parameter: (r['parameter'] ?? '') as String,
              unit: (r['unit'] ?? '') as String,
              spec: (r['specification'] ?? '') as String,
              min: numStr(r['min_value']),
              max: numStr(r['max_value']),
              measured: numStr(r['measured_value']),
              measuredText: (r['measured_text'] ?? '') as String,
              result: (r['result'] ?? 'na') as String,
              remarks: (r['remarks'] ?? '') as String,
            ),
        ];
  Json? saved;

  final ok = await showFormSheet(
    context,
    title: initial == null ? 'New Test' : 'Edit ${i['test_number']}',
    saveLabel: initial == null ? 'Create Test' : 'Save Changes',
    builder: (ctx, setS) {
      final filledCount = readings.where((r) => !r.blank).length;
      final failCount = readings.where((r) => !r.blank && (r.auto ?? r.result) == 'fail').length;
      final typical = _typical[testType];
      return [
        Hint(initial == null
            ? 'A pressure, leak or functional test of a system or component — record the conditions and readings.'
            : 'Conditions and readings — save before starting or completing the test.'),
        if (vis.showSection('test')) ...[
          const FormHeading('Test'),
          AppTextField(
              label: 'Title',
              required: true,
              initialValue: title,
              hint: 'Proof test — lift cylinder after rebuild',
              onChanged: (v) => title = v),
          AppSelect<String>(
              label: 'Test Type',
              required: true,
              value: testType,
              options: typeOptions,
              onChanged: (o) => setS(() => testType = o?.value ?? testType)),
          TwoUp(
            initial != null
                ? ReadOnlyField(label: 'Medium', value: lbl(systemTypeLabels, medium))
                : AppSelect<String>(
                    label: 'Medium',
                    required: true,
                    value: medium,
                    options: [for (final e in mediumChoices) Option(e.key, e.value)],
                    onChanged: (o) => setS(() {
                      if (o == null || o.value == medium) return;
                      medium = o.value;
                      systemId = null;
                      systemLabel = null;
                      componentId = null;
                      componentLabel = null;
                    })),
            DateField(label: 'Test Date', value: testDate, onChanged: (d) => setS(() => testDate = d)),
          ),
        ],
        if (vis.showSection('subject')) ...[
          const FormHeading('What Is Tested'),
          AppSelect<int>(
            key: ValueKey('sys-$medium'),
            label: 'System',
            value: systemId,
            valueLabel: systemLabel,
            loadOptions: hydLookup('/hydraulic/lookups/systems', query: {'system_type': medium}),
            onChanged: (o) => setS(() {
              systemId = o?.value;
              systemLabel = o?.label;
            }),
          ),
          AppSelect<int>(
            key: ValueKey('comp-$medium'),
            label: 'Component',
            value: componentId,
            valueLabel: componentLabel,
            loadOptions: hydLookup('/hydraulic/lookups/components', query: {'system_type': medium}),
            onChanged: (o) => setS(() {
              componentId = o?.value;
              componentLabel = o?.label;
            }),
          ),
          AppTextField(label: 'Component Serial No.', initialValue: serial, onChanged: (v) => serial = v),
          Hint('Pick the system, the component, or both *. ${initial != null ? 'The medium follows the system (or component) tested.' : 'Changing the medium clears both pickers.'}'),
        ],
        if (vis.showSection('conditions')) ...[
          const FormHeading('Conditions'),
          AppTextField(
              label: 'Test Standard',
              initialValue: standard,
              hint: 'ISO 10100 / ISO 4413 / RDSO spec',
              onChanged: (v) => standard = v),
          TwoUp(
            AppTextField(
                label: 'Test Pressure (bar)', initialValue: pressure, keyboardType: AppTextField.number, onChanged: (v) => pressure = v),
            AppTextField(label: 'Hold Time (min)', initialValue: hold, keyboardType: AppTextField.number, onChanged: (v) => hold = v),
          ),
          AppTextField(
              label: 'Test Medium',
              initialValue: testMedium,
              hint: 'HLP 46, water-glycol, dry air…',
              onChanged: (v) => testMedium = v),
          TwoUp(
            AppTextField(label: 'Ambient (°C)', initialValue: ambient, keyboardType: _signed, onChanged: (v) => ambient = v),
            AppTextField(label: 'Fluid (°C)', initialValue: fluidTemp, keyboardType: _signed, onChanged: (v) => fluidTemp = v),
          ),
        ],
        if (vis.showSection('people')) ...[
          const FormHeading('People'),
          AppSelect<int>(
            label: 'Tested By',
            value: testedById,
            valueLabel: testedByLabel,
            loadOptions: hydLookup('/hydraulic/lookups/users',
                where: (u) => toInt(u['id']) == initialTester || allowTester(toInt(u['id']) ?? 0)),
            onChanged: (o) => setS(() {
              testedById = o?.value;
              testedByLabel = o?.label;
            }),
          ),
          AppTextField(
              label: 'Witnessed By',
              initialValue: witnessed,
              hint: 'RDSO / customer inspector, name & designation',
              onChanged: (v) => witnessed = v),
        ],
        if (vis.showSection('readings')) ...[
          FormHeading('Readings ($filledCount)${failCount > 0 ? ' · $failCount failing' : ''}',
              trailing: TextButton.icon(
                onPressed: () => setS(() => readings.add(_Reading())),
                icon: const Icon(Icons.add_rounded, size: 18),
                label: const Text('Add Reading'),
              )),
          if (typical != null)
            OutlinedButton(
              onPressed: () => setS(() {
                final have = readings.map((r) => r.parameter.trim().toLowerCase()).toSet();
                final added = [
                  for (final (p, u, s) in typical)
                    if (!have.contains(p.toLowerCase()))
                      _Reading(
                          parameter: p,
                          unit: u,
                          spec: s,
                          min: p == 'Test pressure held' && pressure.trim().isNotEmpty ? pressure.trim() : ''),
                ];
                readings.removeWhere((r) => r.blank);
                readings.addAll(added);
              }),
              child: Text('Load typical readings — ${lbl(testTypeLabels, testType)}'),
            ),
          const Hint(
              'Give a min and/or max limit with a measured value and the result is judged automatically. For readings without numeric limits (visual checks, ISO codes), record the measurement as text and mark the result yourself.'),
          if (readings.isEmpty) const Hint('No readings yet — a test needs at least one reading before it can be completed.'),
          for (final (n, r) in readings.indexed) _readingCard(n, r, readings, setS),
        ],
        if (vis.showSection('notes')) ...[
          const FormHeading('Notes'),
          AppTextField(
              label: 'Observations',
              maxLines: 3,
              initialValue: observations,
              hint: 'What was seen during the test — sweating at a fitting, noise, temperature rise…',
              onChanged: (v) => observations = v),
          AppTextField(label: 'Remarks', maxLines: 3, initialValue: remarks, onChanged: (v) => remarks = v),
        ],
      ];
    },
    onSave: () async {
      if (title.trim().isEmpty) throw 'Title is required — e.g. "Proof test of lift cylinder after rebuild".';
      if (systemId == null && componentId == null) throw 'Pick the system or the component being tested (or both).';
      final nums = <String, num?>{};
      for (final (k, v, label, positive) in [
        ('test_pressure_bar', pressure, 'Test pressure', true),
        ('hold_time_min', hold, 'Hold time', true),
        ('ambient_temp_c', ambient, 'Ambient temperature', false),
        ('fluid_temp_c', fluidTemp, 'Fluid temperature', false),
      ]) {
        final raw = v.trim();
        final n = raw.isEmpty ? null : num.tryParse(raw);
        if (raw.isNotEmpty && n == null) throw '$label must be a number.';
        if (positive && n != null && n < 0) throw "$label can't be negative.";
        nums[k] = n;
      }
      final filled = readings.where((r) => !r.blank).toList();
      for (final (n, r) in filled.indexed) {
        final name = r.parameter.trim();
        if (name.isEmpty) {
          throw 'Reading row ${n + 1} has values but no parameter — name it (e.g. "Pressure drop") or remove the row.';
        }
        bool bad(String s) => s.trim().isNotEmpty && num.tryParse(s.trim()) == null;
        if (bad(r.min) || bad(r.max) || bad(r.measured)) {
          throw "Reading '$name': min, max and measured value must be numbers — use \"Measured (text)\" for anything else.";
        }
        final lo = numOrNull(r.min);
        final hi = numOrNull(r.max);
        if (lo != null && hi != null && lo > hi) throw "Reading '$name': the minimum limit ($lo) is above the maximum ($hi) — swap them.";
      }
      final payload = {
        'title': title.trim(),
        'test_type': testType,
        if (initial == null) 'system_type': medium,
        'system_id': systemId,
        'component_id': componentId,
        'component_serial': blankToNull(serial),
        'test_date': testDate == null ? null : apiDate(testDate!),
        'test_standard': blankToNull(standard),
        ...nums,
        'test_medium': blankToNull(testMedium),
        'tested_by_id': testedById,
        'witnessed_by': blankToNull(witnessed),
        'observations': blankToNull(observations),
        'remarks': blankToNull(remarks),
        'readings': [
          for (final r in filled)
            {
              'parameter': r.parameter.trim(),
              'unit': blankToNull(r.unit),
              'specification': blankToNull(r.spec),
              'min_value': numOrNull(r.min),
              'max_value': numOrNull(r.max),
              'measured_value': numOrNull(r.measured),
              'measured_text': blankToNull(r.measuredText),
              'result': r.auto ?? r.result,
              'remarks': blankToNull(r.remarks),
            },
        ],
      };
      final res = initial == null
          ? await Api.post('/hydraulic/tests', data: payload)
          : await Api.patch('/hydraulic/tests/${i['id']}', data: payload);
      saved = asJson(res);
    },
  );
  if (!ok || saved == null) return null;
  if (initial == null && context.mounted) openScreen(context, HydTestDetail(id: toInt(saved!['id'])!));
  return saved;
}

Widget _readingCard(int n, _Reading r, List<_Reading> all, StateSetter setS) {
  final auto = r.auto;
  return Container(
    key: ValueKey('reading-${r.key}'),
    padding: const EdgeInsets.all(10),
    decoration:
        BoxDecoration(color: Brand.background, borderRadius: BorderRadius.circular(12), border: Border.all(color: Brand.border)),
    child: Column(children: [
      Row(children: [
        Text('Reading ${n + 1}', style: const TextStyle(fontWeight: FontWeight.w700, color: Brand.heading)),
        const Spacer(),
        IconButton(
          tooltip: 'Remove reading',
          icon: const Icon(Icons.delete_outline_rounded, color: Color(0xFFB91C1C)),
          onPressed: () => setS(() => all.remove(r)),
        ),
      ]),
      AppTextField(
          label: 'Parameter *', initialValue: r.parameter, hint: 'Pressure drop over hold time', onChanged: (v) => r.parameter = v),
      const SizedBox(height: 10),
      TwoUp(
        AppTextField(label: 'Unit', initialValue: r.unit, hint: 'bar', onChanged: (v) => r.unit = v),
        AppTextField(label: 'Specification', initialValue: r.spec, onChanged: (v) => r.spec = v),
      ),
      const SizedBox(height: 10),
      Row(children: [
        Expanded(
            child: AppTextField(
                label: 'Min', initialValue: r.min, keyboardType: _signed, onChanged: (v) => setS(() => r.min = v))),
        const SizedBox(width: 8),
        Expanded(
            child: AppTextField(
                label: 'Max', initialValue: r.max, keyboardType: _signed, onChanged: (v) => setS(() => r.max = v))),
        const SizedBox(width: 8),
        Expanded(
            child: AppTextField(
                label: 'Measured',
                initialValue: r.measured,
                keyboardType: _signed,
                onChanged: (v) => setS(() => r.measured = v))),
      ]),
      const SizedBox(height: 10),
      AppTextField(
          label: 'Measured (text)', initialValue: r.measuredText, hint: '18/16/13, no leak…', onChanged: (v) => r.measuredText = v),
      const SizedBox(height: 10),
      if (auto != null)
        Align(
          alignment: Alignment.centerLeft,
          child: StatusBadge('${_readingLabels[auto]} · auto', color: hx(_readingHex[auto])),
        )
      else
        AppSelect<String>(
            label: 'Result',
            required: true,
            value: r.result,
            options: optionsOf(_readingLabels),
            onChanged: (o) => setS(() => r.result = o?.value ?? r.result)),
      const SizedBox(height: 10),
      AppTextField(label: 'Remarks', initialValue: r.remarks, onChanged: (v) => r.remarks = v),
    ]),
  );
}

String _limitText(Object? min, Object? max) {
  if (min != null && max != null) return '$min – $max';
  if (min != null) return '≥ $min';
  if (max != null) return '≤ $max';
  return '—';
}

class HydTestDetail extends StatelessWidget {
  const HydTestDetail({super.key, required this.id});
  final int id;

  Future<void> _complete(BuildContext ctx, Json t, DetailCtl ctl, bool canSignOff) async {
    final readings = (t['readings'] as List? ?? const []).whereType<Map>().toList();
    final failed = [for (final r in readings) if (r['result'] == 'fail') txt(r['parameter'])];
    var result = failed.isNotEmpty ? 'fail' : '';
    var remarks = (t['remarks'] ?? '') as String;
    final finish = canSignOff ? 'Complete Test' : 'Submit Result for Sign-off';
    Json? done;
    final ok = await showFormSheet(
      ctx,
      title: '${canSignOff ? 'Complete' : 'Submit result of'} ${t['test_number']}',
      saveLabel: finish,
      builder: (c, setS) => [
        Hint(canSignOff
            ? 'Signs the result off — the test is then locked.'
            : 'Sends the result to a signer — the approvers are notified.'),
        if (readings.isEmpty)
          const NoteBox(
              'No readings are saved yet. Record at least one reading (parameter and measured value) and save before completing.'),
        const FormHeading('Result'),
        Wrap(spacing: 8, children: [
          for (final r in ['pass', 'fail', 'conditional'])
            ChoiceChip(
              label: Text(resultLabels[r]!),
              selected: result == r,
              selectedColor: hx(resultHex[r]).withValues(alpha: 0.15),
              onSelected: r == 'pass' && failed.isNotEmpty ? null : (_) => setS(() => result = r),
            ),
        ]),
        if (failed.isNotEmpty)
          Hint(
              "Pass isn't available — ${failed.length} reading(s) are outside their limits: ${failed.join(', ')}. Mark it Failed, or Conditional with remarks explaining the concession.",
              color: Brand.danger),
        AppTextField(
          label: result == 'conditional' ? 'Remarks *' : 'Remarks (optional)',
          maxLines: 3,
          initialValue: remarks,
          hint: result == 'conditional' ? 'The condition or concession, and who agreed it…' : 'Optional',
          onChanged: (v) => remarks = v,
        ),
      ],
      onSave: () async {
        if (readings.isEmpty) throw 'No readings are saved yet — edit the test, add a reading and save first.';
        if (result.isEmpty) throw 'Pick the test result — Pass, Fail or Conditional.';
        if (result == 'conditional' && remarks.trim().isEmpty) {
          throw 'A conditional pass needs remarks saying what the condition or concession is (and who agreed it).';
        }
        final body = {'result': result, 'remarks': blankToNull(remarks)};
        done = asJson(await Api.post('/hydraulic/tests/$id/${canSignOff ? 'complete' : 'submit'}', data: body));
      },
    );
    if (!ok || done == null) return;
    ctl.setRecord(done!);
    if (ctx.mounted) {
      showSnack(
          ctx,
          done!['status'] == 'completed'
              ? 'Test completed — ${lbl(resultLabels, done!['result'])}.'
              : 'Result (${lbl(resultLabels, done!['result'])}) sent for sign-off — the approvers have been notified.');
    }
  }

  @override
  Widget build(BuildContext context) {
    final vis = HydVis('hydraulic:testing');
    final canSignOff = hydCan('testing', 'approve');
    final canSubmitResult = hydCan('testing', 'submit');
    final canEdit = hydCan('testing', 'edit');
    final canRetest = hydCanFeature('testing', 'retest', 'create');
    return HydDetail(
      fallbackTitle: 'Test',
      load: () async => asJson(await Api.get('/hydraulic/tests/$id')),
      title: (t) => txt(t['test_number']),
      actions: (ctx, t, ctl) {
        final completed = t['status'] == 'completed';
        final underReview = t['status'] == 'under_review';
        final canFinish = underReview ? (canSignOff && t['approval_request_id'] == null) : (canSignOff || canSubmitResult);
        return [
          if (!completed && !underReview && canEdit)
            secondaryBtn('Edit', () async {
              final r = await openTestForm(ctx, initial: t);
              if (r != null) {
                ctl.setRecord(r);
                if (ctx.mounted) {
                  showSnack(ctx, r['status'] != t['status'] ? 'Test saved — now ${lbl(testStatusLabels, r['status'])}.' : 'Test saved.');
                }
              }
            }),
          if (!completed && t['status'] == 'planned' && canEdit)
            secondaryBtn(
                'Start Test',
                () => ctl.run(ctx, () async {
                      ctl.setRecord(asJson(await Api.post('/hydraulic/tests/$id/start')));
                    }, success: 'Test started.')),
          if (!completed && canFinish)
            primaryBtn(canSignOff ? 'Complete Test' : 'Submit Result for Sign-off', () => _complete(ctx, t, ctl, canSignOff)),
          if (!completed && hydCanDelete('testing', t['created_by_id']))
            dangerBtn('Delete', () async {
              final yes = await confirmDialog(ctx,
                  title: 'Delete test?',
                  message: "${t['test_number']} and its readings will be removed. Only tests that aren't completed can be deleted.",
                  confirmLabel: 'Delete',
                  danger: true);
              if (!yes || !ctx.mounted) return;
              if (await ctl.run(ctx, () => Api.delete('/hydraulic/tests/$id'), success: 'Test deleted.') && ctx.mounted) {
                Navigator.pop(ctx);
              }
            }),
          if (completed && canRetest)
            primaryBtn('Raise Re-test', () async {
              Json? next;
              await ctl.run(ctx, () async => next = asJson(await Api.post('/hydraulic/tests/$id/retest')),
                  success: 'Re-test raised.');
              if (next != null && ctx.mounted) {
                Navigator.of(ctx)
                    .pushReplacement(MaterialPageRoute<void>(builder: (_) => HydTestDetail(id: toInt(next!['id'])!)));
              }
            }),
        ];
      },
      sections: (ctx, t, ctl) {
        final completed = t['status'] == 'completed';
        final readings = (t['readings'] as List? ?? const []).whereType<Map>().map((m) => Map<String, dynamic>.from(m)).toList();
        final failed = toInt(t['failed_readings']) ?? 0;
        final subject = [
          if (t['system_number'] != null) '${t['system_number']}${t['system_name'] != null ? ' — ${t['system_name']}' : ''}',
          if (t['component_code'] != null) '${t['component_code']}${t['component_name'] != null ? ' — ${t['component_name']}' : ''}',
        ].join(' · ');
        final hasNotes = (t['observations'] as String?)?.isNotEmpty == true || (t['remarks'] as String?)?.isNotEmpty == true;
        return [
          HydApprovalPanel(
            key: ValueKey('apr-${t['id']}-${t['status']}-${t['approval_request_id']}'),
            entityType: 'hyd_test',
            entityId: id,
            title: 'Result sign-off',
            onChanged: ctl.reload,
          ),
          if (vis.showSection('detail_summary'))
            SummaryCard(
              eyebrow: 'Hydraulic & Pneumatic · Test',
              title: txt(t['title']),
              text: subject.isNotEmpty ? 'Test on $subject.' : null,
              badges: [
                pill(testStatusLabels, testStatusHex, t['status']),
                pill(resultLabels, resultHex, t['result']),
              ],
              meta:
                  '${lbl(testTypeLabels, t['test_type'])} · ${lbl(systemTypeLabels, t['system_type'])} · ${fmtDate(t['test_date'])}',
            ),
          if (vis.showSection('detail_subject'))
            DetailSection('What was tested', children: [
              FieldRow('Component serial no.', t['component_serial']),
              FieldRow('Test standard', t['test_standard']),
            ]),
          if (vis.showSection('detail_conditions'))
            DetailSection('Test conditions', children: [
              FieldRow('Test pressure', withUnit(t['test_pressure_bar'], 'bar')),
              FieldRow('Hold time', withUnit(t['hold_time_min'], 'min')),
              FieldRow('Test medium', t['test_medium']),
              FieldRow(
                  'Ambient / fluid temp.',
                  t['ambient_temp_c'] == null && t['fluid_temp_c'] == null
                      ? null
                      : '${withUnit(t['ambient_temp_c'], '°C')} / ${withUnit(t['fluid_temp_c'], '°C')}'),
            ]),
          if (vis.showSection('detail_people'))
            DetailSection('People', children: [
              FieldRow('Tested by', t['tested_by_name']),
              FieldRow('Witnessed by', t['witnessed_by']),
              FieldRow(
                  'Completed by',
                  t['completed_by_name'] != null
                      ? '${t['completed_by_name']}${t['completed_at'] != null ? ' · ${fmtDateTime(t['completed_at'])}' : ''}'
                      : null),
            ]),
          if (hasNotes && vis.showSection('detail_notes'))
            DetailSection('Notes', children: [
              if ((t['observations'] as String?)?.isNotEmpty == true) FieldRow('Observations', t['observations']),
              if ((t['remarks'] as String?)?.isNotEmpty == true) FieldRow('Remarks', t['remarks']),
            ]),
          if (vis.showSection('detail_readings'))
            DetailSection('Readings (${readings.length})${failed > 0 ? ' · $failed failed' : ''}', children: [
              if (readings.isEmpty) const Hint('No readings recorded.'),
              for (final r in readings)
                Container(
                  width: double.infinity,
                  padding: const EdgeInsets.symmetric(vertical: 9),
                  decoration: const BoxDecoration(border: Border(top: BorderSide(color: Brand.border))),
                  child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                    Row(children: [
                      Expanded(
                          child: Text(txt(r['parameter']),
                              style: const TextStyle(fontWeight: FontWeight.w600, color: Brand.heading))),
                      pill(_readingLabels, _readingHex, r['result']),
                    ]),
                    if ((r['specification'] as String?)?.isNotEmpty == true)
                      Text(r['specification'] as String, style: const TextStyle(fontSize: 12.5, color: Brand.muted)),
                    Text(
                        'Limits: ${_limitText(r['min_value'], r['max_value'])}${(r['min_value'] != null || r['max_value'] != null) && r['unit'] != null ? ' ${r['unit']}' : ''}',
                        style: const TextStyle(fontSize: 12.5, color: Brand.body)),
                    Text(
                        'Measured: ${r['measured_value'] != null ? '${r['measured_value']}${r['unit'] != null ? ' ${r['unit']}' : ''}' : ''}${r['measured_value'] != null && r['measured_text'] != null ? ' · ' : ''}${r['measured_text'] ?? (r['measured_value'] == null ? '—' : '')}',
                        style: const TextStyle(fontSize: 12.5, color: Brand.body)),
                    if ((r['remarks'] as String?)?.isNotEmpty == true)
                      Text(r['remarks'] as String, style: const TextStyle(fontSize: 12, color: Brand.muted)),
                  ]),
                ),
            ]),
          if (vis.showSection('detail_documents'))
            HydDocumentsPanel(
              key: ValueKey('docs-${t['id']}-${t['status']}'),
              entityType: 'test',
              entityId: id,
              title: 'Test Certificates & Reports',
              defaultDocType: 'test_certificate',
              readOnly: completed,
              readOnlyNote:
                  "This test is completed and locked — its certificates can't be added or removed. Raise a re-test to attach a new certificate.",
            ),
        ];
      },
    );
  }
}
