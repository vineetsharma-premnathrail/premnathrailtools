import 'package:flutter/material.dart';

import '../../api/api.dart';
import '../../theme.dart';
import '../../ui/app_frame.dart';
import '../../ui/form.dart';
import '../../ui/format.dart';
import '../../ui/perms.dart';
import '../../ui/widgets.dart';
import 'quality_common.dart';

/// Quality Masters (portal masters/page.tsx): characteristics, defect codes,
/// disposition codes and the ISO 2859-1 sampling tables + calculator.
class MastersTab extends StatefulWidget {
  const MastersTab({super.key});

  @override
  State<MastersTab> createState() => _MastersTabState();
}

const _tabs = <String, String>{
  'characteristics': 'Inspection characteristics',
  'defect-codes': 'Defect codes',
  'disposition-codes': 'Disposition codes',
  'sampling': 'Sampling (ISO 2859-1)',
};
const _defectCategories = ['dimensional', 'surface', 'material', 'assembly', 'functional', 'documentation'];
const _addButton = <String, String>{
  'characteristics': 'New characteristic',
  'defect-codes': 'New defect code',
  'disposition-codes': 'New disposition code',
};

class _MastersTabState extends State<MastersTab> {
  String _tab = 'characteristics';
  final _listKey = GlobalKey<ApiListViewState>();

  bool get _canCreate => Perm.can('quality', 'masters', 'create');
  bool get _canEdit => Perm.can('quality', 'masters', 'edit');

  Future<void> _toggle(String kind, Json row) async {
    final active = row['is_active'] == true;
    final ok = await runAction(context, () => Api.patch('/quality/masters/$kind/${row['id']}', data: {'is_active': !active}),
        success: active ? 'Retired.' : 'Reactivated.');
    if (ok) _listKey.currentState?.reload();
  }

  Future<void> _add() async {
    final kind = _tab;
    final code = TextEditingController();
    final name = TextEditingController();
    final unit = TextEditingController();
    final gauge = TextEditingController();
    final method = TextEditingController();
    var charType = 'variable';
    var cls = 'minor';
    var category = 'dimensional';
    var dispType = 'rework';
    final title = kind == 'characteristics'
        ? 'New Characteristic'
        : kind == 'defect-codes'
            ? 'New Defect Code'
            : 'New Disposition Code';
    final subtitle = kind == 'characteristics'
        ? 'A dimension or check that inspection plans reuse.'
        : kind == 'defect-codes'
            ? 'Failed results and NCRs are coded with it.'
            : 'What can be done with rejected stock.';
    final ok = await showFormSheet(
      context,
      title: title,
      saveLabel: 'Add',
      builder: (ctx, setS) => [
        Text(subtitle, style: const TextStyle(fontSize: 13, color: Brand.muted)),
        AppTextField(label: 'Code', required: true, controller: code),
        AppTextField(label: 'Name', required: true, controller: name),
        if (kind == 'characteristics') ...[
          AppSelect<String>(
            label: 'Type',
            value: charType,
            clearable: false,
            options: const [Option('variable', 'Measured value'), Option('attribute', 'Pass / fail')],
            onChanged: (o) => setS(() => charType = o?.value ?? charType),
          ),
          AppSelect<String>(
            label: 'Class',
            value: cls,
            clearable: false,
            options: const [Option('critical', 'Critical'), Option('major', 'Major'), Option('minor', 'Minor')],
            onChanged: (o) => setS(() => cls = o?.value ?? cls),
          ),
          AppTextField(label: 'Unit', controller: unit, hint: 'mm'),
          AppTextField(label: 'Gauge type', controller: gauge, hint: 'Vernier, bore gauge…'),
          AppTextField(label: 'Method', controller: method),
        ],
        if (kind == 'defect-codes')
          AppSelect<String>(
            label: 'Category',
            value: category,
            clearable: false,
            options: [for (final c in _defectCategories) Option(c, c)],
            onChanged: (o) => setS(() => category = o?.value ?? category),
          ),
        if (kind == 'disposition-codes') ...[
          AppSelect<String>(
            label: 'Acts as',
            value: dispType,
            clearable: false,
            options: [for (final e in dispositionTypeLabels.entries) Option(e.key, e.value)],
            onChanged: (o) => setS(() => dispType = o?.value ?? dispType),
          ),
          const Text('“Acts as” decides who must approve it and what happens to the Blocked stock.',
              style: TextStyle(fontSize: 12, color: Brand.muted)),
        ],
      ],
      onSave: () async {
        requireField(code.text, 'Code');
        requireField(name.text, 'Name');
        final Json payload = {'code': code.text.trim(), 'name': name.text.trim()};
        if (kind == 'characteristics') {
          payload.addAll({
            'char_type': charType,
            'classification': cls,
            'unit': unit.text.trim(),
            'gauge_type': gauge.text.trim(),
            'method': method.text.trim(),
          });
        } else if (kind == 'defect-codes') {
          payload['category'] = category;
        } else {
          payload['disposition_type'] = dispType;
        }
        await Api.post('/quality/masters/$kind', data: payload);
      },
    );
    if (ok && mounted) {
      showSnack(context, 'Added.');
      _listKey.currentState?.reload();
    }
  }

  Widget _tabRow() => ChipRow(children: [
        for (final e in _tabs.entries)
          CountChip(e.value, null, selected: _tab == e.key, onTap: () => setState(() => _tab = e.key)),
      ]);

  Widget _toggleBtn(String kind, Json r) {
    if (!_canEdit) return const SizedBox.shrink();
    final active = r['is_active'] == true;
    return TextButton(
      onPressed: () => _toggle(kind, r),
      child: Text(active ? 'Retire' : 'Reactivate',
          style: TextStyle(fontSize: 12.5, fontWeight: FontWeight.w600, color: active ? qRed : qGreen)),
    );
  }

  @override
  Widget build(BuildContext context) {
    final fab = _canCreate && _tab != 'sampling' ? CreateFab(label: _addButton[_tab]!, onPressed: _add) : null;
    final header = Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
      const PageHeader('Quality Masters', subtitle: 'Quality Module'),
      _tabRow(),
    ]);
    if (_tab == 'sampling') {
      return Scaffold(backgroundColor: Colors.transparent, body: _SamplingView(header: header));
    }
    final kind = _tab;
    return Scaffold(
      backgroundColor: Colors.transparent,
      floatingActionButton: fab,
      body: ApiListView(
        key: ValueKey('masters-$kind'),
        searchHint: 'Search code or name…',
        header: header,
        load: (page, search) async {
          final p = await Api.list('/quality/masters/$kind', query: {'include_inactive': true});
          final q = search.toLowerCase();
          return ApiPage(q.isEmpty
              ? p.rows
              : p.rows.where((r) => '${r['code']} ${r['name']}'.toLowerCase().contains(q)).toList());
        },
        emptyText: kind == 'defect-codes'
            ? 'No defect codes yet — results that fail need one.'
            : kind == 'characteristics'
                ? 'No characteristics yet.'
                : 'No disposition codes yet.',
        itemBuilder: (ctx, r, reload) {
          final active = r['is_active'] == true;
          final card = switch (kind) {
            'characteristics' => RecordCard(
                code: str(r['code']),
                title: txt(r['name']),
                trailing: Padding(
                    padding: const EdgeInsets.only(left: 8),
                    child: pill(humanize(r['classification']), severityHex[str(r['classification'])])),
                meta: [
                  ('Type', r['char_type'] == 'variable' ? 'Measured' : 'Pass/fail'),
                  ('Unit', txt(r['unit'])),
                  ('Method', txt(r['method'])),
                  ('Gauge type', txt(r['gauge_type'])),
                  ('Status', active ? 'Active' : 'Retired'),
                ],
              ),
            'defect-codes' => RecordCard(
                code: str(r['code']),
                title: txt(r['name']),
                meta: [('Category', txt(r['category'])), ('Status', active ? 'Active' : 'Retired')],
              ),
            _ => RecordCard(
                code: str(r['code']),
                title: txt(r['name']),
                meta: [
                  ('Acts as', lbl(dispositionTypeLabels, r['disposition_type'])),
                  ('Status', active ? 'Active' : 'Retired'),
                ],
              ),
          };
          return Opacity(
            opacity: active ? 1 : 0.55,
            child: Stack(children: [
              card,
              Positioned(right: 20, bottom: 12, child: _toggleBtn(kind, r)),
            ]),
          );
        },
      ),
    );
  }
}

class _SamplingView extends StatefulWidget {
  const _SamplingView({required this.header});
  final Widget header;

  @override
  State<_SamplingView> createState() => _SamplingViewState();
}

class _SamplingViewState extends State<_SamplingView> {
  String _severity = 'normal';
  List<Json> _rows = [];
  String _error = '';
  final _lot = TextEditingController(text: '500');
  final _aql = TextEditingController(text: '1.0');
  String _level = 'II';
  String _calcSeverity = 'normal';
  String _result = '';

  @override
  void initState() {
    super.initState();
    _load();
  }

  @override
  void dispose() {
    _lot.dispose();
    _aql.dispose();
    super.dispose();
  }

  Future<void> _load() async {
    try {
      final r = await Api.get('/quality/masters/sampling/aql-plans', query: {'severity': _severity});
      if (mounted) {
        setState(() {
          _rows = rowsOf(r);
          _error = '';
        });
      }
    } catch (e) {
      if (mounted) setState(() => _error = ApiClient.describe(e));
    }
  }

  Future<void> _calc() async {
    setState(() => _error = '');
    try {
      final r = await Api.get('/quality/masters/sampling/calculate', query: {
        'lot_size': num.tryParse(_lot.text.trim()),
        'aql': num.tryParse(_aql.text.trim()),
        'level': _level,
        'severity': _calcSeverity,
      });
      if (mounted && r is Map) {
        setState(() => _result =
            'Sample ${r['sample_size']}, accept ${r['accept_number']}, reject ${r['reject_number']} — ${txt(r['basis'])}');
      }
    } catch (e) {
      if (mounted) setState(() => _error = ApiClient.describe(e));
    }
  }

  @override
  Widget build(BuildContext context) {
    final letters = <String>[];
    for (final r in _rows) {
      final l = str(r['code_letter']);
      if (!letters.contains(l)) letters.add(l);
    }
    final aqls = <num>{for (final r in _rows) asNum(r['aql']) ?? 0}.toList()..sort();
    return RefreshIndicator(
      onRefresh: _load,
      child: ListView(
        padding: const EdgeInsets.only(bottom: 32),
        children: [
          widget.header,
          if (_error.isNotEmpty) Padding(padding: const EdgeInsets.fromLTRB(16, 4, 16, 8), child: ErrorBanner(_error)),
          DetailSection('Sample size calculator', children: [
            Row(children: [
              Expanded(child: AppTextField(label: 'Lot size', controller: _lot, keyboardType: TextInputType.number)),
              const SizedBox(width: 8),
              Expanded(child: AppTextField(label: 'AQL', controller: _aql, keyboardType: AppTextField.number)),
            ]),
            const SizedBox(height: 10),
            Row(children: [
              Expanded(
                child: AppSelect<String>(
                  label: 'Level',
                  value: _level,
                  clearable: false,
                  options: const [Option('I', 'I'), Option('II', 'II'), Option('III', 'III')],
                  onChanged: (o) => setState(() => _level = o?.value ?? _level),
                ),
              ),
              const SizedBox(width: 8),
              Expanded(
                child: AppSelect<String>(
                  label: 'State',
                  value: _calcSeverity,
                  clearable: false,
                  options: [for (final e in samplingLabels.entries) Option(e.key, e.value)],
                  onChanged: (o) => setState(() => _calcSeverity = o?.value ?? _calcSeverity),
                ),
              ),
            ]),
            ActionWrap(children: [primaryBtn('Calculate', _calc, icon: Icons.calculate_outlined)]),
            if (_result.isNotEmpty)
              Padding(
                padding: const EdgeInsets.only(top: 8),
                child: Text(_result, style: const TextStyle(fontWeight: FontWeight.w600, color: Brand.heading)),
              ),
          ]),
          const Hint('Single sampling plans (n / Ac / Re), arrows already resolved:'),
          Padding(
            padding: const EdgeInsets.fromLTRB(16, 0, 16, 8),
            child: AppSelect<String>(
              label: 'Table',
              value: _severity,
              clearable: false,
              options: const [
                Option('normal', 'Normal (II-A)'),
                Option('tightened', 'Tightened (II-B)'),
                Option('reduced', 'Reduced (II-C)'),
              ],
              onChanged: (o) {
                setState(() => _severity = o?.value ?? _severity);
                _load();
              },
            ),
          ),
          Padding(
            padding: const EdgeInsets.symmetric(horizontal: 16),
            child: Card(
              child: SingleChildScrollView(
                scrollDirection: Axis.horizontal,
                child: DataTable(
                  headingRowHeight: 36,
                  dataRowMinHeight: 30,
                  dataRowMaxHeight: 34,
                  columnSpacing: 14,
                  headingTextStyle: const TextStyle(fontSize: 11, fontWeight: FontWeight.w600, color: Brand.muted),
                  columns: [
                    DataColumn(label: Text('Code (${letters.length})')),
                    for (final a in aqls) DataColumn(label: Text('$a')),
                  ],
                  rows: [
                    for (final l in letters)
                      DataRow(cells: [
                        DataCell(Text(l, style: const TextStyle(fontWeight: FontWeight.w700))),
                        for (final a in aqls)
                          DataCell(Builder(builder: (_) {
                            final r = _rows.where((x) => str(x['code_letter']) == l && asNum(x['aql']) == a).firstOrNull;
                            return Text(r == null ? '—' : '${r['sample_size']} / ${r['accept_number']} / ${r['reject_number']}',
                                style: const TextStyle(fontSize: 11.5));
                          })),
                      ]),
                  ],
                ),
              ),
            ),
          ),
        ],
      ),
    );
  }
}
