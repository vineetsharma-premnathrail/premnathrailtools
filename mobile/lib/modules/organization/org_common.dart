import 'package:flutter/material.dart';

import '../../api/api.dart';
import '../../theme.dart';
import '../../ui/form.dart';
import '../../ui/perms.dart';

/// Shared bits of the Organization module (only used inside this folder).

/// Organization tabs in portal nav order - registry keys
/// (`organization:<tab>:<action>`), same as _lib/useRequireOrgTab.ts.
const orgTabKeys = [
  'info',
  'branches',
  'department',
  'users',
  'roles',
  'workflows',
  'delegations',
  'security',
  'audit_logs',
  'access_reviews',
  'grc',
  'monitor',
  'cockpit',
];

/// Portal filterTabsByAccess('organization', ...): the server's tab_access
/// list when the user has one, otherwise (admins) every tab.
bool orgTabVisible(String key) {
  if (Perm.isAdmin) return true;
  final ta = Perm.user['tab_access'];
  if (ta is Map && ta['organization'] is List) {
    return (ta['organization'] as List).contains(key);
  }
  return Perm.can('organization', key, 'view');
}

/// can(user, 'organization', tab, action).
bool orgCan(String tab, String action) => Perm.can('organization', tab, action);

int? asInt(Object? v) => v is int ? v : (v is num ? v.toInt() : (v is String ? int.tryParse(v) : null));

String str(Object? v) => v == null ? '' : v.toString();

List<Json> jsonList(Object? v) =>
    v is List ? v.whereType<Map>().map((m) => Map<String, dynamic>.from(m)).toList() : <Json>[];

Json jsonMap(Object? v) => v is Map ? Map<String, dynamic>.from(v) : <String, dynamic>{};

/// Active users from /users/directory as select options (name + email).
Future<List<Option<int>>> loadUserOptions(String search) async {
  final rows = (await Api.list('/users/directory')).rows;
  final q = search.toLowerCase();
  return [
    for (final u in rows)
      if (q.isEmpty ||
          str(u['name']).toLowerCase().contains(q) ||
          str(u['email']).toLowerCase().contains(q))
        Option<int>(asInt(u['id'])!, str(u['name']),
            subtitle: [str(u['email']), str(u['department'])].where((s) => s.isNotEmpty).join(' · ')),
  ];
}

Future<List<Option<int>>> loadRoleOptions(String search) async {
  final rows = (await Api.list('/roles')).rows;
  final q = search.toLowerCase();
  return [
    for (final r in rows)
      if (q.isEmpty || str(r['name']).toLowerCase().contains(q)) Option<int>(asInt(r['id'])!, str(r['name'])),
  ];
}

Future<List<Option<int>>> loadDepartmentOptions(String search) async {
  final rows = (await Api.list('/organization/departments')).rows;
  final q = search.toLowerCase();
  return [
    for (final d in rows)
      if (q.isEmpty || str(d['name']).toLowerCase().contains(q))
        Option<int>(asInt(d['id'])!, str(d['name']), subtitle: str(d['code']).isEmpty ? null : str(d['code'])),
  ];
}

Future<List<Option<int>>> loadBranchOptions(String search) async {
  final rows = (await Api.list('/organization/branches')).rows;
  final q = search.toLowerCase();
  return [
    for (final b in rows)
      if (q.isEmpty || str(b['name']).toLowerCase().contains(q))
        Option<int>(asInt(b['id'])!, str(b['name']), subtitle: str(b['code']).isEmpty ? null : str(b['code'])),
  ];
}

/// Small outlined pill button (portal secondaryBtnStyle).
class PillButton extends StatelessWidget {
  const PillButton(this.label, {super.key, required this.onPressed, this.icon, this.danger = false});
  final String label;
  final IconData? icon;
  final VoidCallback? onPressed;
  final bool danger;

  @override
  Widget build(BuildContext context) {
    final c = danger ? Brand.danger : Brand.body;
    return OutlinedButton.icon(
      style: OutlinedButton.styleFrom(
        foregroundColor: c,
        side: BorderSide(color: danger ? Brand.danger.withValues(alpha: 0.4) : Brand.border),
        shape: const StadiumBorder(),
        padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
        minimumSize: const Size(0, 34),
        visualDensity: VisualDensity.compact,
      ),
      onPressed: onPressed,
      icon: Icon(icon ?? Icons.chevron_right_rounded, size: 16),
      label: Text(label, style: const TextStyle(fontSize: 13, fontWeight: FontWeight.w600)),
    );
  }
}

/// Multi-pick chips with a "+ Add" icon button (portal UserChipsPicker).
class ChipsPicker extends StatelessWidget {
  const ChipsPicker({
    super.key,
    required this.label,
    required this.selected,
    required this.onChanged,
    required this.loadOptions,
  });
  final String label;

  /// id -> label
  final Map<int, String> selected;
  final ValueChanged<Map<int, String>> onChanged;
  final Future<List<Option<int>>> Function(String) loadOptions;

  @override
  Widget build(BuildContext context) {
    return InputDecorator(
      decoration: fieldDecoration(label),
      child: Wrap(
        spacing: 6,
        runSpacing: 6,
        crossAxisAlignment: WrapCrossAlignment.center,
        children: [
          for (final e in selected.entries)
            InputChip(
              label: Text(e.value, style: const TextStyle(fontSize: 12.5)),
              visualDensity: VisualDensity.compact,
              onDeleted: () => onChanged(Map.of(selected)..remove(e.key)),
            ),
          SizedBox(
            width: 140,
            child: AppSelect<int>(
              label: 'Add',
              value: null,
              loadOptions: loadOptions,
              onChanged: (o) {
                if (o == null) return;
                onChanged(Map.of(selected)..[o.value] = o.label);
              },
            ),
          ),
        ],
      ),
    );
  }
}
