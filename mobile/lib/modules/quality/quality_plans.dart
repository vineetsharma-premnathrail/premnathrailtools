import 'package:flutter/material.dart';

import '../../api/api.dart';
import '../../theme.dart';
import '../../ui/app_frame.dart';
import '../../ui/form.dart';
import '../../ui/format.dart';
import '../../ui/perms.dart';
import '../../ui/widgets.dart';
import 'quality_common.dart';

const _samplingLabel = <String, String>{'aql': 'AQL', 'full': '100%', 'fixed': 'Fixed'};
const _aqls = ['0.065', '0.10', '0.15', '0.25', '0.40', '0.65', '1.0', '1.5', '2.5', '4.0', '6.5', '10.0'];

/// Inspection Plans register (portal inspection-plans/page.tsx).
class InspectionPlansTab extends StatefulWidget {
  const InspectionPlansTab({super.key});

  @override
  State<InspectionPlansTab> createState() => _InspectionPlansTabState();
}

class _InspectionPlansTabState extends State<InspectionPlansTab> {
  String _status = '';
  String _type = '';
  final _listKey = GlobalKey<ApiListViewState>();

  void _reload() => _listKey.currentState?.reload();

  Future<void> _new() async {
    final p = await _showNewPlanForm(context);
    if (p != null && mounted) {
      _reload();
      openScreen(context, InspectionPlanDetailScreen(id: asInt(p['id'])!));
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: Colors.transparent,
      floatingActionButton: Perm.can('quality', 'inspection_plans', 'create')
          ? CreateFab(label: 'New Plan', onPressed: _new)
          : null,
      body: ApiListView(
        key: _listKey,
        searchHint: 'Search plan number or item…',
        load: (page, search) => Api.list('/quality/inspection-plans',
            query: {'status': _status, 'inspection_type': _type, 'search': search}),
        header: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            const PageHeader('Inspection Plans', subtitle: 'Quality Module'),
            const Hint('One approved (current) plan per item and inspection type. Approved plans are frozen — use '
                '“New revision” to change one; approving the revision makes the old one obsolete.'),
            FilterSelect(
              label: 'Inspection type',
              allLabel: 'All inspection types',
              value: _type,
              options: inspectionTypeLabels,
              onChanged: (v) {
                setState(() => _type = v);
                _reload();
              },
            ),
            FilterSelect(
              label: 'Status',
              allLabel: 'All statuses',
              value: _status,
              options: planStatusLabels,
              onChanged: (v) {
                setState(() => _status = v);
                _reload();
              },
            ),
          ],
        ),
        emptyText: _status.isNotEmpty || _type.isNotEmpty
            ? 'No inspection plans match these filters.'
            : 'No inspection plans yet — use + New Plan.',
        itemBuilder: (ctx, p, reload) => RecordCard(
          code: str(p['plan_number']),
          title: '${codeName(p['item_code'], p['item_name'])}${p['item_id'] == null ? ' (legacy — no item link)' : ''}',
          trailing: Padding(padding: const EdgeInsets.only(left: 8), child: qPill(planStatusLabels, planStatusHex, p['status'])),
          meta: [
            ('Inspection type', lbl(inspectionTypeLabels, p['inspection_type'])),
            ('Rev', txt(p['revision'])),
            (
              'Sampling',
              '${_samplingLabel[str(p['sampling_type'])] ?? p['sampling_type']}'
                  '${p['sampling_type'] == 'aql' && p['aql'] != null ? ' ${p['aql']} / ${p['inspection_level']}' : ''}'
            ),
            ('Lines', txt(p['line_count'])),
            ('Approved', p['approved_at'] != null ? '${fmtDate(p['approved_at'])} · ${str(p['approved_by_name'])}' : '—'),
          ],
          onTap: () async {
            await Navigator.of(ctx).push(MaterialPageRoute(builder: (_) => InspectionPlanDetailScreen(id: asInt(p['id'])!)));
            reload();
          },
        ),
      ),
    );
  }
}

// ── New plan (inspection-plans/new/page.tsx) ─────────────────────────────────

Future<Json?> _showNewPlanForm(BuildContext context) async {
  int? itemId;
  String? itemLabel;
  var type = 'incoming';
  final title = TextEditingController();
  var sampling = 'aql';
  var aql = '1.0';
  var level = 'II';
  final fixed = TextEditingController();
  try {
    final s = await Api.get('/quality/settings');
    final v = s is Map && s['values'] is Map ? Map<String, dynamic>.from(s['values'] as Map) : <String, dynamic>{};
    if (str(v['default_sampling_type']).isNotEmpty) sampling = str(v['default_sampling_type']);
    if (str(v['default_aql']).isNotEmpty) aql = str(v['default_aql']);
    if (str(v['default_inspection_level']).isNotEmpty) level = str(v['default_inspection_level']);
  } catch (_) {}
  if (!context.mounted) return null;
  Json? created;
  final ok = await showFormSheet(
    context,
    title: 'New Inspection Plan',
    saveLabel: 'Create draft',
    builder: (ctx, setS) => [
      const Text('Create the draft plan header — characteristics are added on the plan next.',
          style: TextStyle(fontSize: 13, color: Brand.muted)),
      const Caps('Plan header'),
      AppSelect<int>(
        label: 'Item',
        required: true,
        value: itemId,
        valueLabel: itemLabel,
        loadOptions: loadQualityItems,
        onChanged: (o) => setS(() {
          itemId = o?.value;
          itemLabel = o?.label;
        }),
      ),
      AppSelect<String>(
        label: 'Inspection type',
        value: type,
        clearable: false,
        options: [for (final e in inspectionTypeLabels.entries) Option(e.key, e.value)],
        onChanged: (o) => setS(() => type = o?.value ?? type),
      ),
      AppTextField(label: 'Title', controller: title),
      const Caps('Sampling'),
      AppSelect<String>(
        label: 'Sampling',
        value: sampling,
        clearable: false,
        options: const [
          Option('aql', 'AQL table (ISO 2859-1)'),
          Option('full', '100% inspection'),
          Option('fixed', 'Fixed quantity'),
        ],
        onChanged: (o) => setS(() => sampling = o?.value ?? sampling),
      ),
      if (sampling == 'aql') ...[
        AppSelect<String>(
          label: 'AQL',
          value: aql,
          clearable: false,
          options: [for (final a in _aqls) Option(a, a)],
          onChanged: (o) => setS(() => aql = o?.value ?? aql),
        ),
        AppSelect<String>(
          label: 'Level',
          value: level,
          clearable: false,
          options: const [Option('I', 'General I'), Option('II', 'General II'), Option('III', 'General III')],
          onChanged: (o) => setS(() => level = o?.value ?? level),
        ),
      ],
      if (sampling == 'fixed') AppTextField(label: 'Sample size', controller: fixed, keyboardType: TextInputType.number),
      const Text('Critical characteristics are always inspected 100% with accept number 0, whatever the sampling.',
          style: TextStyle(fontSize: 12, color: Brand.muted)),
    ],
    onSave: () async {
      if (itemId == null) throw 'Pick the item this plan is for.';
      final r = await Api.post('/quality/inspection-plans', data: {
        'item_id': itemId,
        'inspection_type': type,
        'title': title.text.trim().isEmpty ? null : title.text.trim(),
        'sampling_type': sampling,
        'aql': sampling == 'aql' ? num.tryParse(aql) : null,
        'inspection_level': level,
        'fixed_sample_size': sampling == 'fixed' ? parseNum(fixed.text, 'Sample size') : null,
        'lines': <Json>[],
      });
      created = r is Map ? Map<String, dynamic>.from(r) : null;
    },
  );
  return ok ? created : null;
}

// ── Plan detail (inspection-plans/[id]/page.tsx) ─────────────────────────────

class _Line {
  _Line({
    required this.characteristicId,
    String nominal = '',
    String min = '',
    String max = '',
    this.classification = '',
    String method = '',
    this.aql = '',
  })  : nominal = TextEditingController(text: nominal),
        min = TextEditingController(text: min),
        max = TextEditingController(text: max),
        method = TextEditingController(text: method);
  final int characteristicId;
  final TextEditingController nominal;
  final TextEditingController min;
  final TextEditingController max;
  final TextEditingController method;
  String classification;
  String aql;

  void dispose() {
    nominal.dispose();
    min.dispose();
    max.dispose();
    method.dispose();
  }
}

String _s(Object? v) => v == null ? '' : '$v';

class InspectionPlanDetailScreen extends StatefulWidget {
  const InspectionPlanDetailScreen({super.key, required this.id});
  final int id;

  @override
  State<InspectionPlanDetailScreen> createState() => _InspectionPlanDetailScreenState();
}

class _InspectionPlanDetailScreenState extends State<InspectionPlanDetailScreen> {
  Json? _plan;
  Object? _error;
  bool _busy = false;
  List<Json> _chars = [];
  final _lines = <_Line>[];

  String get _base => '/quality/inspection-plans/${widget.id}';

  @override
  void initState() {
    super.initState();
    _load();
    Api.get('/quality/masters/characteristics').then((r) {
      if (mounted) setState(() => _chars = rowsOf(r));
    }).catchError((_) {});
  }

  @override
  void dispose() {
    for (final l in _lines) {
      l.dispose();
    }
    super.dispose();
  }

  Future<void> _load() async {
    try {
      final r = await Api.get(_base);
      if (mounted) _apply(Map<String, dynamic>.from(r as Map));
    } catch (e) {
      if (mounted) setState(() => _error = e);
    }
  }

  void _apply(Json p) {
    for (final l in _lines) {
      l.dispose();
    }
    _lines
      ..clear()
      ..addAll([
        for (final l in rowsOf(p['lines']))
          _Line(
            characteristicId: asInt(l['characteristic_id'])!,
            nominal: _s(l['nominal']),
            min: _s(l['min_value']),
            max: _s(l['max_value']),
            classification: str(l['classification']),
            method: str(l['method']),
            aql: _s(l['aql']),
          ),
      ]);
    setState(() {
      _plan = p;
      _error = null;
    });
  }

  Future<void> _run(Future<dynamic> Function() fn, {String? success, void Function(Json)? go}) async {
    if (_busy) return;
    setState(() => _busy = true);
    try {
      final r = await fn();
      if (!mounted) return;
      final p = r is Map ? Map<String, dynamic>.from(r) : null;
      if (go != null && p != null) {
        go(p);
      } else if (p != null) {
        _apply(p);
      }
      if (success != null) showSnack(context, success);
    } catch (e) {
      if (mounted) showSnack(context, ApiClient.describe(e), error: true);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _save() async {
    try {
      final lines = [
        for (var i = 0; i < _lines.length; i++)
          {
            'characteristic_id': _lines[i].characteristicId,
            'sequence': (i + 1) * 10,
            'nominal': parseNum(_lines[i].nominal.text, 'Nominal'),
            'min_value': parseNum(_lines[i].min.text, 'Min'),
            'max_value': parseNum(_lines[i].max.text, 'Max'),
            'classification': _lines[i].classification.isEmpty ? null : _lines[i].classification,
            'method': _lines[i].method.text.trim().isEmpty ? null : _lines[i].method.text.trim(),
            'aql': _lines[i].aql.isEmpty ? null : num.tryParse(_lines[i].aql),
          },
      ];
      await _run(() => Api.patch(_base, data: {'lines': lines}), success: 'Draft saved.');
    } catch (e) {
      if (e is String && mounted) showSnack(context, e, error: true);
    }
  }

  Future<void> _addChar() async {
    final plan = _plan!;
    int? pick;
    final ok = await showFormSheet(
      context,
      title: 'Add characteristic',
      saveLabel: 'Add to plan',
      builder: (ctx, setS) => [
        Text('${txt(plan['plan_number'])} · rev ${txt(plan['revision'])} · ${txt(plan['item_name'])}',
            style: const TextStyle(color: Brand.muted)),
        AppSelect<int>(
          label: 'Characteristic',
          required: true,
          value: pick,
          options: [
            for (final c in _chars)
              if (!_lines.any((l) => l.characteristicId == asInt(c['id'])))
                Option(asInt(c['id'])!, '${txt(c['code'])} — ${txt(c['name'])} (${txt(c['classification'])})'),
          ],
          onChanged: (o) => setS(() => pick = o?.value),
        ),
        const Text(
            'Set the nominal / limits, class override, AQL and method on the card, then “Save draft”. '
            'Missing one? Add it in Quality → Masters.',
            style: TextStyle(fontSize: 12, color: Brand.muted)),
      ],
      onSave: () async {
        if (pick == null) throw 'Pick the characteristic to add.';
      },
    );
    if (ok && pick != null && mounted) setState(() => _lines.add(_Line(characteristicId: pick!)));
  }

  Future<void> _obsolete() async {
    final yes = await confirmDialog(context,
        title: 'Make this plan obsolete?',
        message: 'New lots for this item and inspection type will have no approved plan until a new one is approved.',
        confirmLabel: 'Make obsolete',
        danger: true);
    if (yes) await _run(() => Api.post('$_base/obsolete'), success: 'Plan is obsolete.');
  }

  Future<void> _delete() async {
    final yes = await confirmDialog(context,
        title: 'Delete this draft?',
        message: 'The draft plan is removed (kept in the audit trail).',
        confirmLabel: 'Delete draft',
        danger: true);
    if (!yes || !mounted) return;
    final ok = await runAction(context, () => Api.delete(_base), success: 'Draft deleted.');
    if (ok && mounted) Navigator.of(context).pop();
  }

  @override
  Widget build(BuildContext context) {
    final plan = _plan;
    if (plan == null) {
      return SubPage(
          title: 'Inspection Plan', body: _error != null ? ErrorView(_error!, onRetry: _load) : const LoadingView());
    }
    final status = str(plan['status']);
    final isDraft = status == 'draft';
    final draft = isDraft && Perm.can('quality', 'inspection_plans', 'edit');
    final typeLabel = lbl(inspectionTypeLabels, plan['inspection_type']);
    final charById = {for (final c in _chars) asInt(c['id']): c};
    final planLines = rowsOf(plan['lines']);

    return SubPage(
      title: '${txt(plan['plan_number'])} · rev ${txt(plan['revision'])}',
      bottom: draft
          ? BottomActions(children: [
              secondaryBtn('Add characteristic', _addChar, icon: Icons.add_rounded),
              primaryBtn(_busy ? 'Saving…' : 'Save draft', _busy ? null : _save, color: const Color(0xFF2563EB)),
            ])
          : null,
      body: RefreshIndicator(
        onRefresh: _load,
        child: ListView(
          padding: const EdgeInsets.only(top: 12, bottom: 32),
          children: [
            Hint('Inspection plan · $typeLabel'),
            DetailSection(codeName(plan['item_code'], plan['item_name']), children: [
              Text(
                  str(plan['title']).isNotEmpty
                      ? str(plan['title'])
                      : 'What to check on every ${typeLabel.toLowerCase()} lot of this item, and how many pieces to sample.',
                  style: const TextStyle(fontSize: 13.5)),
              const SizedBox(height: 8),
              Wrap(spacing: 8, runSpacing: 4, crossAxisAlignment: WrapCrossAlignment.center, children: [
                qPill(planStatusLabels, planStatusHex, status),
                Text('Created by ${txt(plan['created_by_name'])}', style: const TextStyle(fontSize: 12, color: Brand.muted)),
                if (plan['approved_at'] != null)
                  Text(
                      'Approved ${fmtDate(plan['approved_at'])}${str(plan['approved_by_name']).isNotEmpty ? ' by ${plan['approved_by_name']}' : ''}',
                      style: const TextStyle(fontSize: 12, color: Brand.muted)),
              ]),
              const SizedBox(height: 6),
              FieldRow('Inspection type', typeLabel),
              FieldRow(
                  'Sampling',
                  plan['sampling_type'] == 'aql'
                      ? 'AQL ${plan['aql'] ?? '—'}, level ${plan['inspection_level']}'
                      : plan['sampling_type'] == 'full'
                          ? '100%'
                          : 'Fixed ${plan['fixed_sample_size']}'),
              if (plan['item_id'] == null)
                const Text(
                    'Legacy plan with no Item Master link — it can\'t be approved. Create a new plan for the item instead.',
                    style: TextStyle(fontSize: 12.5, color: Color(0xFFB45309))),
              ActionWrap(children: [
                if (isDraft && Perm.can('quality', 'inspection_plans', 'submit'))
                  primaryBtn('Submit for approval',
                      _busy ? null : () => _run(() => Api.post('$_base/submit'), success: 'Submitted for approval.'),
                      icon: Icons.send_rounded),
                if (isDraft && Perm.can('quality', 'inspection_plans', 'approve'))
                  secondaryBtn('Approve now (Quality head)',
                      _busy ? null : () => _run(() => Api.post('$_base/approve'), success: 'Plan approved.'),
                      icon: Icons.verified_outlined),
                if (isDraft && qCanDelete('inspection_plans', plan['created_by_id']))
                  secondaryBtn('Delete draft', _busy ? null : _delete, color: qRed, icon: Icons.delete_outline_rounded),
                if (status == 'approved' && Perm.can('quality', 'inspection_plans', 'create'))
                  primaryBtn(
                      'New revision',
                      _busy
                          ? null
                          : () => _run(() => Api.post('$_base/new-revision'),
                              go: (p) => Navigator.of(context).pushReplacement(MaterialPageRoute(
                                  builder: (_) => InspectionPlanDetailScreen(id: asInt(p['id'])!)))),
                      icon: Icons.copy_rounded),
                if (status != 'obsolete' && status != 'pending_approval' && !isDraft && Perm.can('quality', 'inspection_plans', 'approve'))
                  secondaryBtn('Make obsolete', _busy ? null : _obsolete, color: qRed, icon: Icons.block_rounded),
              ]),
              if (status == 'pending_approval')
                const Padding(
                  padding: EdgeInsets.only(top: 8),
                  child: Text(
                      'Waiting for approval — the approvers decide below (Organization › Approval Workflows › Inspection plan). '
                      'Returned or withdrawn plans come back as drafts.',
                      style: TextStyle(fontSize: 12.5, color: Brand.muted)),
                ),
            ]),
            ApprovalPanel(key: ValueKey(status), entityType: 'quality_inspection_plan', entityId: widget.id, onChanged: _load),
            DetailSection('Characteristics (${_lines.length})', children: [
              if (_lines.isEmpty) const Text('No characteristics yet.', style: TextStyle(color: Brand.muted)),
              for (var i = 0; i < _lines.length; i++) _lineCard(i, charById, planLines, draft),
              if (draft)
                const Padding(
                  padding: EdgeInsets.only(top: 8),
                  child: Text('Missing a characteristic? Add it in Quality → Masters. Changes are kept only after “Save draft”.',
                      style: TextStyle(fontSize: 12, color: Brand.muted)),
                ),
            ]),
          ],
        ),
      ),
    );
  }

  Widget _lineCard(int i, Map<int?, Json> charById, List<Json> planLines, bool draft) {
    final l = _lines[i];
    final ch = charById[l.characteristicId];
    final pl = planLines.where((x) => asInt(x['characteristic_id']) == l.characteristicId).firstOrNull;
    final name = ch != null
        ? '${txt(ch['code'])} — ${txt(ch['name'])}'
        : '${str(pl?['characteristic_code'])} — ${str(pl?['characteristic_name']).isEmpty ? l.characteristicId : pl?['characteristic_name']}';
    final type = str(ch?['char_type'] ?? pl?['char_type']);
    final cls = l.classification.isNotEmpty
        ? l.classification
        : str(ch?['classification'] ?? pl?['effective_classification']).isEmpty
            ? 'minor'
            : str(ch?['classification'] ?? pl?['effective_classification']);
    final unit = str(ch?['unit']);
    final attr = type == 'attribute';
    return Container(
      margin: const EdgeInsets.only(top: 10),
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(borderRadius: BorderRadius.circular(12), border: Border.all(color: Brand.border)),
      child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
        Row(children: [
          Expanded(
            child: Text('${i + 1}. $name${unit.isNotEmpty ? ' ($unit)' : ''}',
                style: const TextStyle(fontWeight: FontWeight.w700, color: Brand.heading)),
          ),
          if (draft)
            IconButton(
              tooltip: 'Remove $name',
              icon: const Icon(Icons.delete_outline_rounded, color: qRed),
              onPressed: () => setState(() => _lines.removeAt(i).dispose()),
            ),
        ]),
        KvRow('Type', attr ? 'Pass/fail' : 'Measured'),
        if (!draft) ...[
          Row(children: [
            const Expanded(flex: 2, child: Text('Class', style: TextStyle(fontSize: 12.5, color: Brand.muted))),
            Expanded(flex: 3, child: Align(alignment: Alignment.centerLeft, child: pill(humanize(cls), severityHex[cls]))),
          ]),
          KvRow('Nominal', l.nominal.text.isEmpty ? '—' : l.nominal.text),
          KvRow('Min', l.min.text.isEmpty ? '—' : l.min.text),
          KvRow('Max', l.max.text.isEmpty ? '—' : l.max.text),
          KvRow('AQL', l.aql.isEmpty ? 'Plan' : l.aql),
          KvRow('Method', l.method.text.isNotEmpty ? l.method.text : txt(ch?['method'])),
        ] else ...[
          const SizedBox(height: 8),
          AppSelect<String>(
            label: 'Class',
            value: l.classification,
            clearable: false,
            options: [
              Option('', 'Default (${str(ch?['classification']).isEmpty ? '—' : ch!['classification']})'),
              const Option('critical', 'Critical'),
              const Option('major', 'Major'),
              const Option('minor', 'Minor'),
            ],
            onChanged: (o) => setState(() => l.classification = o?.value ?? ''),
          ),
          const SizedBox(height: 10),
          Row(children: [
            Expanded(child: AppTextField(label: 'Nominal', controller: l.nominal, keyboardType: AppTextField.number, enabled: !attr)),
            const SizedBox(width: 8),
            Expanded(child: AppTextField(label: 'Min', controller: l.min, keyboardType: AppTextField.number, enabled: !attr)),
            const SizedBox(width: 8),
            Expanded(child: AppTextField(label: 'Max', controller: l.max, keyboardType: AppTextField.number, enabled: !attr)),
          ]),
          const SizedBox(height: 10),
          AppSelect<String>(
            label: 'AQL',
            value: l.aql,
            clearable: false,
            options: [const Option('', 'Plan'), for (final a in _aqls) Option(a, a)],
            onChanged: (o) => setState(() => l.aql = o?.value ?? ''),
          ),
          const SizedBox(height: 10),
          AppTextField(label: 'Method', controller: l.method, hint: str(ch?['method'])),
        ],
      ]),
    );
  }
}
