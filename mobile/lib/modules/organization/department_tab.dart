import 'package:flutter/material.dart';

import '../../api/api.dart';
import '../../theme.dart';
import '../../ui/app_frame.dart';
import '../../ui/form.dart';
import '../../ui/widgets.dart';
import 'org_common.dart';

/// Organization › Department - native copy of
/// frontend/src/app/dashboard/organization/department/page.tsx. The portal's
/// expandable row (members as a reporting tree, Reports to, Remove, Add
/// member) opens as its own screen here.
class OrgDepartmentTab extends StatefulWidget {
  const OrgDepartmentTab({super.key});

  @override
  State<OrgDepartmentTab> createState() => _OrgDepartmentTabState();
}

class _OrgDepartmentTabState extends State<OrgDepartmentTab> {
  final _list = GlobalKey<ApiListViewState>();
  List<Json> _branches = const [];
  List<Json> _all = const [];
  int? _branchFilter;

  @override
  void initState() {
    super.initState();
    Api.list('/organization/branches').then((p) {
      if (mounted) setState(() => _branches = p.rows);
    }).catchError((_) {});
  }

  Future<ApiPage> _load(int page, String search) async {
    final rows = (await Api.list('/organization/departments')).rows;
    if (mounted) setState(() => _all = rows);
    return ApiPage(_visible(rows));
  }

  List<Json> _visible(List<Json> rows) =>
      _branchFilter == null ? rows : rows.where((d) => asInt(d['branch_id']) == _branchFilter).toList();

  void _setFilter(int? id) {
    setState(() => _branchFilter = id);
    _list.currentState?.reload();
  }

  Future<void> _add() async {
    if (await _showAddDepartmentSheet(context, _branches)) {
      if (mounted) showSnack(context, 'Department created.');
      _list.currentState?.reload();
    }
  }

  @override
  Widget build(BuildContext context) {
    final header = Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        const PageHeader('Department', subtitle: 'Organization'),
        const Padding(
          padding: EdgeInsets.fromLTRB(16, 0, 16, 10),
          child: Text(
            'Auto-populated from Azure AD on sign-in and admin Azure sync — see Organization > Role & Permissions > '
            'Sync Azure Users. You can also add departments manually below.',
            style: TextStyle(fontSize: 12.5, color: Brand.muted),
          ),
        ),
        // Branch filter (portal: the Branch column header dropdown).
        SizedBox(
          height: 42,
          child: ListView(
            scrollDirection: Axis.horizontal,
            padding: const EdgeInsets.symmetric(horizontal: 16),
            children: [
              CountChip('All Branches', _all.length, selected: _branchFilter == null, onTap: () => _setFilter(null)),
              for (final b in _branches)
                CountChip(
                  str(b['name']),
                  _all.where((d) => asInt(d['branch_id']) == asInt(b['id'])).length,
                  selected: _branchFilter == asInt(b['id']),
                  onTap: () => _setFilter(_branchFilter == asInt(b['id']) ? null : asInt(b['id'])),
                ),
            ],
          ),
        ),
        const SizedBox(height: 8),
      ],
    );
    return Scaffold(
      backgroundColor: Colors.transparent,
      floatingActionButton:
          orgCan('department', 'create') ? CreateFab(label: 'Add Department', onPressed: _add) : null,
      body: ApiListView(
        key: _list,
        load: _load,
        header: header,
        emptyText: 'No departments yet — sign in or run Azure sync to populate this.',
        itemBuilder: (ctx, d, reload) => RecordCard(
          code: str(d['code']),
          title: str(d['name']),
          meta: [
            ('Branch', _dash(d['branch_name'])),
            ('Head', _dash(d['head_user_name'])),
          ],
          trailing: const Icon(Icons.chevron_right_rounded, color: Brand.muted),
          onTap: () async {
            await Navigator.of(context).push(MaterialPageRoute(builder: (_) => _DepartmentMembersScreen(dept: d)));
            _list.currentState?.reload();
          },
        ),
      ),
    );
  }
}

String _dash(Object? v) => str(v).trim().isEmpty ? '—' : str(v);

// ── Add Department ───────────────────────────────────────────────────────────

Future<bool> _showAddDepartmentSheet(BuildContext context, List<Json> branches) async {
  List<Json> directory = const [];
  try {
    directory = (await Api.list('/users/directory')).rows;
  } catch (_) {}
  if (!context.mounted) return false;
  final name = TextEditingController();
  int? branchId;
  final heads = <int, String>{};

  Future<List<Option<int>>> headOptions(String search) async {
    final q = search.toLowerCase();
    return [
      for (final u in directory)
        // A department is only headed from its own unit - the backend rejects
        // anyone else, so only offer people posted in the selected branch.
        if ((branchId == null || asInt(u['branch_id']) == branchId) &&
            !heads.containsKey(asInt(u['id'])) &&
            (q.isEmpty || str(u['name']).toLowerCase().contains(q) || str(u['email']).toLowerCase().contains(q)))
          Option<int>(asInt(u['id'])!, str(u['name']), subtitle: str(u['email'])),
    ];
  }

  if (!context.mounted) return false;
  return showFormSheet(
    context,
    title: 'Add Department',
    saveLabel: 'Save Department',
    builder: (ctx, setS) => [
      const Text("Create a department Azure AD sync didn't already populate",
          style: TextStyle(fontSize: 12.5, color: Brand.muted)),
      const Caps('Department', color: Brand.heading),
      AppTextField(label: 'Name', controller: name, required: true, hint: 'Accounts'),
      Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          AppSelect<int>(
            label: 'Branch (optional)',
            value: branchId,
            options: [for (final b in branches) Option(asInt(b['id'])!, str(b['name']))],
            onChanged: (o) => setS(() {
              branchId = o?.value;
              // Heads picked for the old unit don't belong to the new one.
              if (branchId != null) {
                heads.removeWhere((id, _) =>
                    asInt(directory.where((u) => asInt(u['id']) == id).firstOrNull?['branch_id']) != branchId);
              }
            }),
          ),
          const SizedBox(height: 4),
          const Text('Leave empty for a department that spans all branches.',
              style: TextStyle(fontSize: 12, color: Brand.muted)),
        ],
      ),
      const Caps('Head of Department', color: Brand.heading),
      Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          ChipsPicker(
            label: 'Heads (one or more, optional)',
            selected: heads,
            loadOptions: headOptions,
            onChanged: (m) => setS(() {
              heads
                ..clear()
                ..addAll(m);
            }),
          ),
          const SizedBox(height: 4),
          const Text(
              'The first person picked is the primary head, the second the secondary head. Only people posted in '
              'the selected branch are offered.',
              style: TextStyle(fontSize: 12, color: Brand.muted)),
        ],
      ),
    ],
    onSave: () async {
      if (name.text.trim().isEmpty) throw 'Department name is required';
      final ids = heads.keys.toList();
      await Api.post('/organization/departments', data: {
        'name': name.text.trim(),
        'branch_id': ?branchId,
        if (ids.isNotEmpty) 'head_user_id': ids[0],
        if (ids.length > 1) 'secondary_head_user_id': ids[1],
        if (ids.length > 2) 'additional_head_user_ids': ids.sublist(2),
      });
    },
  );
}

// ── Members (expanded row) ───────────────────────────────────────────────────

class _TreeRow {
  _TreeRow(this.m, this.guides, this.last, this.outsideManager);
  final Json m;
  final List<bool> guides;
  final bool last;
  final bool outsideManager;
}

/// Members as a reporting tree: someone whose reporting manager is in this
/// department sits under them; heads and everyone else are top-level, heads
/// first (same as the portal's memberTree).
List<_TreeRow> _memberTree(List<Json> list) {
  final ids = {for (final m in list) asInt(m['id'])};
  int byHeadThenName(Json a, Json b) {
    final h = (b['is_head'] == true ? 1 : 0) - (a['is_head'] == true ? 1 : 0);
    return h != 0 ? h : str(a['name']).compareTo(str(b['name']));
  }

  final children = <int, List<Json>>{};
  final roots = <Json>[];
  for (final m in list) {
    final mid = asInt(m['reporting_manager_id']);
    if (mid != null && mid != asInt(m['id']) && ids.contains(mid)) {
      children.putIfAbsent(mid, () => []).add(m);
    } else {
      roots.add(m);
    }
  }
  final rows = <_TreeRow>[];
  final seen = <int?>{};
  void walk(List<Json> nodes, List<bool> guides) {
    final sorted = nodes.where((n) => !seen.contains(asInt(n['id']))).toList()..sort(byHeadThenName);
    for (var i = 0; i < sorted.length; i++) {
      final m = sorted[i];
      seen.add(asInt(m['id']));
      final last = i == sorted.length - 1;
      final mid = asInt(m['reporting_manager_id']);
      rows.add(_TreeRow(m, guides, last, mid != null && !ids.contains(mid)));
      walk(children[asInt(m['id'])] ?? const [], [...guides, last]);
    }
  }

  walk(roots, const []);
  // An old reporting loop inside the department has no root - still list everyone.
  walk(list.where((m) => !seen.contains(asInt(m['id']))).toList(), const []);
  return rows;
}

class _DepartmentMembersScreen extends StatefulWidget {
  const _DepartmentMembersScreen({required this.dept});
  final Json dept;

  @override
  State<_DepartmentMembersScreen> createState() => _DepartmentMembersScreenState();
}

class _DepartmentMembersScreenState extends State<_DepartmentMembersScreen> {
  late Future<List<Json>> _future = _load();
  bool _busy = false;

  int get _id => asInt(widget.dept['id'])!;
  bool get _canEdit => orgCan('department', 'edit');

  Future<List<Json>> _load() async => (await Api.list('/organization/departments/$_id/members')).rows;

  void _reload() => setState(() => _future = _load());

  Future<void> _addMember(List<Json> members, Option<int> o) async {
    setState(() => _busy = true);
    try {
      await Api.post('/organization/departments/$_id/members', data: {'user_id': o.value});
      if (mounted) showSnack(context, '${o.label} added to ${str(widget.dept['name'])}.');
      _reload();
    } catch (e) {
      if (mounted) {
        showSnack(
            context,
            '${ApiClient.describe(e)} — Could not add this person to the department. Try again; if it keeps failing, '
            'check they are still an active user.',
            error: true);
      }
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _remove(Json m) async {
    final yes = await confirmDialog(context,
        title: 'Remove member?',
        message: 'Remove ${str(m['name'])} from ${str(widget.dept['name'])}?',
        confirmLabel: 'Remove',
        danger: true);
    if (!yes || !mounted) return;
    if (await runAction(context, () => Api.delete('/organization/departments/$_id/members/${m['id']}'),
        success: 'Member removed.')) {
      _reload();
    }
  }

  Future<void> _reportsTo(Json m, List<Json> members) async {
    int? pick = asInt(m['reporting_manager_id']);
    String? pickName = m['reporting_manager_name'] as String?;
    final memberIds = {for (final x in members) asInt(x['id'])};

    // Empty search suggests colleagues from this department; typing searches
    // everyone (a head usually reports to someone outside the department).
    Future<List<Option<int>>> options(String search) async {
      if (search.trim().isEmpty) {
        return [
          for (final x in members)
            if (asInt(x['id']) != asInt(m['id']))
              Option<int>(asInt(x['id'])!, str(x['name']), subtitle: str(x['email'])),
        ];
      }
      final all = await loadUserOptions(search);
      return all.where((o) => o.value != asInt(m['id'])).toList()
        ..sort((a, b) => (memberIds.contains(b.value) ? 1 : 0) - (memberIds.contains(a.value) ? 1 : 0));
    }

    final saved = await showFormSheet(
      context,
      title: 'Reports to',
      saveLabel: 'Save',
      builder: (ctx, setS) => [
        Text('${str(m['name'])} · ${str(widget.dept['name'])}', style: const TextStyle(fontSize: 13, color: Brand.muted)),
        const Caps('Reporting manager', color: Brand.heading),
        AppSelect<int>(
          label: 'Reports to (optional)',
          value: pick,
          valueLabel: pickName,
          loadOptions: options,
          onChanged: (o) => setS(() {
            pick = o?.value;
            pickName = o?.label;
          }),
        ),
        if (pick == null) const Text('No reporting manager.', style: TextStyle(fontSize: 12.5, color: Brand.muted)),
        const Text(
            'This builds the reporting hierarchy shown in the tree. Approval steps set to "Requester\'s reporting '
            'manager" go to this person, and where a role limits task assignment to the person\'s team, that team is '
            'everyone below them here.',
            style: TextStyle(fontSize: 12, color: Brand.muted)),
      ],
      onSave: () async {
        if (pick == asInt(m['reporting_manager_id'])) return; // nothing changed
        try {
          await Api.put('/organization/departments/$_id/members/${m['id']}/manager',
              data: {'reporting_manager_id': pick});
        } catch (e) {
          throw '${ApiClient.describe(e)} — Could not save who this person reports to. Try again; if it keeps '
              'failing, check both people are still active users.';
        }
      },
    );
    if (saved) _reload();
  }

  @override
  Widget build(BuildContext context) {
    final d = widget.dept;
    return SubPage(
      title: str(d['name']),
      body: FutureBuilder<List<Json>>(
        future: _future,
        builder: (ctx, s) {
          if (s.connectionState != ConnectionState.done) return const LoadingView();
          if (s.hasError) return ErrorView(s.error!, onRetry: _reload);
          final members = s.data!;
          final rows = _memberTree(members);
          return RefreshIndicator(
            onRefresh: () async => _reload(),
            child: ListView(
              padding: const EdgeInsets.only(top: 12, bottom: 32),
              children: [
                DetailSection('Department', children: [
                  FieldRow('Name', d['name']),
                  FieldRow('Code', d['code']),
                  FieldRow('Branch', _dash(d['branch_name'])),
                  FieldRow('Head', _dash(d['head_user_name'])),
                ]),
                DetailSection('Members (${members.length})', children: [
                  if (_canEdit) ...[
                    AppSelect<int>(
                      label: _busy ? 'Adding…' : 'Add member',
                      value: null,
                      enabled: !_busy,
                      loadOptions: (q) async {
                        final ids = {for (final x in members) asInt(x['id'])};
                        return (await loadUserOptions(q)).where((o) => !ids.contains(o.value)).toList();
                      },
                      onChanged: (o) {
                        if (o != null) _addMember(members, o);
                      },
                    ),
                    const SizedBox(height: 4),
                    const Text('Pick a person to link them to this department — it is saved at once.',
                        style: TextStyle(fontSize: 12, color: Brand.muted)),
                    const SizedBox(height: 8),
                  ],
                  if (rows.isEmpty)
                    const Text('No users linked to this department yet.',
                        style: TextStyle(fontSize: 12.5, color: Brand.muted)),
                  for (final r in rows) _memberRow(r, members),
                ]),
              ],
            ),
          );
        },
      ),
    );
  }

  Widget _memberRow(_TreeRow r, List<Json> members) {
    final m = r.m;
    final isHead = m['is_head'] == true;
    final guide = '${r.guides.map((g) => g ? '   ' : '│  ').join()}${r.last ? '└─' : '├─'}';
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 4),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(guide, style: const TextStyle(fontFamily: 'monospace', color: Brand.muted, fontSize: 12.5)),
          const SizedBox(width: 6),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Wrap(
                  spacing: 6,
                  crossAxisAlignment: WrapCrossAlignment.center,
                  children: [
                    Text(str(m['name']),
                        style: TextStyle(
                            fontSize: 13.5,
                            fontWeight: isHead ? FontWeight.w700 : FontWeight.w500,
                            color: isHead ? Brand.primaryActive : Brand.body)),
                    if (isHead) const StatusBadge('Head', color: Brand.primaryActive),
                  ],
                ),
                Text(
                  [
                    if (str(m['designation']).isNotEmpty) str(m['designation']),
                    str(m['email']),
                    if (r.outsideManager)
                      'reports to ${str(m['reporting_manager_name']).isEmpty ? 'User #${m['reporting_manager_id']}' : str(m['reporting_manager_name'])}',
                  ].join(' · '),
                  style: const TextStyle(fontSize: 12, color: Brand.muted),
                ),
              ],
            ),
          ),
          if (_canEdit)
            PopupMenuButton<String>(
              padding: EdgeInsets.zero,
              icon: const Icon(Icons.more_vert_rounded, size: 20),
              itemBuilder: (_) => [
                const PopupMenuItem(value: 'manager', child: Text('Reports to')),
                if (!isHead)
                  const PopupMenuItem(value: 'remove', child: Text('Remove', style: TextStyle(color: Color(0xFFB91C1C)))),
              ],
              onSelected: (v) => v == 'manager' ? _reportsTo(m, members) : _remove(m),
            ),
        ],
      ),
    );
  }
}
