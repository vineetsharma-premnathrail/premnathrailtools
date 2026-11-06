import 'package:flutter/material.dart';

import '../../api/api.dart';
import '../../theme.dart';
import '../../ui/format.dart';
import '../../ui/widgets.dart';
import 'org_common.dart';
import 'permission_tree.dart';
import 'role_detail.dart';
import 'user_detail.dart';

// Organization › Access Risk (Segregation of Duties) - native copy of
// frontend/src/app/dashboard/organization/access-risk/page.tsx. The ruleset
// is coded on the server; this page reports who / which role violates it and
// the mitigations that were accepted on assignment.

const _riskLabels = {'high': 'High', 'medium': 'Medium'};
const _riskColors = {'high': Color(0xFFDC2626), 'medium': Color(0xFFF59E0B)};
const _tabs = [
  ('users', 'Users in conflict'),
  ('roles', 'Roles in conflict'),
  ('mitigations', 'Mitigations'),
  ('rules', 'Ruleset'),
];

Widget _risk(Object? r) =>
    StatusBadge(_riskLabels[str(r)] ?? humanize(r), color: _riskColors[str(r)] ?? const Color(0xFF78716C));

class OrgAccessRiskTab extends StatefulWidget {
  const OrgAccessRiskTab({super.key});

  @override
  State<OrgAccessRiskTab> createState() => _OrgAccessRiskTabState();
}

class _OrgAccessRiskTabState extends State<OrgAccessRiskTab> {
  String _tab = 'users';
  Json? _report;
  List<Json> _rules = [];
  List<Json> _mitigations = [];
  Json? _registry;
  String _error = '';
  bool _highOnly = false;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    setState(() => _error = '');
    try {
      final r = jsonMap(await Api.get('/organization/grc/sod/report'));
      if (mounted) setState(() => _report = r);
    } catch (e) {
      if (mounted) setState(() => _error = ApiClient.describe(e));
    }
    try {
      final r = (await Api.list('/organization/grc/sod/rules')).rows;
      if (mounted) setState(() => _rules = r);
    } catch (_) {}
    try {
      final m = (await Api.list('/organization/grc/sod/mitigations')).rows;
      if (mounted) setState(() => _mitigations = m);
    } catch (_) {}
    if (_registry == null) {
      try {
        final reg = await loadPermissionRegistry();
        if (mounted) setState(() => _registry = reg);
      } catch (_) {}
    }
  }

  String _words(Object? ids) =>
      (ids is List ? ids : const []).map((p) => permissionWords(_registry, str(p))).join('; ');

  Future<void> _withdraw(Json m) async {
    final ok = await confirmDialog(context,
        title: 'Withdraw this mitigation?',
        message: "${str(m['user_name'])}'s ${str(m['rule_id'])} conflict will show as unmitigated again.",
        confirmLabel: 'Withdraw',
        danger: true);
    if (!ok || !mounted) return;
    final done = await runAction(context, () => Api.delete('/organization/grc/sod/mitigations/${m['id']}'));
    if (done) _load();
  }

  @override
  Widget build(BuildContext context) {
    final users = jsonList(_report?['users']);
    final roles = jsonList(_report?['roles']);
    final unmitigatedHigh = users
        .where((u) => jsonList(u['conflicts']).any((c) => c['risk'] == 'high' && c['mitigation'] == null))
        .length;
    final userConflicts = users.fold<int>(0, (n, u) => n + jsonList(u['conflicts']).length);
    final roleConflicts = roles.fold<int>(0, (n, r) => n + jsonList(r['conflicts']).length);
    final count = switch (_tab) {
      'users' => userConflicts,
      'roles' => roleConflicts,
      'mitigations' => _mitigations.length,
      _ => _rules.length,
    };

    return RefreshIndicator(
      onRefresh: _load,
      child: ListView(
        padding: const EdgeInsets.only(bottom: 32),
        children: [
          PageHeader('Access Risk (Segregation of Duties)',
              subtitle: 'Who holds two duties that should be split between people. Assigning a high-risk conflict on '
                  'the Users page needs a mitigation reason.'
                  '${_report != null ? ' ${_report!['admins_excluded'] ?? 0} admin account(s) hold everything by design and are not listed.' : ''}'),
          if (_error.isNotEmpty) Padding(padding: const EdgeInsets.fromLTRB(16, 0, 16, 12), child: ErrorBanner(_error)),
          Padding(
            padding: const EdgeInsets.fromLTRB(16, 0, 16, 12),
            child: GridView.count(
              crossAxisCount: 2,
              shrinkWrap: true,
              physics: const NeverScrollableScrollPhysics(),
              mainAxisSpacing: 10,
              crossAxisSpacing: 10,
              childAspectRatio: 2.1,
              children: [
                _stat('Users in conflict', _report == null ? '—' : '${users.length}', () => _go('users', false)),
                _stat('Unmitigated high risk', _report == null ? '—' : '$unmitigatedHigh', () => _go('users', !_highOnly)),
                _stat('Roles in conflict', _report == null ? '—' : '${roles.length}', () => _go('roles', false)),
                _stat('Rules', '${_rules.length}', () => _go('rules', false)),
              ],
            ),
          ),
          SizedBox(
            height: 44,
            child: ListView(
              scrollDirection: Axis.horizontal,
              padding: const EdgeInsets.symmetric(horizontal: 16),
              children: [
                for (final (k, label) in _tabs)
                  CountChip(label, k == _tab ? count : null, selected: _tab == k, onTap: () => _go(k, false)),
              ],
            ),
          ),
          const SizedBox(height: 8),
          if (_report == null && _error.isEmpty) const LoadingView(),
          ..._body(users, roles),
        ],
      ),
    );
  }

  void _go(String tab, bool highOnly) => setState(() {
        _tab = tab;
        _highOnly = highOnly;
      });

  Widget _stat(String label, String value, VoidCallback onTap) => Material(
        color: Colors.white,
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(14), side: const BorderSide(color: Brand.border)),
        child: InkWell(
          borderRadius: BorderRadius.circular(14),
          onTap: onTap,
          child: Padding(
            padding: const EdgeInsets.all(12),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              mainAxisAlignment: MainAxisAlignment.center,
              children: [
                Text(label.toUpperCase(),
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: const TextStyle(fontSize: 10.5, fontWeight: FontWeight.w700, color: Brand.muted)),
                Text(value, style: const TextStyle(fontSize: 22, fontWeight: FontWeight.w800, color: Brand.heading)),
              ],
            ),
          ),
        ),
      );

  List<Widget> _body(List<Json> users, List<Json> roles) {
    switch (_tab) {
      case 'users':
        final cards = <Widget>[];
        for (final u in users) {
          var conflicts = jsonList(u['conflicts']);
          if (_highOnly) conflicts = conflicts.where((c) => c['risk'] == 'high' && c['mitigation'] == null).toList();
          for (final c in conflicts) {
            final m = c['mitigation'] is Map ? jsonMap(c['mitigation']) : null;
            cards.add(RecordCard(
              title: txt(u['name']),
              subtitle: str(u['department']).isNotEmpty ? str(u['department']) : str(u['email']),
              trailing: _risk(c['risk']),
              meta: [
                ('Rule', '${str(c['rule_id'])} ${str(c['title'])}'),
                ('Why', txt(c['why'])),
                (str(c['side_a_label']), _words(c['side_a_held'])),
                (str(c['side_b_label']), _words(c['side_b_held'])),
                (
                  'Mitigation',
                  m == null
                      ? 'None'
                      : '${str(m['reason'])} — by ${txt(m['mitigated_by_name'])}'
                          '${str(m['valid_to']).isNotEmpty ? ', until ${fmtDate(m['valid_to'])}' : ''}'
                ),
              ],
              onTap: () {
                final id = asInt(u['user_id']);
                if (id != null) openScreen(context, UserDetailScreen(userId: id, name: str(u['name'])));
              },
            ));
          }
        }
        if (_report != null && cards.isEmpty) {
          return [
            EmptyView(_highOnly ? 'No unmitigated high-risk conflict.' : 'No user holds conflicting duties.')
          ];
        }
        return cards;
      case 'roles':
        final cards = <Widget>[];
        for (final r in roles) {
          for (final c in jsonList(r['conflicts'])) {
            cards.add(RecordCard(
              title: txt(r['name']),
              subtitle: r['is_system'] == true ? 'BUILT-IN' : null,
              trailing: _risk(c['risk']),
              meta: [
                ('Rule', '${str(c['rule_id'])} ${str(c['title'])}'),
                ('Grants both', _words([...(c['side_a_held'] as List? ?? []), ...(c['side_b_held'] as List? ?? [])])),
              ],
              onTap: () {
                final id = asInt(r['role_id']);
                if (id != null) openScreen(context, RoleDetailScreen(roleId: id));
              },
            ));
          }
        }
        if (_report != null && cards.isEmpty) {
          return const [EmptyView('No role on its own combines conflicting duties.')];
        }
        return cards;
      case 'mitigations':
        if (_mitigations.isEmpty) return const [EmptyView('No SoD risk has been accepted yet.')];
        return [
          for (final m in _mitigations)
            Opacity(
              opacity: m['active'] == false ? 0.55 : 1,
              child: RecordCard(
                title: txt(m['user_name']),
                subtitle: '${str(m['rule_id'])} ${str(m['rule_title'])}',
                meta: [
                  ('Mitigating control', txt(m['reason'])),
                  ('Valid to', str(m['valid_to']).isEmpty ? 'No end date' : fmtDate(m['valid_to'])),
                  ('Accepted by', '${txt(m['mitigated_by_name'])} · ${fmtDate(m['created_at'])}'),
                ],
                trailing: orgCan('grc', 'edit')
                    ? TextButton(
                        onPressed: () => _withdraw(m),
                        style: TextButton.styleFrom(foregroundColor: Brand.danger),
                        child: const Text('Withdraw'))
                    : null,
              ),
            ),
        ];
      default:
        if (_rules.isEmpty) return const [EmptyView('No rules.')];
        return [
          for (final r in _rules)
            RecordCard(
              code: str(r['rule_id']),
              title: txt(r['title']),
              subtitle: str(r['why']),
              trailing: _risk(r['risk']),
              meta: [
                (str(r['side_a_label']), _words(r['side_a'])),
                (str(r['side_b_label']), _words(r['side_b'])),
              ],
            ),
        ];
    }
  }
}
