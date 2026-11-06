import 'dart:async';

import 'package:dio/dio.dart' show DioException;
import 'package:flutter/material.dart';

import '../../api/api.dart';
import '../../theme.dart';
import '../../ui/app_frame.dart';
import '../../ui/files.dart';
import '../../ui/form.dart';
import '../../ui/format.dart';
import '../../ui/perms.dart';
import '../../ui/widgets.dart';
import 'hyd_common.dart';
import 'hyd_systems.dart';

// Portal: /dashboard/hydraulic/calculations (+ /new calculator, /[id]) and
// components/hydraulic/CalcResults.tsx. Every figure comes from the server
// engine (POST /hydraulic/calculations/compute) - nothing is computed here.

/// One result value as displayed (en-IN grouping, up to 4 decimals).
String formatCalcValue(Object? v) {
  if (v == null || v == '') return '—';
  if (v is num) {
    final s = v.toStringAsFixed(4).replaceFirst(RegExp(r'\.?0+$'), '');
    final n = num.tryParse(s) ?? v;
    final whole = n.truncate();
    final frac = s.contains('.') ? s.substring(s.indexOf('.')) : '';
    return '${fmtNumber(whole)}$frac';
  }
  return v.toString();
}

String keyResultText(Object? rows) {
  final list = (rows is List ? rows : const []).whereType<Map>().toList();
  if (list.isEmpty) return '—';
  final row = list.firstWhere((r) => r['primary'] == true, orElse: () => list.first);
  return '${row['label']}: ${formatCalcValue(row['value'])}${row['unit'] != null && row['value'] != null ? ' ${row['unit']}' : ''}';
}

Future<List<Json>> _calcTypes() async => rowsOf(await Api.get('/hydraulic/calculations/types'));

class HydCalculationsList extends StatefulWidget {
  const HydCalculationsList({super.key});

  @override
  State<HydCalculationsList> createState() => _HydCalculationsListState();
}

class _HydCalculationsListState extends State<HydCalculationsList> {
  final _list = GlobalKey<ApiListViewState>();
  List<Json> _types = [];
  String _type = '';
  String _medium = '';
  int? _count;

  @override
  void initState() {
    super.initState();
    _calcTypes().then((t) {
      if (mounted) setState(() => _types = t);
    }).catchError((_) {});
  }

  void _refilter(VoidCallback f) {
    setState(f);
    _list.currentState?.reload();
  }

  @override
  Widget build(BuildContext context) {
    final typeOpts = {
      for (final m in ['hydraulic', 'pneumatic'])
        for (final t in _types)
          if (t['system_type'] == m && (_medium.isEmpty || _medium == m))
            t['key'] as String: '${t['label']} (${systemTypeLabels[m]})',
    };
    return Scaffold(
      backgroundColor: Colors.transparent,
      floatingActionButton: CreateFab(
          label: 'New Calculation',
          onPressed: () async {
            await pushPage(context, const HydCalculator());
            _list.currentState?.reload();
          }),
      body: ApiListView(
        key: _list,
        searchHint: 'Search calc no. or title…',
        load: (page, search) async {
          final p = await Api.list('/hydraulic/calculations', query: {'calc_type': _type, 'system_type': _medium, 'search': search});
          if (mounted) setState(() => _count = p.rows.length);
          return p;
        },
        header: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
          const PageHeader('Calculations', subtitle: 'Hydraulic & Pneumatic'),
          FilterBar(children: [
            FilterPill(
                label: 'Calculation',
                value: _type,
                allLabel: 'All calculations',
                options: typeOpts,
                onChanged: (v) => _refilter(() => _type = v)),
            FilterPill(
                label: 'Medium',
                value: _medium,
                allLabel: 'Hydraulic + Pneumatic',
                options: systemTypeLabels,
                onChanged: (v) => _refilter(() {
                      _medium = v;
                      if (_type.isNotEmpty && v.isNotEmpty) {
                        final t = _types.where((x) => x['key'] == _type).firstOrNull;
                        if (t != null && t['system_type'] != v) _type = '';
                      }
                    })),
          ]),
          if (_count != null) RowCountLine(_count!),
        ]),
        emptyText:
            'No saved calculations match. Size a cylinder, pump, accumulator or receiver in the calculator and save it here for the record.',
        itemBuilder: (ctx, c, reload) => RecordCard(
          code: txt(c['calc_number']),
          title: txt(c['title']),
          subtitle: txt(c['calc_type_label'] ?? c['calc_type']),
          trailing: Padding(
              padding: const EdgeInsets.only(left: 8), child: pill(systemTypeLabels, systemTypeHex, c['system_type'])),
          meta: [
            ('System', txt(c['system_number'])),
            ('Key Result', keyResultText(c['results'] is Map ? (c['results'] as Map)['results'] : null)),
            ('By', txt(c['created_by_name'])),
            ('Date', fmtDate(c['created_at'])),
          ],
          onTap: () async {
            await pushPage(ctx, HydCalculationDetail(id: toInt(c['id'])!));
            reload();
          },
        ),
      ),
    );
  }
}

/// Results card body (portal CalcResults).
class CalcResults extends StatelessWidget {
  const CalcResults({super.key, required this.results, this.warnings = const [], this.error, this.computing = false, this.emptyNote = 'Fill in the inputs to see results.'});
  final List<Json> results;
  final List<String> warnings;
  final String? error;
  final bool computing;
  final String emptyNote;

  @override
  Widget build(BuildContext context) {
    final primary = results.where((r) => r['primary'] == true).toList();
    final rest = results.where((r) => r['primary'] != true).toList();
    return Opacity(
      opacity: computing ? 0.6 : 1,
      child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
        if (error != null)
          ErrorBanner("Can't calculate yet: $error")
        else if (results.isEmpty)
          Hint(computing ? 'Calculating…' : emptyNote)
        else ...[
          if (primary.isNotEmpty)
            Wrap(spacing: 10, runSpacing: 10, children: [
              for (final r in primary)
                Container(
                  constraints: const BoxConstraints(minWidth: 140),
                  padding: const EdgeInsets.all(12),
                  decoration: BoxDecoration(
                    color: Brand.primary.withValues(alpha: 0.08),
                    borderRadius: BorderRadius.circular(14),
                    border: Border.all(color: Brand.primary.withValues(alpha: 0.25)),
                  ),
                  child: Column(crossAxisAlignment: CrossAxisAlignment.start, mainAxisSize: MainAxisSize.min, children: [
                    Text(txt(r['label']), style: const TextStyle(fontSize: 11.5, fontWeight: FontWeight.w600, color: Brand.muted)),
                    const SizedBox(height: 4),
                    Text.rich(TextSpan(children: [
                      TextSpan(
                          text: formatCalcValue(r['value']),
                          style: const TextStyle(fontSize: 24, fontWeight: FontWeight.w700, color: Brand.heading)),
                      if (r['unit'] != null && r['value'] != null)
                        TextSpan(
                            text: ' ${r['unit']}',
                            style: const TextStyle(fontSize: 13, fontWeight: FontWeight.w600, color: Brand.muted)),
                    ])),
                  ]),
                ),
            ]),
          if (rest.isNotEmpty) ...[
            const SizedBox(height: 10),
            for (final r in rest)
              _ValueRow(txt(r['label']), formatCalcValue(r['value']), r['value'] != null ? (r['unit'] ?? '').toString() : ''),
          ],
        ],
        if (error == null && warnings.isNotEmpty) ...[
          const SizedBox(height: 10),
          Container(
            width: double.infinity,
            padding: const EdgeInsets.all(12),
            decoration: BoxDecoration(
              color: Brand.warning.withValues(alpha: 0.10),
              borderRadius: BorderRadius.circular(10),
              border: Border.all(color: Brand.warning.withValues(alpha: 0.35)),
            ),
            child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
              const Text('Check these', style: TextStyle(fontWeight: FontWeight.w700, color: Color(0xFF92400E))),
              for (final w in warnings) Text('• $w', style: const TextStyle(fontSize: 13, color: Color(0xFF92400E))),
            ]),
          ),
        ],
      ]),
    );
  }
}

class _ValueRow extends StatelessWidget {
  const _ValueRow(this.label, this.value, this.unit);
  final String label;
  final String value;
  final String unit;

  @override
  Widget build(BuildContext context) => Container(
        padding: const EdgeInsets.symmetric(vertical: 7),
        decoration: const BoxDecoration(border: Border(top: BorderSide(color: Brand.border))),
        child: Row(children: [
          Expanded(child: Text(label, style: const TextStyle(fontSize: 13, color: Brand.muted))),
          Text(value,
              style: TextStyle(
                  fontSize: 13, fontWeight: FontWeight.w600, color: value == 'Not given' ? Brand.muted : Brand.heading)),
          SizedBox(
              width: 64,
              child: Padding(
                padding: const EdgeInsets.only(left: 6),
                child: Text(unit, style: const TextStyle(fontSize: 12, color: Brand.muted)),
              )),
        ]),
      );
}

List<Json> _resultRows(Json c) {
  final r = c['results'];
  return r is Map ? rowsOf(r['results']) : const [];
}

List<String> _warnings(Json c) {
  final r = c['results'];
  return r is Map && r['warnings'] is List ? (r['warnings'] as List).map((e) => e.toString()).toList() : const [];
}

class HydCalculationDetail extends StatefulWidget {
  const HydCalculationDetail({super.key, required this.id});
  final int id;

  @override
  State<HydCalculationDetail> createState() => _HydCalculationDetailState();
}

class _HydCalculationDetailState extends State<HydCalculationDetail> {
  Json? _meta;

  @override
  Widget build(BuildContext context) {
    final id = widget.id;
    final canEdit = hydCan('calculations', 'edit');
    final canCreate = hydCan('calculations', 'create');
    return HydDetail(
      fallbackTitle: 'Calculation',
      load: () async {
        final c = asJson(await Api.get('/hydraulic/calculations/$id'));
        try {
          _meta = (await _calcTypes()).where((t) => t['key'] == c['calc_type']).firstOrNull;
        } catch (_) {/* inputs then show by key */}
        return c;
      },
      title: (c) => '${c['calc_number']} — ${c['title']}',
      actions: (ctx, c, ctl) => [
        if (canEdit)
          secondaryBtn('Edit Details', () async {
            var title = (c['title'] ?? '') as String;
            int? systemId = toInt(c['system_id']);
            String? systemLabel = c['system_number'] != null ? '${c['system_number']} — ${c['system_name'] ?? ''}' : null;
            var remarks = (c['remarks'] ?? '') as String;
            Json? saved;
            final ok = await showFormSheet(ctx,
                title: 'Details',
                saveLabel: 'Save Changes',
                builder: (_, setS) => [
                      AppTextField(label: 'Title', required: true, initialValue: title, onChanged: (v) => title = v),
                      AppSelect<int>(
                        label: 'System (${lbl(systemTypeLabels, c['system_type'])} only)',
                        value: systemId,
                        valueLabel: systemLabel,
                        loadOptions: hydLookup('/hydraulic/lookups/systems', query: {'system_type': c['system_type']}),
                        onChanged: (o) => setS(() {
                          systemId = o?.value;
                          systemLabel = o?.label;
                        }),
                      ),
                      AppTextField(label: 'Remarks', maxLines: 3, initialValue: remarks, onChanged: (v) => remarks = v),
                      const Hint("Inputs can't be edited — re-run it in the calculator and save a new calculation instead."),
                    ],
                onSave: () async {
                  if (title.trim().isEmpty) throw "Title can't be empty — enter a short name for this calculation.";
                  saved = asJson(await Api.patch('/hydraulic/calculations/$id',
                      data: {'title': title.trim(), 'system_id': systemId, 'remarks': blankToNull(remarks)}));
                });
            if (ok && saved != null) {
              ctl.setRecord(saved!);
              if (ctx.mounted) showSnack(ctx, 'Calculation details saved.');
            }
          }),
        if (canCreate)
          secondaryBtn('Re-run in calculator', () {
            final inputs = c['inputs'] is Map ? Map<String, dynamic>.from(c['inputs'] as Map) : <String, dynamic>{};
            openScreen(
                ctx,
                HydCalculator(
                  initialType: c['calc_type'] as String?,
                  initialInputs: inputs,
                  presetSystemId: toInt(c['system_id']),
                  presetSystemLabel: c['system_number'] != null ? '${c['system_number']} — ${c['system_name'] ?? ''}' : null,
                ));
          }),
        if (hydCanDelete('calculations', c['created_by_id']))
          dangerBtn('Delete', () async {
            final yes = await confirmDialog(ctx,
                title: 'Delete calculation?',
                message: '${c['calc_number']} will be removed from the saved calculations list.',
                confirmLabel: 'Delete',
                danger: true);
            if (!yes || !ctx.mounted) return;
            if (await ctl.run(ctx, () => Api.delete('/hydraulic/calculations/$id'), success: 'Calculation deleted.') &&
                ctx.mounted) {
              Navigator.pop(ctx);
            }
          }),
      ],
      sections: (ctx, c, ctl) {
        final inputs = c['inputs'] is Map ? Map<String, dynamic>.from(c['inputs'] as Map) : <String, dynamic>{};
        final metaInputs = rowsOf(_meta?['inputs']);
        final seen = <String>{};
        final rows = <_ValueRow>[];
        for (final inp in metaInputs) {
          final k = inp['key'] as String;
          seen.add(k);
          final raw = inputs[k];
          final value = inp['kind'] == 'select'
              ? (rowsOf(inp['options']).where((o) => o['value'] == raw).firstOrNull?['label']?.toString() ?? txt(raw))
              : raw == null
                  ? 'Not given'
                  : formatCalcValue(raw);
          rows.add(_ValueRow(txt(inp['label']), value, raw == null ? '' : (inp['unit'] ?? '').toString()));
        }
        for (final e in inputs.entries) {
          if (!seen.contains(e.key)) rows.add(_ValueRow(e.key.replaceAll('_', ' '), formatCalcValue(e.value), ''));
        }
        return [
          SummaryCard(
            eyebrow: 'Hydraulic & Pneumatic · Calculation',
            title: txt(c['calc_type_label'] ?? c['calc_type']),
            text: _meta?['description'] as String?,
            badges: [pill(systemTypeLabels, systemTypeHex, c['system_type'])],
            meta: 'Saved by ${c['created_by_name'] ?? '—'} on ${fmtDateTime(c['created_at'])}',
          ),
          if (c['system_id'] != null)
            Padding(
              padding: const EdgeInsets.fromLTRB(16, 0, 16, 8),
              child: Align(
                alignment: Alignment.centerLeft,
                child: linkBtn('${c['system_number']}${c['system_name'] != null ? ' — ${c['system_name']}' : ''} →',
                    () => openScreen(ctx, HydSystemDetail(id: toInt(c['system_id'])!))),
              ),
            ),
          DetailSection('Inputs', children: [if (rows.isEmpty) const Hint('No inputs recorded.'), ...rows]),
          DetailSection('Results', children: [
            CalcResults(
                results: _resultRows(c), warnings: _warnings(c), emptyNote: 'No results were stored with this calculation.'),
          ]),
          DetailSection('Details', children: [
            FieldRow('Title', c['title']),
            FieldRow('System', c['system_number'] != null ? '${c['system_number']} — ${c['system_name'] ?? ''}' : null),
            FieldRow('Remarks', c['remarks']),
            Hint(canEdit
                ? "Inputs can't be edited — re-run it in the calculator and save a new calculation instead."
                : "Changing the title, system or remarks needs the 'edit' right on Calculations."),
          ]),
        ];
      },
    );
  }
}

/// Engineering Calculator (portal /dashboard/hydraulic/calculations/new).
class HydCalculator extends StatefulWidget {
  const HydCalculator({super.key, this.initialType, this.initialInputs, this.presetSystemId, this.presetSystemLabel});
  final String? initialType;
  final Map<String, dynamic>? initialInputs;
  final int? presetSystemId;
  final String? presetSystemLabel;

  @override
  State<HydCalculator> createState() => _HydCalculatorState();
}

class _HydCalculatorState extends State<HydCalculator> {
  List<Json> _types = [];
  Json? _calc;
  Map<String, String> _values = {};
  int _formKey = 0;
  List<Json> _results = [];
  List<String> _warnings = [];
  String? _calcError;
  Object? _error;
  bool _computing = false;
  int _seq = 0;
  Timer? _timer;

  String _title = '';
  bool _titleTouched = false;
  late int? _systemId = widget.presetSystemId;
  late String? _systemLabel = widget.presetSystemLabel;
  String _remarks = '';
  bool _saving = false;
  String? _saveError;

  @override
  void initState() {
    super.initState();
    _init();
  }

  @override
  void dispose() {
    _timer?.cancel();
    super.dispose();
  }

  Map<String, String> _defaults(Json meta) =>
      {for (final i in rowsOf(meta['inputs'])) i['key'] as String: i['default'] == null ? '' : i['default'].toString()};

  Future<void> _init() async {
    try {
      final list = await _calcTypes();
      Json? start = list.where((t) => t['key'] == widget.initialType).firstOrNull;
      if (start == null && widget.presetSystemId != null) {
        try {
          final sys = rowsOf(await Api.get('/hydraulic/lookups/systems'))
              .where((s) => toInt(s['id']) == widget.presetSystemId)
              .firstOrNull;
          start = list.where((t) => t['system_type'] == sys?['extra']).firstOrNull;
        } catch (_) {}
      }
      start ??= list.firstOrNull;
      if (!mounted) return;
      setState(() => _types = list);
      if (start != null) {
        final vals = _defaults(start);
        if (start['key'] == widget.initialType && widget.initialInputs != null) {
          for (final inp in rowsOf(start['inputs'])) {
            final k = inp['key'] as String;
            if (!widget.initialInputs!.containsKey(k)) continue;
            final v = widget.initialInputs![k];
            if (inp['kind'] == 'select') {
              if (v is String && rowsOf(inp['options']).any((o) => o['value'] == v)) vals[k] = v;
            } else if (v is num) {
              vals[k] = v.toString();
            } else if (v == null && inp['optional'] == true) {
              vals[k] = '';
            }
          }
        }
        _pick(start, vals);
      }
    } catch (e) {
      if (mounted) setState(() => _error = e);
    }
  }

  void _pick(Json meta, [Map<String, String>? vals]) {
    setState(() {
      final mediumChanged = _calc?['system_type'] != meta['system_type'];
      _calc = meta;
      _values = vals ?? _defaults(meta);
      _formKey++;
      _results = [];
      _warnings = [];
      _calcError = null;
      _saveError = null;
      if (!_titleTouched) _title = txt(meta['label']);
      if (mediumChanged && _calc != null && widget.presetSystemId == null) {
        _systemId = null;
        _systemLabel = null;
      }
    });
    _schedule();
  }

  Map<String, dynamic> _payload() {
    final out = <String, dynamic>{};
    for (final inp in rowsOf(_calc?['inputs'])) {
      final k = inp['key'] as String;
      final raw = (_values[k] ?? '').trim();
      if (inp['kind'] == 'select') {
        out[k] = raw.isEmpty ? null : raw;
      } else if (raw.isEmpty) {
        out[k] = null;
      } else {
        out[k] = num.tryParse(raw) ?? raw;
      }
    }
    return out;
  }

  void _schedule() {
    _timer?.cancel();
    final calc = _calc;
    if (calc == null) return;
    final seq = ++_seq;
    _timer = Timer(const Duration(milliseconds: 400), () async {
      if (!mounted) return;
      setState(() => _computing = true);
      try {
        final res = await Api.post('/hydraulic/calculations/compute', data: {'calc_type': calc['key'], 'inputs': _payload()});
        if (!mounted || seq != _seq) return;
        final m = res is Map ? res : const {};
        setState(() {
          _results = rowsOf(m['results']);
          _warnings = m['warnings'] is List ? (m['warnings'] as List).map((e) => e.toString()).toList() : [];
          _calcError = null;
          _error = null;
        });
      } catch (e) {
        if (!mounted || seq != _seq) return;
        final status = e is DioException ? e.response?.statusCode : null;
        setState(() {
          if (status == 400 || status == 422) {
            _calcError = ApiClient.describe(e);
            _results = [];
          } else {
            _error = e;
          }
        });
      } finally {
        if (mounted && seq == _seq) setState(() => _computing = false);
      }
    });
  }

  Future<void> _save() async {
    final calc = _calc;
    if (calc == null) return;
    setState(() => _saveError = null);
    if (_title.trim().isEmpty) {
      setState(() => _saveError = 'Enter a title so the calculation can be found later — e.g. "Lift cylinder force at 160 bar".');
      return;
    }
    if (_calcError != null) {
      setState(() => _saveError = "The inputs above can't be calculated yet — fix the problem shown in the results card, then save.");
      return;
    }
    setState(() => _saving = true);
    try {
      final saved = asJson(await Api.post('/hydraulic/calculations', data: {
        'title': _title.trim(),
        'calc_type': calc['key'],
        'system_id': _systemId,
        'inputs': _payload(),
        'remarks': blankToNull(_remarks),
      }));
      if (!mounted) return;
      Navigator.of(context)
          .pushReplacement(MaterialPageRoute<void>(builder: (_) => HydCalculationDetail(id: toInt(saved['id'])!)));
    } catch (e) {
      if (mounted) {
        setState(() {
          _saveError = ApiClient.describe(e);
          _saving = false;
        });
      }
    }
  }

  Widget _input(Json inp) {
    final k = inp['key'] as String;
    final label = '${inp['label']}${inp['optional'] == true ? ' (optional)' : ''}';
    final help = inp['help'] as String?;
    Widget field;
    if (inp['kind'] == 'select') {
      field = AppSelect<String>(
        label: label,
        value: (_values[k] ?? '').isEmpty ? null : _values[k],
        required: true,
        options: [for (final o in rowsOf(inp['options'])) Option(o['value'].toString(), txt(o['label']))],
        onChanged: (o) {
          setState(() => _values[k] = o?.value ?? '');
          _schedule();
        },
      );
    } else {
      field = TextFormField(
        key: ValueKey('in-$_formKey-$k'),
        initialValue: _values[k],
        keyboardType: const TextInputType.numberWithOptions(decimal: true, signed: true),
        onChanged: (v) {
          _values[k] = v;
          _schedule();
        },
        decoration: fieldDecoration(label,
                hint: inp['optional'] == true
                    ? 'Leave blank to skip'
                    : inp['default'] == null
                        ? 'Required'
                        : inp['default'].toString())
            .copyWith(suffixText: inp['unit']?.toString()),
      );
    }
    return Padding(
      padding: const EdgeInsets.only(bottom: 12),
      child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
        field,
        if (help != null && help.isNotEmpty) Padding(padding: const EdgeInsets.only(top: 4), child: Hint(help)),
      ]),
    );
  }

  @override
  Widget build(BuildContext context) {
    final calc = _calc;
    final canSave = hydCan('calculations', 'create');
    final hasRnd = Perm.hasApp('rnd');
    return Scaffold(
      appBar: AppBar(title: const Text('Engineering Calculator')),
      body: ListView(
        padding: const EdgeInsets.only(top: 12, bottom: 32),
        children: [
          if (_error != null)
            Padding(padding: const EdgeInsets.fromLTRB(16, 0, 16, 12), child: ErrorBanner(ApiClient.describe(_error!))),
          DetailSection('Calculation', children: [
            if (_types.isEmpty && _error == null) const Hint('Loading calculations…'),
            if (_types.isNotEmpty)
              AppSelect<String>(
                label: 'Calculation',
                required: true,
                value: calc?['key'] as String?,
                options: [
                  for (final m in ['hydraulic', 'pneumatic'])
                    for (final t in _types)
                      if (t['system_type'] == m) Option(t['key'] as String, txt(t['label']), subtitle: systemTypeLabels[m]),
                ],
                onChanged: (o) {
                  final t = _types.where((x) => x['key'] == o?.value).firstOrNull;
                  if (t != null && t['key'] != calc?['key']) _pick(t);
                },
              ),
            if (hasRnd)
              Align(
                alignment: Alignment.centerLeft,
                child: linkBtn('Locomotive hydrostatic drive sizing → R&D tool',
                    () => runAction(context, () => Files.openInPortal('/dashboard/rnd/hydraulic'))),
              ),
          ]),
          if (calc != null) ...[
            SummaryCard(
              eyebrow: 'Hydraulic & Pneumatic',
              title: txt(calc['label']),
              text: calc['description'] as String?,
              badges: [pill(systemTypeLabels, systemTypeHex, calc['system_type'])],
            ),
            DetailSection('Inputs', action: linkBtn('Reset to defaults', () => _pick(calc)), children: [
              for (final inp in rowsOf(calc['inputs'])) _input(inp),
            ]),
            DetailSection('Results', action: _computing ? const Hint('Calculating…') : null, children: [
              CalcResults(results: _results, warnings: _warnings, error: _calcError, computing: _computing),
            ]),
            if (!canSave)
              const DetailSection('Save this calculation', children: [
                Hint(
                    "You can run the calculator, but saving a calculation needs the 'create' right on Hydraulic & Pneumatic › Calculations — ask an admin (Organization › Role & Permissions)."),
              ])
            else
              DetailSection('Save this calculation', children: [
                if (_saveError != null) Padding(padding: const EdgeInsets.only(bottom: 10), child: ErrorBanner(_saveError!)),
                TextFormField(
                  key: ValueKey('title-$_formKey'),
                  initialValue: _title,
                  onChanged: (v) {
                    _title = v;
                    _titleTouched = true;
                  },
                  decoration: fieldDecoration('Title', required: true),
                ),
                const SizedBox(height: 12),
                AppSelect<int>(
                  key: ValueKey('sys-${calc['system_type']}'),
                  label: 'System (${lbl(systemTypeLabels, calc['system_type'])} only)',
                  value: _systemId,
                  valueLabel: _systemLabel,
                  loadOptions: hydLookup('/hydraulic/lookups/systems', query: {'system_type': calc['system_type']}),
                  onChanged: (o) => setState(() {
                    _systemId = o?.value;
                    _systemLabel = o?.label;
                  }),
                ),
                const SizedBox(height: 12),
                AppTextField(
                    label: 'Remarks',
                    maxLines: 3,
                    initialValue: _remarks,
                    hint: 'Assumptions, the load case, where the figures came from…',
                    onChanged: (v) => _remarks = v),
                const SizedBox(height: 8),
                const Hint('The server re-runs the calculation when saving, so the stored results always match the inputs.'),
                const SizedBox(height: 10),
                SizedBox(
                  width: double.infinity,
                  child: primaryBtn(_saving ? 'Saving…' : 'Save Calculation', _saving ? null : _save),
                ),
              ]),
          ],
        ],
      ),
    );
  }
}
