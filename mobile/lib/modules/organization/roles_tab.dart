import 'package:flutter/material.dart';

import '../../api/api.dart';
import '../../theme.dart';
import '../../ui/widgets.dart';
import 'org_common.dart';
import 'role_detail.dart';

/// Organization › Role & Permissions - the list of roles (portal
/// organization/roles/page.tsx). A role is a named bundle of module › tab ›
/// action grants; users get access by holding one or more roles.
class OrgRolesTab extends StatefulWidget {
  const OrgRolesTab({super.key});

  @override
  State<OrgRolesTab> createState() => _OrgRolesTabState();
}

class _OrgRolesTabState extends State<OrgRolesTab> {
  final _list = GlobalKey<ApiListViewState>();

  Future<void> _open(int? id) async {
    await Navigator.of(context).push(MaterialPageRoute(builder: (_) => RoleDetailScreen(roleId: id)));
    _list.currentState?.reload();
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: Colors.transparent,
      floatingActionButton: orgCan('roles', 'create')
          ? FloatingActionButton.extended(
              backgroundColor: Brand.primary,
              foregroundColor: Colors.white,
              onPressed: () => _open(null),
              icon: const Icon(Icons.add_rounded),
              label: const Text('New Role'),
            )
          : null,
      body: ApiListView(
        key: _list,
        searchHint: 'Search roles…',
        emptyText: 'No roles yet — tap “+ New Role”.',
        header: const PageHeader('Role & Permissions',
            subtitle: "A role is a job's access — which modules, tabs and actions (view, create, edit, delete, approve…) it "
                'allows. Give users one or more roles; their access is everything their roles allow. Users can delete only '
                'records they created themselves (admins can delete anything).'),
        load: (page, search) async {
          final rows = (await Api.list('/roles')).rows;
          final q = search.toLowerCase();
          return ApiPage(rows
              .where((r) =>
                  q.isEmpty || str(r['name']).toLowerCase().contains(q) || str(r['description']).toLowerCase().contains(q))
              .toList());
        },
        itemBuilder: (ctx, r, reload) {
          final isDefault = r['is_default'] == true;
          final active = r['is_active'] == true;
          return Opacity(
            opacity: active ? 1 : 0.55,
            child: RecordCard(
              title: str(r['name']),
              subtitle: str(r['description']).isEmpty ? '—' : str(r['description']),
              trailing: Wrap(spacing: 6, children: [
                if (isDefault) const StatusBadge('Everyone', color: Color(0xFF047857)),
                if (!active) const StatusBadge('Inactive', color: Brand.muted),
              ]),
              meta: [
                ('Users', isDefault ? 'All' : str(r['user_count'])),
              ],
              onTap: () => _open(asInt(r['id'])),
            ),
          );
        },
      ),
    );
  }
}
