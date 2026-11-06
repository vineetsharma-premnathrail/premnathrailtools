import 'package:flutter/material.dart';

import '../../api/api.dart';
import '../../theme.dart';
import '../../ui/app_frame.dart';
import '../../ui/form.dart';
import '../../ui/format.dart';
import '../../ui/perms.dart';
import '../../ui/widgets.dart';
import 'quality_common.dart';

const _lists = [
  ('ncr_sources', 'NCR sources', 'Where a manual NCR can come from.'),
  ('complaint_categories', 'Complaint categories', 'Used from Phase 3 (customer complaints).'),
  ('audit_types', 'Audit types', 'Used from Phase 4 (audits).'),
  ('inspection_agencies', 'Inspection agencies', 'Third-party inspection (RITES / RDSO / customer), Phase 2.'),
];

/// Quality Settings (portal settings/page.tsx) — opened from the gear icon.
class QualitySettingsScreen extends StatefulWidget {
  const QualitySettingsScreen({super.key});

  @override
  State<QualitySettingsScreen> createState() => _QualitySettingsScreenState();
}

class _QualitySettingsScreenState extends State<QualitySettingsScreen> {
  List<Json> _specs = [];
  List<Json> _groups = [];
  bool _canEdit = false;
  final _ctrls = <String, TextEditingController>{};
  final _choices = <String, String>{};
  List<Json> _values = [];
  List<Json> _roles = [];
  List<Json> _users = [];
  bool _loaded = false;
  Object? _error;
  bool _busy = false;

  bool get _isAdmin => Perm.user['role'] == 'admin';

  @override
  void initState() {
    super.initState();
    _load();
  }

  @override
  void dispose() {
    for (final c in _ctrls.values) {
      c.dispose();
    }
    super.dispose();
  }

  Future<void> _load() async {
    try {
      final d = await Api.get('/quality/settings');
      final m = d is Map ? Map<String, dynamic>.from(d) : <String, dynamic>{};
      final vals = m['values'] is Map ? Map<String, dynamic>.from(m['values'] as Map) : <String, dynamic>{};
      _specs = rowsOf(m['specs']);
      _groups = rowsOf(m['groups']);
      _canEdit = m['can_edit'] == true;
      for (final sp in _specs) {
        final k = str(sp['key']);
        final v = vals[k] == null ? '' : '${vals[k]}';
        if (sp['type'] == 'choice') {
          _choices[k] = v;
        } else {
          (_ctrls[k] ??= TextEditingController()).text = v;
        }
      }
      try {
        _values = rowsOf(await Api.get('/quality/masters/values', query: {'include_inactive': true}));
      } catch (_) {
        _values = [];
      }
      try {
        final r = await Api.get('/quality/settings/roles');
        if (r is Map) {
          _roles = rowsOf(r['roles']);
          _users = rowsOf(r['users']);
        }
      } catch (_) {}
      if (mounted) {
        setState(() {
          _loaded = true;
          _error = null;
        });
      }
    } catch (e) {
      if (mounted) setState(() => _error = e);
    }
  }

  Future<void> _save() async {
    final payload = <String, dynamic>{};
    for (final sp in _specs) {
      final k = str(sp['key']);
      if (sp['type'] == 'choice') {
        payload[k] = _choices[k] ?? '';
      } else {
        final t = _ctrls[k]?.text ?? '';
        if (sp['type'] == 'int' || sp['type'] == 'float') {
          final n = num.tryParse(t.trim());
          if (n == null) {
            showSnack(context, '${sp['label']} must be a number - fix it and save again.', error: true);
            return;
          }
          payload[k] = n;
        } else {
          payload[k] = t;
        }
      }
    }
    setState(() => _busy = true);
    final ok = await runAction(context, () => Api.put('/quality/settings', data: {'values': payload}),
        success: 'Quality settings saved. The change is recorded in the audit log.');
    if (mounted) setState(() => _busy = false);
    if (ok) _load();
  }

  Future<void> _toggleValue(Json v) async {
    final ok = await runAction(context, () => Api.patch('/quality/masters/values/${v['id']}', data: {'is_active': v['is_active'] != true}));
    if (ok) _load();
  }

  Future<void> _addValue(String key, String label, String note) async {
    final ctrl = TextEditingController();
    final ok = await showFormSheet(
      context,
      title: 'Add Value',
      saveLabel: 'Add',
      builder: (ctx, setS) => [
        Text(label, style: const TextStyle(color: Brand.muted)),
        AppTextField(label: 'Value', required: true, controller: ctrl, hint: 'New value'),
        Text(note, style: const TextStyle(fontSize: 12, color: Brand.muted)),
      ],
      onSave: () async {
        final v = ctrl.text.trim();
        if (v.isEmpty) throw 'Type the value to add (e.g. the agency or category name).';
        await Api.post('/quality/masters/values', data: {'list_key': key, 'value': v, 'label': v});
      },
    );
    if (ok && mounted) {
      showSnack(context, 'Value added.');
      _load();
    }
  }

  Future<void> _grant() async {
    int? userId;
    var role = _roles.isNotEmpty ? str(_roles.first['key']) : 'inspector';
    if (_roles.any((r) => r['key'] == 'inspector')) role = 'inspector';
    String msg = '';
    final ok = await showFormSheet(
      context,
      title: 'Grant Quality Role',
      saveLabel: 'Grant role',
      builder: (ctx, setS) => [
        const Text('Adds the role\'s Permission Matrix grants to the user.', style: TextStyle(color: Brand.muted)),
        AppSelect<int>(
          label: 'User',
          required: true,
          value: userId,
          options: [for (final u in _users) Option(asInt(u['id'])!, txt(u['name']), subtitle: str(u['email']))],
          onChanged: (o) => setS(() => userId = o?.value),
        ),
        AppSelect<String>(
          label: 'Role',
          required: true,
          value: role,
          options: [for (final r in _roles) Option(str(r['key']), txt(r['label']))],
          onChanged: (o) => setS(() => role = o?.value ?? role),
        ),
        const Text('The user gets every permission of this role; permissions they already hold are kept.',
            style: TextStyle(fontSize: 12, color: Brand.muted)),
      ],
      onSave: () async {
        if (userId == null) throw 'Pick the user.';
        final r = await Api.post('/quality/settings/roles/assign', data: {'user_id': userId, 'role': role});
        final added = r is Map && r['added'] is List ? (r['added'] as List).length : 0;
        msg = added > 0 ? 'Granted $added permission(s).' : 'The user already had every permission of this role.';
      },
    );
    if (ok && mounted) {
      showSnack(context, msg);
      _load();
    }
  }

  Widget _specField(Json sp) {
    final k = str(sp['key']);
    final help = str(sp['help']);
    final Widget field;
    if (sp['type'] == 'choice') {
      final choices = sp['choices'] is List ? sp['choices'] as List : const [];
      field = AppSelect<String>(
        label: txt(sp['label']),
        value: _choices[k],
        clearable: false,
        enabled: _canEdit,
        options: [
          for (final c in choices)
            if (c is List && c.length >= 2) Option('${c[0]}', '${c[1]}'),
        ],
        onChanged: (o) => setState(() => _choices[k] = o?.value ?? ''),
      );
    } else {
      field = AppTextField(
        label: txt(sp['label']),
        controller: _ctrls[k] ??= TextEditingController(),
        enabled: _canEdit,
        keyboardType: sp['type'] == 'str'
            ? null
            : sp['type'] == 'int'
                ? TextInputType.number
                : AppTextField.number,
      );
    }
    return Padding(
      padding: const EdgeInsets.only(bottom: 12),
      child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
        field,
        if (help.isNotEmpty)
          Padding(
            padding: const EdgeInsets.only(top: 4),
            child: Text(help, style: const TextStyle(fontSize: 11.5, color: Brand.muted)),
          ),
      ]),
    );
  }

  @override
  Widget build(BuildContext context) {
    if (!_loaded) {
      return SubPage(
          title: 'Quality Settings', body: _error != null ? ErrorView(_error!, onRetry: _load) : const LoadingView());
    }
    return SubPage(
      title: 'Quality Settings',
      bottom: _canEdit
          ? primaryBtn(_busy ? 'Saving…' : 'Save settings', _busy ? null : _save, icon: Icons.save_outlined)
          : null,
      body: RefreshIndicator(
        onRefresh: _load,
        child: ListView(
          padding: const EdgeInsets.only(top: 12, bottom: 32),
          children: [
            if (!_canEdit)
              const Hint('Read-only — only a Quality head or an admin can change Quality settings.',
                  color: Color(0xFFB45309)),
            const Hint('Who approves — NCR dispositions (incl. the scrap value that needs a Partner), inspection plans, '
                'vendor blocks, CAPA D8 and complaint closure — is set in Organization › Approval Workflows, not here.'),
            for (final g in _groups)
              DetailSection(txt(g['label']), children: [
                for (final sp in _specs.where((s) => s['group'] == g['key'])) _specField(sp),
              ]),
            DetailSection('Master lists', children: [
              const Text(
                  'Values are never deleted — retire them so old records keep their meaning. Defect and disposition codes, '
                  'characteristics and the sampling table are under Quality → Masters.',
                  style: TextStyle(fontSize: 12, color: Brand.muted)),
              for (final (key, label, note) in _lists) ...[
                const SizedBox(height: 12),
                Text(label, style: const TextStyle(fontSize: 13, fontWeight: FontWeight.w700, color: Brand.heading)),
                Text(note, style: const TextStyle(fontSize: 11.5, color: Brand.muted)),
                for (final v in _values.where((v) => v['list_key'] == key))
                  Opacity(
                    opacity: v['is_active'] == true ? 1 : 0.5,
                    child: Row(children: [
                      Expanded(child: Text(txt(v['label']), style: const TextStyle(fontSize: 13.5))),
                      if (_canEdit)
                        TextButton(
                          onPressed: () => _toggleValue(v),
                          child: Text(v['is_active'] == true ? 'Retire' : 'Reactivate',
                              style: TextStyle(
                                  fontSize: 12.5, fontWeight: FontWeight.w600, color: v['is_active'] == true ? qRed : qGreen)),
                        ),
                    ]),
                  ),
                if (_canEdit) ActionWrap(children: [secondaryBtn('+ Add value', () => _addValue(key, label, note), icon: Icons.add_rounded)]),
              ],
            ]),
            DetailSection('Quality roles', children: [
              const Text(
                  'Roles are Permission Matrix sets. Usage decisions, plan approval, NCR disposition approvals and these settings '
                  'need the role explicitly (admins always pass). Partner approval comes from Company Info → Partners; Design and '
                  'Purchase approvals from module access.',
                  style: TextStyle(fontSize: 12, color: Brand.muted)),
              if (_isAdmin) ActionWrap(children: [primaryBtn('+ Grant role', _grant, icon: Icons.shield_outlined)]),
              const SizedBox(height: 8),
              for (final u in _users)
                Padding(
                  padding: const EdgeInsets.symmetric(vertical: 4),
                  child: Wrap(spacing: 6, runSpacing: 4, crossAxisAlignment: WrapCrossAlignment.center, children: [
                    Text(txt(u['name']), style: const TextStyle(fontSize: 13.5, fontWeight: FontWeight.w600)),
                    if (u['is_admin'] == true) pill('Admin', const Color(0xFF7C3AED)),
                    if (u['is_partner'] == true) pill('Partner', const Color(0xFF0891B2)),
                    for (final r in (u['roles'] is List ? u['roles'] as List : const []))
                      pill(str(_roles.where((x) => x['key'] == r).firstOrNull?['label'] ?? r), qGreen),
                    if (u['is_admin'] != true && (u['roles'] is! List || (u['roles'] as List).isEmpty))
                      const Text('No Quality role', style: TextStyle(fontSize: 12, color: Brand.muted)),
                  ]),
                ),
            ]),
          ],
        ),
      ),
    );
  }
}
