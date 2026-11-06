import 'package:flutter/material.dart';

import '../../api/api.dart';
import '../../theme.dart';
import '../../ui/app_frame.dart';
import '../../ui/form.dart';
import '../../ui/format.dart';
import '../../ui/perms.dart';
import '../../ui/widgets.dart';
import 'quality_common.dart';
import 'quality_complaints.dart';
import 'quality_ncr.dart';

/// CAPA (8D) register (portal capa/page.tsx).
class CapaTab extends StatefulWidget {
  const CapaTab({super.key});

  @override
  State<CapaTab> createState() => _CapaTabState();
}

class _CapaTabState extends State<CapaTab> {
  String _status = 'live';
  String _trigger = '';
  bool _mine = false;
  bool _overdue = false;
  final _listKey = GlobalKey<ApiListViewState>();

  void _reload() => _listKey.currentState?.reload();

  Future<void> _new() async {
    final c = await showNewCapaForm(context);
    if (c != null && mounted) {
      _reload();
      openScreen(context, CapaDetailScreen(id: asInt(c['id'])!));
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: Colors.transparent,
      floatingActionButton: Perm.can('quality', 'capa', 'create') ? CreateFab(label: 'New CAPA', onPressed: _new) : null,
      body: ApiListView(
        key: _listKey,
        searchHint: 'Search CAPA number, title, item…',
        load: (page, search) => Api.list('/quality/capa', query: {
          if (_status == 'live') 'open_only': true else 'status': _status,
          'trigger': _trigger,
          'search': search,
          if (_mine) 'mine': true,
          if (_overdue) 'overdue_only': true,
        }),
        header: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            const PageHeader('CAPA (8D)', subtitle: 'Quality · Corrective & preventive actions'),
            AppSelectFilter(
              label: 'Status',
              value: _status,
              options: {'live': 'All not closed', '': 'All statuses', ...capaStatusLabels},
              onChanged: (v) {
                setState(() => _status = v);
                _reload();
              },
            ),
            FilterSelect(
              label: 'Trigger',
              allLabel: 'Any trigger',
              value: _trigger,
              options: capaTriggerLabels,
              onChanged: (v) {
                setState(() => _trigger = v);
                _reload();
              },
            ),
            ChipRow(children: [
              CountChip('Mine (owner / team / action)', null, selected: _mine, onTap: () {
                setState(() => _mine = !_mine);
                _reload();
              }),
              CountChip('Overdue only', null, selected: _overdue, color: qRed, onTap: () {
                setState(() => _overdue = !_overdue);
                _reload();
              }),
            ]),
          ],
        ),
        emptyText: 'No CAPAs found — use + New CAPA to open one.',
        itemBuilder: (ctx, c, reload) => RecordCard(
          code: str(c['capa_number']),
          title: txt(c['title']),
          trailing: Padding(padding: const EdgeInsets.only(left: 8), child: qPill(capaStatusLabels, capaStatusHex, c['status'])),
          meta: [
            (
              'Raised for',
              '${lbl(capaTriggerLabels, c['trigger'])}${str(c['ncr_number']).isNotEmpty ? ' · ${c['ncr_number']}' : ''}'
                  '${str(c['complaint_number']).isNotEmpty ? ' · ${c['complaint_number']}' : ''}'
            ),
            ('Severity', humanize(c['severity'])),
            ('Owner', str(c['responsible_user_name']).isEmpty ? 'Not assigned' : str(c['responsible_user_name'])),
            ('Open actions', '${c['open_actions'] ?? 0}${c['overdue'] == true ? ' · overdue' : ''}'),
            ('Opened', fmtDate(c['created_at'])),
          ],
          onTap: () async {
            await Navigator.of(ctx).push(MaterialPageRoute(builder: (_) => CapaDetailScreen(id: asInt(c['id'])!)));
            reload();
          },
        ),
      ),
    );
  }
}

/// Dropdown filter whose options already include the "all" entries.
class AppSelectFilter extends StatelessWidget {
  const AppSelectFilter({super.key, required this.label, required this.value, required this.options, required this.onChanged});
  final String label;
  final String value;
  final Map<String, String> options;
  final ValueChanged<String> onChanged;

  @override
  Widget build(BuildContext context) => Padding(
        padding: const EdgeInsets.fromLTRB(16, 0, 16, 8),
        child: AppSelect<String>(
          label: label,
          value: value,
          clearable: false,
          options: [for (final e in options.entries) Option(e.key, e.value)],
          onChanged: (o) => onChanged(o?.value ?? ''),
        ),
      );
}

// ── New CAPA (capa/new/page.tsx) ─────────────────────────────────────────────

/// "New CAPA" form; [ncrId] pre-links an NCR. Returns the created CAPA.
Future<Json?> showNewCapaForm(BuildContext context, {int? ncrId}) async {
  List<Option<int>> codes = [];
  List<Json> ncrs = [];
  try {
    final r = await Future.wait([
      Api.get('/quality/masters/defect-codes'),
      Api.get('/quality/ncr', query: {'open_only': true}),
    ]);
    codes = [
      for (final c in rowsOf(r[0]))
        if (c['is_active'] != false) Option(asInt(c['id'])!, '${txt(c['code'])} — ${txt(c['name'])}'),
    ];
    ncrs = rowsOf(r[1]);
  } catch (_) {}
  if (!context.mounted) return null;
  final title = TextEditingController();
  var type = 'corrective';
  var severity = 'major';
  int? itemId;
  String? itemLabel;
  int? codeId;
  final vendor = TextEditingController();
  final audit = TextEditingController();
  final problem = TextEditingController();
  int? ownerId;
  String? ownerLabel;
  DateTime? due;
  final ncrIds = <int>[?ncrId];
  Json? created;
  String ncrLabel(int id) {
    final n = ncrs.where((x) => asInt(x['id']) == id).firstOrNull;
    return n == null ? 'NCR #$id' : txt(n['ncr_number']);
  }

  final ok = await showFormSheet(
    context,
    title: 'New CAPA',
    saveLabel: 'Raise CAPA',
    builder: (ctx, setS) => [
      const Text('Quality · CAPA (8D) — the 8D steps (team, containment, root cause, actions) are filled in on the CAPA itself.',
          style: TextStyle(fontSize: 13, color: Brand.muted)),
      const Caps('Problem'),
      AppTextField(label: 'Title', required: true, controller: title, hint: 'The problem in one line'),
      AppSelect<String>(
        label: 'Type',
        value: type,
        clearable: false,
        options: const [Option('corrective', 'Corrective'), Option('preventive', 'Preventive')],
        onChanged: (o) => setS(() => type = o?.value ?? type),
      ),
      AppSelect<String>(
        label: 'Severity',
        value: severity,
        clearable: false,
        options: const [Option('minor', 'Minor'), Option('major', 'Major'), Option('critical', 'Critical')],
        onChanged: (o) => setS(() => severity = o?.value ?? severity),
      ),
      AppSelect<int>(
        label: 'Item',
        value: itemId,
        valueLabel: itemLabel,
        loadOptions: loadQualityItems,
        onChanged: (o) => setS(() {
          itemId = o?.value;
          itemLabel = o?.label;
        }),
      ),
      AppSelect<int>(label: 'Defect code', value: codeId, options: codes, onChanged: (o) => setS(() => codeId = o?.value)),
      AppTextField(label: 'Vendor', controller: vendor),
      AppTextField(label: 'Audit reference', controller: audit),
      AppTextField(label: 'D2 — Problem description', controller: problem, maxLines: 4, hint: 'What, where, when, how many, how found'),
      const Caps('D1 — Owner'),
      AppSelect<int>(
        label: 'CAPA owner (champion)',
        value: ownerId,
        valueLabel: ownerLabel,
        loadOptions: loadQualityUsers,
        onChanged: (o) => setS(() {
          ownerId = o?.value;
          ownerLabel = o?.label;
        }),
      ),
      DateField(label: 'Target date', value: due, onChanged: (d) => setS(() => due = d)),
      const Caps('Linked NCRs'),
      if (ncrIds.isNotEmpty)
        Wrap(spacing: 6, runSpacing: 6, children: [
          for (final id in ncrIds)
            InputChip(label: Text(ncrLabel(id)), onDeleted: () => setS(() => ncrIds.remove(id))),
        ]),
      AppSelect<int>(
        label: 'Search open NCRs by number or item…',
        value: null,
        options: [
          for (final n in ncrs)
            if (!ncrIds.contains(asInt(n['id'])))
              Option(asInt(n['id'])!, '${txt(n['ncr_number'])} — ${txt(n['item_name'])} (${txt(n['severity'])})'),
        ],
        onChanged: (o) => setS(() {
          if (o != null) ncrIds.add(o.value);
        }),
      ),
      const Text(
          'Major / Critical NCRs, repeat defects, customer complaints, vendor rating drops and audit findings raise CAPAs '
          'automatically — raise one here for anything else.',
          style: TextStyle(fontSize: 12, color: Brand.muted)),
    ],
    onSave: () async {
      if (title.text.trim().isEmpty) throw 'Give the CAPA a short title (the problem in one line).';
      final r = await Api.post('/quality/capa', data: {
        'title': title.text.trim(),
        'action_type': type,
        'severity': severity,
        'ncr_ids': ncrIds,
        'item_id': itemId,
        'vendor_name': vendor.text.trim().isEmpty ? null : vendor.text.trim(),
        'defect_code_id': codeId,
        'problem_statement': problem.text.trim().isEmpty ? null : problem.text.trim(),
        'audit_reference': audit.text.trim().isEmpty ? null : audit.text.trim(),
        'responsible_user_id': ownerId,
        'due_date': due == null ? null : apiDate(due!),
      });
      created = r is Map ? Map<String, dynamic>.from(r) : null;
    },
  );
  return ok ? created : null;
}

// ── CAPA detail (capa/[id]/page.tsx) ─────────────────────────────────────────

const _steps = ['open', 'root_cause_found', 'actions_in_progress', 'effectiveness_check', 'closed'];
const _analysisEditable = ['open', 'reopened', 'root_cause_found'];
const _fishboneLabels = <String, String>{
  'man': 'Man (people / skill)',
  'machine': 'Machine',
  'method': 'Method',
  'material': 'Material',
  'measurement': 'Measurement',
  'environment': 'Environment',
};

class CapaDetailScreen extends StatefulWidget {
  const CapaDetailScreen({super.key, required this.id});
  final int id;

  @override
  State<CapaDetailScreen> createState() => _CapaDetailScreenState();
}

class _CapaDetailScreenState extends State<CapaDetailScreen> {
  Json? _capa;
  Object? _error;
  bool _busy = false;
  Json _meta = {};
  List<Json> _ncrs = [];

  final _problem = TextEditingController();
  final _containment = TextEditingController();
  final _rootCause = TextEditingController();
  final _impl = TextEditingController();
  final _prevReason = TextEditingController();
  String _method = '';
  final _why = <TextEditingController>[];
  final _fish = <String, TextEditingController>{};

  String get _base => '/quality/capa/${widget.id}';

  bool get _canEdit => Perm.can('quality', 'capa', 'edit');
  bool get _canApprove => Perm.can('quality', 'capa', 'approve');
  bool _cf(String f, String a) => Perm.canFeature('quality', 'capa', f, a);
  bool get _holdsTab => Perm.can('quality', 'capa', 'view');
  bool get _seeTeam => !_holdsTab || _cf('team', 'view');
  bool get _canTeam => _cf('team', 'edit');
  bool get _seeActions => !_holdsTab || _cf('actions', 'view');
  bool get _canAddAction => _cf('actions', 'create');
  bool get _canCancelAction => _cf('actions', 'cancel');
  bool get _canVerdict => _canApprove && _cf('effectiveness', 'approve');

  @override
  void initState() {
    super.initState();
    _load();
    Api.get('/quality/capa/meta').then((m) {
      if (mounted && m is Map) setState(() => _meta = Map<String, dynamic>.from(m));
    }).catchError((_) {});
    Api.get('/quality/ncr').then((r) {
      if (mounted) setState(() => _ncrs = rowsOf(r));
    }).catchError((_) {});
  }

  @override
  void dispose() {
    for (final c in [_problem, _containment, _rootCause, _impl, _prevReason, ..._why, ..._fish.values]) {
      c.dispose();
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

  void _apply(Json c) {
    _problem.text = str(c['problem_statement']);
    _containment.text = str(c['containment_actions']);
    _rootCause.text = str(c['root_cause']);
    _impl.text = str(c['implementation_summary']);
    _prevReason.text = str(c['prevention_not_needed_reason']);
    _method = str(c['root_cause_method']);
    for (final w in _why) {
      w.dispose();
    }
    _why.clear();
    final whys = (c['why_analysis'] is List && (c['why_analysis'] as List).isNotEmpty)
        ? (c['why_analysis'] as List).map((e) => '$e').toList()
        : ['', '', ''];
    _why.addAll(whys.map((w) => TextEditingController(text: w)));
    final fb = c['fishbone'] is Map ? Map<String, dynamic>.from(c['fishbone'] as Map) : <String, dynamic>{};
    for (final k in _fishboneLabels.keys) {
      final v = fb[k] is List ? (fb[k] as List).map((e) => '$e').join('\n') : '';
      _fish.putIfAbsent(k, () => TextEditingController()).text = v;
    }
    setState(() {
      _capa = c;
      _error = null;
    });
  }

  Future<bool> _run(Future<dynamic> Function() fn, {String? success}) async {
    if (_busy) return false;
    setState(() => _busy = true);
    try {
      final r = await fn();
      if (!mounted) return true;
      if (r is Map) _apply(Map<String, dynamic>.from(r));
      if (success != null) showSnack(context, success);
      return true;
    } catch (e) {
      if (mounted) showSnack(context, ApiClient.describe(e), error: true);
      return false;
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  /// For form sheets: lets the error through to the sheet.
  Future<void> _sheet(Future<dynamic> Function() fn) async {
    final r = await fn();
    if (mounted && r is Map) _apply(Map<String, dynamic>.from(r));
  }

  Json _analysisPayload() {
    final fishbone = <String, List<String>>{};
    _fish.forEach((k, c) {
      final causes = c.text.split('\n').map((x) => x.trim()).where((x) => x.isNotEmpty).toList();
      if (causes.isNotEmpty) fishbone[k] = causes;
    });
    return {
      'problem_statement': _problem.text,
      'containment_actions': _containment.text,
      'root_cause_method': _method.isEmpty ? null : _method,
      'root_cause': _rootCause.text,
      'why_analysis': _why.map((w) => w.text.trim()).where((w) => w.isNotEmpty).toList(),
      'fishbone': fishbone,
    };
  }

  Future<void> _setTeam(List<Json> members) => _sheet(() => Api.put('$_base/team', data: {'members': members}));

  List<Json> _teamPayload(List<Json> team) =>
      [for (final m in team) {'user_id': m['user_id'], 'role': m['role'], 'department': m['department']}];

  Future<void> _addMember() async {
    final capa = _capa!;
    final team = rowsOf(capa['team']);
    int? userId;
    String? userLabel;
    var role = 'member';
    final dept = TextEditingController();
    final ok = await showFormSheet(
      context,
      title: 'Add team member',
      saveLabel: 'Add to team',
      builder: (ctx, setS) => [
        Text('${txt(capa['capa_number'])} · D1 — 8D team', style: const TextStyle(color: Brand.muted)),
        AppSelect<int>(
          label: 'Person',
          required: true,
          value: userId,
          valueLabel: userLabel,
          loadOptions: (s) async =>
              (await loadQualityUsers(s)).where((o) => !team.any((m) => asInt(m['user_id']) == o.value)).toList(),
          onChanged: (o) => setS(() {
            userId = o?.value;
            userLabel = o?.label;
          }),
        ),
        AppSelect<String>(
          label: 'Role',
          value: role,
          clearable: false,
          options: const [Option('member', 'Member'), Option('leader', 'Leader')],
          onChanged: (o) => setS(() => role = o?.value ?? role),
        ),
        AppTextField(label: 'Department', controller: dept, hint: 'e.g. Production'),
        const Text('An 8D needs the owner and at least one more member from the functions involved (e.g. production, design).',
            style: TextStyle(fontSize: 12, color: Brand.muted)),
      ],
      onSave: () async {
        if (userId == null) throw 'Pick the person to add.';
        await _setTeam([
          ..._teamPayload(team),
          {'user_id': userId, 'role': role, 'department': dept.text.trim().isEmpty ? null : dept.text.trim()},
        ]);
      },
    );
    if (ok && mounted) showSnack(context, 'Team updated.');
  }

  Future<void> _linkNcr() async {
    final capa = _capa!;
    final linked = rowsOf(capa['ncrs']);
    int? pick;
    final ok = await showFormSheet(
      context,
      title: 'Link an NCR',
      saveLabel: 'Link NCR',
      builder: (ctx, setS) => [
        Text('${txt(capa['capa_number'])} · D2 — problem', style: const TextStyle(color: Brand.muted)),
        AppSelect<int>(
          label: 'NCR',
          required: true,
          value: pick,
          options: [
            for (final n in _ncrs)
              if (!linked.any((x) => x['id'] == n['id'])) Option(asInt(n['id'])!, '${txt(n['ncr_number'])} — ${txt(n['item_name'])}'),
          ],
          onChanged: (o) => setS(() => pick = o?.value),
        ),
        const Text('Link every NCR with the same root cause, so this CAPA answers all of them.',
            style: TextStyle(fontSize: 12, color: Brand.muted)),
      ],
      onSave: () async {
        if (pick == null) throw 'Pick the NCR to link.';
        await _sheet(() => Api.post('$_base/ncrs', data: {'ncr_id': pick}));
      },
    );
    if (ok && mounted) showSnack(context, 'NCR linked.');
  }

  Future<void> _addAction() async {
    final capa = _capa!;
    var kind = 'corrective';
    String? prevType;
    final desc = TextEditingController();
    int? ownerId;
    String? ownerLabel;
    DateTime? due;
    final prev = _meta['prevention_types'] is Map
        ? Map<String, dynamic>.from(_meta['prevention_types'] as Map)
        : <String, dynamic>{};
    final ok = await showFormSheet(
      context,
      title: 'Add action',
      saveLabel: 'Add action',
      builder: (ctx, setS) => [
        Text('${txt(capa['capa_number'])} · D5 corrective / D7 prevention', style: const TextStyle(color: Brand.muted)),
        AppSelect<String>(
          label: 'Kind',
          value: kind,
          clearable: false,
          options: const [Option('corrective', 'D5 corrective'), Option('preventive', 'D7 prevention')],
          onChanged: (o) => setS(() => kind = o?.value ?? kind),
        ),
        if (kind == 'preventive')
          AppSelect<String>(
            label: 'Updates',
            value: prevType,
            options: [for (final e in prev.entries) Option(e.key, '${e.value}')],
            onChanged: (o) => setS(() => prevType = o?.value),
          ),
        AppTextField(
            label: 'Action',
            required: true,
            controller: desc,
            maxLines: 3,
            hint: kind == 'preventive' ? 'e.g. Add the bore check to the in-process plan' : 'e.g. Replace the worn boring bar on VMC-2'),
        AppSelect<int>(
          label: 'Owner',
          required: true,
          value: ownerId,
          valueLabel: ownerLabel,
          loadOptions: loadQualityUsers,
          onChanged: (o) => setS(() {
            ownerId = o?.value;
            ownerLabel = o?.label;
          }),
        ),
        DateField(label: 'Due date', required: true, value: due, onChanged: (d) => setS(() => due = d)),
      ],
      onSave: () => _sheet(() => Api.post('$_base/actions', data: {
            'kind': kind,
            'prevention_type': kind == 'preventive' ? prevType : null,
            'description': desc.text,
            'owner_id': ownerId,
            'due_date': due == null ? null : apiDate(due!),
          })),
    );
    if (ok && mounted) showSnack(context, 'Action added.');
  }

  Future<void> _markDone(Json a) async {
    final capa = _capa!;
    final ev = TextEditingController();
    final ref = TextEditingController();
    final ok = await showFormSheet(
      context,
      title: 'Mark action done',
      saveLabel: 'Mark done',
      builder: (ctx, setS) => [
        Text('${txt(capa['capa_number'])} · ${txt(a['description'])}', style: const TextStyle(color: Brand.muted)),
        AppTextField(label: 'D6 — evidence (what was done, where to see it)', required: true, controller: ev, maxLines: 4),
        AppTextField(label: 'Document ref.', controller: ref, hint: 'Plan rev, drawing rev, SOP'),
      ],
      onSave: () => _sheet(() => Api.post('$_base/actions/${a['id']}/done',
          data: {'evidence': ev.text, 'evidence_reference': ref.text.trim().isEmpty ? null : ref.text.trim()})),
    );
    if (ok && mounted) showSnack(context, 'Action marked done.');
  }

  Future<void> _cancelAction(Json a) async {
    final reason = await promptDialog(context,
        title: 'Cancel this action?', message: 'Give the reason the action is no longer needed.', confirmLabel: 'Cancel action');
    if (reason == null) return;
    await _run(() => Api.post('$_base/actions/${a['id']}/cancel', data: {'reason': reason}), success: 'Action cancelled.');
  }

  Future<void> _effective() async {
    final capa = _capa!;
    final remarks = TextEditingController();
    final ok = await showFormSheet(
      context,
      title: 'Effective — close CAPA',
      saveLabel: 'Close CAPA',
      builder: (ctx, setS) => [
        Text('${txt(capa['capa_number'])} · D8 effectiveness verdict', style: const TextStyle(color: Brand.muted)),
        AppTextField(
            label: 'Verification remarks',
            controller: remarks,
            maxLines: 4,
            hint: 'e.g. No recurrence in 3 months / 400 units since the fix'),
        const Text('Recorded in Organization › Approval Workflows › CAPA effectiveness (D8); the CAPA closes.',
            style: TextStyle(fontSize: 12, color: Brand.muted)),
      ],
      onSave: () => _sheet(() => Api.post('$_base/effectiveness', data: {'effective': true, 'remarks': remarks.text})),
    );
    if (ok && mounted) showSnack(context, 'CAPA closed.');
  }

  Future<void> _notEffective() async {
    final reason = await promptDialog(context,
        title: 'Mark the CAPA not effective?',
        message: 'It reopens for a new root-cause analysis (D4) and new actions. Say what showed it wasn\'t effective.',
        confirmLabel: 'Not effective — reopen');
    if (reason == null) return;
    await _run(() => Api.post('$_base/effectiveness', data: {'effective': false, 'remarks': reason}),
        success: 'CAPA reopened.');
  }

  Future<void> _reopen() async {
    final reason = await promptDialog(context,
        title: 'Reopen this CAPA?',
        message: 'The 8D restarts at the root cause; the earlier 8D report stays on record. Give the reason.',
        confirmLabel: 'Reopen');
    if (reason == null) return;
    await _run(() => Api.post('$_base/reopen', data: {'reason': reason}), success: 'CAPA reopened.');
  }

  Widget _muted(String t, {Color color = Brand.muted}) =>
      Padding(padding: const EdgeInsets.only(top: 4), child: Text(t, style: TextStyle(fontSize: 13, color: color)));

  @override
  Widget build(BuildContext context) {
    final capa = _capa;
    if (capa == null) {
      return SubPage(title: 'CAPA', body: _error != null ? ErrorView(_error!, onRetry: _load) : const LoadingView());
    }
    final status = str(capa['status']);
    final closed = status == 'closed';
    final analysisEditable = _analysisEditable.contains(status) && _canEdit;
    final actions = rowsOf(capa['actions']);
    final active = actions.where((a) => a['superseded'] != true).toList();
    final history = actions.where((a) => a['superseded'] == true).toList();
    final stepIndex = status == 'reopened' ? 0 : _steps.indexOf(status);
    final prevLabels = _meta['prevention_types'] is Map
        ? Map<String, dynamic>.from(_meta['prevention_types'] as Map)
        : <String, dynamic>{};
    final team = rowsOf(capa['team']);
    final fishCats = _meta['fishbone_categories'] is List
        ? (_meta['fishbone_categories'] as List).map((e) => '$e').toList()
        : _fishboneLabels.keys.toList();
    final reopenCount = asInt(capa['reopen_count']) ?? 0;

    return SubPage(
      title: txt(capa['capa_number']),
      body: RefreshIndicator(
        onRefresh: _load,
        child: ListView(
          padding: const EdgeInsets.only(top: 12, bottom: 32),
          children: [
            Hint('Quality · CAPA (8D) · ${lbl(capaTriggerLabels, capa['trigger'])}'),
            ApprovalPanel(key: ValueKey('d8-$status'), entityType: 'quality_capa', entityId: widget.id, title: 'D8 approval', onChanged: _load),
            ChipRow(children: [
              for (var i = 0; i < _steps.length; i++)
                Padding(
                  padding: const EdgeInsets.only(right: 6),
                  child: StatusBadge('${i + 1}. ${capaStatusLabels[_steps[i]]}',
                      color: stepIndex >= i ? const Color(0xFF15803D) : const Color(0xFF64748B)),
                ),
              if (reopenCount > 0)
                Center(child: Text('Reopened $reopenCount×', style: const TextStyle(fontSize: 11.5, color: Color(0xFFB91C1C)))),
            ]),
            DetailSection(txt(capa['title']), children: [
              Text(
                  '${capa['action_type'] == 'preventive' ? 'Preventive' : 'Corrective'} action raised for: ${lbl(capaTriggerLabels, capa['trigger'])}.',
                  style: const TextStyle(fontSize: 13.5)),
              const SizedBox(height: 8),
              Wrap(spacing: 8, runSpacing: 4, crossAxisAlignment: WrapCrossAlignment.center, children: [
                qPill(capaStatusLabels, capaStatusHex, status),
                pill(humanize(capa['severity']), severityHex[str(capa['severity'])]),
                if (capa['overdue'] == true) pill('Overdue', qRed),
                if (str(capa['responsible_user_name']).isNotEmpty)
                  Text('Owner ${capa['responsible_user_name']}', style: const TextStyle(fontSize: 12, color: Brand.muted)),
                Text('Opened ${fmtDate(capa['created_at'])}', style: const TextStyle(fontSize: 12, color: Brand.muted)),
                Text('Target ${fmtDate(capa['due_date'])}', style: const TextStyle(fontSize: 12, color: Brand.muted)),
              ]),
            ]),
            DetailSection('What it concerns', children: [
              FieldRow('Item', capa['item_name']),
              FieldRow('Vendor', capa['vendor_name']),
              FieldRow('Defect', capa['defect_code_label']),
              if (str(capa['audit_reference']).isNotEmpty) FieldRow('Audit reference', capa['audit_reference']),
              if (capa['complaint_id'] != null)
                FieldRow(
                    'Customer complaint',
                    InkWell(
                      onTap: () => openScreen(context, ComplaintDetailScreen(id: asInt(capa['complaint_id'])!)),
                      child: Text(txt(capa['complaint_number']), style: const TextStyle(color: qAccent, fontWeight: FontWeight.w600)),
                    )),
            ]),
            if (_seeTeam)
              DetailSection('D1 — Team', children: [
                AppSelect<int>(
                  label: 'CAPA owner (champion)',
                  value: asInt(capa['responsible_user_id']),
                  valueLabel: str(capa['responsible_user_name']).isEmpty ? null : str(capa['responsible_user_name']),
                  clearable: false,
                  enabled: !closed && !_busy && _canEdit,
                  loadOptions: loadQualityUsers,
                  onChanged: (o) {
                    if (o != null) _run(() => Api.patch(_base, data: {'responsible_user_id': o.value}), success: 'Owner changed.');
                  },
                ),
                const SizedBox(height: 8),
                if (team.isEmpty)
                  _muted('No team yet — an 8D needs the owner and at least one more member (e.g. production, design).')
                else
                  Wrap(spacing: 6, runSpacing: 6, children: [
                    for (final m in team)
                      InputChip(
                        label: Text('${txt(m['user_name'])} · ${txt(m['role'])}${str(m['department']).isNotEmpty ? ' · ${m['department']}' : ''}',
                            style: const TextStyle(fontSize: 12.5)),
                        onDeleted: (!closed && _canTeam && m['user_id'] != capa['responsible_user_id'] && !_busy)
                            ? () => _run(() => Api.put('$_base/team',
                                data: {'members': _teamPayload(team.where((x) => x['id'] != m['id']).toList())}))
                            : null,
                      ),
                  ]),
                if (!closed && _canTeam)
                  ActionWrap(children: [secondaryBtn('+ Add team member', _busy ? null : _addMember, icon: Icons.group_add_outlined)]),
              ]),
            DetailSection('D2 — Problem & linked NCRs', children: [
              AppTextField(
                  label: 'Problem description (what, where, when, how many, how found)',
                  controller: _problem,
                  maxLines: 4,
                  enabled: analysisEditable),
              for (final n in rowsOf(capa['ncrs']))
                InkWell(
                  onTap: () => openScreen(context, NcrDetailScreen(id: asInt(n['id'])!)),
                  child: Padding(
                    padding: const EdgeInsets.only(top: 8),
                    child: Wrap(spacing: 6, runSpacing: 2, crossAxisAlignment: WrapCrossAlignment.center, children: [
                      Text(txt(n['ncr_number']), style: const TextStyle(color: qAccent, fontWeight: FontWeight.w600)),
                      Text('· ${fmtDate(n['ncr_date'])} · ${txt(n['item_name'])} · ${fmtQty(n['quantity'], n['uom'])}',
                          style: const TextStyle(fontSize: 12.5)),
                      pill(str(n['severity']), severityHex[str(n['severity'])]),
                      Text(lbl(ncrStatusLabels, n['status']), style: const TextStyle(fontSize: 12.5)),
                    ]),
                  ),
                ),
              if (!closed && _canEdit)
                ActionWrap(children: [secondaryBtn('+ Link another NCR', _busy ? null : _linkNcr, icon: Icons.link_rounded)]),
            ]),
            DetailSection('D3 — Containment', children: [
              AppTextField(
                label: 'Containment actions (sort stock, hold dispatch, inform customer, check units in the field)',
                controller: _containment,
                maxLines: 4,
                enabled: !closed && status != 'effectiveness_check' && _canEdit,
              ),
            ]),
            DetailSection('D4 — Root cause', children: [
              AppSelect<String>(
                label: 'Method',
                value: _method.isEmpty ? null : _method,
                enabled: analysisEditable,
                options: const [
                  Option('why_why', 'Why-why (5 whys)'),
                  Option('fishbone', 'Fishbone (6M)'),
                  Option('both', 'Both'),
                ],
                onChanged: (o) => setState(() => _method = o?.value ?? ''),
              ),
              if (_method == 'why_why' || _method == 'both') ...[
                for (var i = 0; i < _why.length; i++)
                  Padding(
                    padding: const EdgeInsets.only(top: 8),
                    child: AppTextField(label: 'Why ${i + 1}', controller: _why[i], enabled: analysisEditable),
                  ),
                if (analysisEditable && _why.length < 7)
                  ActionWrap(children: [
                    secondaryBtn('+ Another why', () => setState(() => _why.add(TextEditingController())), icon: Icons.add_rounded),
                  ]),
              ],
              if (_method == 'fishbone' || _method == 'both')
                for (final k in fishCats)
                  Padding(
                    padding: const EdgeInsets.only(top: 8),
                    child: AppTextField(
                      label: '${_fishboneLabels[k] ?? k} — one cause per line',
                      controller: _fish.putIfAbsent(k, () => TextEditingController()),
                      maxLines: 3,
                      enabled: analysisEditable,
                    ),
                  ),
              const SizedBox(height: 8),
              AppTextField(label: 'Root cause (verified)', controller: _rootCause, maxLines: 3, enabled: analysisEditable),
              if (!closed && _canEdit)
                ActionWrap(children: [
                  secondaryBtn('Save D2–D4', _busy ? null : () => _run(() => Api.patch(_base, data: _analysisPayload()), success: 'Saved.'),
                      icon: Icons.save_outlined),
                  if (status == 'open' || status == 'reopened')
                    primaryBtn(
                        'Save & mark root cause found',
                        _busy
                            ? null
                            : () => _run(() async {
                                  await Api.patch(_base, data: _analysisPayload());
                                  return Api.post('$_base/advance');
                                }, success: 'Root cause found.')),
                ]),
            ]),
            DetailSection('D5 / D7 — Actions (owner + due date) and D6 evidence', children: [
              if (_seeActions) ...[
                if (active.isEmpty) _muted('No actions yet.'),
                for (final a in active) _actionCard(a, prevLabels, closed),
              ],
              if (_canAddAction && ['open', 'reopened', 'root_cause_found', 'actions_in_progress'].contains(status))
                ActionWrap(children: [secondaryBtn('+ Add action', _busy ? null : _addAction, icon: Icons.add_task_rounded)]),
              if (status == 'root_cause_found' || status == 'actions_in_progress') ...[
                const SizedBox(height: 10),
                AppTextField(
                    label: 'D7 — no prevention item needed because… (only if none is added)',
                    controller: _prevReason,
                    enabled: _canEdit),
                if (_canEdit)
                  ActionWrap(children: [
                    secondaryBtn('Save', _busy
                        ? null
                        : () => _run(() => Api.patch(_base, data: {'prevention_not_needed_reason': _prevReason.text}), success: 'Saved.'),
                        icon: Icons.save_outlined),
                  ]),
              ],
              if (status == 'actions_in_progress' || status == 'effectiveness_check') ...[
                const SizedBox(height: 10),
                AppTextField(label: 'D6 — implementation summary', controller: _impl, maxLines: 3, enabled: _canEdit),
                if (_canEdit)
                  ActionWrap(children: [
                    secondaryBtn('Save', _busy
                        ? null
                        : () => _run(() => Api.patch(_base, data: {'implementation_summary': _impl.text}), success: 'Saved.'),
                        icon: Icons.save_outlined),
                  ]),
              ],
              ActionWrap(children: [
                if (_canEdit && status == 'root_cause_found')
                  primaryBtn('Start actions', _busy ? null : () => _run(() => Api.post('$_base/advance'), success: 'Actions started.'),
                      icon: Icons.play_arrow_rounded),
                if (_canEdit && status == 'actions_in_progress')
                  primaryBtn('All actions done → effectiveness check',
                      _busy ? null : () => _run(() => Api.post('$_base/advance'), success: 'Moved to the effectiveness check.')),
              ]),
              if (history.isNotEmpty)
                ExpansionTile(
                  tilePadding: EdgeInsets.zero,
                  title: Text('${history.length} action(s) from before the reopen',
                      style: const TextStyle(fontSize: 12.5, color: Brand.muted)),
                  children: [
                    for (final a in history)
                      Align(
                        alignment: Alignment.centerLeft,
                        child: Text(
                            '${txt(a['kind'])} · ${txt(a['description'])} · ${txt(a['status'])}${str(a['evidence']).isNotEmpty ? ' · ${a['evidence']}' : ''}',
                            style: const TextStyle(fontSize: 12.5)),
                      ),
                  ],
                ),
            ]),
            if (status == 'effectiveness_check' || closed || capa['effectiveness_result'] != null)
              DetailSection('D8 — Effectiveness & closure', children: [
                FieldRow('Actions completed', fmtDate(capa['actions_completed_at'])),
                FieldRow('Check due', fmtDate(capa['effectiveness_due_date'])),
                FieldRow('Last result', capa['effectiveness_result'] == null ? '—' : str(capa['effectiveness_result']).replaceAll('_', ' ')),
                FieldRow(
                    'Checked by',
                    str(capa['effectiveness_checked_by_name']).isNotEmpty
                        ? '${capa['effectiveness_checked_by_name']} · ${fmtDate(capa['effectiveness_checked_at'])}'
                        : '—'),
                if (str(capa['effectiveness_remarks']).isNotEmpty) FieldRow('Remarks', capa['effectiveness_remarks']),
                if (rowsOf(capa['recurrences']).isNotEmpty)
                  _muted(
                      'Same defect recurred after the actions: ${rowsOf(capa['recurrences']).map((n) => n['ncr_number']).join(', ')} — the CAPA is probably not effective.',
                      color: const Color(0xFFB91C1C)),
                if (_canVerdict && status == 'effectiveness_check')
                  ActionWrap(children: [
                    primaryBtn('Effective — close CAPA', _busy ? null : _effective, color: qGreen, icon: Icons.verified_outlined),
                    secondaryBtn('Not effective', _busy ? null : _notEffective, color: qRed, icon: Icons.close_rounded),
                  ]),
                if (closed && _canVerdict)
                  ActionWrap(children: [secondaryBtn('Reopen CAPA', _busy ? null : _reopen, color: qRed, icon: Icons.replay_rounded)]),
              ]),
            if (status != 'open' && status != 'reopened')
              DetailSection('8D report', children: [
                RecordDocTile(
                  title: '8D report',
                  hint: 'The full 8D on the company letterhead — also the customer response for a complaint CAPA.',
                  entityType: 'quality_8d_report',
                  entityId: widget.id,
                  pdfPath: '/quality/records/capa/${widget.id}/8d-report.pdf',
                  canModify: _canEdit,
                  revision: asInt(capa['report_revision']) ?? 0,
                  downloadName:
                      '8D-Report-${capa['capa_number']}${(asInt(capa['report_revision']) ?? 0) > 0 ? '-R${capa['report_revision']}' : ''}',
                ),
              ]),
          ],
        ),
      ),
    );
  }

  Widget _actionCard(Json a, Map<String, dynamic> prevLabels, bool closed) {
    final st = str(a['status']);
    final overdue = a['overdue'] == true;
    final color = st == 'done'
        ? qGreen
        : st == 'cancelled'
            ? const Color(0xFFA8A29E)
            : overdue
                ? qRed
                : const Color(0xFF2563EB);
    final mayAct = st == 'open' &&
        !closed &&
        (_canEdit || _canApprove || (a['owner_id'] != null && asInt(a['owner_id']) == Perm.userId));
    return Container(
      margin: const EdgeInsets.only(top: 8),
      padding: const EdgeInsets.all(10),
      decoration: BoxDecoration(borderRadius: BorderRadius.circular(12), border: Border.all(color: Brand.border)),
      child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
        Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
          Expanded(
            child: Text(
                '${a['kind'] == 'preventive' ? 'D7 · ${prevLabels[str(a['prevention_type'])] ?? a['prevention_type'] ?? ''}: ' : 'D5 · '}${txt(a['description'])}',
                style: const TextStyle(fontSize: 13, fontWeight: FontWeight.w600, color: Brand.heading)),
          ),
          pill(st, color),
        ]),
        if (overdue) const Text('overdue', style: TextStyle(fontSize: 11.5, color: qRed, fontWeight: FontWeight.w600)),
        Text(
            'Owner ${txt(a['owner_name'])} · due ${fmtDate(a['due_date'])}'
            '${a['done_at'] != null ? ' · done ${fmtDate(a['done_at'])} by ${txt(a['done_by_name'])}' : ''}'
            '${str(a['cancel_reason']).isNotEmpty ? ' · cancelled: ${a['cancel_reason']}' : ''}',
            style: const TextStyle(fontSize: 12.5, color: Brand.muted)),
        if (str(a['evidence']).isNotEmpty)
          Text('Evidence: ${a['evidence']}${str(a['evidence_reference']).isNotEmpty ? ' [${a['evidence_reference']}]' : ''}',
              style: const TextStyle(fontSize: 12.5)),
        if (mayAct)
          ActionWrap(children: [
            secondaryBtn('Record evidence & mark done', _busy ? null : () => _markDone(a), icon: Icons.task_alt_rounded),
            if (_canCancelAction) secondaryBtn('Cancel action', _busy ? null : () => _cancelAction(a), color: qRed, icon: Icons.close_rounded),
          ]),
      ]),
    );
  }
}
