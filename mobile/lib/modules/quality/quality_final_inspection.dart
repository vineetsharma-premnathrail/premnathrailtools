import 'package:flutter/material.dart';

import '../../api/api.dart';
import '../../theme.dart';
import '../../ui/app_frame.dart';
import '../../ui/form.dart';
import '../../ui/format.dart';
import '../../ui/perms.dart';
import '../../ui/widgets.dart';
import 'quality_common.dart';

/// RRV Final Inspections (portal final-inspection/page.tsx, new, [id]) and
/// the shared editor of the free-text inspections (/quality/inspections),
/// also used by In-process › Earlier gate inspections.

const inspectionStatusLabels = <String, String>{
  'pending': 'Pending',
  'in_progress': 'In Progress',
  'passed': 'Passed',
  'failed': 'Failed',
  'conditionally_passed': 'Conditionally Passed',
};
const inspectionStatusHex = <String, Color>{
  'pending': Color(0xFFF59E0B),
  'in_progress': Color(0xFF2563EB),
  'passed': Color(0xFF16A34A),
  'failed': Color(0xFFDC2626),
  'conditionally_passed': Color(0xFF7C3AED),
};

/// Card for one free-text inspection in a list.
Widget inspectionCard(BuildContext ctx, Json insp, VoidCallback reload, String type) => RecordCard(
      code: str(insp['inspection_number']),
      title: '${txt(insp['item_name'])}${str(insp['item_code']).isNotEmpty ? ' (${insp['item_code']})' : ''}',
      trailing: Padding(
          padding: const EdgeInsets.only(left: 8), child: qPill(inspectionStatusLabels, inspectionStatusHex, insp['status'])),
      meta: [
        ('Batch', txt(insp['batch_number'])),
        ('Project', txt(insp['project_label'])),
        ('Qty Inspected', txt(insp['quantity_inspected'])),
        ('Date', fmtDate(insp['inspection_date'])),
      ],
      onTap: () async {
        await Navigator.of(ctx).push(MaterialPageRoute(
            builder: (_) => LegacyInspectionScreen(id: asInt(insp['id']), inspectionType: type)));
        reload();
      },
    );

class FinalInspectionTab extends StatefulWidget {
  const FinalInspectionTab({super.key});

  @override
  State<FinalInspectionTab> createState() => _FinalInspectionTabState();
}

class _FinalInspectionTabState extends State<FinalInspectionTab> {
  String _status = '';
  final _listKey = GlobalKey<ApiListViewState>();

  Future<void> _new() async {
    await Navigator.of(context)
        .push(MaterialPageRoute(builder: (_) => const LegacyInspectionScreen(id: null, inspectionType: 'final')));
    _listKey.currentState?.reload();
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: Colors.transparent,
      floatingActionButton: Perm.can('quality', 'final_inspection', 'create')
          ? CreateFab(label: 'New Inspection', onPressed: _new)
          : null,
      body: ApiListView(
        key: _listKey,
        searchHint: 'Search by inspection #, item, batch, or project…',
        load: (page, search) => Api.list('/quality/inspections',
            query: {'inspection_type': 'final', 'status': _status, 'search': search}),
        header: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
          const PageHeader('RRV Final Inspections', subtitle: 'Quality Module'),
          FilterSelect(
            label: 'Status',
            allLabel: 'All statuses',
            value: _status,
            options: inspectionStatusLabels,
            onChanged: (v) {
              setState(() => _status = v);
              _listKey.currentState?.reload();
            },
          ),
        ]),
        emptyText: 'No final inspections found.',
        itemBuilder: (ctx, insp, reload) => inspectionCard(ctx, insp, reload, 'final'),
      ),
    );
  }
}

/// Opens one final inspection (kept for the module's public API).
class FinalInspectionDetailScreen extends StatelessWidget {
  const FinalInspectionDetailScreen({super.key, required this.id});
  final int id;

  @override
  Widget build(BuildContext context) => LegacyInspectionScreen(id: id, inspectionType: 'final');
}

// ── Editor (new + detail) ────────────────────────────────────────────────────

class _Result {
  _Result({String parameter = '', String method = '', String criteria = '', String observed = '', this.result = 'na'})
      : parameter = TextEditingController(text: parameter),
        method = TextEditingController(text: method),
        criteria = TextEditingController(text: criteria),
        observed = TextEditingController(text: observed);
  final TextEditingController parameter;
  final TextEditingController method;
  final TextEditingController criteria;
  final TextEditingController observed;
  String result;

  void dispose() {
    parameter.dispose();
    method.dispose();
    criteria.dispose();
    observed.dispose();
  }
}

/// Free-text inspection: create (id == null) or view / edit / delete.
/// [inspectionType] is 'final' or 'in_process' (decides the permission tab).
class LegacyInspectionScreen extends StatefulWidget {
  const LegacyInspectionScreen({super.key, required this.id, required this.inspectionType});
  final int? id;
  final String inspectionType;

  @override
  State<LegacyInspectionScreen> createState() => _LegacyInspectionScreenState();
}

class _LegacyInspectionScreenState extends State<LegacyInspectionScreen> {
  Json? _insp;
  Object? _loadError;
  String _error = '';
  bool _loading = true;
  bool _saving = false;
  List<Option<int>> _plans = [];

  final _itemName = TextEditingController();
  final _itemCode = TextEditingController();
  final _batch = TextEditingController();
  final _project = TextEditingController();
  final _qtyIns = TextEditingController();
  final _qtyAcc = TextEditingController();
  final _qtyRej = TextEditingController();
  final _remarks = TextEditingController();
  int? _planId;
  DateTime? _date;
  String _status = 'pending';
  final _results = <_Result>[];

  bool get _isNew => widget.id == null;
  String get _tab => widget.inspectionType == 'final' ? 'final_inspection' : 'in_process_inspection';
  bool get _canEdit => _isNew ? Perm.can('quality', _tab, 'create') : Perm.can('quality', _tab, 'edit');
  String get _label => widget.inspectionType == 'final' ? 'Final Inspection' : 'In-Process Inspection';

  @override
  void initState() {
    super.initState();
    _load();
  }

  @override
  void dispose() {
    for (final c in [_itemName, _itemCode, _batch, _project, _qtyIns, _qtyAcc, _qtyRej, _remarks]) {
      c.dispose();
    }
    for (final r in _results) {
      r.dispose();
    }
    super.dispose();
  }

  Future<void> _load() async {
    setState(() {
      _loading = true;
      _loadError = null;
    });
    try {
      final plans = await Api.get('/quality/inspection-plans', query: {'inspection_type': widget.inspectionType});
      _plans = [
        for (final p in rowsOf(plans)) Option(asInt(p['id'])!, '${txt(p['plan_number'])} — ${txt(p['item_name'])}'),
      ];
      if (_isNew) {
        _date = DateTime.now();
        _results.add(_Result());
      } else {
        final r = await Api.get('/quality/inspections/${widget.id}');
        _apply(Map<String, dynamic>.from(r as Map));
      }
      if (mounted) setState(() => _loading = false);
    } catch (e) {
      if (mounted) {
        setState(() {
          _loading = false;
          if (_isNew) {
            _error = 'Failed to load inspection plans: ${ApiClient.describe(e)}';
            _date ??= DateTime.now();
            if (_results.isEmpty) _results.add(_Result());
          } else {
            _loadError = e;
          }
        });
      }
    }
  }

  void _apply(Json i) {
    _insp = i;
    _itemName.text = str(i['item_name']);
    _itemCode.text = str(i['item_code']);
    _batch.text = str(i['batch_number']);
    _project.text = str(i['project_label']);
    _qtyIns.text = numText(i['quantity_inspected']);
    _qtyAcc.text = numText(i['quantity_accepted']);
    _qtyRej.text = numText(i['quantity_rejected']);
    _remarks.text = str(i['remarks']);
    _planId = asInt(i['inspection_plan_id']);
    _date = parseDate(i['inspection_date']);
    _status = str(i['status']).isEmpty ? 'pending' : str(i['status']);
    for (final r in _results) {
      r.dispose();
    }
    _results
      ..clear()
      ..addAll([
        for (final r in rowsOf(i['results']))
          _Result(
            parameter: str(r['parameter']),
            method: str(r['method']),
            criteria: str(r['acceptance_criteria']),
            observed: str(r['observed_value']),
            result: str(r['result']).isEmpty ? 'na' : str(r['result']),
          ),
      ]);
    if (_results.isEmpty) _results.add(_Result());
  }

  num? _n(TextEditingController c, String label) => parseNum(c.text, label);

  Future<void> _save() async {
    if (_saving) return;
    FocusScope.of(context).unfocus();
    setState(() => _error = '');
    if (_itemName.text.trim().isEmpty) {
      setState(() => _error = 'Item name is required.');
      return;
    }
    String? opt(TextEditingController c) => c.text.trim().isEmpty ? null : c.text.trim();
    final Json payload;
    try {
      final filled = _results.where((r) => r.parameter.text.trim().isNotEmpty).toList();
      payload = {
        'inspection_type': widget.inspectionType,
        'inspection_plan_id': _planId,
        'item_name': _itemName.text.trim(),
        'item_code': opt(_itemCode),
        'batch_number': opt(_batch),
        'quantity_inspected': _n(_qtyIns, 'Qty inspected'),
        'quantity_accepted': _n(_qtyAcc, 'Qty accepted'),
        'quantity_rejected': _n(_qtyRej, 'Qty rejected'),
        'project_label': opt(_project),
        'inspection_date': _date == null ? null : apiDate(_date!),
        'status': _status,
        'remarks': opt(_remarks),
        'results': [
          for (var i = 0; i < filled.length; i++)
            {
              'parameter': filled[i].parameter.text.trim(),
              'method': filled[i].method.text,
              'acceptance_criteria': filled[i].criteria.text,
              'observed_value': filled[i].observed.text,
              'result': filled[i].result,
              'sort_order': i + 1,
            },
        ],
      }..removeWhere((k, v) => v == null);
    } catch (e) {
      setState(() => _error = '$e');
      return;
    }
    setState(() => _saving = true);
    try {
      final r = _isNew
          ? await Api.post('/quality/inspections', data: payload)
          : await Api.patch('/quality/inspections/${widget.id}', data: payload);
      if (!mounted) return;
      final saved = Map<String, dynamic>.from(r as Map);
      if (_isNew) {
        showSnack(context, '$_label saved.');
        Navigator.of(context).pushReplacement(MaterialPageRoute(
            builder: (_) => LegacyInspectionScreen(id: asInt(saved['id']), inspectionType: widget.inspectionType)));
      } else {
        setState(() => _apply(saved));
        showSnack(context, 'Changes saved.');
      }
    } catch (e) {
      if (mounted) {
        setState(() => _error = ApiClient.describe(e));
      }
    } finally {
      if (mounted) setState(() => _saving = false);
    }
  }

  Future<void> _delete() async {
    final yes = await confirmDialog(context,
        title: 'Delete this Inspection?',
        message: 'This permanently deletes "${txt(_insp?['inspection_number'])}". This cannot be undone.',
        confirmLabel: 'Delete',
        danger: true);
    if (!yes || !mounted) return;
    final ok = await runAction(context, () => Api.delete('/quality/inspections/${widget.id}'), success: 'Inspection deleted.');
    if (ok && mounted) Navigator.of(context).pop();
  }

  @override
  Widget build(BuildContext context) {
    final title = _isNew
        ? (widget.inspectionType == 'final' ? 'New Final Inspection' : 'New In-Process Inspection')
        : (_insp == null ? _label : txt(_insp!['inspection_number']));
    if (_loading) return SubPage(title: title, body: const LoadingView());
    if (_loadError != null) return SubPage(title: title, body: ErrorView(_loadError!, onRetry: _load));
    final edit = _canEdit;
    final canDelete = !_isNew && qCanDelete(_tab, null);
    return SubPage(
      title: title,
      actions: [
        if (canDelete)
          IconButton(
              tooltip: 'Delete inspection', icon: const Icon(Icons.delete_outline_rounded, color: qRed), onPressed: _delete),
      ],
      bottom: edit
          ? BottomActions(children: [
              primaryBtn(_saving ? 'Saving…' : (_isNew ? 'Save Inspection' : 'Save changes'), _saving ? null : _save,
                  color: const Color(0xFF2563EB)),
            ])
          : null,
      body: ListView(
        padding: const EdgeInsets.only(top: 12, bottom: 32),
        children: [
          Hint(_isNew
              ? 'Quality Module · ${widget.inspectionType == 'final' ? 'Final' : 'In-process'} inspection record with its results.'
              : 'Quality · ${widget.inspectionType == 'final' ? 'Final' : 'In-process'} inspection'
                  '${str(_insp?['item_name']).isNotEmpty ? ' · ${_insp!['item_name']}' : ''}'),
          if (_error.isNotEmpty) Padding(padding: const EdgeInsets.fromLTRB(16, 0, 16, 12), child: ErrorBanner(_error)),
          DetailSection('Inspection details', children: [
            _gap(AppTextField(label: 'Item name', required: true, controller: _itemName, enabled: edit)),
            _gap(AppTextField(label: 'Item code', controller: _itemCode, enabled: edit)),
            _gap(AppTextField(label: 'Batch number', controller: _batch, enabled: edit)),
            _gap(AppTextField(label: 'Project label', controller: _project, enabled: edit)),
            _gap(Row(children: [
              Expanded(child: AppTextField(label: 'Qty inspected', controller: _qtyIns, keyboardType: AppTextField.number, enabled: edit)),
              const SizedBox(width: 8),
              Expanded(child: AppTextField(label: 'Qty accepted', controller: _qtyAcc, keyboardType: AppTextField.number, enabled: edit)),
              const SizedBox(width: 8),
              Expanded(child: AppTextField(label: 'Qty rejected', controller: _qtyRej, keyboardType: AppTextField.number, enabled: edit)),
            ])),
            _gap(AppSelect<int>(
              label: 'Inspection plan',
              value: _planId,
              enabled: edit,
              options: _plans,
              onChanged: (o) => setState(() => _planId = o?.value),
            )),
            _gap(edit
                ? DateField(label: 'Inspection date', value: _date, onChanged: (d) => setState(() => _date = d))
                : FieldRow('Inspection date', fmtDate(_date))),
            _gap(AppSelect<String>(
              label: 'Status',
              value: _status,
              clearable: false,
              enabled: edit,
              options: [for (final e in inspectionStatusLabels.entries) Option(e.key, e.value)],
              onChanged: (o) => setState(() => _status = o?.value ?? _status),
            )),
            AppTextField(label: 'Remarks', controller: _remarks, maxLines: 3, enabled: edit),
          ]),
          DetailSection(
            'Inspection results (${_results.length})',
            action: edit
                ? TextButton.icon(
                    onPressed: () => setState(() => _results.add(_Result())),
                    icon: const Icon(Icons.add_rounded, size: 18),
                    label: const Text('Add result'))
                : null,
            children: [for (var i = 0; i < _results.length; i++) _resultCard(i, edit)],
          ),
        ],
      ),
    );
  }

  Widget _gap(Widget w) => Padding(padding: const EdgeInsets.only(bottom: 12), child: w);

  Widget _resultCard(int i, bool edit) {
    final r = _results[i];
    final border = r.result == 'fail'
        ? qRed.withValues(alpha: 0.5)
        : r.result == 'pass'
            ? qGreen.withValues(alpha: 0.4)
            : Brand.border;
    return Container(
      margin: const EdgeInsets.only(top: 10),
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(borderRadius: BorderRadius.circular(12), border: Border.all(color: border)),
      child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
        Row(children: [
          Expanded(
              child: Text('SL ${i + 1}', style: const TextStyle(fontWeight: FontWeight.w700, color: Brand.muted, fontSize: 12.5))),
          if (edit && _results.length > 1)
            IconButton(
              tooltip: 'Remove result ${i + 1}',
              icon: const Icon(Icons.delete_outline_rounded, color: qRed),
              onPressed: () => setState(() => _results.removeAt(i).dispose()),
            ),
        ]),
        _gap(AppTextField(label: 'Parameter', controller: r.parameter, enabled: edit)),
        _gap(AppTextField(label: 'Method', controller: r.method, enabled: edit)),
        _gap(AppTextField(label: 'Acceptance criteria', controller: r.criteria, enabled: edit)),
        _gap(AppTextField(label: 'Observed value', controller: r.observed, enabled: edit)),
        const Text('Result', style: TextStyle(fontSize: 11.5, color: Brand.muted)),
        const SizedBox(height: 4),
        // One-tap result on the shop floor (portal: Result select N/A / Pass / Fail).
        SegmentedButton<String>(
          showSelectedIcon: false,
          segments: const [
            ButtonSegment(value: 'na', label: Text('N/A')),
            ButtonSegment(value: 'pass', label: Text('Pass')),
            ButtonSegment(value: 'fail', label: Text('Fail')),
          ],
          selected: {r.result},
          onSelectionChanged: edit ? (s) => setState(() => r.result = s.first) : null,
        ),
      ]),
    );
  }
}
