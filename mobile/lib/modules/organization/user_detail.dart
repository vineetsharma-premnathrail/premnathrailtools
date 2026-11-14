import 'package:dio/dio.dart';
import 'package:flutter/material.dart';

import '../../api/api.dart';
import '../../theme.dart';
import '../../ui/app_frame.dart';
import '../../ui/files.dart';
import '../../ui/form.dart';
import '../../ui/format.dart';
import '../../ui/perms.dart';
import '../../ui/widgets.dart';
import 'org_common.dart';
import 'permission_tree.dart';

/// One user - copy of frontend/src/app/dashboard/users/[id]/page.tsx: User
/// Details, Assignments, Roles & Permissions, Data Access, Permission History,
/// Login History, User Activity, User Documents.
class UserDetailScreen extends StatefulWidget {
  const UserDetailScreen({super.key, required this.userId, this.name = 'User'});
  final int userId;
  final String name;

  @override
  State<UserDetailScreen> createState() => _UserDetailScreenState();
}

const _tabs = [
  'User Details',
  'Assignments',
  'Roles & Permissions',
  'Data Access',
  'Permission History',
  'Login History',
  'User Activity',
  'User Documents',
];

bool _seeTab(String t) {
  bool f(String tab, String feature) => Perm.canFeature('organization', tab, feature, 'view');
  switch (t) {
    case 'Assignments':
      return f('users', 'assignments');
    case 'Roles & Permissions':
      return orgCan('roles', 'view');
    case 'Data Access':
      return f('roles', 'data_access');
    case 'Permission History':
    case 'User Activity':
      return f('users', 'activity');
    case 'Login History':
      return f('users', 'login_history');
    case 'User Documents':
      return f('users', 'documents');
    default:
      return true;
  }
}

class _UserDetailScreenState extends State<UserDetailScreen> {
  Json? _user;
  Object? _error;
  String _tab = 'User Details';
  int _gen = 0;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    setState(() => _error = null);
    try {
      final u = jsonMap(await Api.get('/users/${widget.userId}'));
      if (mounted) {
        setState(() {
          _user = u;
          _gen++;
        });
      }
    } catch (e) {
      if (mounted) setState(() => _error = e);
    }
  }

  @override
  Widget build(BuildContext context) {
    final u = _user;
    Widget body;
    if (u == null) {
      body = _error != null
          ? ErrorView(
              'Could not load this user: ${ApiClient.describe(_error!)} Reload; if it keeps failing, check the user still exists in Users.',
              onRetry: _load)
          : const LoadingView();
    } else {
      final tabs = _tabs.where(_seeTab).toList();
      if (!tabs.contains(_tab)) _tab = 'User Details';
      final active = u['is_active'] == true;
      body = RefreshIndicator(
        onRefresh: _load,
        child: ListView(
          padding: const EdgeInsets.only(bottom: 40),
          children: [
            Padding(
              padding: const EdgeInsets.fromLTRB(16, 12, 16, 4),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  const Caps('Organization › Users'),
                  const SizedBox(height: 4),
                  Wrap(
                    spacing: 10,
                    crossAxisAlignment: WrapCrossAlignment.center,
                    children: [
                      Text(str(u['name']),
                          style: const TextStyle(fontSize: 20, fontWeight: FontWeight.w700, color: Brand.heading)),
                      StatusBadge(active ? 'Active' : 'Inactive',
                          color: active ? const Color(0xFF047857) : const Color(0xFF64748B)),
                    ],
                  ),
                  const SizedBox(height: 4),
                  Text(
                      [u['email'], u['designation'], u['department']]
                          .where((x) => x != null && str(x).isNotEmpty)
                          .map(str)
                          .join(' · '),
                      style: const TextStyle(fontSize: 12.5, color: Brand.muted)),
                ],
              ),
            ),
            SizedBox(
              height: 46,
              child: ListView(
                scrollDirection: Axis.horizontal,
                padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 6),
                children: [
                  for (final t in tabs) CountChip(t, null, selected: t == _tab, onTap: () => setState(() => _tab = t)),
                ],
              ),
            ),
            const SizedBox(height: 8),
            KeyedSubtree(key: ValueKey('$_tab-$_gen'), child: _tabBody(u)),
          ],
        ),
      );
    }
    return SubPage(title: u == null ? widget.name : str(u['name']), body: body);
  }

  Widget _tabBody(Json u) {
    final id = widget.userId;
    switch (_tab) {
      case 'Assignments':
        return _AssignmentsTab(user: u);
      case 'Roles & Permissions':
        return _RolesPermissionsTab(user: u, onRefresh: _load);
      case 'Data Access':
        return _DataAccessTab(userId: id);
      case 'Permission History':
        return _HistoryList(
            path: '/users/$id/permission-history',
            title: 'Permission History',
            empty: 'No permission changes recorded yet — role, extra-permission and approval-flag changes will appear here.');
      case 'Login History':
        return _LoginHistoryTab(userId: id);
      case 'User Activity':
        return _HistoryList(
            path: '/users/$id/activity', title: 'User Activity', empty: 'No activity recorded yet.', activity: true);
      case 'User Documents':
        return _DocumentsTab(userId: id);
      default:
        return _DetailsTab(user: u, onRefresh: _load);
    }
  }
}

// ── Small helpers ───────────────────────────────────────────────────────────

/// Loads a JSON value inside a tab (no own scrolling - the page scrolls).
class _Load<T> extends StatefulWidget {
  const _Load({super.key, required this.load, required this.builder});
  final Future<T> Function() load;
  final Widget Function(BuildContext, T, VoidCallback reload) builder;

  @override
  State<_Load<T>> createState() => _LoadState<T>();
}

class _LoadState<T> extends State<_Load<T>> {
  late Future<T> _f = widget.load();
  void _reload() => setState(() => _f = widget.load());

  @override
  Widget build(BuildContext context) => FutureBuilder<T>(
        future: _f,
        builder: (ctx, s) {
          if (s.connectionState != ConnectionState.done) return const LoadingView();
          if (s.hasError) {
            return Padding(
                padding: const EdgeInsets.symmetric(horizontal: 16),
                child: ErrorView(s.error!, onRetry: _reload));
          }
          return widget.builder(ctx, s.data as T, _reload);
        },
      );
}

class _Hint extends StatelessWidget {
  const _Hint(this.text, {this.color = Brand.muted});
  final String text;
  final Color color;

  @override
  Widget build(BuildContext context) =>
      Padding(padding: const EdgeInsets.only(bottom: 8), child: Text(text, style: TextStyle(fontSize: 12.5, color: color)));
}

class _Item extends StatelessWidget {
  const _Item({required this.title, this.sub, this.body, this.tags = const [], this.actions = const []});
  final String title;
  final String? sub;
  final String? body;
  final List<Widget> tags;
  final List<Widget> actions;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(vertical: 10),
      decoration: const BoxDecoration(border: Border(bottom: BorderSide(color: Color(0x14000000)))),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Wrap(spacing: 8, runSpacing: 4, crossAxisAlignment: WrapCrossAlignment.center, children: [
            Text(title, style: const TextStyle(fontSize: 14, fontWeight: FontWeight.w600, color: Brand.heading)),
            if (sub != null && sub!.isNotEmpty) Text(sub!, style: const TextStyle(fontSize: 12.5, color: Brand.muted)),
            ...tags,
          ]),
          if (body != null && body!.isNotEmpty)
            Padding(
                padding: const EdgeInsets.only(top: 3),
                child: Text(body!, style: const TextStyle(fontSize: 12.5, color: Brand.body))),
          if (actions.isNotEmpty) Padding(padding: const EdgeInsets.only(top: 4), child: Wrap(spacing: 4, children: actions)),
        ],
      ),
    );
  }
}

Widget _linkBtn(String label, VoidCallback onTap, {bool danger = false}) => TextButton(
      style: TextButton.styleFrom(
          foregroundColor: danger ? const Color(0xFFB91C1C) : Brand.primaryActive,
          visualDensity: VisualDensity.compact,
          padding: const EdgeInsets.symmetric(horizontal: 6)),
      onPressed: onTap,
      child: Text(label, style: const TextStyle(fontSize: 12.5, fontWeight: FontWeight.w600)),
    );

Widget _primary(String label, VoidCallback? onPressed) => Align(
      alignment: Alignment.centerRight,
      child: FilledButton(
          style: FilledButton.styleFrom(minimumSize: const Size(120, 40)), onPressed: onPressed, child: Text(label)),
    );

String _cap(String s) => s.isEmpty ? s : s[0].toUpperCase() + s.substring(1);

// ── Approves in (read-only) ──────────────────────────────────────────────────

const _kind = {
  'approver': ('Approver', Color(0xFFC2410C)),
  'also': ('May also decide', Color(0xFF1E40AF)),
  'escalation': ('Escalation', Color(0xFF92400E)),
};

class _ApprovesInList extends StatelessWidget {
  const _ApprovesInList({required this.rows, required this.empty});
  final List<Json> rows;
  final String empty;

  @override
  Widget build(BuildContext context) {
    if (rows.isEmpty) return _Hint(empty);
    return Column(children: [
      for (final r in rows)
        Opacity(
          opacity: r['workflow_active'] == false ? 0.6 : 1,
          child: Container(
            width: double.infinity,
            margin: const EdgeInsets.only(bottom: 6),
            padding: const EdgeInsets.all(10),
            decoration:
                BoxDecoration(borderRadius: BorderRadius.circular(10), border: Border.all(color: Brand.border)),
            child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
              Row(children: [
                Expanded(
                  child: Text('${str(r['module_label'])} › ${str(r['document'])}',
                      style: const TextStyle(fontSize: 13, fontWeight: FontWeight.w600, color: Brand.heading)),
                ),
                StatusBadge(_kind[r['kind']]?.$1 ?? str(r['kind']), color: _kind[r['kind']]?.$2),
              ]),
              Text(
                  'Stage ${str(r['stage_sequence'])} “${str(r['stage_name'])}”'
                  '${r['workflow_active'] == false ? ' · approval switched off' : ''}',
                  style: const TextStyle(fontSize: 12, color: Brand.muted)),
              const SizedBox(height: 2),
              Text('${str(r['how'])} · Applies to: ${str(r['applies_when'])}',
                  style: const TextStyle(fontSize: 12, color: Brand.body)),
              if (r['sole'] == true && r['kind'] == 'approver')
                const Text('Only approver of this stage — nobody else can approve it.',
                    style: TextStyle(fontSize: 11.5, color: Color(0xFFB91C1C))),
            ]),
          ),
        ),
    ]);
  }
}

// ── User Details ────────────────────────────────────────────────────────────

class _DetailsTab extends StatefulWidget {
  const _DetailsTab({required this.user, required this.onRefresh});
  final Json user;
  final Future<void> Function() onRefresh;

  @override
  State<_DetailsTab> createState() => _DetailsTabState();
}

class _DetailsTabState extends State<_DetailsTab> {
  Json? _approvesIn;
  String? _approvesErr;
  bool _toggling = false;

  Json get u => widget.user;

  @override
  void initState() {
    super.initState();
    Api.get('/organization/workflows/-/approves-in/user/${u['id']}').then((r) {
      if (mounted) setState(() => _approvesIn = jsonMap(r));
    }).catchError((Object e) {
      if (mounted) {
        setState(() => _approvesErr = 'Could not load the approvals this person takes part in: ${ApiClient.describe(e)}');
      }
    });
  }

  String get _deactivateWarning {
    final name = str(u['name']);
    final stages = jsonList(_approvesIn?['stages'])
        .where((r) => r['sole'] == true && r['kind'] == 'approver' && r['workflow_active'] == true)
        .toList();
    final pending = asInt(_approvesIn?['pending_steps']) ?? 0;
    return [
      if (stages.isNotEmpty)
        '$name is the only approver of: ${stages.map((r) => '${str(r['module_label'])} › ${str(r['document'])} (stage ${str(r['stage_sequence'])} “${str(r['stage_name'])}”)').join('; ')} — those documents will be refused on submit until another approver is set in Organization › Approval Workflows.',
      if (pending > 0)
        '$pending approval(s) are waiting on $name now. They stay with them until escalation or an admin acts — if they are leaving or moving, complete their exit / transfer in HR › Lifecycle first, which hands them to the handover person.',
    ].join(' ');
  }

  Future<void> _toggle() async {
    final active = u['is_active'] == true;
    if (active && _deactivateWarning.isNotEmpty) {
      final ok = await confirmDialog(context,
          title: 'Deactivate an approver?', message: _deactivateWarning, confirmLabel: 'Deactivate anyway', danger: true);
      if (!ok) return;
    }
    if (!mounted) return;
    setState(() => _toggling = true);
    final ok = await runAction(
        context, () => Api.patch('/users/${u['id']}/${active ? 'deactivate' : 'activate'}'),
        success: active ? 'User deactivated.' : 'User activated.');
    if (mounted) setState(() => _toggling = false);
    if (ok) await widget.onRefresh();
  }

  @override
  Widget build(BuildContext context) {
    final isSelf = asInt(u['id']) == Perm.userId;
    final active = u['is_active'] == true;
    final pending = asInt(_approvesIn?['pending_steps']) ?? 0;
    return Column(children: [
      DetailSection('Profile', children: [
        const _Hint(
            'Name, email, designation, department and office location are synced from Azure AD and aren\'t editable here.'),
        Wrap(spacing: 8, runSpacing: 4, crossAxisAlignment: WrapCrossAlignment.center, children: [
          Text('Portal role: ${u['role'] == null ? '—' : _cap(str(u['role']))}',
              style: const TextStyle(fontSize: 12.5, color: Brand.body)),
          if (u['date_of_joining'] != null)
            Text('· Joined ${fmtDate(u['date_of_joining'])}', style: const TextStyle(fontSize: 12.5, color: Brand.body)),
          if (pending > 0) StatusBadge('$pending approval(s) waiting', color: const Color(0xFFB45309)),
        ]),
        if (orgCan('users', 'edit')) ...[
          const SizedBox(height: 10),
          PillButton(
            active ? 'Deactivate User' : 'Activate User',
            icon: active ? Icons.person_off_outlined : Icons.person_outline,
            danger: active,
            onPressed: isSelf || _toggling ? null : _toggle,
          ),
          if (isSelf) const _Hint('You cannot deactivate your own account'),
        ],
      ]),
      DetailSection('Work & contact', children: [
        FieldRow('Designation', u['designation']),
        FieldRow('Department', u['department']),
        FieldRow('Office location', u['office_location']),
        FieldRow('Branch', u['branch_name']),
        FieldRow('Reporting manager', u['reporting_manager_name']),
        FieldRow('Date of joining', u['date_of_joining'] == null ? null : fmtDate(u['date_of_joining'])),
        FieldRow('Phone', u['phone']),
      ]),
      DetailSection('Approves in', children: [
        const _Hint(
            'Read-only — the approval stages this person can decide, from Organization › Approval Workflows (the only place approvals are set up).'),
        if (_approvesErr != null)
          _Hint(_approvesErr!, color: const Color(0xFFB91C1C))
        else if (_approvesIn == null)
          const _Hint('Loading…')
        else
          _ApprovesInList(rows: jsonList(_approvesIn!['stages']), empty: 'Not an approver in any workflow.'),
      ]),
    ]);
  }
}

// ── Assignments ─────────────────────────────────────────────────────────────

class _AssignmentsTab extends StatefulWidget {
  const _AssignmentsTab({required this.user});
  final Json user;

  @override
  State<_AssignmentsTab> createState() => _AssignmentsTabState();
}

class _AssignmentsTabState extends State<_AssignmentsTab> {
  List<Json>? _rows;
  List<Json> _branches = [];
  List<Json> _departments = [];
  Object? _error;

  int get _uid => asInt(widget.user['id'])!;
  bool get _canEdit =>
      Perm.canFeature('organization', 'users', 'assignments', 'edit') ||
      Perm.canFeature('organization', 'branches', 'user_assignments', 'edit');

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    try {
      final res = await Future.wait([
        Api.list('/users/$_uid/assignments'),
        Api.list('/organization/branches'),
        Api.list('/organization/departments'),
      ]);
      if (!mounted) return;
      setState(() {
        _rows = res[0].rows;
        _branches = res[1].rows;
        _departments = res[2].rows;
        _error = null;
      });
    } catch (e) {
      if (mounted) setState(() => _error = e);
    }
  }

  String _branchName(Object? id) =>
      str(_branches.firstWhere((b) => b['id'] == id, orElse: () => {'name': 'Branch #$id'})['name']);

  Future<void> _edit(Json? a) async {
    int? branchId = asInt(a?['branch_id']);
    int? deptId = asInt(a?['department_id']);
    final empId = TextEditingController(text: str(a?['employee_id']));
    final designation = TextEditingController(text: str(a?['designation']));
    final role = TextEditingController(text: str(a?['role']));
    String? access = str(a?['access_level']).isEmpty ? null : str(a?['access_level']);
    DateTime? from = parseDate(a?['effective_from']);
    DateTime? to = parseDate(a?['effective_to']);
    String status = str(a?['status']).isEmpty ? 'active' : str(a?['status']);
    bool primary = a?['is_primary_branch'] == true;
    final name = str(widget.user['name']);
    final saved = await showFormSheet(context,
        title: a == null ? 'Add Assignment' : 'Edit Assignment',
        saveLabel: a == null ? 'Save Assignment' : 'Save Changes', builder: (ctx, setS) {
      final depts = branchId == null ? _departments : _departments.where((d) => d['branch_id'] == branchId).toList();
      return [
        _Hint(a == null ? 'Post $name to a branch' : '$name at ${_branchName(a['branch_id'])}'),
        const Caps('Branch & post'),
        AppSelect<int>(
          label: 'Branch',
          required: true,
          enabled: a == null,
          value: branchId,
          options: [for (final b in _branches) Option(asInt(b['id'])!, str(b['name']))],
          onChanged: (o) => setS(() => branchId = o?.value),
        ),
        if (a != null)
          const _Hint('Branch is locked while editing — remove and re-add to move someone to a different branch.'),
        AppTextField(label: 'Employee ID', controller: empId),
        AppSelect<int>(
          label: 'Department',
          value: deptId,
          options: [for (final d in depts) Option(asInt(d['id'])!, str(d['name']))],
          onChanged: (o) => setS(() => deptId = o?.value),
        ),
        AppTextField(label: 'Designation', controller: designation),
        AppTextField(label: 'Role', controller: role),
        AppSelect<String>(
          label: 'Access Level',
          value: access,
          options: const [Option('view', 'View'), Option('edit', 'Edit'), Option('admin', 'Admin')],
          onChanged: (o) => setS(() => access = o?.value),
        ),
        const Caps('Validity & status'),
        DateField(label: 'Effective From', value: from, onChanged: (d) => setS(() => from = d)),
        DateField(label: 'Effective To', value: to, onChanged: (d) => setS(() => to = d)),
        AppSelect<String>(
          label: 'Status',
          required: true,
          value: status,
          options: const [Option('active', 'Active'), Option('inactive', 'Inactive')],
          onChanged: (o) => setS(() => status = o?.value ?? 'active'),
        ),
        CheckField(label: 'Primary Branch', value: primary, onChanged: (v) => setS(() => primary = v)),
        const _Hint("Tick for the person's main branch (one per person). Leave Effective To blank if open-ended."),
      ];
    }, onSave: () async {
      if (branchId == null) throw 'Branch is required';
      final payload = {
        'branch_id': branchId,
        'employee_id': empId.text.trim(),
        'department_id': deptId,
        'designation': designation.text.trim(),
        'role': role.text.trim(),
        'access_level': access ?? '',
        'is_primary_branch': primary,
        'effective_from': from == null ? null : apiDate(from!),
        'effective_to': to == null ? null : apiDate(to!),
        'status': status,
        'user_id': _uid,
      };
      if (a != null) {
        await Api.patch('/organization/branches/${a['branch_id']}/user-assignments/${a['id']}', data: payload);
      } else {
        await Api.post('/organization/branches/$branchId/user-assignments', data: payload);
      }
    });
    if (saved) _load();
  }

  Future<void> _remove(Json a) async {
    final ok = await confirmDialog(context,
        title: 'Remove this assignment?',
        message: 'Remove this branch assignment for "${str(widget.user['name'])}"? This cannot be undone.',
        confirmLabel: 'Remove',
        danger: true);
    if (!ok || !mounted) return;
    if (await runAction(context,
        () => Api.delete('/organization/branches/${a['branch_id']}/user-assignments/${a['id']}'),
        success: 'Assignment removed.')) {
      _load();
    }
  }

  @override
  Widget build(BuildContext context) {
    final rows = _rows;
    return DetailSection('Assignments',
        action: _canEdit
            ? TextButton.icon(
                onPressed: () => _edit(null), icon: const Icon(Icons.add_rounded, size: 18), label: const Text('Add Assignment'))
            : null,
        children: [
          if (rows == null)
            _error != null ? ErrorView(_error!, onRetry: _load) : const LoadingView()
          else if (rows.isEmpty)
            _Hint('No branch assignments yet${_canEdit ? ' — use + Add Assignment to post this person to a branch.' : '.'}')
          else
            for (final a in rows)
              _Item(
                title: _branchName(a['branch_id']),
                sub: str(a['role']),
                tags: [
                  if (a['is_primary_branch'] == true)
                    const StatusBadge('Primary branch', color: Color(0xFF047857)),
                  if (str(a['status']).isNotEmpty && a['status'] != 'active')
                    const StatusBadge('Inactive', color: Color(0xFF64748B)),
                ],
                body: [
                  str(a['designation']),
                  str(a['department_name']),
                  if (str(a['access_level']).isNotEmpty) '${_cap(str(a['access_level']))} access',
                  if (str(a['employee_id']).isNotEmpty) 'Emp. ID ${a['employee_id']}',
                  if (a['effective_from'] != null)
                    'From ${fmtDate(a['effective_from'])}${a['effective_to'] != null ? ' to ${fmtDate(a['effective_to'])}' : ''}',
                ].where((s) => s.isNotEmpty).join(' · '),
                actions: _canEdit
                    ? [_linkBtn('Edit', () => _edit(a)), _linkBtn('Remove', () => _remove(a), danger: true)]
                    : const [],
              ),
        ]);
  }
}

// ── Roles & Permissions ─────────────────────────────────────────────────────

const _approvalFlags = <(String, String, String)>[
  ('is_director', 'Director', 'Director stages (e.g. large sales orders) and project management'),
  ('is_department_head', 'Department Head',
      'Flag-based stages and Sales Head fallback. "Department head" stages use the heads set in Organization › Department'),
  ('is_plant_head', 'Plant Head',
      'Flag-based stages. "Plant head" stages use the head set on the plant (Organization › Branches)'),
  ('is_project_head', 'Project Head', 'Flag-based approval stages'),
  ('is_purchase_head', 'Purchase Head', 'Purchase stage of NCR disposition and flag-based stages'),
  ('is_finance_manager', 'Finance Manager',
      'Purchase-invoice variances, period close, depreciation and year-end close'),
  ('is_purchase_manager', 'Purchase Manager', 'Flag-based approval stages'),
  ('is_store_manager', 'Store Manager',
      'Flag-based approval stages (store-specific approvals use the store location manager)'),
  ('is_production_manager', 'Production Manager', 'RRV build sign-off and flag-based stages'),
  ('is_design_manager', 'Design Manager', 'Flag-based approval stages'),
  ('is_rnd_manager', 'R&D Manager', 'Flag-based approval stages'),
  ('is_project_manager', 'Project Manager', 'Flag-based approval stages'),
];

String _humanizeKey(String k) => humanize(k);

/// Plain words for a permission id (portal permissionWords).
String _permissionWords(Json? registry, String id) {
  if (id == '*' || id == '*:*:*') return 'Everything (all modules)';
  final parts = id.split(':');
  final mk = parts.isNotEmpty ? parts[0] : '';
  final tk = parts.length > 1 ? parts[1] : '*';
  final a = parts.length > 2 ? parts[2] : '*';
  final mod = jsonMap(jsonMap(registry?['modules'])[mk]);
  final modLabel = mk == '*' ? 'All modules' : (str(mod['label']).isEmpty ? _humanizeKey(mk) : str(mod['label']));
  String place;
  if (tk.isEmpty || tk == '*') {
    place = 'any tab';
  } else {
    final tf = tk.split('.');
    final tab = tf[0];
    final tabLabel = str(jsonMap(mod['subtabs'])[tab]).isEmpty ? _humanizeKey(tab) : str(jsonMap(mod['subtabs'])[tab]);
    var featLabel = '';
    if (tf.length > 1) {
      final fl = str(jsonMap(jsonMap(jsonMap(mod['features'])[tab])[tf[1]])['label']);
      featLabel = fl.isEmpty ? _humanizeKey(tf[1]) : fl;
    }
    place = featLabel.isNotEmpty ? '$tabLabel › $featLabel' : tabLabel;
  }
  final al = str(jsonMap(registry?['action_labels'])[a]);
  final action = a.isEmpty || a == '*' ? 'any action' : (al.isEmpty ? _humanizeKey(a) : al);
  return '$modLabel › $place — $action';
}

/// Segregation of Duties check before saving roles / extras (portal
/// useSodGuard). Returns the mitigation reason (may be null); throws a
/// readable message when the user cancels.
Future<String?> _sodGuard(BuildContext context, int userId, Json planned) async {
  final preview = jsonMap(await Api.post('/organization/grc/sod/preview', data: {'user_id': userId, ...planned}));
  final conflicts = jsonList(preview['new_conflicts']);
  if (conflicts.isEmpty) return null;
  if (!context.mounted) throw 'Not saved.';
  final high = conflicts.any((c) => c['risk'] == 'high');
  final ctrl = TextEditingController();
  String? err;
  final reason = await showDialog<String>(
    context: context,
    builder: (ctx) => StatefulBuilder(
      builder: (ctx, setS) => AlertDialog(
        title: Text(high ? 'Segregation of Duties conflict — mitigation needed' : 'Segregation of Duties warning'),
        content: SingleChildScrollView(
          child: Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.start, children: [
            Text(high
                ? 'Enter the mitigating control (who reviews their work, until when) to assign it anyway.'
                : 'You can save anyway; a reason is recorded if you give one.'),
            const SizedBox(height: 10),
            const Caps('What clashes'),
            for (final c in conflicts)
              Container(
                margin: const EdgeInsets.only(top: 6),
                padding: const EdgeInsets.all(8),
                decoration:
                    BoxDecoration(borderRadius: BorderRadius.circular(8), border: Border.all(color: Brand.border)),
                child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                  Wrap(spacing: 6, crossAxisAlignment: WrapCrossAlignment.center, children: [
                    Text('${str(c['rule_id'])} ${str(c['title'])}',
                        style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 13)),
                    StatusBadge('${_cap(str(c['risk']))} risk',
                        color: c['risk'] == 'high' ? const Color(0xFFDC2626) : const Color(0xFFF59E0B)),
                  ]),
                  Text(str(c['why']), style: const TextStyle(fontSize: 12.5)),
                ]),
              ),
            const SizedBox(height: 12),
            TextField(
              controller: ctrl,
              maxLines: 3,
              decoration: InputDecoration(
                labelText: high ? 'Who checks this person’s work, and until when? *' : 'Why is this needed?',
                hintText: high ? 'e.g. Finance manager reviews every JV this user posts, until 31-03-2027' : 'Optional reason…',
                errorText: err,
                border: const OutlineInputBorder(),
              ),
            ),
            const SizedBox(height: 4),
            Text(
                high
                    ? 'Recorded as the mitigation for this conflict (Organization › Access Risk › Mitigations).'
                    : 'Recorded with the assignment.',
                style: const TextStyle(fontSize: 11.5, color: Brand.muted)),
          ]),
        ),
        actions: [
          TextButton(onPressed: () => Navigator.pop(ctx), child: const Text('Cancel')),
          FilledButton(
            style: FilledButton.styleFrom(backgroundColor: Brand.danger, minimumSize: const Size(88, 40)),
            onPressed: () {
              if (high && ctrl.text.trim().isEmpty) {
                setS(() => err = 'Enter the mitigating control - a high-risk conflict needs one.');
                return;
              }
              Navigator.pop(ctx, ctrl.text.trim());
            },
            child: const Text('Assign anyway'),
          ),
        ],
      ),
    ),
  );
  if (reason == null) {
    throw 'Not saved — the Segregation of Duties conflict was not accepted. Remove the conflicting role or give a mitigation reason.';
  }
  return reason.isEmpty ? null : reason;
}

class _RolesPermissionsTab extends StatefulWidget {
  const _RolesPermissionsTab({required this.user, required this.onRefresh});
  final Json user;
  final Future<void> Function() onRefresh;

  @override
  State<_RolesPermissionsTab> createState() => _RolesPermissionsTabState();
}

class _RolesPermissionsTabState extends State<_RolesPermissionsTab> {
  Json? _registry;
  List<Json> _roles = [];
  Json? _effective;
  Object? _error;
  late Set<int> _roleIds;
  late Set<String> _extras;
  late Map<String, bool> _flags;
  bool _showExtras = false;
  String _roleQuery = '';
  String _saving = '';

  Json get u => widget.user;
  int get _uid => asInt(u['id'])!;
  bool get _selfLocked => !Perm.isAdmin && Perm.userId == _uid;
  bool get _canEditRoles => Perm.canFeature('organization', 'roles', 'members', 'edit') && !_selfLocked;
  bool get _canEditExtras => Perm.canFeature('organization', 'roles', 'extra_permissions', 'edit') && !_selfLocked;
  bool get _seeExtras => Perm.canFeature('organization', 'roles', 'extra_permissions', 'view');
  bool get _canEditFlags => orgCan('users', 'edit') && !_selfLocked;

  Set<int> get _savedRoleIds => (u['role_ids'] is List) ? (u['role_ids'] as List).map(asInt).whereType<int>().toSet() : {};
  Set<String> get _savedExtras =>
      (u['granular_permissions'] is List) ? (u['granular_permissions'] as List).map(str).toSet() : {};

  @override
  void initState() {
    super.initState();
    _roleIds = Set.of(_savedRoleIds);
    _extras = Set.of(_savedExtras);
    _showExtras = _extras.isNotEmpty;
    _flags = {for (final (k, _, _) in _approvalFlags) k: u[k] == true};
    if (u['role'] != 'admin') _load();
  }

  Future<void> _load() async {
    try {
      final res = await Future.wait([
        Api.get('/users/permissions/registry'),
        Api.get('/roles'),
        Api.get('/users/$_uid/effective-permissions'),
      ]);
      if (!mounted) return;
      setState(() {
        _registry = jsonMap(res[0]);
        _roles = ApiPage.from(res[1]).rows;
        _effective = jsonMap(res[2]);
        _error = null;
      });
    } catch (e) {
      if (mounted) setState(() => _error = e);
    }
  }

  Future<void> _run(String what, Future<void> Function() fn, String ok) async {
    setState(() => _saving = what);
    try {
      await fn();
      _effective = jsonMap(await Api.get('/users/$_uid/effective-permissions'));
      if (mounted) showSnack(context, ok);
      await widget.onRefresh();
    } catch (e) {
      if (mounted) showSnack(context, e is String ? e : 'Could not save $what: ${ApiClient.describe(e)}', error: true);
    } finally {
      if (mounted) setState(() => _saving = '');
    }
  }

  Map<String, List<String>> get _grants {
    final g = jsonMap(_effective?['grants']);
    return {for (final e in g.entries) e.key: (e.value is List ? (e.value as List).map(str).toList() : <String>[])};
  }

  Set<String> get _fromRoles => {
        for (final e in _grants.entries)
          if (e.value.any((s) => s != 'Extra')) e.key,
      };

  bool _sameSet<T>(Set<T> a, Set<T> b) => a.length == b.length && a.containsAll(b);

  @override
  Widget build(BuildContext context) {
    if (u['role'] == 'admin') {
      return DetailSection('Roles & Permissions', children: [
        Text(
            '${str(u['name'])} is an Admin — admins can see and do everything in every module, so roles don\'t apply. '
            'Change their role to User on the User Details tab to manage their access with roles.',
            style: const TextStyle(fontSize: 13, color: Brand.body)),
      ]);
    }
    if (_registry == null) {
      return _error != null
          ? Padding(
              padding: const EdgeInsets.all(16),
              child: ErrorView('Could not load roles for this user: ${ApiClient.describe(_error!)}', onRetry: _load))
          : const LoadingView();
    }
    final q = _roleQuery.trim().toLowerCase();
    final assignable = _roles
        .where((r) => r['is_default'] != true && (r['is_active'] == true || _roleIds.contains(asInt(r['id']))))
        .toList();
    final shown = assignable
        .where((r) => _roleIds.contains(asInt(r['id'])) || q.isEmpty || str(r['name']).toLowerCase().contains(q))
        .toList();
    final everyone = _roles.where((r) => r['is_default'] == true && r['is_active'] == true).map((r) => str(r['name']));
    final rolesChanged = !_sameSet(_roleIds, _savedRoleIds);
    final extrasChanged = !_sameSet(_extras, _savedExtras);
    final apps = (_effective?['apps'] is List) ? (_effective!['apps'] as List).map(str).toList() : <String>[];
    final modules = jsonMap(_registry!['modules']);
    final grants = _grants.entries.toList()..sort((a, b) => a.key.compareTo(b.key));

    return Column(children: [
      DetailSection('Roles', children: [
        _Hint('Tick the roles this person holds; their access is everything those roles allow.'
            '${everyone.isNotEmpty ? ' Everyone also gets: ${everyone.join(', ')}.' : ''}'),
        SearchField(hint: 'Search roles…', onChanged: (v) => setState(() => _roleQuery = v)),
        const SizedBox(height: 6),
        for (final r in shown)
          Opacity(
            opacity: r['is_active'] == true ? 1 : 0.55,
            child: CheckboxListTile(
              dense: true,
              contentPadding: EdgeInsets.zero,
              controlAffinity: ListTileControlAffinity.leading,
              value: _roleIds.contains(asInt(r['id'])),
              onChanged: _canEditRoles
                  ? (v) => setState(() => v == true ? _roleIds.add(asInt(r['id'])!) : _roleIds.remove(asInt(r['id'])))
                  : null,
              title: Row(children: [
                Flexible(child: Text(str(r['name']), style: const TextStyle(fontWeight: FontWeight.w600, fontSize: 13.5))),
                if (r['is_system'] == true)
                  const Padding(
                      padding: EdgeInsets.only(left: 6),
                      child: Text('BUILT-IN', style: TextStyle(fontSize: 10, color: Color(0xFF1D4ED8)))),
              ]),
              subtitle: str(r['description']).isEmpty ? null : Text(str(r['description']), maxLines: 2),
            ),
          ),
        if (_selfLocked)
          const _Hint(
              'This is your own account — only an admin can change your roles, extra permissions or approval flags.',
              color: Color(0xFFB45309)),
        if (_canEditRoles)
          _primary(
              _saving == 'roles' ? 'Saving…' : 'Save Roles',
              _saving.isNotEmpty || !rolesChanged
                  ? null
                  : () => _run('roles', () async {
                        final ids = _roleIds.toList();
                        final reason = await _sodGuard(context, _uid, {'role_ids': ids});
                        await Api.put('/users/$_uid/roles', data: {'role_ids': ids, 'sod_mitigation_reason': reason});
                      }, 'Roles saved — the user gets the new access on their next page load.')),
      ]),
      DetailSection('Approval Roles', children: [
        const _Hint(
            'Who approvals are routed to — not a permission. Approval workflows (Organization › Workflows) pick approvers by these flags. Partners are set in Company Info › Partners.'),
        ListTile(
          dense: true,
          contentPadding: EdgeInsets.zero,
          leading: Icon(u['is_partner'] == true ? Icons.check_circle_rounded : Icons.remove_circle_outline,
              color: u['is_partner'] == true ? const Color(0xFFB45309) : Brand.muted),
          title: Text(u['is_partner'] == true ? 'Partner' : 'Not a Partner',
              style: const TextStyle(fontWeight: FontWeight.w600)),
          subtitle: const Text('Change in Organization › Info › Partners'),
        ),
        for (final (k, label, hint) in _approvalFlags)
          CheckboxListTile(
            dense: true,
            contentPadding: EdgeInsets.zero,
            controlAffinity: ListTileControlAffinity.leading,
            value: _flags[k] ?? false,
            onChanged: _canEditFlags ? (v) => setState(() => _flags[k] = v ?? false) : null,
            title: Text(label, style: const TextStyle(fontWeight: FontWeight.w600, fontSize: 13.5)),
            subtitle: Text(hint, style: const TextStyle(fontSize: 11.5)),
          ),
        if (_canEditFlags)
          _primary(
              _saving == 'approval roles' ? 'Saving…' : 'Save',
              _saving.isNotEmpty
                  ? null
                  : () => _run('approval roles', () => Api.patch('/users/$_uid', data: _flags), 'Approval roles saved.')),
      ]),
      if (_seeExtras)
        DetailSection('Extra permissions (this user only)',
            action: TextButton(
                onPressed: () => setState(() => _showExtras = !_showExtras),
                child: Text(_showExtras ? 'Hide' : 'Show${_extras.isNotEmpty ? ' (${_extras.length})' : ''}')),
            children: [
              const _Hint(
                  'For a one-off exception on top of their roles. If several people need the same thing, make a role instead. Faded ticks come from roles.'),
              if (_showExtras) ...[
                PermissionTreeEditor(
                  registry: _registry!,
                  grants: _extras,
                  inherited: _fromRoles,
                  readOnly: !_canEditExtras,
                  onChanged: (g) => setState(() => _extras = Set.of(g)),
                ),
                if (_canEditExtras)
                  Padding(
                    padding: const EdgeInsets.only(top: 10),
                    child: _primary(
                        _saving == 'extra permissions' ? 'Saving…' : 'Save Extra Permissions',
                        _saving.isNotEmpty || !extrasChanged
                            ? null
                            : () => _run('extra permissions', () async {
                                  final g = _extras.toList();
                                  final reason = await _sodGuard(context, _uid, {'granular_permissions': g});
                                  await Api.patch('/users/$_uid/permissions',
                                      data: {'granular_permissions': g, 'sod_mitigation_reason': reason});
                                }, 'Extra permissions saved.')),
                  ),
              ],
            ]),
      _ValiditySection(
        userId: _uid,
        registry: _registry,
        canEdit: _canEditRoles,
        roles: [
          for (final r in _roles)
            if (_savedRoleIds.contains(asInt(r['id']))) (asInt(r['id'])!, str(r['name'])),
        ],
        extras: _savedExtras.toList(),
      ),
      if (orgCan('monitor', 'view')) _DenialsSection(userId: _uid, registry: _registry),
      DetailSection('Effective access', children: [
        _Hint('Everything ${str(u['name'])} can do right now (saved roles + extras), with the role that gives it. '
            'Modules: ${apps.isEmpty ? 'none' : apps.map((a) => str(jsonMap(modules[a])['label']).isEmpty ? humanize(a) : str(jsonMap(modules[a])['label'])).join(', ')}'),
        if (grants.isEmpty) const _Hint('No access granted.'),
        for (final g in grants)
          Padding(
            padding: const EdgeInsets.symmetric(vertical: 4),
            child: Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
              const Padding(
                  padding: EdgeInsets.only(top: 2, right: 6),
                  child: Icon(Icons.check_rounded, size: 16, color: Brand.success)),
              Expanded(
                child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                  Text(_permissionWords(_registry, g.key), style: const TextStyle(fontSize: 13, color: Brand.body)),
                  Text('From: ${g.value.join(', ')}', style: const TextStyle(fontSize: 11.5, color: Brand.muted)),
                ]),
              ),
            ]),
          ),
      ]),
    ]);
  }
}

class _ValiditySection extends StatefulWidget {
  const _ValiditySection(
      {required this.userId, required this.registry, required this.canEdit, required this.roles, required this.extras});
  final int userId;
  final Json? registry;
  final bool canEdit;
  final List<(int, String)> roles;
  final List<String> extras;

  @override
  State<_ValiditySection> createState() => _ValiditySectionState();
}

class _ValiditySectionState extends State<_ValiditySection> {
  List<Json> _rows = [];
  String? _error;

  @override
  void initState() {
    super.initState();
    Api.list('/organization/grc/users/${widget.userId}/validity').then((p) {
      if (mounted) setState(() => _rows = p.rows);
    }).catchError((Object e) {
      if (mounted) setState(() => _error = 'Could not load validity dates: ${ApiClient.describe(e)}');
    });
  }

  Json? _rowOf(String kind, int? roleId, String? perm) {
    for (final r in _rows) {
      if (kind == 'role' && r['kind'] == 'role' && asInt(r['role_id']) == roleId) return r;
      if (kind == 'grant' && r['kind'] == 'grant' && r['permission'] == perm) return r;
    }
    return null;
  }

  Future<void> _edit(String kind, int? roleId, String? perm, String label) async {
    final r = _rowOf(kind, roleId, perm);
    DateTime? from = parseDate(r?['valid_from']);
    DateTime? to = parseDate(r?['valid_to']);
    final reason = TextEditingController(text: str(r?['reason']));
    final saved = await showFormSheet(context, title: 'Access validity', builder: (ctx, setS) => [
          _Hint(label),
          const Caps('Validity'),
          DateField(label: 'Valid from', value: from, onChanged: (d) => setS(() => from = d)),
          DateField(label: 'Valid to', value: to, onChanged: (d) => setS(() => to = d)),
          const _Hint(
              'Outside these dates the access grants nothing; a daily job removes it the day after "valid to". Leave both empty for permanent access.'),
          const Caps('Reason'),
          AppTextField(label: 'Why is it temporary?', controller: reason, hint: 'e.g. covering leave'),
        ], onSave: () async {
      final out = await Api.put('/organization/grc/users/${widget.userId}/validity', data: {
        'kind': kind,
        'role_id': roleId,
        'permission': perm,
        'valid_from': from == null ? null : apiDate(from!),
        'valid_to': to == null ? null : apiDate(to!),
        'reason': reason.text.trim().isEmpty ? null : reason.text.trim(),
      });
      _rows = ApiPage.from(out).rows;
    });
    if (saved && mounted) {
      setState(() {});
      showSnack(
          context,
          from != null || to != null
              ? 'Validity saved for $label. It is removed automatically the day after "valid to".'
              : '$label is now permanent.');
    }
  }

  @override
  Widget build(BuildContext context) {
    final items = <(String, int?, String?, String)>[
      for (final (id, name) in widget.roles) ('role', id, null, 'Role: $name'),
      for (final p in widget.extras) ('grant', null, p, 'Extra: ${_permissionWords(widget.registry, p)}'),
    ];
    return DetailSection('Access validity (temporary access)', children: [
      const _Hint(
          'Give a role or extra grant a start and end date — e.g. cover for a colleague on leave. Outside the dates it grants nothing, and a daily job removes it once the end date has passed (the user and admins get a notification). Leave both empty for permanent access.'),
      if (_error != null) _Hint(_error!, color: const Color(0xFFB91C1C)),
      if (items.isEmpty) const _Hint('No roles or extra grants assigned yet — save roles first.'),
      for (final (kind, roleId, perm, label) in items)
        Builder(builder: (_) {
          final r = _rowOf(kind, roleId, perm);
          return _Item(
            title: label,
            tags: [
              if (r == null)
                const Text('Permanent', style: TextStyle(fontSize: 12, color: Brand.muted))
              else
                StatusBadge(r['active'] == true ? 'Active' : 'Not active today',
                    color: r['active'] == true ? const Color(0xFF16A34A) : const Color(0xFFB45309)),
            ],
            body: r == null
                ? null
                : 'Valid from ${fmtDate(r['valid_from'])} · Valid to ${fmtDate(r['valid_to'])}'
                    '${str(r['reason']).isNotEmpty ? ' · ${r['reason']}' : ''}',
            actions: widget.canEdit ? [_linkBtn('Set dates', () => _edit(kind, roleId, perm, label))] : const [],
          );
        }),
    ]);
  }
}

class _DenialsSection extends StatelessWidget {
  const _DenialsSection({required this.userId, required this.registry});
  final int userId;
  final Json? registry;

  @override
  Widget build(BuildContext context) {
    return DetailSection('Denied access — last 30 days', children: [
      const _Hint(
          'Every request this user was refused, with the exact permission that was missing and the roles that would grant it.'),
      _Load<List<Json>>(
        load: () async => (await Api.list('/organization/grc/denials', query: {'user_id': userId, 'days': 30})).rows,
        builder: (ctx, rows, _) => rows.isEmpty
            ? const _Hint('Nothing was refused in the last 30 days.')
            : Column(children: [
                for (final d in rows)
                  _Item(
                    title: d['permission_key'] != null
                        ? _permissionWords(registry, str(d['permission_key']))
                        : (str(d['permission_label']).isEmpty ? 'Record-level rule' : str(d['permission_label'])),
                    sub: fmtDateTime(d['occurred_at']),
                    body: [
                      '${str(d['method'])} ${str(d['path'])}',
                      'Times: ${str(d['repeat_count'])}',
                      'Granted by role: ${jsonList(d['granted_by_roles']).isEmpty ? '—' : jsonList(d['granted_by_roles']).map((r) => str(r['name'])).join(', ')}',
                      if (d['permission_key'] == null && str(d['detail']).isNotEmpty)
                        str(d['detail']).length > 140 ? str(d['detail']).substring(0, 140) : str(d['detail']),
                    ].join(' · '),
                  ),
              ]),
      ),
    ]);
  }
}

// ── Data Access ─────────────────────────────────────────────────────────────

const _scopeOptions = [
  Option('', 'Follow roles'),
  Option('own', 'Own records'),
  Option('assigned', 'Own + assigned'),
  Option('department', 'Department'),
  Option('plant', 'Plant / branch'),
  Option('multi_plant', 'Multiple plants'),
  Option('organization', 'Entire organization'),
];

class _DataAccessTab extends StatefulWidget {
  const _DataAccessTab({required this.userId});
  final int userId;

  @override
  State<_DataAccessTab> createState() => _DataAccessTabState();
}

class _DataAccessTabState extends State<_DataAccessTab> {
  List<Json>? _rows;
  Map<String, String> _draft = {};
  Object? _error;
  bool _saving = false;

  bool get _canEdit => Perm.canFeature('organization', 'roles', 'data_access', 'edit');

  @override
  void initState() {
    super.initState();
    _load();
  }

  void _set(List<Json> rows) {
    _rows = rows;
    _draft = {
      for (final r in rows)
        if (str(r['override']).isNotEmpty) str(r['module_key']): str(r['override']),
    };
  }

  Future<void> _load() async {
    try {
      final p = await Api.list('/users/${widget.userId}/data-scopes');
      if (mounted) setState(() => _set(p.rows));
    } catch (e) {
      if (mounted) setState(() => _error = e);
    }
  }

  Future<void> _save() async {
    setState(() => _saving = true);
    try {
      final out = await Api.put('/users/${widget.userId}/data-scopes', data: {'overrides': _draft});
      if (!mounted) return;
      setState(() => _set(ApiPage.from(out).rows));
      showSnack(context, 'Data access saved. It applies on the user’s next page load.');
    } catch (e) {
      if (mounted) showSnack(context, 'Could not save data access: ${ApiClient.describe(e)}', error: true);
    } finally {
      if (mounted) setState(() => _saving = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final rows = _rows;
    return DetailSection('Data Access', children: [
      const _Hint(
          'Which records this person sees in each module. Normally it comes from their roles (widest wins); set a personal override only for exceptions. Modules they can\'t open at all are unaffected.'),
      if (rows == null)
        _error != null ? ErrorView(_error!, onRetry: _load) : const LoadingView()
      else ...[
        for (final r in rows)
          Padding(
            padding: const EdgeInsets.only(bottom: 10),
            child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
              AppSelect<String>(
                label: str(r['module_label']),
                value: _draft[str(r['module_key'])] ?? '',
                enabled: _canEdit,
                clearable: false,
                options: _scopeOptions,
                onChanged: (o) => setState(() {
                  final v = o?.value ?? '';
                  if (v.isEmpty) {
                    _draft.remove(str(r['module_key']));
                  } else {
                    _draft[str(r['module_key'])] = v;
                  }
                }),
              ),
              Padding(
                padding: const EdgeInsets.only(top: 2, left: 4),
                child: Text('now: ${str(r['effective_label'])}', style: const TextStyle(fontSize: 12, color: Brand.muted)),
              ),
            ]),
          ),
        if (_canEdit) _primary(_saving ? 'Saving…' : 'Save data access', _saving ? null : _save),
      ],
    ]);
  }
}

// ── History lists ───────────────────────────────────────────────────────────

class _HistoryList extends StatelessWidget {
  const _HistoryList({required this.path, required this.title, required this.empty, this.activity = false});
  final String path;
  final String title;
  final String empty;
  final bool activity;

  @override
  Widget build(BuildContext context) {
    return DetailSection(title, children: [
      _Load<List<Json>>(
        load: () async => (await Api.list(path)).rows,
        builder: (ctx, rows, _) => rows.isEmpty
            ? _Hint(empty)
            : Column(children: [
                for (final h in rows)
                  _Item(
                    title: str(h['summary']).isNotEmpty ? str(h['summary']) : str(h['action']),
                    tags: [
                      if (activity && str(h['entity_type']).isNotEmpty)
                        StatusBadge(str(h['entity_type']).replaceAll('_', ' '), color: Brand.primary),
                    ],
                    body: activity && str(h['summary']).isNotEmpty
                        ? '${str(h['action'])} · ${fmtDateTime(h['performed_at'])}'
                        : fmtDateTime(h['performed_at']),
                  ),
              ]),
      ),
    ]);
  }
}

// ── Login History ───────────────────────────────────────────────────────────

const _revokeReason = {
  'logout': 'Signed out',
  'admin': 'Signed out by admin',
  'idle': 'Idle timeout',
  'rotated': 'Renewed',
  'limit': 'Device limit',
  'deactivated': 'Deactivated',
};

class _LoginHistoryTab extends StatelessWidget {
  const _LoginHistoryTab({required this.userId});
  final int userId;

  @override
  Widget build(BuildContext context) {
    return _Load<List<Json>>(
      load: () async => (await Api.list('/users/$userId/sessions')).rows,
      builder: (ctx, sessions, reload) {
        final now = DateTime.now();
        bool isLive(Json s) => s['revoked_at'] == null && (parseDate(s['expires_at'])?.isAfter(now) ?? false);
        final live = sessions.where(isLive).length;
        return DetailSection('Login History · $live live',
            action: live > 0 && orgCan('security', 'edit')
                ? TextButton(
                    onPressed: () async {
                      final ok = await confirmDialog(ctx,
                          title: 'Sign out everywhere?',
                          message: 'End every live session of this user? They will have to sign in again.',
                          confirmLabel: 'Sign out',
                          danger: true);
                      if (!ok || !ctx.mounted) return;
                      try {
                        final r = jsonMap(await Api.post('/organization/security/users/$userId/revoke-all'));
                        if (ctx.mounted) showSnack(ctx, 'Signed out of ${str(r['revoked'])} session(s).');
                        reload();
                      } catch (e) {
                        if (ctx.mounted) {
                          showSnack(ctx, 'Could not sign the user out: ${ApiClient.describe(e)}', error: true);
                        }
                      }
                    },
                    child: const Text('Sign out everywhere'))
                : null,
            children: [
              if (sessions.isEmpty) const _Hint('No sessions recorded yet — this person has not signed in.'),
              for (final s in sessions)
                _Item(
                  title: 'Signed in ${fmtDateTime(s['created_at'])}',
                  tags: [
                    if (s['revoked_at'] != null)
                      StatusBadge(_revokeReason[s['revoked_reason']] ?? 'Revoked', color: const Color(0xFFB91C1C))
                    else if (isLive(s))
                      const StatusBadge('Live', color: Color(0xFF047857))
                    else
                      const StatusBadge('Expired', color: Color(0xFF64748B)),
                  ],
                  body: 'Last used ${fmtDateTime(s['last_used_at'])} · Expires ${fmtDateTime(s['expires_at'])}'
                      '${str(s['ip_address']).isNotEmpty ? ' · IP ${s['ip_address']}' : ''}'
                      '${str(s['user_agent']).isNotEmpty ? ' · ${s['user_agent']}' : ''}',
                ),
            ]);
      },
    );
  }
}

// ── User Documents ──────────────────────────────────────────────────────────

const _docTypes = ['ID Proof', 'Offer Letter', 'Certificate', 'Agreement', 'Other'];
const _confidentiality = ['Public', 'Internal', 'Confidential'];

class _DocumentsTab extends StatefulWidget {
  const _DocumentsTab({required this.userId});
  final int userId;

  @override
  State<_DocumentsTab> createState() => _DocumentsTabState();
}

class _DocumentsTabState extends State<_DocumentsTab> {
  int _gen = 0;

  bool get _canCreate => Perm.canFeature('organization', 'users', 'documents', 'create');
  bool get _canDelete => Perm.canFeature('organization', 'users', 'documents', 'delete');
  bool get _canOpen => Perm.canFeature('organization', 'users', 'documents', 'export');

  Future<void> _add() async {
    MultipartFile? file;
    String? fileName;
    String type = 'Other';
    String conf = 'Confidential';
    DateTime? issue;
    DateTime? expiry;
    final name = TextEditingController();
    final number = TextEditingController();
    final authority = TextEditingController();
    final tags = TextEditingController();
    final remarks = TextEditingController();
    final saved = await showFormSheet(context, title: 'Add User Document', saveLabel: 'Save Document',
        builder: (ctx, setS) => [
              const _Hint('ID proof, offer letter, certificate or agreement — stored in SharePoint'),
              const Caps('File'),
              OutlinedButton.icon(
                icon: const Icon(Icons.attach_file_rounded),
                label: Text(fileName ?? 'Document File *', overflow: TextOverflow.ellipsis),
                onPressed: () async {
                  try {
                    final f = await Files.pickFile();
                    if (f != null) {
                      setS(() {
                        file = f;
                        fileName = f.filename;
                      });
                    }
                  } catch (e) {
                    if (ctx.mounted) showSnack(ctx, 'Could not pick the file. ${ApiClient.describe(e)}', error: true);
                  }
                },
              ),
              const Caps('Details'),
              AppSelect<String>(
                label: 'Document Type',
                required: true,
                value: type,
                options: [for (final t in _docTypes) Option(t, t)],
                onChanged: (o) => setS(() => type = o?.value ?? 'Other'),
              ),
              AppTextField(label: 'Document Name', required: true, controller: name, hint: 'e.g. PAN Card'),
              AppTextField(label: 'Document Number', controller: number),
              AppTextField(label: 'Issuing Authority', controller: authority),
              DateField(label: 'Issue Date', value: issue, onChanged: (d) => setS(() => issue = d)),
              DateField(label: 'Expiry Date', value: expiry, onChanged: (d) => setS(() => expiry = d)),
              const _Hint(
                  'Fill the expiry date for documents that expire (passport, licence) so renewals show in the list.'),
              const Caps('Classification'),
              AppSelect<String>(
                label: 'Confidentiality',
                required: true,
                value: conf,
                options: [for (final c in _confidentiality) Option(c, c)],
                onChanged: (o) => setS(() => conf = o?.value ?? 'Confidential'),
              ),
              AppTextField(label: 'Tags (comma separated)', controller: tags, hint: 'e.g. kyc, joining'),
              AppTextField(label: 'Remarks', controller: remarks),
            ], onSave: () async {
      if (file == null) throw 'Select a file to upload';
      if (name.text.trim().isEmpty) throw 'Document Name is required';
      final meta = <String, String>{
        'document_type': type,
        'document_name': name.text.trim(),
        'document_number': number.text.trim(),
        'issue_date': issue == null ? '' : apiDate(issue!),
        'expiry_date': expiry == null ? '' : apiDate(expiry!),
        'issuing_authority': authority.text.trim(),
        'confidentiality': conf,
        'tags': tags.text.trim(),
        'remarks': remarks.text.trim(),
      };
      final form = FormData();
      form.files.add(MapEntry('file', file!));
      meta.forEach((k, v) {
        if (v.isNotEmpty) form.fields.add(MapEntry(k, v));
      });
      await Api.dio.post('/users/${widget.userId}/documents',
          data: form, options: Options(sendTimeout: const Duration(seconds: 120), receiveTimeout: const Duration(seconds: 120)));
    });
    if (saved && mounted) setState(() => _gen++);
  }

  Future<void> _delete(Json d, VoidCallback reload) async {
    final ok = await confirmDialog(context,
        title: 'Delete this document?',
        message: 'Delete "${str(d['document_name'])}"? This cannot be undone.',
        confirmLabel: 'Delete',
        danger: true);
    if (!ok || !mounted) return;
    if (await runAction(context, () => Api.delete('/users/${widget.userId}/documents/${d['id']}'),
        success: 'Document deleted.')) {
      reload();
    }
  }

  @override
  Widget build(BuildContext context) {
    return DetailSection('User Documents',
        action: _canCreate
            ? TextButton.icon(onPressed: _add, icon: const Icon(Icons.add_rounded, size: 18), label: const Text('Add Document'))
            : null,
        children: [
          _Load<List<Json>>(
            key: ValueKey(_gen),
            load: () async => (await Api.list('/users/${widget.userId}/documents')).rows,
            builder: (ctx, docs, reload) => docs.isEmpty
                ? _Hint(
                    'No documents uploaded yet${_canCreate ? ' — use + Add Document to upload ID proof, offer letter or certificates.' : '.'}')
                : Column(children: [
                    for (final d in docs)
                      _Item(
                        title: str(d['document_name']),
                        sub: str(d['document_type']),
                        body: '${str(d['filename'])}${d['expiry_date'] != null ? ' · Expires ${fmtDate(d['expiry_date'])}' : ''}',
                        actions: [
                          if (str(d['sharepoint_url']).isNotEmpty && _canOpen)
                            _linkBtn('Open', () async {
                              try {
                                await Files.openUrl(str(d['sharepoint_url']));
                              } catch (e) {
                                if (context.mounted) showSnack(context, ApiClient.describe(e), error: true);
                              }
                            }),
                          if (_canDelete) _linkBtn('Delete', () => _delete(d, reload), danger: true),
                        ],
                      ),
                  ]),
          ),
        ]);
  }
}
