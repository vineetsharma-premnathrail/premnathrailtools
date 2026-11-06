import 'dart:async';
import 'dart:convert';

import 'package:flutter/material.dart';

import '../../api/api.dart';
import '../../theme.dart';
import '../../ui/app_frame.dart';
import '../../ui/form.dart';
import '../../ui/format.dart';
import '../../ui/perms.dart';
import '../../ui/widgets.dart';
import 'org_common.dart';

/// Organization › Approval Workflows › one workflow - native copy of
/// frontend/src/app/dashboard/organization/workflows/[key]/page.tsx.
/// Sections: flow, In plain words, 1 General settings, 2 Approval stages,
/// 3 Check & preview, 4 History; sticky Reset / Save bar.

Json _deep(Object? v) => jsonMap(jsonDecode(jsonEncode(v)));

Json _blankStage() => {
      'name': '',
      'approver_rule': 'department_head',
      'rule_config': <String, dynamic>{},
      'approval_mode': 'any',
      'conditions': <dynamic>[],
      'skip_if_no_approver': false,
      'escalate_after_hours': null,
      'escalation_rule': null,
      'escalation_config': <String, dynamic>{},
    };

Json _stage(String name, String rule, [Json extra = const {}]) => {..._blankStage(), 'name': name, 'approver_rule': rule, ...extra};
Json _esc(int hours, String rule) =>
    {'escalate_after_hours': hours, 'escalation_rule': rule, 'escalation_config': <String, dynamic>{}};
List<dynamic> _overAmount(num a) => [
      {'field': 'amount', 'op': 'gt', 'value': a}
    ];

class _Template {
  const _Template(this.id, this.label, this.help, this.stages, {this.needsAmount = false});
  final String id;
  final String label;
  final String help;
  final bool needsAmount;
  final List<Json> Function(num amount) stages;
}

final _templates = <_Template>[
  _Template('dept', 'Department head',
      'One check by the requester’s department head; escalates to their manager after 48 h.',
      (_) => [_stage('Department head', 'department_head', _esc(48, 'approver_manager'))]),
  _Template('dept_partner', 'Department head, then a Partner above an amount',
      'Every document: department head. Above the amount: also any one Partner.',
      (a) => [
            _stage('Department head', 'department_head', _esc(48, 'approver_manager')),
            _stage('Partner (final approval)', 'partner', {'conditions': _overAmount(a)}),
          ],
      needsAmount: true),
  _Template('purchase_partner', 'Purchase head, then a Partner above an amount',
      'Every document: anyone flagged Purchase head. Above the amount: also any one Partner. Purchase head escalates to the Partners after 48 h.',
      (a) => [
            _stage('Purchase head', 'user_flag', {
              'rule_config': {'flag': 'is_purchase_head'},
              ..._esc(48, 'partner'),
            }),
            _stage('Partner (final approval)', 'partner', {'conditions': _overAmount(a)}),
          ],
      needsAmount: true),
  _Template('manager_dept', 'Reporting manager, then department head',
      'Two checks on every document: the requester’s manager, then their department head.',
      (_) => [
            _stage('Reporting manager', 'reporting_manager', _esc(48, 'department_head')),
            _stage('Department head', 'department_head', _esc(48, 'partner')),
          ]),
  _Template('partner', 'Any one Partner', 'A single final approval by any Partner.',
      (_) => [_stage('Partner (final approval)', 'partner')]),
];

const _levels = {
  'error': ('Must fix', Color(0xFFB91C1C), Color(0x14DC2626)),
  'warning': ('Weak control', Color(0xFF92400E), Color(0x14F59E0B)),
  'info': ('Suggestion', Color(0xFF1E40AF), Color(0x123B82F6)),
};

class WorkflowEditorScreen extends StatefulWidget {
  const WorkflowEditorScreen({super.key, required this.workflowKey});
  final String workflowKey;

  @override
  State<WorkflowEditorScreen> createState() => _WorkflowEditorScreenState();
}

class _WorkflowEditorScreenState extends State<WorkflowEditorScreen> {
  Json? _type;
  Json? _wf;
  Json? _meta;
  List<Json> _users = [];
  Object? _loadError;
  String? _baseline;
  bool _saving = false;

  Json? _check;
  String _checkError = '';
  bool _checking = false;
  Timer? _checkTimer;

  int? _pvUser;
  final Map<String, String> _pvCtx = {};
  List<Json>? _preview;

  List<Json>? _history;
  bool _showHistory = false;

  String? _tplId;
  String _tplAmount = '1000000';

  String get _key => widget.workflowKey;
  bool get _readOnly => !orgCan('workflows', 'edit');
  bool get _isAdmin => Perm.isAdmin;
  bool get _maySimulate => Perm.canFeature('organization', 'workflows', 'simulate', 'view');
  bool get _mayReset => Perm.canFeature('organization', 'workflows', 'reset', 'edit');
  bool get _seeHistory => Perm.canFeature('organization', 'workflows', 'history', 'view');

  List<Json> get _stages => jsonList(_wf?['stages']);
  Map<String, dynamic> get _fields => jsonMap(_type?['context_fields']);

  Json _payload(Json w) => {
        'stages': w['stages'],
        'is_active': w['is_active'],
        'allow_self_approval': w['allow_self_approval'],
        'distinct_approvers': w['distinct_approvers'],
        'require_permission': w['require_permission'],
      };
  String _snap(Json w) => jsonEncode(_payload(w));
  bool get _dirty => _wf != null && _baseline != null && _snap(_wf!) != _baseline;

  @override
  void initState() {
    super.initState();
    _load();
  }

  @override
  void dispose() {
    _checkTimer?.cancel();
    super.dispose();
  }

  Future<void> _load() async {
    setState(() => _loadError = null);
    try {
      final res = await Future.wait([
        Api.get('/organization/workflows/${Uri.encodeComponent(_key)}'),
        Api.get('/organization/workflows/meta'),
        Api.list('/users/directory'),
      ]);
      if (!mounted) return;
      final w = jsonMap(res[0]);
      setState(() {
        _type = jsonMap(w['type']);
        _wf = jsonMap(w['workflow']);
        _baseline = _snap(_wf!);
        _meta = jsonMap(res[1]);
        _users = (res[2] as ApiPage).rows;
      });
      _scheduleCheck();
    } catch (e) {
      if (mounted) setState(() => _loadError = e);
    }
  }

  /// Re-check the setup as it is edited (debounced) — problems show before saving.
  void _scheduleCheck() {
    if (_wf == null || !_maySimulate) return;
    _checkTimer?.cancel();
    _checkTimer = Timer(const Duration(milliseconds: 700), () async {
      if (!mounted) return;
      setState(() => _checking = true);
      try {
        final r = await Api.post('/organization/workflows/${Uri.encodeComponent(_key)}/check', data: _payload(_wf!));
        if (mounted) {
          setState(() {
            _check = jsonMap(r);
            _checkError = '';
          });
        }
      } catch (e) {
        if (mounted) setState(() => _checkError = ApiClient.describe(e));
      } finally {
        if (mounted) setState(() => _checking = false);
      }
    });
  }

  void _edit(void Function(Json w) fn) {
    setState(() => fn(_wf!));
    _scheduleCheck();
  }

  void _setStages(List<Json> st) => _edit((w) => w['stages'] = st);

  // ── words ──────────────────────────────────────────────────────────────

  Map<String, dynamic> get _rules => jsonMap(_meta?['approver_rules']);
  Map<String, dynamic> get _flags => jsonMap(_meta?['approver_flags']);
  List<Json> get _roles => jsonList(_meta?['roles']);

  String _permWords(Object? code) {
    final c = str(code);
    for (final o in jsonList(_meta?['approval_permission_options'])) {
      if (str(o['value']) == c) return '${str(o['module'])} › ${str(o['label'])}';
    }
    return c.split(':').map((x) => x.replaceAll('_', ' ')).join(' › ');
  }

  List<Option<String>> get _permOptions {
    final opts = jsonList(_meta?['approval_permission_options']);
    if (opts.isEmpty) {
      return [for (final p in (_meta?['approval_permissions'] as List? ?? const [])) Option(str(p), _permWords(p))];
    }
    final own = str(_type?['module_key']);
    opts.sort((a, b) {
      final ao = str(a['module_key']) == own ? 0 : 1;
      final bo = str(b['module_key']) == own ? 0 : 1;
      return ao.compareTo(bo);
    });
    return [
      for (final o in opts) Option(str(o['value']), '${str(o['module'])} › ${str(o['label'])}', subtitle: str(o['module']))
    ];
  }

  String _roleName(Object? id) {
    for (final r in _roles) {
      if (asInt(r['id']) == asInt(id)) return str(r['name']);
    }
    return '';
  }

  String _userName(Object? id) {
    for (final u in _users) {
      if (asInt(u['id']) == asInt(id)) return str(u['name']);
    }
    return 'a user who is no longer listed';
  }

  List<int> _ids(Object? v) => v is List ? v.map(asInt).whereType<int>().toList() : <int>[];

  String _whoText(Json s) {
    final cfg = jsonMap(s['rule_config']);
    switch (str(s['approver_rule'])) {
      case 'role':
        final n = _roleName(cfg['role_id']);
        return 'Role: ${n.isEmpty ? '—' : n}';
      case 'user_flag':
        return str(_flags[str(cfg['flag'])]).isEmpty ? 'Approval flag' : str(_flags[str(cfg['flag'])]);
      case 'permission':
        final p = _permWords(cfg['permission']);
        return 'Holders of ${p.isEmpty ? '—' : p}';
      case 'specific_users':
        return '${_ids(cfg['user_ids']).length} named user(s)';
    }
    final r = str(_rules[str(s['approver_rule'])]);
    return r.isEmpty ? str(s['approver_rule']) : r;
  }

  String _condText(Json s) {
    final conds = jsonList(s['conditions']);
    if (conds.isEmpty) return 'Always';
    final ops = jsonMap(_meta?['condition_ops']);
    return conds.map((c) {
      final f = jsonMap(_fields[str(c['field'])]);
      final labels = jsonMap(f['choice_labels']);
      final vals = c['value'] is List ? c['value'] as List : [c['value'] ?? ''];
      final shown = vals.map((v) => str(labels[str(v)]).isEmpty ? str(v) : str(labels[str(v)])).join(', ');
      final op = str(c['op']);
      final fl = str(f['label']).isEmpty ? str(c['field']) : str(f['label']);
      final ol = str(ops[op]).isEmpty ? op : str(ops[op]);
      return '$fl $ol${op == 'true' || op == 'false' ? '' : ' $shown'}';
    }).join(' and ');
  }

  (String, bool) _whoPlain(Json s) {
    final cfg = jsonMap(s['rule_config']);
    switch (str(s['approver_rule'])) {
      case 'reporting_manager':
        return ('the requester’s reporting manager', true);
      case 'department_head':
        return ('the requester’s department head', false);
      case 'plant_head':
        return ('the plant head', true);
      case 'partner':
        return ('the Partners', false);
      case 'director':
        return ('the Directors', false);
      case 'user_flag':
        final f = str(_flags[str(cfg['flag'])]);
        return ('everyone flagged “${f.isEmpty ? 'an approval flag' : f}”', false);
      case 'specific_users':
        final ids = _ids(cfg['user_ids']);
        final names = ids.map(_userName).join(', ');
        return (names.isEmpty ? 'the named users (none picked yet)' : names, ids.length == 1);
      case 'role':
        final n = _roleName(cfg['role_id']);
        return ('holders of the role “${n.isEmpty ? 'not picked yet' : n}”', false);
      case 'permission':
        return (
          'holders of ${str(cfg['permission']).isNotEmpty ? _permWords(cfg['permission']) : 'a permission (not picked yet)'}',
          false
        );
      case 'record_field':
        final l = str(jsonMap(_fields[str(cfg['field'])])['label']);
        return ('the person chosen as “${l.isEmpty ? 'approver' : l}” on the document', true);
    }
    final r = str(_rules[str(s['approver_rule'])]);
    return (r.isEmpty ? str(s['approver_rule']) : r, false);
  }

  String _escPlain(Json s) {
    final h = asInt(s['escalate_after_hours']);
    if (h == null || h == 0) return '';
    final rule = str(s['escalation_rule']);
    String to;
    if (rule == 'specific_users') {
      final names = _ids(jsonMap(s['escalation_config'])['user_ids']).map(_userName).join(', ');
      to = names.isEmpty ? 'the picked users' : names;
    } else {
      to = const {
            'approver_manager': 'the late approver’s reporting manager',
            'department_head': 'the requester’s department head',
            'partner': 'any Partner',
            'director': 'any Director',
          }[rule] ??
          'the escalation contact';
    }
    return ' If nobody decides within $h hours, $to can decide it too.';
  }

  List<String> get _summary {
    final wf = _wf, type = _type;
    if (wf == null || type == null) return [];
    if (wf['is_active'] != true) {
      return ['Approval is switched off — every ${str(type['label'])} is approved the moment it is submitted.'];
    }
    final st = _stages;
    if (st.isEmpty) return ['No stages yet — add one, or switch “Approval required” off.'];
    final lines = <String>[];
    for (var i = 0; i < st.length; i++) {
      final s = st[i];
      final (who, single) = _whoPlain(s);
      final conds = jsonList(s['conditions']);
      final when = conds.isNotEmpty ? 'If ${_condText(s)}, ' : '';
      final lead = i == 0 ? 'it goes to' : 'it then goes to';
      final how = single ? '' : (s['approval_mode'] == 'all' ? ' — every one of them must approve' : ' — any one of them approves');
      final cfg = jsonMap(s['rule_config']);
      final plant = cfg['same_plant'] == true ? ' (same plant only)' : '';
      final extra = str(cfg['plus_permission']).isNotEmpty
          ? ' Holders of ${_permWords(cfg['plus_permission'])} may also decide.'
          : '';
      final skip = s['skip_if_no_approver'] == true ? ' The stage is skipped if nobody matches.' : '';
      final leadText = when.isNotEmpty ? lead : lead[0].toUpperCase() + lead.substring(1);
      lines.add('${i + 1}. $when$leadText $who$plant$how.$extra${_escPlain(s)}$skip');
    }
    lines.add([
      wf['allow_self_approval'] == true
          ? 'The requester MAY approve their own document.'
          : 'Nobody approves their own document.',
      st.length > 1
          ? (wf['distinct_approvers'] == true
              ? 'Each stage needs a different person.'
              : 'One person may approve more than one stage.')
          : '',
      wf['require_permission'] == true
          ? 'Approvers must also hold the Approve permission on ${str(type['module_label'])} › ${str(type['subtab_label'])}.'
          : 'Being the stage’s approver is enough — no extra permission needed.',
      st.every((s) => jsonList(s['conditions']).isNotEmpty)
          ? 'A document matching none of the conditions is approved at once.'
          : '',
      'Approvals are final once the last stage approves; Return sends it back for changes and Reject stops it.',
    ].where((x) => x.isNotEmpty).join(' '));
    return lines;
  }

  List<Json> get _issues => jsonList(_check?['issues']);
  int _errorsFor(int? i) => _issues.where((x) => asInt(x['stage']) == i && x['level'] == 'error').length;
  int get _totalErrors => _issues.where((x) => x['level'] == 'error').length;

  // ── actions ────────────────────────────────────────────────────────────

  Future<void> _message(String title, String message, {bool error = false}) => showDialog<void>(
        context: context,
        builder: (ctx) => AlertDialog(
          title: Text(title, style: TextStyle(color: error ? Brand.danger : null)),
          content: SingleChildScrollView(child: Text(message)),
          actions: [
            FilledButton(
                style: FilledButton.styleFrom(minimumSize: const Size(88, 40)),
                onPressed: () => Navigator.pop(ctx),
                child: const Text('OK')),
          ],
        ),
      );

  Future<void> _doSave() async {
    setState(() => _saving = true);
    try {
      final out = jsonMap(await Api.put('/organization/workflows/${Uri.encodeComponent(_key)}', data: _payload(_wf!)));
      if (!mounted) return;
      setState(() {
        _wf = jsonMap(out['workflow']);
        _baseline = _snap(_wf!);
        _history = null;
        _preview = null;
        _checkError = '';
      });
      await _message('Saved',
          'Workflow saved. It applies to documents submitted from now on; documents already waiting keep their approvers.');
    } catch (e) {
      if (mounted) await _message('Approval workflow', ApiClient.describe(e), error: true);
    } finally {
      if (mounted) setState(() => _saving = false);
    }
  }

  /// Save first runs the setup check on what is on screen now: mistakes in
  /// the workflow itself stop the save; people-dependent errors and weak
  /// controls ask for a confirmation.
  Future<void> _save() async {
    if (_wf == null || _saving) return;
    if (!_maySimulate) return _doSave();
    setState(() => _saving = true);
    Json result;
    try {
      result = jsonMap(await Api.post('/organization/workflows/${Uri.encodeComponent(_key)}/check', data: _payload(_wf!)));
      if (!mounted) return;
      setState(() {
        _check = result;
        _checkError = '';
        _saving = false;
      });
    } catch (e) {
      if (!mounted) return;
      setState(() => _saving = false);
      await _message('Approval workflow', 'The setup could not be checked, so nothing was saved. ${ApiClient.describe(e)}',
          error: true);
      return;
    }
    final issues = jsonList(result['issues']);
    final block = issues.where((x) => x['blocking'] == true).toList();
    if (block.isNotEmpty) {
      await _message(
          'Not saved — fix these first',
          [...block.map((x) => str(x['message'])), 'Nothing was saved. Fix the stage(s) marked in section 3, then save again.']
              .join('\n\n'),
          error: true);
      return;
    }
    final errors = issues.where((x) => x['level'] == 'error').toList();
    final warnings = issues.where((x) => x['level'] == 'warning').toList();
    if (!mounted) return;
    if (errors.isNotEmpty) {
      final ok = await confirmDialog(context,
          title: 'Save with problems?',
          confirmLabel: 'Save anyway',
          message: 'The setup check found ${errors.length} problem(s) marked "Must fix" — the people listed there would '
              'be refused when they submit. Fix them first (see section 3), or save anyway if you are fixing the '
              "people's setup next.");
      if (ok) await _doSave();
    } else if (warnings.isNotEmpty) {
      final m = str(warnings.first['message']);
      final short = m.length > 160 ? '${m.substring(0, 160)}…' : m;
      final ok = await confirmDialog(context,
          title: 'Save with weak controls?',
          confirmLabel: 'Save anyway',
          message: 'The setup check raised ${warnings.length} warning(s), e.g. "$short" Save anyway, or review section 3 first?');
      if (ok) await _doSave();
    } else {
      await _doSave();
    }
  }

  Future<void> _reset() async {
    final ok = await confirmDialog(context,
        title: 'Reset to default now?',
        confirmLabel: 'Reset now',
        danger: true,
        message: 'This replaces the saved workflow straight away for documents submitted from now on, and discards your '
            'unsaved edits. Documents already waiting keep their approvers.');
    if (!ok) return;
    try {
      final out = jsonMap(await Api.post('/organization/workflows/${Uri.encodeComponent(_key)}/reset'));
      if (!mounted) return;
      setState(() {
        _wf = jsonMap(out['workflow']);
        _baseline = _snap(_wf!);
        _history = null;
        _preview = null;
        _checkError = '';
      });
      _scheduleCheck();
      await _message('Saved',
          'Workflow reset to the module default. It is live now for documents submitted from now on; documents already waiting keep their approvers.');
    } catch (e) {
      if (mounted) await _message('Approval workflow', ApiClient.describe(e), error: true);
    }
  }

  Future<void> _runPreview() async {
    if (_pvUser == null) {
      await _message('Approval workflow', 'Pick the requester to preview as.', error: true);
      return;
    }
    final ctx = <String, dynamic>{};
    _pvCtx.forEach((k, v) {
      if (v.isEmpty) return;
      final t = str(jsonMap(_fields[k])['type']);
      ctx[k] = (t == 'number' || t == 'user') ? (num.tryParse(v) ?? v) : t == 'bool' ? v == 'true' : v;
    });
    try {
      final out = jsonMap(await Api.post('/organization/workflows/${Uri.encodeComponent(_key)}/preview',
          data: {'requester_id': _pvUser, 'context': ctx, 'draft': _payload(_wf!)}));
      if (mounted) setState(() => _preview = jsonList(out['stages']));
    } catch (e) {
      if (mounted) await _message('Approval workflow', ApiClient.describe(e), error: true);
    }
  }

  Future<void> _applyTemplate() async {
    final t = _templates.where((x) => x.id == _tplId).firstOrNull;
    if (t == null || _wf == null) return;
    final ok = await confirmDialog(context,
        title: 'Apply template',
        confirmLabel: 'Replace stages',
        message: 'Replace the ${_stages.length} stage(s) on screen with “${t.label}”? Nothing is saved until you click Save workflow.');
    if (!ok || !mounted) return;
    final amount = num.tryParse(_tplAmount) ?? 0;
    if (t.needsAmount && !(amount > 0)) {
      await _message('Approval workflow',
          'Enter the amount (₹) above which the Partner stage applies, e.g. 1000000 for ₹10 lakh.',
          error: true);
      return;
    }
    final stages = t.stages(amount);
    _edit((w) {
      w['is_active'] = true;
      w['stages'] = stages;
      w['allow_self_approval'] = false;
      if (stages.length > 1) w['distinct_approvers'] = true;
    });
    setState(() => _preview = null);
    await _message('Template applied',
        'Template “${t.label}” applied on screen. Adjust anything you need, check section 3, then Save workflow — nothing is saved yet.');
  }

  Future<void> _toggleHistory() async {
    setState(() => _showHistory = !_showHistory);
    if (_showHistory && _history == null) {
      try {
        final h = await Api.list('/organization/workflows/${Uri.encodeComponent(_key)}/history');
        if (mounted) setState(() => _history = h.rows);
      } catch (e) {
        if (mounted) await _message('Approval workflow', ApiClient.describe(e), error: true);
      }
    }
  }

  Future<void> _removeStage(int i) async {
    final s = _stages[i];
    if (str(s['name']).trim().isNotEmpty) {
      final ok = await confirmDialog(context,
          title: 'Remove this stage?',
          confirmLabel: 'Remove stage',
          danger: true,
          message: 'Stage ${i + 1} “${str(s['name'])}” will be taken out of the workflow on screen. Nothing is saved until you click Save workflow.');
      if (!ok) return;
    }
    final st = _stages..removeAt(i);
    _setStages(st);
  }

  void _moveStage(int i, int d) {
    final st = _stages;
    final j = i + d;
    if (j < 0 || j >= st.length) return;
    final t = st[i];
    st[i] = st[j];
    st[j] = t;
    _setStages(st);
  }

  Future<void> _editStage(int? index) async {
    final isNew = index == null;
    final s = isNew ? _blankStage() : _deep(_stages[index]);
    final saved = await showFormSheet(
      context,
      title: isNew ? 'Add stage' : 'Stage ${index + 1}',
      saveLabel: 'Done',
      builder: (ctx, setS) => _stageFields(s, setS),
      onSave: () async {
        requireField(s['name'], 'Stage name');
      },
    );
    if (!saved) return;
    final st = _stages;
    if (isNew) {
      st.add(s);
    } else {
      st[index] = s;
    }
    _setStages(st);
  }

  // ── stage form (FormSheet) ─────────────────────────────────────────────

  Future<List<Option<int>>> _userOptions(String q) async {
    final ql = q.toLowerCase();
    return [
      for (final u in _users)
        if (ql.isEmpty || str(u['name']).toLowerCase().contains(ql) || str(u['email']).toLowerCase().contains(ql))
          Option<int>(asInt(u['id'])!, str(u['name']), subtitle: str(u['email'])),
    ];
  }

  Map<int, String> _userMap(Object? ids) => {for (final id in _ids(ids)) id: _userName(id)};

  Widget _hint(String t) => Text(t, style: const TextStyle(fontSize: 11.5, color: Brand.muted));

  List<Widget> _stageFields(Json s, StateSetter setS) {
    final meta = _meta!;
    final cfg = jsonMap(s['rule_config']);
    s['rule_config'] = cfg;
    final rule = str(s['approver_rule']);
    final userFields = _fields.entries.where((e) => jsonMap(e.value)['type'] == 'user').toList();
    final conds = jsonList(s['conditions']);
    s['conditions'] = conds;
    final escRules = jsonMap(meta['escalation_rules']);
    final hours = asInt(s['escalate_after_hours']);
    return [
      const Caps('Who approves'),
      AppTextField(
        label: 'Stage name',
        required: true,
        initialValue: str(s['name']),
        hint: 'e.g. Department head',
        onChanged: (v) => s['name'] = v,
      ),
      AppSelect<String>(
        label: 'Approver',
        value: rule,
        clearable: false,
        options: [for (final e in _rules.entries) Option(e.key, str(e.value))],
        onChanged: (o) => setS(() {
          if (o == null) return;
          s['approver_rule'] = o.value;
          s['rule_config'] = <String, dynamic>{};
        }),
      ),
      AppSelect<String>(
        label: 'When several people match',
        value: str(s['approval_mode']),
        clearable: false,
        options: const [Option('any', 'Any one of them approves'), Option('all', 'Every one must approve')],
        onChanged: (o) => setS(() => s['approval_mode'] = o?.value ?? 'any'),
      ),
      if (rule == 'specific_users')
        ChipsPicker(
          label: 'Users',
          selected: _userMap(cfg['user_ids']),
          loadOptions: _userOptions,
          onChanged: (m) => setS(() => cfg['user_ids'] = m.keys.toList()),
        ),
      if (rule == 'role')
        AppSelect<int>(
          label: 'Role',
          value: asInt(cfg['role_id']),
          options: [for (final r in _roles) Option(asInt(r['id'])!, str(r['name']))],
          onChanged: (o) => setS(() => cfg['role_id'] = o?.value),
        ),
      if (rule == 'permission')
        AppSelect<String>(
          label: 'Permission',
          value: str(cfg['permission']).isEmpty ? null : str(cfg['permission']),
          valueLabel: _permWords(cfg['permission']),
          options: _permOptions,
          onChanged: (o) => setS(() => cfg['permission'] = o?.value),
        ),
      if (rule == 'user_flag')
        AppSelect<String>(
          label: 'Approval flag',
          value: str(cfg['flag']).isEmpty ? null : str(cfg['flag']),
          options: [for (final e in _flags.entries) Option(e.key, str(e.value))],
          onChanged: (o) => setS(() => cfg['flag'] = o?.value),
        ),
      if (rule == 'record_field')
        userFields.isEmpty
            ? _hint('This document names no people')
            : AppSelect<String>(
                label: 'Person on the document',
                value: str(cfg['field']).isEmpty ? null : str(cfg['field']),
                options: [for (final e in userFields) Option(e.key, str(jsonMap(e.value)['label']))],
                onChanged: (o) => setS(() => cfg['field'] = o?.value),
              ),
      AppSelect<String>(
        label: 'Also allow holders of (optional)',
        value: str(cfg['plus_permission']).isEmpty ? null : str(cfg['plus_permission']),
        valueLabel: _permWords(cfg['plus_permission']),
        options: _permOptions,
        onChanged: (o) => setS(() {
          if (o == null) {
            cfg.remove('plus_permission');
          } else {
            cfg['plus_permission'] = o.value;
          }
        }),
      ),
      if (str(cfg['plus_permission']).isEmpty) _hint('Nobody else'),
      SwitchListTile(
        contentPadding: EdgeInsets.zero,
        value: cfg['same_plant'] == true,
        title: const Text("Same plant only — keep approvers whose plant is the document's plant",
            style: TextStyle(fontSize: 13.5)),
        onChanged: (v) => setS(() {
          if (v) {
            cfg['same_plant'] = true;
          } else {
            cfg.remove('same_plant');
          }
        }),
      ),
      const Caps('Applies when'),
      if (conds.isEmpty) _hint('Always — every document goes through this stage.'),
      for (var ci = 0; ci < conds.length; ci++) _conditionCard(conds, ci, setS),
      if (_fields.isNotEmpty)
        Align(
          alignment: Alignment.centerLeft,
          child: TextButton.icon(
            icon: const Icon(Icons.add_rounded, size: 18),
            label: const Text('Add condition'),
            onPressed: () => setS(() {
              final first = _fields.entries.first;
              final t = str(jsonMap(first.value)['type']);
              conds.add({'field': first.key, 'op': t == 'number' ? 'gt' : t == 'bool' ? 'true' : 'eq', 'value': ''});
            }),
          ),
        ),
      const Caps('If nobody matches · if nobody acts'),
      SwitchListTile(
        contentPadding: EdgeInsets.zero,
        value: s['skip_if_no_approver'] == true,
        title: const Text('Skip this stage if nobody matches', style: TextStyle(fontSize: 13.5)),
        subtitle: const Text(
            'Off (recommended) = submission is refused with the reason, so the gap gets fixed. A document is never approved with every stage skipped.',
            style: TextStyle(fontSize: 11.5)),
        onChanged: (v) => setS(() => s['skip_if_no_approver'] = v),
      ),
      AppTextField(
        label: 'Escalate after (hours)',
        initialValue: hours == null ? '' : '$hours',
        hint: 'off',
        keyboardType: TextInputType.number,
        onChanged: (v) => setS(() {
          final n = int.tryParse(v.trim());
          s['escalate_after_hours'] = n;
          if (n != null && str(s['escalation_rule']).isEmpty) s['escalation_rule'] = 'approver_manager';
        }),
      ),
      if (hours != null && hours > 0)
        AppSelect<String>(
          label: 'Escalate to',
          value: str(s['escalation_rule']).isEmpty ? null : str(s['escalation_rule']),
          clearable: false,
          options: [for (final e in escRules.entries) Option(e.key, str(e.value))],
          onChanged: (o) => setS(() => s['escalation_rule'] = o?.value),
        ),
      if (hours != null && hours > 0 && s['escalation_rule'] == 'specific_users')
        ChipsPicker(
          label: 'Escalation users',
          selected: _userMap(jsonMap(s['escalation_config'])['user_ids']),
          loadOptions: _userOptions,
          onChanged: (m) => setS(() => s['escalation_config'] = {'user_ids': m.keys.toList()}),
        ),
    ];
  }

  Widget _conditionCard(List<Json> conds, int ci, StateSetter setS) {
    final c = conds[ci];
    final f = jsonMap(_fields[str(c['field'])]);
    final ftype = str(f['type']);
    final op = str(c['op']);
    final ops = jsonMap(_meta?['condition_ops']);
    final choices = (f['choices'] is List) ? (f['choices'] as List).map(str).toList() : <String>[];
    final labels = jsonMap(f['choice_labels']);
    String cl(String ch) => str(labels[ch]).isEmpty ? ch : str(labels[ch]);
    final opOptions = [
      for (final e in ops.entries)
        if (['gt', 'gte', 'lt', 'lte'].contains(e.key)
            ? ftype == 'number'
            : ['true', 'false'].contains(e.key)
                ? ftype == 'bool'
                : ftype != 'bool')
          Option(e.key, str(e.value)),
    ];
    Widget? valueField;
    if (op != 'true' && op != 'false') {
      if (choices.isNotEmpty && (op == 'eq' || op == 'ne')) {
        valueField = AppSelect<String>(
          label: 'Value',
          value: str(c['value']).isEmpty ? null : str(c['value']),
          options: [for (final ch in choices) Option(ch, cl(ch))],
          onChanged: (o) => setS(() => c['value'] = o?.value ?? ''),
        );
      } else if (choices.isNotEmpty) {
        final picked = (c['value'] is List ? c['value'] as List : str(c['value']).split(','))
            .map((v) => str(v).trim())
            .where((v) => v.isNotEmpty)
            .toList();
        valueField = Wrap(spacing: 6, runSpacing: 6, children: [
          for (final ch in choices)
            FilterChip(
              label: Text(cl(ch), style: const TextStyle(fontSize: 12.5)),
              selected: picked.contains(ch),
              onSelected: (on) => setS(() => c['value'] = on ? [...picked, ch] : picked.where((v) => v != ch).toList()),
            ),
        ]);
      } else {
        final isList = op == 'in' || op == 'not_in';
        valueField = AppTextField(
          key: ValueKey('cv-$ci-${c['field']}-$op'),
          label: 'Value',
          initialValue: c['value'] is List ? (c['value'] as List).join(', ') : str(c['value']),
          hint: isList ? 'a, b, c' : ftype == 'number' ? '500000' : 'value',
          keyboardType: ftype == 'number' && !isList ? AppTextField.number : null,
          onChanged: (v) {
            c['value'] = ftype == 'number' && !isList ? (v.trim().isEmpty ? '' : (num.tryParse(v.trim()) ?? v)) : v;
          },
        );
      }
    }
    return Container(
      padding: const EdgeInsets.all(10),
      decoration: BoxDecoration(borderRadius: BorderRadius.circular(10), border: Border.all(color: Brand.border)),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Row(children: [
            Text(ci > 0 ? 'AND' : 'IF',
                style: const TextStyle(fontSize: 11.5, fontWeight: FontWeight.w700, color: Brand.muted)),
            const Spacer(),
            IconButton(
              tooltip: 'Remove condition ${ci + 1}',
              visualDensity: VisualDensity.compact,
              icon: const Icon(Icons.close_rounded, color: Brand.danger, size: 20),
              onPressed: () => setS(() => conds.removeAt(ci)),
            ),
          ]),
          AppSelect<String>(
            label: 'Field',
            value: str(c['field']),
            clearable: false,
            options: [for (final e in _fields.entries) Option(e.key, str(jsonMap(e.value)['label']))],
            onChanged: (o) => setS(() {
              if (o == null) return;
              c['field'] = o.value;
              c['value'] = '';
            }),
          ),
          const SizedBox(height: 8),
          AppSelect<String>(
            label: 'Condition',
            value: op,
            clearable: false,
            options: opOptions,
            onChanged: (o) => setS(() => c['op'] = o?.value ?? op),
          ),
          if (valueField != null) ...[const SizedBox(height: 8), valueField],
        ],
      ),
    );
  }

  // ── build ──────────────────────────────────────────────────────────────

  Widget _card(List<Widget> children, {Color? color, Color? border}) => Padding(
        padding: const EdgeInsets.fromLTRB(16, 0, 16, 12),
        child: Container(
          padding: const EdgeInsets.all(14),
          decoration: BoxDecoration(
            color: color ?? Colors.white,
            borderRadius: BorderRadius.circular(14),
            border: Border.all(color: border ?? Brand.border),
          ),
          child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: children),
        ),
      );

  Widget _step(int n, String title, String help) => Padding(
        padding: const EdgeInsets.fromLTRB(16, 12, 16, 8),
        child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          Text('$n. $title', style: const TextStyle(fontSize: 16, fontWeight: FontWeight.w700, color: Brand.heading)),
          const SizedBox(height: 2),
          _hint(help),
        ]),
      );

  Widget _flowNode(String title, String sub, Color tone, {String? foot, String? badge}) => Container(
        width: double.infinity,
        padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
        decoration: BoxDecoration(
          color: tone.withValues(alpha: 0.07),
          borderRadius: BorderRadius.circular(12),
          border: Border.all(color: tone.withValues(alpha: 0.35)),
        ),
        child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          Text.rich(TextSpan(children: [
            TextSpan(text: title),
            if (badge != null)
              TextSpan(text: '  ⚠ $badge', style: const TextStyle(fontSize: 10.5, color: Color(0xFFB91C1C))),
          ]), style: const TextStyle(fontSize: 13, fontWeight: FontWeight.w700, color: Brand.heading)),
          Text(sub, style: const TextStyle(fontSize: 12, color: Brand.body)),
          if (foot != null) Text(foot, style: const TextStyle(fontSize: 11, color: Brand.muted)),
        ]),
      );

  Widget get _arrow => const Center(child: Icon(Icons.arrow_downward_rounded, size: 18, color: Brand.muted));

  Widget _switchRow(String k, String label, String help) {
    final wf = _wf!;
    return SwitchListTile(
      contentPadding: EdgeInsets.zero,
      value: wf[k] == true,
      title: Text(label, style: const TextStyle(fontSize: 14, fontWeight: FontWeight.w600, color: Brand.heading)),
      subtitle: Text(help, style: const TextStyle(fontSize: 11.5)),
      onChanged: _readOnly || !_isAdmin ? null : (v) => _edit((w) => w[k] = v),
    );
  }

  Widget _stageCard(int i, Json s) {
    final errs = _errorsFor(i);
    final cfg = jsonMap(s['rule_config']);
    final hours = asInt(s['escalate_after_hours']);
    final esc = jsonMap(_meta?['escalation_rules']);
    return Padding(
      padding: const EdgeInsets.fromLTRB(16, 0, 16, 12),
      child: Container(
        decoration: BoxDecoration(
          color: Colors.white,
          borderRadius: BorderRadius.circular(14),
          border: Border.all(color: errs > 0 ? Brand.danger : Brand.border, width: errs > 0 ? 1.5 : 1),
        ),
        padding: const EdgeInsets.all(14),
        child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          Text('Stage ${i + 1}${str(s['name']).isNotEmpty ? ' — ${str(s['name'])}' : ''}',
              style: const TextStyle(fontSize: 14, fontWeight: FontWeight.w700, color: Brand.heading)),
          if (errs > 0)
            Text('⚠ $errs to fix — see section 3',
                style: const TextStyle(fontSize: 11.5, fontWeight: FontWeight.w600, color: Color(0xFFB91C1C))),
          const SizedBox(height: 6),
          FieldRow('Approver', _whoText(s)),
          FieldRow('When several people match',
              s['approval_mode'] == 'all' ? 'Every one must approve' : 'Any one of them approves'),
          if (str(cfg['plus_permission']).isNotEmpty) FieldRow('Also allow holders of', _permWords(cfg['plus_permission'])),
          if (cfg['same_plant'] == true) const FieldRow('Same plant only', 'Yes'),
          FieldRow('Applies when', _condText(s)),
          FieldRow('Skip this stage if nobody matches', s['skip_if_no_approver'] == true ? 'Yes' : 'No'),
          FieldRow(
              'Escalate after (hours)',
              hours == null || hours == 0
                  ? 'off'
                  : '$hours h → ${str(esc[str(s['escalation_rule'])]).isEmpty ? str(s['escalation_rule']) : str(esc[str(s['escalation_rule'])])}'),
          if (!_readOnly) ...[
            const SizedBox(height: 6),
            Wrap(spacing: 8, runSpacing: 8, children: [
              PillButton('Edit', icon: Icons.edit_outlined, onPressed: () => _editStage(i)),
              PillButton('Up', icon: Icons.arrow_upward_rounded, onPressed: i == 0 ? null : () => _moveStage(i, -1)),
              PillButton('Down',
                  icon: Icons.arrow_downward_rounded,
                  onPressed: i == _stages.length - 1 ? null : () => _moveStage(i, 1)),
              PillButton('Remove', icon: Icons.delete_outline_rounded, danger: true, onPressed: () => _removeStage(i)),
            ]),
          ] else ...[
            const SizedBox(height: 6),
            PillButton('View', icon: Icons.visibility_outlined, onPressed: () => _viewStage(s)),
          ],
        ]),
      ),
    );
  }

  /// Read-only users still see the full stage (conditions, escalation users).
  void _viewStage(Json s) {
    final cfg = jsonMap(s['rule_config']);
    final users = _ids(cfg['user_ids']).map(_userName).join(', ');
    final escUsers = _ids(jsonMap(s['escalation_config'])['user_ids']).map(_userName).join(', ');
    showModalBottomSheet<void>(
      context: context,
      backgroundColor: Colors.white,
      builder: (_) => SafeArea(
        child: ListView(shrinkWrap: true, padding: const EdgeInsets.all(16), children: [
          Text(str(s['name']), style: const TextStyle(fontSize: 17, fontWeight: FontWeight.w700)),
          const SizedBox(height: 8),
          FieldRow('Approver', _whoText(s)),
          if (users.isNotEmpty) FieldRow('Users', users),
          FieldRow('Applies when', _condText(s)),
          if (escUsers.isNotEmpty) FieldRow('Escalation users', escUsers),
        ]),
      ),
    );
  }

  List<Widget> _checkSection() {
    final fields = _fields.entries.where((e) => jsonMap(e.value)['type'] != 'user').toList();
    final check = _check;
    return [
      _step(3, 'Check & preview',
          'The setup is checked against everyone who can raise this document, as you edit — before you save.'),
      _card([
        Row(children: [
          const Expanded(
              child: Text('Setup check',
                  style: TextStyle(fontSize: 14, fontWeight: FontWeight.w700, color: Brand.heading))),
          Flexible(
            child: Text(
              _checking
                  ? 'Checking…'
                  : check != null
                      ? 'Checked against ${check['checked_users']} people who can raise this document'
                      : '',
              textAlign: TextAlign.right,
              style: const TextStyle(fontSize: 11.5, color: Brand.muted),
            ),
          ),
        ]),
        const SizedBox(height: 8),
        if (_checkError.isNotEmpty)
          Padding(
            padding: const EdgeInsets.only(bottom: 8),
            child: Text("Can't check yet: $_checkError",
                style: const TextStyle(fontSize: 12.5, color: Color(0xFFB91C1C))),
          ),
        if (check != null && _issues.isEmpty)
          const Text('✓ No problems — everyone who can raise this document would find an approver at every stage.',
              style: TextStyle(fontSize: 13, color: Color(0xFF15803D))),
        for (final x in _issues)
          Builder(builder: (_) {
            final lv = _levels[str(x['level'])] ?? _levels['info']!;
            final st = asInt(x['stage']);
            return Container(
              margin: const EdgeInsets.only(bottom: 6),
              padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
              decoration: BoxDecoration(
                  color: lv.$3, borderRadius: BorderRadius.circular(10), border: Border.all(color: lv.$2.withValues(alpha: 0.3))),
              child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                Text.rich(TextSpan(children: [
                  TextSpan(text: '${lv.$1}: ', style: const TextStyle(fontWeight: FontWeight.w700)),
                  TextSpan(text: str(x['message'])),
                ]), style: TextStyle(fontSize: 12.5, color: lv.$2)),
                if (st != null && st < _stages.length)
                  TextButton(
                    style: TextButton.styleFrom(padding: EdgeInsets.zero, minimumSize: const Size(0, 28)),
                    onPressed: () => _readOnly ? _viewStage(_stages[st]) : _editStage(st),
                    child: Text('Go to stage', style: TextStyle(color: lv.$2, decoration: TextDecoration.underline)),
                  ),
              ]),
            );
          }),
        const SizedBox(height: 14),
        const Text('Try it', style: TextStyle(fontSize: 14, fontWeight: FontWeight.w700, color: Brand.heading)),
        const SizedBox(height: 2),
        _hint("Pick a requester and fill in the document's values (e.g. amount) to see exactly who would approve it — "
            'uses the workflow as edited above, so you can try a change before saving.'),
        const SizedBox(height: 10),
        AppSelect<int>(
          label: 'Requester',
          value: _pvUser,
          valueLabel: _pvUser == null ? null : _userName(_pvUser),
          loadOptions: _userOptions,
          onChanged: (o) => setState(() => _pvUser = o?.value),
        ),
        for (final e in fields) ...[
          const SizedBox(height: 10),
          _ctxField(e.key, jsonMap(e.value)),
        ],
        const SizedBox(height: 10),
        Align(
          alignment: Alignment.centerLeft,
          child: PillButton('Preview', icon: Icons.search_rounded, onPressed: _runPreview),
        ),
        if (_preview != null) ...[
          const SizedBox(height: 10),
          if (_preview!.isEmpty)
            _hint('No stage applies — the document would be approved on submit.'),
          for (final p in _preview!) _previewRow(p),
        ],
      ]),
    ];
  }

  Widget _ctxField(String k, Json f) {
    final t = str(f['type']);
    final label = str(f['label']);
    final choices = (f['choices'] is List) ? (f['choices'] as List).map(str).toList() : <String>[];
    final labels = jsonMap(f['choice_labels']);
    final cur = _pvCtx[k] ?? '';
    if (t == 'bool') {
      return AppSelect<String>(
        label: label,
        value: cur.isEmpty ? null : cur,
        options: const [Option('true', 'Yes'), Option('false', 'No')],
        onChanged: (o) => setState(() => _pvCtx[k] = o?.value ?? ''),
      );
    }
    if (choices.isNotEmpty) {
      return AppSelect<String>(
        label: label,
        value: cur.isEmpty ? null : cur,
        options: [for (final c in choices) Option(c, str(labels[c]).isEmpty ? c : str(labels[c]))],
        onChanged: (o) => setState(() => _pvCtx[k] = o?.value ?? ''),
      );
    }
    return AppTextField(
      label: label,
      initialValue: cur,
      keyboardType: t == 'number' ? AppTextField.number : null,
      onChanged: (v) => _pvCtx[k] = v,
    );
  }

  Widget _previewRow(Json p) {
    final approvers = jsonList(p['approvers']);
    final skipped = p['skipped'] == true;
    final problem = str(p['problem']);
    final bad = problem.isNotEmpty && !skipped;
    final InlineSpan tail;
    if (approvers.isNotEmpty) {
      tail = TextSpan(
          text: '— ${approvers.map((a) => str(a['name'])).join(', ')} (${p['approval_mode'] == 'all' ? 'all' : 'any one'})');
    } else if (skipped) {
      tail = TextSpan(text: '— skipped: $problem', style: const TextStyle(color: Brand.muted));
    } else {
      tail = TextSpan(
          text: '— submission would be refused: $problem', style: const TextStyle(color: Color(0xFFB91C1C)));
    }
    return Container(
      margin: const EdgeInsets.only(bottom: 6),
      padding: const EdgeInsets.only(left: 10),
      decoration: BoxDecoration(
          border: Border(left: BorderSide(color: bad ? Brand.danger : Brand.border, width: 3))),
      child: Text.rich(
          TextSpan(children: [
            TextSpan(text: '${p['sequence']}. ${str(p['name'])} ', style: const TextStyle(fontWeight: FontWeight.w700)),
            tail,
          ]),
          style: const TextStyle(fontSize: 13, color: Brand.body)),
    );
  }

  List<Widget> _historySection() => [
        _step(4, 'History', 'Changes apply to documents submitted after saving. Every save is recorded.'),
        _card([
          Align(
            alignment: Alignment.centerLeft,
            child: TextButton(
              onPressed: _toggleHistory,
              child: Text(_showHistory ? '▾ Hide change history' : '▸ Show change history',
                  style: const TextStyle(color: Brand.muted, fontWeight: FontWeight.w600)),
            ),
          ),
          if (_showHistory) ...[
            if (_history == null) _hint('Loading…'),
            if (_history != null && _history!.isEmpty)
              _hint('Not changed since it was set up — it runs on the module default.'),
            for (final h in _history ?? <Json>[])
              Container(
                margin: const EdgeInsets.only(top: 6),
                padding: const EdgeInsets.only(left: 10),
                decoration: const BoxDecoration(border: Border(left: BorderSide(color: Brand.border, width: 3))),
                child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                  Text('${str(h['performed_by'])} · ${fmtDateTime(h['performed_at'])}',
                      style: const TextStyle(fontSize: 12.5, fontWeight: FontWeight.w700, color: Brand.body)),
                  Text(txt(h['summary']), style: const TextStyle(fontSize: 12.5, color: Brand.muted)),
                ]),
              ),
          ],
        ]),
      ];

  Widget _body() {
    if (_wf == null || _meta == null || _type == null) {
      if (_loadError != null) {
        return ErrorView('This workflow could not be opened: ${ApiClient.describe(_loadError!)}', onRetry: _load);
      }
      return const LoadingView();
    }
    final wf = _wf!, type = _type!;
    final stages = _stages;
    final summary = _summary;
    final tpl = _templates.where((x) => x.id == _tplId).firstOrNull;
    final subtitle = [
      '${str(type['module_label'])} › ${str(type['subtab_label'])}',
      str(type['description']),
    ].where((x) => x.isNotEmpty).join(' — ');
    return ListView(
      padding: const EdgeInsets.only(bottom: 24),
      children: [
        PageHeader(str(type['label']).isEmpty ? 'Approval workflow' : str(type['label']), subtitle: subtitle),
        // Visual flow: what happens to a document, start to finish.
        _card([
          _flowNode('Submitted', 'by the requester', const Color(0xFF64748B)),
          if (wf['is_active'] != true) ...[
            _arrow,
            _flowNode('Approval off', 'approved at once', const Color(0xFFF59E0B)),
          ] else
            for (var i = 0; i < stages.length; i++) ...[
              _arrow,
              InkWell(
                onTap: () => _readOnly ? _viewStage(stages[i]) : _editStage(i),
                child: _flowNode(
                  '${i + 1}. ${str(stages[i]['name']).isEmpty ? 'Unnamed stage' : str(stages[i]['name'])}',
                  '${_whoText(stages[i])} · ${stages[i]['approval_mode'] == 'all' ? 'all must sign' : 'any one signs'}',
                  _errorsFor(i) > 0
                      ? const Color(0xFFDC2626)
                      : jsonList(stages[i]['conditions']).isNotEmpty
                          ? const Color(0xFF3B82F6)
                          : Brand.primary,
                  foot: 'When: ${_condText(stages[i])}'
                      '${asInt(stages[i]['escalate_after_hours']) != null ? ' · escalates after ${stages[i]['escalate_after_hours']}h' : ''}'
                      '${stages[i]['skip_if_no_approver'] == true ? ' · skippable' : ''}',
                  badge: _errorsFor(i) > 0 ? '${_errorsFor(i)} to fix' : null,
                ),
              ),
            ],
          _arrow,
          _flowNode('Approved', 'the module moves on', const Color(0xFF22C55E)),
        ]),
        // The same workflow in plain words — updates as you edit.
        _card([
          const Caps('In plain words'),
          const SizedBox(height: 8),
          for (var i = 0; i < summary.length; i++)
            Padding(
              padding: const EdgeInsets.only(bottom: 5),
              child: Text(summary[i],
                  style: TextStyle(
                      fontSize: 13,
                      height: 1.5,
                      color: i == summary.length - 1 && wf['is_active'] == true && stages.isNotEmpty
                          ? Brand.muted
                          : Brand.body)),
            ),
        ], color: const Color(0x09FF6A2A)),
        _step(1, 'General settings', 'Rules that apply to every stage of this approval.'),
        _card([
          _switchRow('is_active', 'Approval required', 'Off = documents are approved as soon as they are submitted.'),
          _switchRow('allow_self_approval', 'Requester may approve own document',
              'Off = the person who raised it can never approve it (a second person must). Recommended off.'),
          _switchRow('distinct_approvers', 'Different person per stage',
              'One person can approve only one stage of the same document.'),
          _switchRow(
              'require_permission',
              'Approver also needs the Approve permission',
              'On (recommended) = the approver must also have the Approve permission on ${str(type['module_label'])} › '
                  "${str(type['subtab_label'])}, so losing the permission stops them approving. Off = being the stage's "
                  'approver is enough — only where the person is the authority (e.g. a manager approving leave).'),
          if (!_isAdmin) ...[const SizedBox(height: 8), _hint('Only an administrator can change this.')],
          const SizedBox(height: 10),
          _hint('An approver going on leave sets a delegate in Organization › Delegations — their pending approvals '
              "reach the delegate for those dates. Every decision, delegation and escalation is kept on the document's "
              'approval history.'),
        ]),
        _step(2, 'Approval stages',
            'Stages run in order. Each stage: who approves, when it applies, and what happens if nobody matches or nobody acts.'),
        if (!_readOnly)
          _card([
            AppSelect<String>(
              label: 'Start from a template (optional)',
              value: _tplId,
              options: [for (final t in _templates) Option(t.id, t.label)],
              onChanged: (o) => setState(() => _tplId = o?.value),
            ),
            if (tpl?.needsAmount == true) ...[
              const SizedBox(height: 10),
              AppTextField(
                label: 'Partner above (₹)',
                initialValue: _tplAmount,
                keyboardType: TextInputType.number,
                onChanged: (v) => _tplAmount = v,
              ),
            ],
            if (tpl != null) ...[const SizedBox(height: 6), _hint(tpl.help)],
            const SizedBox(height: 10),
            Align(
              alignment: Alignment.centerLeft,
              child: PillButton('Apply template',
                  icon: Icons.description_outlined, onPressed: tpl == null ? null : _applyTemplate),
            ),
          ]),
        for (var i = 0; i < stages.length; i++) _stageCard(i, stages[i]),
        if (!_readOnly)
          Padding(
            padding: const EdgeInsets.fromLTRB(16, 0, 16, 6),
            child: Align(
              alignment: Alignment.centerLeft,
              child: PillButton('Add stage', icon: Icons.add_rounded, onPressed: () => _editStage(null)),
            ),
          ),
        if (!_readOnly && stages.isEmpty)
          Padding(
            padding: const EdgeInsets.fromLTRB(16, 0, 16, 8),
            child: Text('No stages — switch “Approval required” off if this document should not need approval.',
                style: TextStyle(fontSize: 11.5, color: Brand.danger.withValues(alpha: 0.9))),
          ),
        if (_maySimulate) ..._checkSection(),
        if (_seeHistory) ..._historySection(),
      ],
    );
  }

  Widget? _bottom() {
    if (_wf == null) return null;
    if (_readOnly) {
      return const Text(
          'You can view this workflow; changing it needs Organization › Approval Workflows › Edit.',
          style: TextStyle(fontSize: 12.5, color: Brand.muted));
    }
    return Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.stretch, children: [
      if (_dirty)
        const Padding(
          padding: EdgeInsets.only(bottom: 6),
          child: Text('Unsaved changes',
              style: TextStyle(fontSize: 12.5, fontWeight: FontWeight.w600, color: Color(0xFF92400E))),
        ),
      Row(children: [
        if (_mayReset) ...[
          Expanded(
            child: OutlinedButton.icon(
              style: OutlinedButton.styleFrom(minimumSize: const Size(0, 44)),
              onPressed: _reset,
              icon: const Icon(Icons.undo_rounded, size: 18),
              label: const Text('Reset to default'),
            ),
          ),
          const SizedBox(width: 8),
        ],
        Expanded(
          child: FilledButton.icon(
            style: FilledButton.styleFrom(minimumSize: const Size(0, 44)),
            onPressed: _saving ? null : _save,
            icon: const Icon(Icons.check_rounded, size: 18),
            label: Text(_saving
                ? 'Saving…'
                : _totalErrors > 0
                    ? 'Save workflow ($_totalErrors to fix)'
                    : 'Save workflow'),
          ),
        ),
      ]),
    ]);
  }

  @override
  Widget build(BuildContext context) {
    return PopScope(
      canPop: !_dirty,
      onPopInvokedWithResult: (didPop, _) async {
        if (didPop) return;
        final leave = await confirmDialog(context,
            title: 'Leave without saving?',
            confirmLabel: 'Leave',
            message: 'Your changes to this workflow have not been saved.');
        if (leave && context.mounted) {
          setState(() => _baseline = null);
          Navigator.of(context).pop();
        }
      },
      child: SubPage(
        title: str(_type?['label']).isEmpty ? 'Approval workflow' : str(_type?['label']),
        body: _body(),
        bottom: _bottom(),
      ),
    );
  }
}
