import 'package:flutter/material.dart';

import '../../api/api.dart';
import '../../ui/app_frame.dart';
import '../../ui/format.dart';
import '../../ui/widgets.dart';
import 'branch_detail.dart';
import 'branch_forms.dart';
import 'org_common.dart';

/// Organization › Branches - native copy of
/// frontend/src/app/dashboard/organization/plants/page.tsx ("All Branches").
class OrgBranchesTab extends StatefulWidget {
  const OrgBranchesTab({super.key});

  @override
  State<OrgBranchesTab> createState() => _OrgBranchesTabState();
}

class _OrgBranchesTabState extends State<OrgBranchesTab> {
  final _list = GlobalKey<ApiListViewState>();
  int? _count;

  bool get _canEdit => orgCan('branches', 'edit');
  bool get _canDelete => orgCan('branches', 'delete');

  Future<ApiPage> _load(int page, String search) async {
    final rows = (await Api.list('/organization/branches')).rows;
    final q = search.toLowerCase();
    bool has(Object? v) => str(v).toLowerCase().contains(q);
    final filtered = q.isEmpty
        ? rows
        : rows
            .where((p) =>
                has(p['name']) ||
                has(p['code']) ||
                has(p['company_name']) ||
                has(p['plant_type']) ||
                has(p['manager_user_name']) ||
                has(p['industry_function']))
            .toList();
    if (mounted) setState(() => _count = filtered.length);
    return ApiPage(filtered);
  }

  void _reload() => _list.currentState?.reload();

  Future<void> _toggleActive(Json p) async {
    final next = p['status'] == 'active' ? 'inactive' : 'active';
    final ok = await runAction(context, () => Api.patch('/organization/branches/${p['id']}', data: {'status': next}),
        success: next == 'active' ? 'Branch activated.' : 'Branch deactivated.');
    if (ok) _reload();
  }

  Future<void> _delete(Json p) async {
    final yes = await confirmDialog(context,
        title: 'Delete this branch?',
        message: 'Delete branch "${str(p['name'])}"? This cannot be undone.',
        confirmLabel: 'Delete',
        danger: true);
    if (!yes || !mounted) return;
    // The server gives the real reason (e.g. stores, departments or users still
    // attached - remove those first, or deactivate the branch instead).
    final ok = await runAction(context, () => Api.delete('/organization/branches/${p['id']}'),
        success: 'Branch deleted.');
    if (ok) _reload();
  }

  Future<void> _create() async {
    final created = await showBranchCreateSheet(context);
    if (created == null || !mounted) return;
    _reload();
    final id = asInt(created['id']);
    if (id != null) {
      openScreen(context, BranchDetailScreen(branchId: id, name: str(created['name'])));
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: Colors.transparent,
      floatingActionButton:
          orgCan('branches', 'create') ? CreateFab(label: 'Add Branch', onPressed: _create) : null,
      body: ApiListView(
        key: _list,
        load: _load,
        searchHint: 'Search Branch…',
        emptyText: 'No branches found.',
        header: PageHeader('All Branches', subtitle: _count == null ? 'Organization' : 'Organization · $_count branches'),
        itemBuilder: (ctx, p, reload) {
          final actions = <PopupMenuEntry<String>>[
            if (_canEdit)
              PopupMenuItem(value: 'toggle', child: Text(p['status'] == 'active' ? 'Deactivate' : 'Activate')),
            if (_canDelete)
              const PopupMenuItem(
                  value: 'delete', child: Text('Delete', style: TextStyle(color: Color(0xFFB91C1C)))),
          ];
          return RecordCard(
            code: str(p['code']),
            title: str(p['name']),
            subtitle: p['company_name'] as String?,
            trailing: Row(
              mainAxisSize: MainAxisSize.min,
              children: [
                const SizedBox(width: 8),
                StatusBadge(branchStatusLabel(p['status']), color: branchStatusColor(p['status'])),
                if (actions.isNotEmpty)
                  PopupMenuButton<String>(
                    tooltip: 'Actions',
                    padding: EdgeInsets.zero,
                    icon: const Icon(Icons.more_vert_rounded, size: 20),
                    itemBuilder: (_) => actions,
                    onSelected: (v) => v == 'toggle' ? _toggleActive(p) : _delete(p),
                  ),
              ],
            ),
            meta: [
              ('Branch Type', txt(p['plant_type'])),
              ('Branch Manager', txt(p['manager_user_name'])),
              ('Industry / Function', txt(p['industry_function'])),
              ('Created Date', fmtDate(p['created_at'])),
              ('Last Updated', fmtDate(p['updated_at'])),
            ],
            onTap: () async {
              final id = asInt(p['id']);
              if (id == null) return;
              await Navigator.of(context).push(MaterialPageRoute(
                  builder: (_) => BranchDetailScreen(branchId: id, name: str(p['name']))));
              _reload();
            },
          );
        },
      ),
    );
  }
}
