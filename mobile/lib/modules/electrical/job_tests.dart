// Tests tab - phone copy of frontend/src/components/electrical/TestsTab.tsx:
// factory and commissioning tests of a job, Record Test / Record Retest /
// Edit / Delete.
import 'package:flutter/material.dart';

import '../../api/api.dart';
import '../../theme.dart';
import '../../ui/form.dart';
import '../../ui/format.dart';
import '../../ui/widgets.dart';
import 'common.dart';

const _phases = ['factory', 'commissioning'];

class TestsTab extends StatefulWidget {
  const TestsTab({super.key, required this.job, required this.meta, required this.canEdit, required this.onChanged});
  final Json job;
  final ElecMeta meta;

  /// Job still open; the role's own rights are checked here.
  final bool canEdit;
  final VoidCallback onChanged;

  @override
  State<TestsTab> createState() => _TestsTabState();
}

class _TestsTabState extends State<TestsTab> {
  List<Json> _tests = [];
  bool _loading = true;
  String? _error;
  String _phase = 'factory';
  final _vis = Vis('electrical:testing');

  Json get job => widget.job;
  int get jobId => asInt(job['id'])!;
  String get jobNo => str(job['job_number']);
  bool get _canRecord => widget.canEdit && (Elec.jf('tests', 'create') || Elec.can('testing', 'create'));
  bool get _canModify => widget.canEdit && (Elec.jf('tests', 'edit') || Elec.can('testing', 'edit'));
  bool get _canRemove => Elec.jf('tests', 'delete') || Elec.can('testing', 'delete');
  String _typeLabel(Object? k) => widget.meta.testTypes[str(k)] ?? str(k).replaceAll('_', ' ');

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    try {
      final rows = rowsOf(await Api.get('/electrical/jobs/$jobId/tests'));
      if (mounted) {
        setState(() {
          _tests = rows;
          _error = null;
          _loading = false;
        });
      }
    } catch (e) {
      if (mounted) {
        setState(() {
          _error = "Couldn't load this job's test records. Pull down to try again. ${ApiClient.describe(e)}";
          _loading = false;
        });
      }
    }
  }

  /// mode: create / retest / edit.
  Future<void> _openForm(String mode, {Json? source}) async {
    final editing = mode == 'edit' ? source : null;
    final retestOf = mode == 'retest' ? source : null;
    final phaseChoices = _vis.options('phase', _phases, (p) => p);
    var phase = source != null ? str(source['phase']) : (phaseChoices.contains(_phase) ? _phase : phaseChoices.first);
    var testType = str(source?['test_type']);
    final typeEntries = _vis.options('test_type', widget.meta.testTypes.entries.toList(), (e) => e.key);
    final typeOptions = [for (final e in typeEntries) Option(e.key, e.value)];
    if (testType.isNotEmpty && !typeOptions.any((o) => o.value == testType)) {
      typeOptions.add(Option(testType, _typeLabel(testType)));
    }
    TextEditingController t(String k, {bool keep = true}) => TextEditingController(text: keep ? str(source?[k]) : '');
    final circuit = t('circuit'), instrument = t('instrument'), expected = t('expected_value'), unit = t('unit');
    final measured = t('measured_value', keep: editing != null), remarks = t('remarks', keep: editing != null);
    int? panelId = asInt(source?['panel_id']);
    int? cableId = asInt(source?['cable_id']);
    var result = editing != null ? str(editing['result']) : '';
    DateTime? testDate = editing != null ? parseDate(editing['test_date']) : DateTime.now();
    int? testedBy = editing != null ? asInt(editing['tested_by_id']) : null;
    String? testedByLabel = editing != null && str(editing['tested_by_name']).isNotEmpty ? str(editing['tested_by_name']) : null;

    // Pickers load only what the role may see (job Panels / Cables features).
    List<Json> panels = [], cables = [];
    try {
      if (Elec.sees('panels')) panels = rowsOf(await Api.get('/electrical/jobs/$jobId/panels'));
      if (Elec.sees('cables')) cables = rowsOf(await Api.get('/electrical/jobs/$jobId/cables'));
    } catch (e) {
      if (mounted) showSnack(context, "Couldn't load this job's panels / cables for the pickers — you can still record the test without them. ${ApiClient.describe(e)}", error: true);
    }
    if (!mounted) return;

    final title = editing != null
        ? 'Edit Test ${editing['test_number']}'
        : retestOf != null
            ? 'Record Retest — Retest of ${retestOf['test_number']}'
            : 'Record Test';
    final subtitle = retestOf != null
        ? '${retestOf['test_number']} failed${str(retestOf['measured_value']).isNotEmpty ? ' (measured ${retestOf['measured_value']}${str(retestOf['unit']).isNotEmpty ? ' ${retestOf['unit']}' : ''})' : ''}. '
            'Record the result after the fix — the phase stays ${testPhaseLabels[str(retestOf['phase'])]}.'
        : editing != null
            ? '${_typeLabel(editing['test_type'])} — $jobNo'
            : 'A factory or commissioning test on $jobNo.';
    Json? saved;

    final ok = await showFormSheet(
      context,
      title: title,
      saveLabel: editing != null ? 'Save Changes' : retestOf != null ? 'Record Retest' : 'Record Test',
      builder: (ctx, setS) => [
        Muted(subtitle),
        if (_vis.showSection('test')) ...[
          const FormHeading('Test'),
          AppSelect<String>(
            label: 'Phase',
            value: phase,
            clearable: false,
            enabled: mode == 'create',
            options: [for (final p in (mode == 'create' ? phaseChoices : _phases)) Option(p, testPhaseLabels[p]!)],
            onChanged: (o) => setS(() => phase = o?.value ?? phase),
          ),
          AppSelect<String>(
            label: 'Test Type',
            required: mode != 'edit',
            value: testType.isEmpty ? null : testType,
            enabled: mode != 'edit',
            options: typeOptions,
            onChanged: (o) => setS(() => testType = o?.value ?? ''),
          ),
          DateField(label: 'Test Date', required: true, value: testDate, onChanged: (d) => setS(() => testDate = d)),
        ],
        if (_vis.showSection('what_tested')) ...[
          const FormHeading('What Was Tested'),
          AppTextField(label: 'Circuit', controller: circuit, hint: 'e.g. Headlamp circuit L1'),
          AppSelect<int>(
            label: 'Panel',
            value: panelId,
            options: [for (final p in panels) Option(asInt(p['id'])!, '${p['panel_tag']} — ${p['name']}')],
            valueLabel: str(source?['panel_tag']).isEmpty ? null : str(source?['panel_tag']),
            onChanged: (o) => setS(() => panelId = o?.value),
          ),
          AppSelect<int>(
            label: 'Cable',
            value: cableId,
            options: [for (final c in cables) Option(asInt(c['id'])!, '${c['cable_tag']} · ${c['from_point']} → ${c['to_point']}')],
            valueLabel: str(source?['cable_tag']).isEmpty ? null : str(source?['cable_tag']),
            onChanged: (o) => setS(() => cableId = o?.value),
          ),
          AppTextField(label: 'Instrument', controller: instrument, hint: 'e.g. Megger MIT420'),
        ],
        if (_vis.showSection('reading_result')) ...[
          const FormHeading('Reading & Result'),
          AppTextField(label: 'Expected Value', controller: expected, hint: 'e.g. ≥ 1'),
          AppTextField(label: 'Measured Value', controller: measured),
          AppTextField(label: 'Unit', controller: unit, hint: 'MΩ'),
          Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(mode == 'edit' ? 'Result' : 'Result *', style: const TextStyle(fontSize: 12, color: Brand.muted)),
              const SizedBox(height: 6),
              if (mode == 'edit')
                pill(result, testResultLabels, testResultHex)
              else
                Row(children: [
                  for (final r in ['pass', 'fail'])
                    Padding(
                      padding: const EdgeInsets.only(right: 8),
                      child: ChoiceChip(
                        label: Text(testResultLabels[r]!),
                        selected: result == r,
                        selectedColor: testResultHex[r]!.withValues(alpha: 0.15),
                        labelStyle: TextStyle(
                            fontWeight: FontWeight.w600, color: result == r ? testResultHex[r] : Brand.body),
                        onSelected: (_) => setS(() => result = r),
                      ),
                    ),
                ]),
              if (mode == 'edit')
                const Padding(
                  padding: EdgeInsets.only(top: 6),
                  child: Muted("A result can't be changed — record a retest instead. The phase and test type are fixed too.",
                      size: 12),
                ),
            ],
          ),
        ],
        if (_vis.showSection('tested_by')) ...[
          const FormHeading('Tested By'),
          AppSelect<int>(
            label: 'Tested by (blank = me)',
            value: testedBy,
            valueLabel: testedByLabel,
            loadOptions: (q) => userOptions(search: q),
            onChanged: (o) => setS(() {
              testedBy = o?.value;
              testedByLabel = o?.label;
            }),
          ),
        ],
        if (_vis.showSection('remarks')) ...[
          const FormHeading('Remarks'),
          AppTextField(label: 'Remarks (optional)', controller: remarks, maxLines: 3),
        ],
      ],
      onSave: () async {
        if (mode != 'edit') {
          if (testType.isEmpty) throw 'Pick the test type.';
          if (result.isEmpty) throw 'Mark the result — Pass or Fail.';
        }
        if (testDate == null) throw 'Enter the date the test was performed.';
        final common = {
          'circuit': strOrNull(circuit.text),
          'panel_id': panelId,
          'cable_id': cableId,
          'instrument': strOrNull(instrument.text),
          'expected_value': strOrNull(expected.text),
          'measured_value': strOrNull(measured.text),
          'unit': strOrNull(unit.text),
          'test_date': apiDate(testDate!),
          'tested_by_id': testedBy,
          'remarks': strOrNull(remarks.text),
        };
        if (editing != null) {
          saved = asJson(await Api.patch('/electrical/tests/${editing['id']}', data: common));
        } else {
          saved = asJson(await Api.post('/electrical/jobs/$jobId/tests', data: {
            ...common,
            'phase': phase,
            'test_type': testType,
            'result': result,
            'retest_of_id': asInt(retestOf?['id']),
          }));
        }
      },
    );
    for (final c in [circuit, instrument, expected, unit, measured, remarks]) {
      c.dispose();
    }
    if (!ok || saved == null) return;
    final s = saved!;
    final res = testResultLabels[str(s['result'])] ?? str(s['result']);
    if (editing == null && str(s['phase']).isNotEmpty) _phase = str(s['phase']);
    await _load();
    widget.onChanged();
    if (!mounted) return;
    showSnack(
        context,
        editing != null
            ? 'Test ${s['test_number']} updated.'
            : retestOf != null
                ? 'Retest ${s['test_number']} recorded against ${retestOf['test_number']} ($res).'
                : 'Test ${s['test_number']} recorded ($res).');
  }

  Future<void> _delete(Json t) async {
    final ok = await confirmDialog(context,
        title: 'Delete test ${t['test_number']}?',
        message: "The test record is removed from this job. A test that has a retest or an issue raised against it can't be "
            'deleted — remove those first.',
        confirmLabel: 'Delete',
        danger: true);
    if (!ok || !mounted) return;
    final done = await runAction(context, () => Api.delete('/electrical/tests/${t['id']}'),
        success: 'Test ${t['test_number']} deleted.');
    if (done) {
      await _load();
      widget.onChanged();
    }
  }

  @override
  Widget build(BuildContext context) {
    final counts = {for (final p in _phases) p: _tests.where((t) => t['phase'] == p).length};
    final visible = _tests.where((t) => t['phase'] == _phase).toList();
    final passed = visible.where((t) => t['result'] == 'pass').length;
    final failures = visible.where((t) => asBool(t['needs_retest'])).length;
    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: 16),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          TabHeader(
            title: 'Tests',
            action: _canRecord ? primaryBtn('Record Test', () => _openForm('create')) : null,
          ),
          SingleChildScrollView(
            scrollDirection: Axis.horizontal,
            child: Row(children: [
              for (final p in _phases)
                segment('${testPhaseLabels[p]} (${counts[p]})', _phase == p, () => setState(() => _phase = p)),
            ]),
          ),
          const SizedBox(height: 6),
          Text.rich(TextSpan(children: [
            TextSpan(text: '$passed', style: const TextStyle(fontWeight: FontWeight.w700, color: cGreen)),
            const TextSpan(text: ' passed · '),
            TextSpan(text: '$failures', style: TextStyle(fontWeight: FontWeight.w700, color: failures > 0 ? cRed : Brand.body)),
            TextSpan(text: ' open ${plural(failures, 'failure')}'),
          ]), style: const TextStyle(fontSize: 13, color: Brand.muted)),
          Padding(
            padding: const EdgeInsets.only(top: 4, bottom: 10),
            child: Muted(
                _phase == 'factory'
                    ? 'Electrical Testing stage needs at least one factory test and every failure retested with a pass.'
                    : 'Commissioning stage needs at least one commissioning test and every failure retested with a pass.',
                size: 11.5),
          ),
          if (_error != null) Padding(padding: const EdgeInsets.only(bottom: 10), child: ErrorBanner(_error!)),
          if (_loading)
            const LoadingView()
          else if (visible.isEmpty)
            Padding(
              padding: const EdgeInsets.symmetric(vertical: 20),
              child: Muted('No ${testPhaseLabels[_phase]!.toLowerCase()} tests recorded yet.'
                  '${_canRecord ? ' Use "+ Record Test" to log one.' : ''}', size: 13),
            )
          else
            for (final t in visible) _card(t),
        ],
      ),
    );
  }

  Widget _card(Json t) {
    final links = [str(t['panel_tag']), str(t['cable_tag'])].where((s) => s.isNotEmpty).join(' · ');
    final measured = str(t['measured_value']).isEmpty
        ? '—'
        : '${t['measured_value']}${str(t['unit']).isNotEmpty ? ' ${t['unit']}' : ''}';
    return ItemCard(
      children: [
        Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(str(t['test_number']),
                      style: const TextStyle(fontSize: 14, fontWeight: FontWeight.w700, color: Brand.heading)),
                  if (str(t['retest_of_number']).isNotEmpty) Muted('Retest of ${t['retest_of_number']}', size: 11.5),
                  Text(_typeLabel(t['test_type']), style: const TextStyle(fontSize: 13.5, color: Brand.body)),
                ],
              ),
            ),
            Wrap(spacing: 4, runSpacing: 4, alignment: WrapAlignment.end, children: [
              pill(t['result'], testResultLabels, testResultHex),
              if (asBool(t['needs_retest'])) tagPill('Needs retest', cRed),
            ]),
          ],
        ),
        MetaWrap([
          ('Circuit / Panel / Cable', [str(t['circuit']), links].where((s) => s.isNotEmpty).join(' · ').ifEmpty('—')),
          ('Instrument', txt(t['instrument'])),
          ('Expected', txt(t['expected_value'])),
          ('Measured', measured),
          ('Date', fmtDate(t['test_date'])),
          ('Tested by', txt(t['tested_by_name'])),
        ]),
        if (widget.canEdit) ...[
          const SizedBox(height: 8),
          btnWrap([
            if (_canRecord && asBool(t['needs_retest'])) smallBtn('Record Retest', () => _openForm('retest', source: t)),
            if (_canModify) smallBtn('Edit', () => _openForm('edit', source: t)),
            if (_canRemove && Elec.canDelete('testing', null)) smallBtn('Delete', () => _delete(t), danger: true),
          ]),
        ],
      ],
    );
  }
}

extension on String {
  String ifEmpty(String other) => isEmpty ? other : this;
}