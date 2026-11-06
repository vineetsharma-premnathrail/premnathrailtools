import 'package:flutter/material.dart';

import '../../api/api.dart';
import '../../theme.dart';
import '../../ui/app_frame.dart';
import '../../ui/form.dart';
import '../../ui/perms.dart';
import '../../ui/widgets.dart';
import 'org_common.dart';
import 'permission_tree.dart';
import 'role_member_access.dart';
import 'role_notifications.dart';
import 'role_rule_sheets.dart';

// Phone version of organization/roles/[id]/page.tsx: one role - its details,
// Permission matrix, Data access, Notifications, Users and Approves in.
// roleId null = New Role (create mode).

const _tabs = ['Permissions', 'Data access', 'Notifications', 'Users', 'Approves in'];

class RoleDetailScreen extends StatefulWidget {
  const RoleDetailScreen({super.key, this.roleId});
  final int? roleId;

  @override
  State<RoleDetailScreen> createState() => _RoleDetailScreenState();
}

class _RoleDetailScreenState extends State<RoleDetailScreen> {
  bool get isNew => widget.roleId == null;

  Json? _catalog;
  Json? _role;
  Object? _loadError;
  bool _loading = true;

  final _name = TextEditingController();
  final _description = TextEditingController();
  bool _isActive = true;
  bool _isDefault = false;
  Set<String> _permissions = {};
  Map<String, String> _dataScopes = {};
  Map<String, List<String>> _notifyEvents = {};
  Map<String, Json> _assigneeRules = {};
  Map<String, Json> _visibilityRules = {};
  List<int> _memberIds = [];
  List<Json> _directory = [];
  AssigneeOptions _assigneeOptions = const AssigneeOptions();

  Json? _eventCatalog;
  String _eventError = '';
  List<Json>? _approvesIn;
  String _approvesErr = '';

  String _tab = 'Permissions';
  int _forUser = 0; // 0 = the role (all holders)
  bool _saving = false;

  @override
  void initState() {
    super.initState();
    _load();
  }

  @override
  void dispose() {
    _name.dispose();
    _description.dispose();
    super.dispose();
  }

  Map<String, List<String>> _chanMap(Object? v) =>
      jsonMap(v).map((k, c) => MapEntry(k, c is List ? c.map(str).toList() : <String>[]));

  void _applyRole(Json r) {
    _role = r;
    _name.text = str(r['name']);
    _description.text = str(r['description']);
    _isActive = r['is_active'] == true;
    _isDefault = r['is_default'] == true;
    _permissions = (r['permissions'] is List ? (r['permissions'] as List).map(str) : <String>[]).toSet();
    _dataScopes = jsonMap(r['data_scopes']).map((k, v) => MapEntry(k, str(v)));
    _notifyEvents = _chanMap(r['notification_events']);
    _assigneeRules = jsonMap(r['assignee_rules']).map((k, v) => MapEntry(k, jsonMap(v)));
    _visibilityRules = jsonMap(r['visibility_rules']).map((k, v) => MapEntry(k, jsonMap(v)));
    _memberIds = jsonList(r['users']).map((u) => asInt(u['id'])).whereType<int>().toList();
  }

  Future<void> _load() async {
    setState(() {
      _loading = true;
      _loadError = null;
    });
    try {
      final res = await Future.wait<dynamic>([
        loadPermissionRegistry(),
        isNew ? Future<dynamic>.value(null) : Api.get('/roles/${widget.roleId}'),
        Api.get('/users/directory'),
      ]);
      if (!mounted) return;
      setState(() {
        _catalog = jsonMap(res[0]);
        if (res[1] != null) _applyRole(jsonMap(res[1]));
        _directory = jsonList(res[2]);
        _loading = false;
      });
    } catch (e) {
      if (mounted) {
        setState(() {
          _loadError = e;
          _loading = false;
        });
      }
      return;
    }
    _loadAssigneeOptions();
    Api.get('/roles/notification-events').then((v) {
      if (mounted) setState(() => _eventCatalog = jsonMap(v));
    }).catchError((Object e) {
      if (mounted) setState(() => _eventError = ApiClient.describe(e));
    });
    if (!isNew) {
      Api.get('/organization/workflows/-/approves-in/role/${widget.roleId}').then((v) {
        if (mounted) setState(() => _approvesIn = jsonList(v));
      }).catchError((Object e) {
        if (mounted) setState(() => _approvesErr = ApiClient.describe(e));
      });
    }
  }

  /// Options for the "Assign to" rule sheet - the sheet works without them.
  Future<void> _loadAssigneeOptions() async {
    var deps = <Option<int>>[];
    var roles = <Option<int>>[];
    try {
      deps = [
        for (final d in (await Api.list('/organization/departments')).rows)
          Option(asInt(d['id'])!, str(d['name']), subtitle: str(d['branch_name']).isEmpty ? null : str(d['branch_name'])),
      ];
    } catch (_) {}
    try {
      roles = [for (final r in (await Api.list('/roles')).rows) Option(asInt(r['id'])!, str(r['name']))];
    } catch (_) {}
    if (!mounted) return;
    setState(() => _assigneeOptions = AssigneeOptions(
          departments: deps,
          roles: roles,
          users: [
            for (final u in _directory)
              Option(asInt(u['id'])!, str(u['name']).isEmpty ? str(u['email']) : str(u['name']),
                  subtitle: str(u['department']).isEmpty ? null : str(u['department'])),
          ],
        ));
  }

  // ── derived ──
  bool get readOnly => _role?['is_system'] == true;
  bool get canSave => isNew ? orgCan('roles', 'create') : orgCan('roles', 'edit');
  bool get locked => readOnly || !canSave;
  bool feat(String f, String a) => Perm.canFeature('organization', 'roles', f, a);
  bool get canEditMembers => feat('members', 'edit');

  bool _seeTab(String t) => switch (t) {
        'Data access' => feat('data_access', 'view'),
        'Notifications' => feat('notifications', 'view'),
        'Users' => feat('members', 'view'),
        'Approves in' => !isNew,
        _ => true,
      };

  String get view => _seeTab(_tab) ? _tab : 'Permissions';

  List<Json> get holders => _role != null && _role!['is_default'] != true ? jsonList(_role!['users']) : <Json>[];

  Json? get picked {
    if (_forUser == 0 || view == 'Users') return null;
    for (final u in holders) {
      if (asInt(u['id']) == _forUser) return u;
    }
    return null;
  }

  List<Json> get _roleStages => (_approvesIn ?? [])
      .where((r) => r['kind'] == 'approver' && str(r['how']).startsWith('Holders of this role'))
      .toList();

  String _stageList(List<Json> rows) => rows
      .map((r) =>
          '${str(r['module_label'])} › ${str(r['document'])} (stage ${str(r['stage_sequence'])} “${str(r['stage_name'])}”)')
      .join('; ');

  Json _payload() => {
        'name': _name.text.trim(),
        'description': _description.text.trim().isEmpty ? null : _description.text.trim(),
        'permissions': _permissions.toList()..sort(),
        'data_scopes': _dataScopes,
        'notification_events': _notifyEvents,
        'assignee_rules': _assigneeRules,
        'visibility_rules': _visibilityRules,
        'is_default': _isDefault,
        'is_active': _isActive,
      };

  Future<void> _error(String msg) => showDialog<void>(
        context: context,
        builder: (ctx) => AlertDialog(
          title: const Text('Role & Permissions'),
          content: Text(msg),
          actions: [
            FilledButton(
                style: FilledButton.styleFrom(minimumSize: const Size(88, 40)),
                onPressed: () => Navigator.pop(ctx),
                child: const Text('OK')),
          ],
        ),
      );

  Future<void> _save() async {
    if (_name.text.trim().length < 2) {
      await _error('Give the role a name (at least 2 characters), e.g. "Store Keeper".');
      return;
    }
    if (!isNew && _role?['is_active'] == true && !_isActive && (_approvesIn ?? []).any((r) => r['kind'] != 'escalation')) {
      final ok = await confirmDialog(context,
          title: 'Deactivate a role that approves?',
          confirmLabel: 'Deactivate anyway',
          message: '“${str(_role?['name'])}” takes part in approvals: '
              '${_stageList((_approvesIn ?? []).where((r) => r['kind'] != 'escalation').toList())}. Once inactive it gives nobody '
              'anything — stages that rely on it find no approver and those documents are refused on submit. Documents already '
              'waiting keep their approvers. Change those stages in Organization › Approval Workflows first, or deactivate anyway.');
      if (!ok) return;
    }
    setState(() => _saving = true);
    try {
      if (isNew) {
        final created = jsonMap(await Api.post('/roles', data: _payload()));
        final id = asInt(created['id'])!;
        if (!_isDefault && _memberIds.isNotEmpty) {
          try {
            await Api.put('/roles/$id/users', data: {'user_ids': _memberIds});
          } catch (e) {
            if (!mounted) return;
            await _error('The role “${str(created['name'])}” was created, but its users couldn\'t be added: '
                '${ApiClient.describe(e)} Add them again from the Users tab.');
          }
        }
        if (!mounted) return;
        Navigator.of(context).pushReplacement(MaterialPageRoute(builder: (_) => RoleDetailScreen(roleId: id)));
        return;
      }
      final updated = jsonMap(await Api.patch('/roles/${widget.roleId}', data: _payload()));
      if (!mounted) return;
      setState(() => _applyRole(updated));
      showSnack(context, 'Role saved. Users holding it get the new access on their next page load.');
    } catch (e) {
      if (mounted) await _error(ApiClient.describe(e));
    } finally {
      if (mounted) setState(() => _saving = false);
    }
  }

  Future<void> _saveMembers() async {
    if (_memberIds.isEmpty && _roleStages.isNotEmpty) {
      final ok = await confirmDialog(context,
          title: 'Remove every holder?',
          confirmLabel: 'Save anyway',
          message: 'Nobody would hold “${str(_role?['name'])}”, but it is the approver of: ${_stageList(_roleStages)}. Those '
              'documents would be refused on submit until someone holds the role again or the stages get another approver in '
              'Organization › Approval Workflows.');
      if (!ok) return;
    }
    setState(() => _saving = true);
    try {
      final r = jsonMap(await Api.put('/roles/${widget.roleId}/users', data: {'user_ids': _memberIds}));
      if (!mounted) return;
      setState(() => _applyRole(r));
      showSnack(context, 'Users updated.');
    } catch (e) {
      if (mounted) await _error(ApiClient.describe(e));
    } finally {
      if (mounted) setState(() => _saving = false);
    }
  }

  Future<void> _copy() async {
    final newName = await promptDialog(context,
        title: 'Copy role',
        message: 'Name for the new editable copy of “${str(_role?['name'])}”:',
        label: 'Name',
        confirmLabel: 'Create copy');
    if (newName == null || !mounted) return;
    try {
      final copy = jsonMap(await Api.post('/roles/${widget.roleId}/copy', data: {'name': newName.trim()}));
      if (!mounted) return;
      Navigator.of(context)
          .pushReplacement(MaterialPageRoute(builder: (_) => RoleDetailScreen(roleId: asInt(copy['id']))));
    } catch (e) {
      if (mounted) await _error(ApiClient.describe(e));
    }
  }

  Future<void> _delete() async {
    final stages = _roleStages;
    final ok = await confirmDialog(context,
        title: 'Delete role',
        danger: true,
        confirmLabel: 'Delete',
        message: 'Delete “${str(_role?['name'])}”? This can\'t be undone. A role still held by users can\'t be deleted — remove it '
            'from them first, or mark it inactive.'
            '${stages.isNotEmpty ? ' It is the approver of: ${_stageList(stages)}. Pick another approver for those stages in '
                'Organization › Approval Workflows first, or documents there will be refused on submit.' : ''}');
    if (!ok || !mounted) return;
    try {
      await Api.delete('/roles/${widget.roleId}');
      if (mounted) Navigator.of(context).pop(true);
    } catch (e) {
      if (mounted) await _error(ApiClient.describe(e));
    }
  }

  // ── UI ──

  Widget _note(String text, Color fg, Color bg) => Padding(
        padding: const EdgeInsets.fromLTRB(16, 0, 16, 12),
        child: Container(
          padding: const EdgeInsets.all(12),
          decoration: BoxDecoration(
              color: bg, borderRadius: BorderRadius.circular(10), border: Border.all(color: fg.withValues(alpha: 0.25))),
          child: Text(text, style: TextStyle(fontSize: 12.5, color: fg)),
        ),
      );

  Widget _hint(String t) => Padding(
      padding: const EdgeInsets.only(bottom: 10), child: Text(t, style: const TextStyle(fontSize: 12.5, color: Brand.muted)));

  String _tabLabel(String t) {
    if (t == 'Users' && (_role != null || isNew)) return 'Users (${_isDefault ? 'everyone' : _memberIds.length})';
    if (t == 'Approves in' && _approvesIn != null) return 'Approves in (${_approvesIn!.length})';
    return t;
  }

  @override
  Widget build(BuildContext context) {
    final title = isNew ? 'New Role' : (str(_role?['name']).isEmpty ? 'Role' : str(_role!['name']));
    if (_loading) return SubPage(title: title, body: const LoadingView());
    if (_loadError != null) {
      return SubPage(
          title: title,
          body: ErrorView(
              '${ApiClient.describe(_loadError!)} It may have been deleted — go back to the role list and reload.',
              onRetry: _load));
    }
    final catalog = _catalog!;
    final expanded = expandGrants(catalog, _permissions);
    final moduleCount = expanded.map((g) => g.split(':')[0]).toSet().length;
    final subtitle = '${expanded.length} permission(s) across $moduleCount module(s)'
        '${_role != null && _role!['is_default'] != true ? ' · held by ${str(_role!['user_count'])} user(s)' : ''}'
        '${_role?['is_default'] == true ? ' · applies to everyone' : ''}';
    final p = picked;
    final v = view;

    final bottomButtons = <Widget>[
      if (!isNew && orgCan('roles', 'create')) PillButton('Copy', icon: Icons.copy_rounded, onPressed: _saving ? null : _copy),
      if (!isNew && !readOnly && orgCan('roles', 'delete'))
        PillButton('Delete', icon: Icons.delete_outline_rounded, danger: true, onPressed: _saving ? null : _delete),
    ];
    Widget? primary;
    if (v == 'Users' && !isNew && _role != null && _role!['is_default'] != true && canEditMembers) {
      final saved = jsonList(_role!['users']).map((u) => asInt(u['id'])).whereType<int>().toList()..sort();
      final cur = [..._memberIds]..sort();
      final changed = saved.join(',') != cur.join(',');
      primary = FilledButton.icon(
        style: FilledButton.styleFrom(minimumSize: const Size(0, 40)),
        onPressed: _saving || !changed ? null : _saveMembers,
        icon: const Icon(Icons.group_outlined, size: 18),
        label: Text(_saving ? 'Saving…' : 'Save Users'),
      );
    } else if ((v != 'Users' || isNew) && p == null && !readOnly && canSave) {
      primary = FilledButton.icon(
        style: FilledButton.styleFrom(minimumSize: const Size(0, 40)),
        onPressed: _saving ? null : _save,
        icon: const Icon(Icons.check_rounded, size: 18),
        label: Text(_saving ? 'Saving…' : isNew ? 'Create Role' : 'Save Role'),
      );
    }

    final scopeLabels = jsonMap(catalog['scope_labels']);
    final defaultScope = str(catalog['default_scope']).isEmpty ? 'assigned' : str(catalog['default_scope']);
    final scopeLevels = catalog['scope_levels'] is List ? (catalog['scope_levels'] as List).map(str).toList() : <String>[];
    final modules = regModules(catalog);
    final grantedModules = expanded
        .map((g) => g.split(':')[0])
        .toSet()
        .where((mk) => mk != 'organization' && modules[mk] != null)
        .toList()
      ..sort((a, b) => str(modules[a]!['label']).compareTo(str(modules[b]!['label'])));

    final body = ListView(
      padding: const EdgeInsets.only(top: 12, bottom: 24),
      children: [
        Padding(
          padding: const EdgeInsets.fromLTRB(16, 0, 16, 12),
          child: Text(subtitle, style: const TextStyle(fontSize: 13, color: Brand.muted)),
        ),
        if (readOnly)
          _note(
              'Built-in preset — you can assign it to users but not change it.'
              '${orgCan('roles', 'create') ? ' Tap Copy to make an editable role from it.' : ''}',
              const Color(0xFF1E40AF),
              const Color(0x122563EB)),
        if (!readOnly && !canSave)
          _note('You can view this role; changing it needs Organization › Role & Permissions › Edit.', Brand.body,
              const Color(0x1264748B)),
        DetailSection('Role details', children: [
          const SizedBox(height: 4),
          AppTextField(label: 'Role name', controller: _name, required: true, enabled: !locked, hint: 'e.g. Store Keeper'),
          const SizedBox(height: 12),
          AppTextField(
              label: 'Description (optional)',
              controller: _description,
              enabled: !locked,
              hint: 'Who this role is for and what it allows'),
          const SizedBox(height: 4),
          CheckboxListTile(
            contentPadding: EdgeInsets.zero,
            controlAffinity: ListTileControlAffinity.leading,
            value: _isActive,
            onChanged: locked ? null : (x) => setState(() => _isActive = x ?? false),
            title: const Text('Active'),
            subtitle: const Text('(an inactive role gives nobody anything)', style: TextStyle(fontSize: 11.5)),
          ),
          CheckboxListTile(
            contentPadding: EdgeInsets.zero,
            controlAffinity: ListTileControlAffinity.leading,
            value: _isDefault,
            onChanged: locked ? null : (x) => setState(() => _isDefault = x ?? false),
            title: const Text('Applies to everyone'),
            subtitle: const Text('(every user gets it without being assigned — e.g. Employee self-service)',
                style: TextStyle(fontSize: 11.5)),
          ),
        ]),
        SizedBox(
          height: 46,
          child: ListView(
            scrollDirection: Axis.horizontal,
            padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 4),
            children: [
              for (final t in _tabs.where(_seeTab))
                Padding(
                  padding: const EdgeInsets.only(right: 6),
                  child: ChoiceChip(
                    label: Text(_tabLabel(t)),
                    selected: v == t,
                    selectedColor: Brand.primary,
                    labelStyle: TextStyle(color: v == t ? Colors.white : Brand.body, fontWeight: FontWeight.w600),
                    showCheckmark: false,
                    onSelected: (_) => setState(() => _tab = t),
                  ),
                ),
            ],
          ),
        ),
        const SizedBox(height: 8),
        if (v != 'Users' && !isNew && holders.isNotEmpty)
          Padding(
            padding: const EdgeInsets.fromLTRB(16, 0, 16, 12),
            child: Container(
              padding: const EdgeInsets.all(12),
              decoration: BoxDecoration(
                color: p != null ? const Color(0x0F2563EB) : Brand.background,
                borderRadius: BorderRadius.circular(12),
                border: Border.all(color: p != null ? const Color(0x402563EB) : Brand.border),
              ),
              child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
                AppSelect<int>(
                  label: 'Settings for',
                  value: _forUser,
                  clearable: false,
                  options: [
                    Option(0, 'This role — all ${holders.length} holder${holders.length == 1 ? '' : 's'}'),
                    for (final u in holders) Option(asInt(u['id'])!, str(u['name'])),
                  ],
                  onChanged: (o) => setState(() => _forUser = o?.value ?? 0),
                ),
                const SizedBox(height: 6),
                Text(
                    p != null
                        ? "Showing ${str(p['name'])}'s real access. Changes here apply to ${str(p['name'])} only — not to the role."
                        : 'Pick a holder to see exactly what they get, or give them something different.',
                    style: const TextStyle(fontSize: 12, color: Brand.muted)),
              ]),
            ),
          ),
        if (p != null)
          RoleMemberAccess(
            key: ValueKey('${p['id']}-$v'),
            tab: v,
            userId: asInt(p['id'])!,
            userName: str(p['name']),
            catalog: catalog,
            eventCatalog: _eventCatalog,
          ),
        if (p == null && v == 'Permissions')
          DetailSection('Permission matrix', children: [
            _hint('Pick a preset per module, then fine-tune tabs and actions. Only the actions that exist on a tab are shown. '
                'Ticking any action also ticks View; unticking View clears the row.'),
            PermissionTreeEditor(
              registry: catalog,
              grants: _permissions,
              onChanged: (g) => setState(() => _permissions = g),
              readOnly: locked,
              assigneeRules: _assigneeRules,
              onAssigneeRulesChange: locked ? null : (r) => setState(() => _assigneeRules = r),
              assigneeOptions: _assigneeOptions,
              visibilityRules: _visibilityRules,
              onVisibilityRulesChange: locked ? null : (r) => setState(() => _visibilityRules = r),
            ),
          ]),
        if (p == null && v == 'Data access')
          DetailSection('Data access', children: [
            _hint('Permissions say what holders can do; data access says which records they see in each module. '
                'Own = records they created or requested · Own + assigned = also records assigned to them · Department = records of '
                'people in their department (same plant) · Plant = their plant · Multiple plants = every plant assigned to them in '
                'Branches · Entire organization = everything. Not set = ${scopeLabels[defaultScope] ?? defaultScope}. Anyone always '
                'sees records they must approve. When a user holds several roles, the widest access wins; a personal override on the '
                'user page beats all roles.'),
            if (grantedModules.isEmpty)
              const Text("This role doesn't open any module yet — tick permissions first.",
                  style: TextStyle(fontSize: 13, color: Brand.muted))
            else
              for (final mk in grantedModules)
                Padding(
                  padding: const EdgeInsets.only(bottom: 10),
                  child: AppSelect<String>(
                    label: str(modules[mk]!['label']),
                    value: _dataScopes[mk] ?? defaultScope,
                    clearable: false,
                    enabled: !locked && feat('data_access', 'edit'),
                    options: [
                      for (final lv in scopeLevels) Option(lv, scopeLabels[lv] == null ? lv : str(scopeLabels[lv])),
                    ],
                    onChanged: (o) => setState(() {
                      final val = o?.value ?? defaultScope;
                      if (val == defaultScope) {
                        _dataScopes.remove(mk);
                      } else {
                        _dataScopes[mk] = val;
                      }
                    }),
                  ),
                ),
          ]),
        if (p == null && v == 'Notifications')
          DetailSection('Notifications', children: [
            _hint("Pick the events this role's members are told about, and how (portal bell, email, Microsoft Teams). A member only "
                'gets an event for a record they can open — they need the permission shown under the event and data access to that '
                "record — and nobody is notified of what they did themselves. The people named in each module's own "
                'Settings › Notifications still get those notices too.'),
            if (_eventError.isNotEmpty)
              Text(_eventError, style: const TextStyle(fontSize: 13, color: Brand.danger))
            else if (_eventCatalog == null)
              const Text('Loading the event list…', style: TextStyle(fontSize: 13, color: Brand.muted))
            else
              RoleNotificationsEditor(
                catalog: _eventCatalog!,
                registry: catalog,
                permissions: _permissions.toList(),
                value: _notifyEvents,
                onChanged: (n) => setState(() => _notifyEvents = n),
                readOnly: locked || !feat('notifications', 'edit'),
              ),
          ]),
        if (p == null && v == 'Approves in' && _role != null)
          DetailSection('Approves in', children: [
            _hint("The approval stages this role's holders take part in. Read-only — approvals are set up per document in "
                'Organization › Approval Workflows, which is the only place that decides who approves.'),
            ApprovesInPanel(rows: _approvesIn, error: _approvesErr, empty: "This role isn't an approver in any workflow."),
          ]),
        if (v == 'Users' && (_role != null || isNew)) _usersSection(),
      ],
    );

    return SubPage(
      title: title,
      body: body,
      bottom: bottomButtons.isEmpty && primary == null
          ? null
          : Row(children: [
              Expanded(child: Wrap(spacing: 8, runSpacing: 6, children: bottomButtons)),
              ?primary,
            ]),
    );
  }

  Json? _findUser(int id) {
    for (final u in _directory) {
      if (asInt(u['id']) == id) return u;
    }
    for (final u in jsonList(_role?['users'])) {
      if (asInt(u['id']) == id) return u;
    }
    return null;
  }

  Widget _usersSection() {
    final isDefault = isNew ? _isDefault : _role?['is_default'] == true;
    if (isDefault) {
      return DetailSection('Who holds this role', children: [
        Text(
            'This role applies to every user automatically — untick “Applies to everyone”${isNew ? '' : ' and save'} to assign it '
            'to specific people instead.',
            style: const TextStyle(fontSize: 13, color: Brand.body)),
      ]);
    }
    final members = _memberIds.map(_findUser).whereType<Json>().toList();
    return DetailSection('Who holds this role', children: [
      if (isNew) _hint('The people you add here get the role when you tap Create Role.'),
      if (canEditMembers)
        Padding(
          padding: const EdgeInsets.only(bottom: 12),
          child: AppSelect<int>(
            label: 'Add a user — type a name or email…',
            value: null,
            loadOptions: (s) async {
              final q = s.toLowerCase();
              return [
                for (final u in _directory)
                  if (!_memberIds.contains(asInt(u['id'])) &&
                      (q.isEmpty || str(u['name']).toLowerCase().contains(q) || str(u['email']).toLowerCase().contains(q)))
                    Option(asInt(u['id'])!, str(u['name']),
                        subtitle: '${str(u['email'])}${str(u['department']).isNotEmpty ? ' · ${str(u['department'])}' : ''}'),
              ];
            },
            onChanged: (o) {
              if (o != null) setState(() => _memberIds = [..._memberIds, o.value]);
            },
          ),
        ),
      if (members.isEmpty) const Text('Nobody holds this role yet.', style: TextStyle(fontSize: 13, color: Brand.muted)),
      for (final u in members)
        Container(
          margin: const EdgeInsets.only(bottom: 6),
          padding: const EdgeInsets.fromLTRB(12, 4, 4, 4),
          decoration: BoxDecoration(
              color: Colors.white, borderRadius: BorderRadius.circular(10), border: Border.all(color: Brand.border)),
          child: Row(children: [
            Expanded(
              child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                Text(str(u['name']),
                    style: const TextStyle(fontSize: 13.5, color: Brand.heading, fontWeight: FontWeight.w600)),
                Text('${str(u['email'])}${str(u['department']).isNotEmpty ? ' · ${str(u['department'])}' : ''}',
                    style: const TextStyle(fontSize: 11.5, color: Brand.muted)),
              ]),
            ),
            if (canEditMembers)
              TextButton(
                onPressed: () => setState(() => _memberIds = _memberIds.where((x) => x != asInt(u['id'])).toList()),
                child: const Text('Remove', style: TextStyle(color: Brand.danger, fontWeight: FontWeight.w600)),
              ),
          ]),
        ),
    ]);
  }
}
