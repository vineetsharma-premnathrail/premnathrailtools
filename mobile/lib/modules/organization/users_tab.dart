import 'package:dio/dio.dart';
import 'package:flutter/material.dart';

import '../../api/api.dart';
import '../../theme.dart';
import '../../ui/format.dart';
import '../../ui/widgets.dart';
import 'org_common.dart';
import 'user_detail.dart';

/// Approval-routing flags shown on the Users list (portal organization/users).
const userListApprovalFlags = <(String, String)>[
  ('is_partner', 'Partner'),
  ('is_director', 'Director'),
  ('is_department_head', 'Department Head'),
  ('is_plant_head', 'Plant Head'),
  ('is_project_head', 'Project Head'),
  ('is_purchase_head', 'Purchase Head'),
  ('is_finance_manager', 'Finance Manager'),
  ('is_purchase_manager', 'Purchase Manager'),
  ('is_store_manager', 'Store Manager'),
  ('is_production_manager', 'Production Manager'),
  ('is_design_manager', 'Design Manager'),
  ('is_rnd_manager', 'R&D Manager'),
  ('is_project_manager', 'Project Manager'),
];

/// Organization › Users - copy of frontend/src/app/dashboard/users/page.tsx
/// (status tabs with counts, search, Sync from Microsoft, tap → user).
class OrgUsersTab extends StatefulWidget {
  const OrgUsersTab({super.key});

  @override
  State<OrgUsersTab> createState() => _OrgUsersTabState();
}

class _OrgUsersTabState extends State<OrgUsersTab> {
  List<Json>? _users;
  Map<String, String> _appLabels = {};
  Object? _error;
  String _status = 'All Users';
  String _search = '';
  bool _syncing = false;

  @override
  void initState() {
    super.initState();
    _load();
    Api.list('/modules').then((p) {
      if (!mounted) return;
      setState(() => _appLabels = {for (final m in p.rows) str(m['key']): str(m['label'])});
    }).catchError((_) {});
  }

  Future<void> _load() async {
    setState(() => _error = null);
    try {
      final p = await Api.list('/users');
      if (mounted) setState(() => _users = p.rows);
    } catch (e) {
      if (mounted) setState(() => _error = e);
    }
  }

  Future<void> _sync() async {
    final ok = await confirmDialog(context,
        title: 'Sync users from Microsoft (Entra ID)?',
        message: 'This pulls the latest names, emails, designations and departments from Microsoft Entra ID and adds '
            'new joiners. New people get no module access until you give them a role.',
        confirmLabel: 'Sync now');
    if (!ok || !mounted) return;
    setState(() => _syncing = true);
    try {
      final data = (await Api.dio.post('/users/sync-azure',
              options: Options(receiveTimeout: const Duration(seconds: 120))))
          .data;
      if (mounted) setState(() => _users = ApiPage.from(data).rows);
    } catch (e) {
      if (mounted) showSnack(context, 'Microsoft sync failed: ${ApiClient.describe(e)}', error: true);
    } finally {
      if (mounted) setState(() => _syncing = false);
    }
  }

  String _appLabel(String a) => a == 'p2p' ? 'Procurement' : (_appLabels[a] ?? a);

  @override
  Widget build(BuildContext context) {
    final users = _users;
    if (users == null) {
      return _error != null ? ErrorView(_error!, onRetry: _load) : const LoadingView();
    }
    final active = users.where((u) => u['is_active'] == true).length;
    final counts = {'All Users': users.length, 'Active Users': active, 'Inactive Users': users.length - active};
    final q = _search.trim().toLowerCase();
    final shown = users.where((u) {
      if (_status == 'Active Users' && u['is_active'] != true) return false;
      if (_status == 'Inactive Users' && u['is_active'] == true) return false;
      if (q.isEmpty) return true;
      return str(u['name']).toLowerCase().contains(q) || str(u['email']).toLowerCase().contains(q);
    }).toList();

    final header = <Widget>[
      PageHeader('Users', subtitle: 'Manage portal users, roles, and module access'),
      SizedBox(
        height: 44,
        child: ListView(
          scrollDirection: Axis.horizontal,
          padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 4),
          children: [
            for (final t in counts.keys)
              CountChip(t, counts[t], selected: _status == t, onTap: () => setState(() => _status = t)),
          ],
        ),
      ),
      Padding(
        padding: const EdgeInsets.fromLTRB(16, 8, 16, 8),
        child: SearchField(hint: 'Search by name or email...', onChanged: (v) => setState(() => _search = v)),
      ),
      if (orgCan('users', 'create'))
        Padding(
          padding: const EdgeInsets.fromLTRB(16, 0, 16, 8),
          child: Align(
            alignment: Alignment.centerLeft,
            child: PillButton(_syncing ? 'Syncing…' : 'Sync from Microsoft (Entra ID)',
                icon: Icons.sync_rounded, onPressed: _syncing ? null : _sync),
          ),
        ),
      Padding(
        padding: const EdgeInsets.fromLTRB(16, 0, 16, 8),
        child: Text('${shown.length} user${shown.length == 1 ? '' : 's'}',
            style: const TextStyle(fontSize: 12, color: Brand.muted)),
      ),
    ];

    return RefreshIndicator(
      onRefresh: _load,
      child: ListView.builder(
        padding: const EdgeInsets.only(bottom: 88),
        itemCount: header.length + (shown.isEmpty ? 1 : shown.length),
        itemBuilder: (ctx, i) {
          if (i < header.length) return header[i];
          if (shown.isEmpty) return const EmptyView('No users match your filters.');
          final u = shown[i - header.length];
          return _userCard(u);
        },
      ),
    );
  }

  Widget _userCard(Json u) {
    final isAdmin = u['role'] == 'admin';
    final roleNames = (u['role_names'] is List) ? (u['role_names'] as List).map(str).toList() : <String>[];
    final apps = (u['apps'] is List) ? (u['apps'] as List).map(str).toList() : <String>[];
    final flags = [for (final (k, l) in userListApprovalFlags) if (u[k] == true) l];
    return RecordCard(
      title: str(u['name']),
      subtitle: str(u['email']),
      trailing: Padding(
        padding: const EdgeInsets.only(left: 8),
        child: StatusBadge(u['is_active'] == true ? 'Active' : 'Inactive',
            color: u['is_active'] == true ? const Color(0xFF047857) : const Color(0xFF64748B)),
      ),
      meta: [
        ('Designation', txt(u['designation'])),
        ('Department', txt(u['department'])),
        ('Office Location', txt(u['office_location'])),
        ('Role', isAdmin ? 'Admin' : (roleNames.isNotEmpty ? roleNames.join(', ') : 'No extra role')),
        ('Apps', isAdmin ? 'All' : (apps.isEmpty ? 'None' : apps.map(_appLabel).join(', '))),
        if (flags.isNotEmpty) ('Approval Roles', flags.join(', ')),
      ],
      onTap: () async {
        await Navigator.of(context).push(MaterialPageRoute(
            builder: (_) => UserDetailScreen(userId: asInt(u['id'])!, name: str(u['name']))));
        if (mounted) _load();
      },
    );
  }
}
