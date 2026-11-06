import 'package:flutter/material.dart';

import '../../api/api.dart';
import '../../theme.dart';
import '../../ui/form.dart';
import '../../ui/format.dart';
import '../../ui/perms.dart';
import '../../ui/widgets.dart';
import 'org_common.dart';
import 'permission_tree.dart';
import 'role_notifications.dart';

// Phone versions of RoleMemberAccess.tsx, ApprovesInPanel.tsx and
// useSodGuard.tsx.

// ── Segregation of Duties guard ──────────────────────────────────────────────

/// Previews a role / extra-grant change for SoD conflicts (backend
/// core/sod_rules.py). No new conflict -> null. A conflict shows what clashes;
/// HIGH risk needs a mitigation reason, medium only a confirmation. Throws a
/// readable String when the user cancels.
Future<String?> sodGuard(BuildContext context, int userId, Json planned) async {
  final preview = jsonMap(await Api.post('/organization/grc/sod/preview', data: {'user_id': userId, ...planned}));
  final conflicts = jsonList(preview['new_conflicts']);
  if (conflicts.isEmpty || !context.mounted) return null;
  final high = conflicts.any((c) => c['risk'] == 'high');
  final ctrl = TextEditingController();
  final ok = await showDialog<bool>(
    context: context,
    builder: (ctx) => StatefulBuilder(
      builder: (ctx, setS) => AlertDialog(
        title: Text(high ? 'Segregation of Duties conflict — mitigation needed' : 'Segregation of Duties warning'),
        content: SingleChildScrollView(
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(
                  high
                      ? 'Enter the mitigating control (who reviews their work, until when) to assign it anyway.'
                      : 'You can save anyway; a reason is recorded if you give one.',
                  style: const TextStyle(fontSize: 12.5, color: Brand.muted)),
              const SizedBox(height: 10),
              const Caps('What clashes'),
              const SizedBox(height: 6),
              for (final c in conflicts)
                Container(
                  margin: const EdgeInsets.only(bottom: 8),
                  padding: const EdgeInsets.all(10),
                  decoration: BoxDecoration(
                      color: Brand.background,
                      borderRadius: BorderRadius.circular(10),
                      border: Border.all(color: Brand.border)),
                  child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                    Wrap(spacing: 8, crossAxisAlignment: WrapCrossAlignment.center, children: [
                      Text('${str(c['rule_id'])} ${str(c['title'])}',
                          style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 13)),
                      StatusBadge('${humanize(c['risk'])} risk',
                          color: c['risk'] == 'high' ? Brand.danger : Brand.warning),
                    ]),
                    const SizedBox(height: 4),
                    Text(str(c['why']), style: const TextStyle(fontSize: 12.5)),
                  ]),
                ),
              const SizedBox(height: 6),
              TextField(
                controller: ctrl,
                maxLines: 3,
                onChanged: (_) => setS(() {}),
                decoration: fieldDecoration(
                  high ? 'Who checks this person’s work, and until when?' : 'Why is this needed?',
                  required: high,
                  hint: high ? 'e.g. Finance manager reviews every JV this user posts, until 31-03-2027' : 'Optional reason…',
                ),
              ),
              const SizedBox(height: 4),
              Text(
                  high
                      ? 'Recorded as the mitigation for this conflict (Organization › Access Risk › Mitigations).'
                      : 'Recorded with the assignment.',
                  style: const TextStyle(fontSize: 11.5, color: Brand.muted)),
            ],
          ),
        ),
        actions: [
          TextButton(onPressed: () => Navigator.pop(ctx, false), child: const Text('Cancel')),
          FilledButton(
            style: FilledButton.styleFrom(backgroundColor: Brand.danger, minimumSize: const Size(88, 40)),
            onPressed: high && ctrl.text.trim().isEmpty ? null : () => Navigator.pop(ctx, true),
            child: const Text('Assign anyway'),
          ),
        ],
      ),
    ),
  );
  if (ok != true) {
    throw 'Not saved — the Segregation of Duties conflict was not accepted. Remove the conflicting role or give a mitigation reason.';
  }
  final r = ctrl.text.trim();
  return r.isEmpty ? null : r;
}

// ── Approves in ─────────────────────────────────────────────────────────────

const _approvesKind = {
  'approver': ('Approver', Color(0xFFC2410C)),
  'also': ('May also decide', Color(0xFF1E40AF)),
  'escalation': ('Escalation', Color(0xFF92400E)),
};

/// Read-only list of workflow stages a role / person approves in.
class ApprovesInPanel extends StatelessWidget {
  const ApprovesInPanel({super.key, required this.rows, this.error, required this.empty});
  final List<Json>? rows;
  final String? error;
  final String empty;

  @override
  Widget build(BuildContext context) {
    if (error != null && error!.isNotEmpty) return Text(error!, style: const TextStyle(fontSize: 13, color: Brand.danger));
    if (rows == null) return const Text('Loading…', style: TextStyle(fontSize: 13, color: Brand.muted));
    if (rows!.isEmpty) return Text(empty, style: const TextStyle(fontSize: 13, color: Brand.muted));
    return Column(
      children: [
        for (final r in rows!)
          Opacity(
            opacity: r['workflow_active'] == false ? 0.6 : 1,
            child: Container(
              width: double.infinity,
              margin: const EdgeInsets.only(bottom: 6),
              padding: const EdgeInsets.all(10),
              decoration: BoxDecoration(
                  color: Colors.white, borderRadius: BorderRadius.circular(10), border: Border.all(color: Brand.border)),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
                    Expanded(
                      child: Text.rich(TextSpan(children: [
                        TextSpan(
                            text: '${str(r['module_label'])} › ${str(r['document'])}',
                            style: const TextStyle(fontWeight: FontWeight.w600, color: Brand.heading)),
                        TextSpan(
                            text: ' · Stage ${str(r['stage_sequence'])} “${str(r['stage_name'])}”'
                                '${r['workflow_active'] == false ? ' · approval switched off' : ''}',
                            style: const TextStyle(color: Brand.muted)),
                      ]), style: const TextStyle(fontSize: 13)),
                    ),
                    const SizedBox(width: 8),
                    StatusBadge((_approvesKind[str(r['kind'])] ?? ('', Brand.muted)).$1,
                        color: (_approvesKind[str(r['kind'])] ?? ('', Brand.muted)).$2),
                  ]),
                  const SizedBox(height: 2),
                  Text('${str(r['how'])} · Applies to: ${str(r['applies_when'])}',
                      style: const TextStyle(fontSize: 12, color: Brand.body)),
                  if (r['sole'] == true && r['kind'] == 'approver')
                    const Padding(
                      padding: EdgeInsets.only(top: 3),
                      child: Text('Only approver of this stage — nobody else can approve it.',
                          style: TextStyle(fontSize: 11.5, color: Brand.danger)),
                    ),
                ],
              ),
            ),
          ),
      ],
    );
  }
}

// ── One holder's own access ─────────────────────────────────────────────────

/// Role editor › "Settings for" one holder: that user's real access on the
/// current tab; changes apply to that user only.
class RoleMemberAccess extends StatefulWidget {
  const RoleMemberAccess({
    super.key,
    required this.tab,
    required this.userId,
    required this.userName,
    required this.catalog,
    required this.eventCatalog,
  });

  /// 'Permissions' | 'Data access' | 'Notifications' | 'Approves in'
  final String tab;
  final int userId;
  final String userName;
  final Json catalog;
  final Json? eventCatalog;

  @override
  State<RoleMemberAccess> createState() => _RoleMemberAccessState();
}

class _RoleMemberAccessState extends State<RoleMemberAccess> {
  Json? _effective;
  Set<String> _extras = {};
  Set<String> _savedExtras = {};
  bool _userLoaded = false;
  List<Json>? _scopes;
  Map<String, String> _scopeEdit = {};
  Map<String, List<String>> _notify = {};
  Map<String, List<String>> _savedNotify = {};
  Map<String, List<String>> _roleNotify = {};
  List<Json>? _approves;
  String _approvesErr = '';
  String _loadErr = '';
  String _userErr = '';
  bool _saving = false;

  bool get seeUsers => orgCan('users', 'view');
  bool get selfLocked => Perm.user['role'] != 'admin' && Perm.userId == widget.userId;
  bool feat(String f, String a) => Perm.canFeature('organization', 'roles', f, a);
  bool get seePerms => feat('extra_permissions', 'view');
  bool get editPerms => feat('extra_permissions', 'edit') && !selfLocked;
  bool get seeScopes => feat('data_access', 'view');
  bool get editScopes => feat('data_access', 'edit') && !selfLocked;
  bool get seeNotify => feat('notifications', 'view');
  bool get editNotify => feat('notifications', 'edit') && !selfLocked;

  String get name => widget.userName;

  Map<String, List<String>> _chanMap(Object? v) =>
      jsonMap(v).map((k, c) => MapEntry(k, c is List ? c.map(str).toList() : <String>[]));

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    setState(() {
      _loadErr = '';
      _userErr = '';
      _approvesErr = '';
    });
    final id = widget.userId;
    void fail(String what, Object e) {
      if (mounted) setState(() => _loadErr = '${ApiClient.describe(e)} (could not load $name\'s $what)');
    }

    Api.get('/users/$id/effective-permissions').then((v) {
      if (mounted) setState(() => _effective = jsonMap(v));
    }).catchError((Object e) => fail('access', e));
    if (seeUsers) {
      Api.get('/users/$id').then((v) async {
        final u = jsonMap(v);
        final g = (u['granular_permissions'] is List ? (u['granular_permissions'] as List).map(str) : <String>[]).toSet();
        if (!mounted) return;
        setState(() {
          _extras = g;
          _savedExtras = g;
          _userLoaded = true;
        });
        try {
          final mine = (u['role_ids'] is List ? (u['role_ids'] as List).map(asInt).whereType<int>() : <int>[]).toSet();
          final rs = (await Api.list('/roles')).rows;
          final out = <String, Set<String>>{};
          for (final r in rs) {
            if (r['is_active'] != true || !(r['is_default'] == true || mine.contains(asInt(r['id'])))) continue;
            for (final e in _chanMap(r['notification_events']).entries) {
              out.putIfAbsent(e.key, () => {}).addAll(e.value);
            }
          }
          if (mounted) setState(() => _roleNotify = out.map((k, v) => MapEntry(k, v.toList())));
        } catch (_) {
          if (mounted) setState(() => _roleNotify = {});
        }
      }).catchError((Object e) {
        if (mounted) setState(() => _userErr = ApiClient.describe(e));
      });
      Api.get('/organization/workflows/-/approves-in/user/$id').then((v) {
        if (mounted) setState(() => _approves = jsonList(jsonMap(v)['stages']));
      }).catchError((Object e) {
        if (mounted) setState(() => _approvesErr = ApiClient.describe(e));
      });
    }
    if (seeScopes) {
      Api.get('/users/$id/data-scopes').then((v) {
        final rows = jsonList(v);
        if (mounted) {
          setState(() {
            _scopes = rows;
            _scopeEdit = {
              for (final r in rows)
                if (str(r['override']).isNotEmpty) str(r['module_key']): str(r['override']),
            };
          });
        }
      }).catchError((Object e) => fail('data access', e));
    }
    if (seeNotify) {
      Api.get('/users/$id/notification-overrides').then((v) {
        final o = _chanMap(jsonMap(v)['overrides']);
        if (mounted) {
          setState(() {
            _notify = o;
            _savedNotify = o;
          });
        }
      }).catchError((Object e) => fail('notification settings', e));
    }
  }

  Map<String, List<String>> get _fromRoles {
    final out = <String, List<String>>{};
    for (final e in jsonMap(_effective?['grants']).entries) {
      final src = (e.value is List ? (e.value as List).map(str) : <String>[]).where((x) => x != 'Extra').toList();
      if (src.isNotEmpty) out[e.key] = src;
    }
    return out;
  }

  Future<void> _run(Future<void> Function() fn, String done) async {
    setState(() => _saving = true);
    final ok = await runAction(context, fn, success: done);
    if (mounted) setState(() => _saving = false);
    if (!ok) return;
  }

  Future<void> _savePerms() => _run(() async {
        final list = _extras.toList()..sort();
        final reason = await sodGuard(context, widget.userId, {'granular_permissions': list});
        await Api.patch('/users/${widget.userId}/permissions',
            data: {'granular_permissions': list, 'sod_mitigation_reason': reason});
        final eff = jsonMap(await Api.get('/users/${widget.userId}/effective-permissions'));
        if (mounted) {
          setState(() {
            _savedExtras = Set.of(_extras);
            _effective = eff;
          });
        }
      }, 'Saved for $name only — the role is unchanged for its other holders. $name gets it on their next page load.');

  Future<void> _saveScopes() => _run(() async {
        final rows = jsonList(await Api.put('/users/${widget.userId}/data-scopes', data: {'overrides': _scopeEdit}));
        if (mounted) setState(() => _scopes = rows);
      }, 'Data access saved for $name only.');

  Future<void> _saveNotify() => _run(() async {
        final o = _chanMap(jsonMap(await Api.put('/users/${widget.userId}/notification-overrides',
            data: {'overrides': _notify}))['overrides']);
        if (mounted) {
          setState(() {
            _notify = o;
            _savedNotify = o;
          });
        }
      }, 'Notifications saved for $name only.');

  Widget _intro(String t) => Padding(
      padding: const EdgeInsets.only(bottom: 10), child: Text(t, style: const TextStyle(fontSize: 12.5, color: Brand.muted)));

  Widget? get _lockNote => selfLocked && widget.tab != 'Approves in'
      ? const Padding(
          padding: EdgeInsets.only(bottom: 10),
          child: Text('This is your own access — only an admin can change it.',
              style: TextStyle(fontSize: 12.5, color: Color(0xFFB45309))),
        )
      : null;

  Widget _noAccess(String what) => Text("Seeing a user's $what needs Organization › Role & Permissions › $what.",
      style: const TextStyle(fontSize: 13, color: Brand.muted));

  Widget? _saveBtn(VoidCallback onTap, bool dirty, bool enabled) => enabled
      ? Padding(
          padding: const EdgeInsets.only(top: 12),
          child: FilledButton.icon(
            onPressed: _saving || !dirty ? null : onTap,
            icon: const Icon(Icons.check_rounded),
            label: Text(_saving ? 'Saving…' : 'Save for $name'),
          ),
        )
      : null;

  bool _sameSet(Set<String> a, Set<String> b) => a.length == b.length && a.containsAll(b);

  bool _sameChan(Map<String, List<String>> a, Map<String, List<String>> b) {
    if (a.length != b.length) return false;
    for (final e in a.entries) {
      final o = b[e.key];
      if (o == null || o.join(',') != e.value.join(',')) return false;
    }
    return true;
  }

  @override
  Widget build(BuildContext context) {
    final errs = [_loadErr, _userErr].where((s) => s.isNotEmpty).join(' ');
    final loading = Text(errs.isNotEmpty ? 'Could not load — see the message above.' : 'Loading…',
        style: const TextStyle(fontSize: 13, color: Brand.muted));
    final children = <Widget>[];
    String title;
    switch (widget.tab) {
      case 'Permissions':
        title = 'Permissions — $name';
        if (!seePerms) {
          children.add(_noAccess('Extra permissions'));
        } else if (!seeUsers) {
          children.add(const Text(
              "Editing a user's extra permissions also needs Organization › Users › View, so the user's current extras can be shown first.",
              style: TextStyle(fontSize: 13, color: Brand.muted)));
        } else if (_effective == null || !_userLoaded) {
          children.add(loading);
        } else {
          children.addAll([
            _intro("Faded, locked ticks come from $name's roles. Tick more to give only $name extra access — the role stays the same "
                'for everyone else. To take away something a role gives, change or remove that role.'),
            ?_lockNote,
            PermissionTreeEditor(
              registry: widget.catalog,
              grants: _extras,
              onChanged: (v) => setState(() => _extras = v),
              readOnly: !editPerms,
              inheritedFrom: _fromRoles,
            ),
            ?_saveBtn(_savePerms, !_sameSet(_extras, _savedExtras), editPerms),
          ]);
        }
      case 'Data access':
        title = 'Data access — $name';
        if (!seeScopes) {
          children.add(_noAccess('Data access'));
        } else if (_scopes == null) {
          children.add(loading);
        } else {
          final levels = (widget.catalog['scope_levels'] is List ? (widget.catalog['scope_levels'] as List).map(str) : <String>[]);
          final labels = jsonMap(widget.catalog['scope_labels']);
          final saved = {
            for (final r in _scopes!)
              if (str(r['override']).isNotEmpty) str(r['module_key']): str(r['override']),
          };
          final dirty = saved.length != _scopeEdit.length || saved.entries.any((e) => _scopeEdit[e.key] != e.value);
          children.addAll([
            _intro('“Follow roles” = the widest access $name\'s roles give. Pick a level to set it for $name only; it beats every role.'),
            ?_lockNote,
            for (final r in _scopes!)
              Padding(
                padding: const EdgeInsets.only(bottom: 10),
                child: AppSelect<String>(
                  label: str(r['module_label']),
                  value: _scopeEdit[str(r['module_key'])] ?? '',
                  enabled: editScopes,
                  clearable: false,
                  options: [
                    Option('', 'Follow roles (${str(r['override']).isNotEmpty ? 'roles decide' : str(r['effective_label'])})'),
                    for (final lv in levels) Option(lv, labels[lv] == null ? lv : str(labels[lv])),
                  ],
                  onChanged: (o) => setState(() {
                    final v = o?.value ?? '';
                    if (v.isEmpty) {
                      _scopeEdit.remove(str(r['module_key']));
                    } else {
                      _scopeEdit[str(r['module_key'])] = v;
                    }
                  }),
                ),
              ),
            ?_saveBtn(_saveScopes, dirty, editScopes),
          ]);
        }
      case 'Notifications':
        title = 'Notifications — $name';
        if (!seeNotify) {
          children.add(_noAccess('Notifications'));
        } else if (widget.eventCatalog == null || _effective == null) {
          children.add(Text(_loadErr.isNotEmpty ? 'Could not load — see the message above.' : 'Loading…',
              style: const TextStyle(fontSize: 13, color: Brand.muted)));
        } else {
          children.addAll([
            _intro("Faded ticks come from $name's roles. Change an event to set it for $name only (untick everything to switch it "
                'off for them); “Follow roles” undoes it.'),
            ?_lockNote,
            RoleNotificationsEditor(
              catalog: widget.eventCatalog!,
              registry: widget.catalog,
              permissions: jsonMap(_effective!['grants']).keys.toList(),
              value: _notify,
              onChanged: (v) => setState(() => _notify = v),
              readOnly: !editNotify,
              fromRoles: _roleNotify,
            ),
            ?_saveBtn(_saveNotify, !_sameChan(_notify, _savedNotify), editNotify),
          ]);
        }
      default:
        title = 'Approves in — $name';
        children.addAll([
          _intro('Every approval stage $name takes part in, from all their roles and permissions. Read-only — who approves is '
              'decided per document in Organization › Approval Workflows (that is where to make $name an approver of a stage).'),
          seeUsers
              ? ApprovesInPanel(rows: _approves, error: _approvesErr, empty: "$name isn't an approver in any workflow.")
              : const Text('Seeing the approvals a user takes part in needs Organization › Users › View.',
                  style: TextStyle(fontSize: 13, color: Brand.muted)),
        ]);
    }
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        if (errs.isNotEmpty)
          Padding(
            padding: const EdgeInsets.fromLTRB(16, 0, 16, 12),
            child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
              ErrorBanner(errs),
              TextButton.icon(onPressed: _load, icon: const Icon(Icons.refresh_rounded), label: const Text('Try again')),
            ]),
          ),
        DetailSection(title, children: children),
      ],
    );
  }
}
