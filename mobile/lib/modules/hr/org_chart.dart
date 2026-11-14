import 'package:flutter/material.dart';

import '../../api/api.dart';
import '../../theme.dart';
import '../../ui/form.dart';
import '../../ui/widgets.dart';
import 'employees.dart';
import 'hr_common.dart';

// Portal: app/dashboard/hr/org-chart/page.tsx — who reports to whom.

class OrgChartPage extends StatefulWidget {
  const OrgChartPage({super.key, this.openEmployees});
  final VoidCallback? openEmployees;

  @override
  State<OrgChartPage> createState() => _OrgChartPageState();
}

class _OrgChartPageState extends State<OrgChartPage> {
  List<Json> _nodes = [];
  List<int> _roots = [];
  Object? _error;
  bool _loading = true;
  String _q = '';
  String? _dept;
  final _open = <int>{};
  bool _showStandalone = false;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    try {
      final d = mapOf(await Api.get('/hr/employees/org-chart'));
      if (!mounted) return;
      setState(() {
        _nodes = rowsOf(d['nodes']);
        _roots = [for (final r in (d['root_ids'] is List ? d['root_ids'] as List : const [])) asInt(r) ?? 0];
        _open.addAll(_roots);
        _loading = false;
      });
    } catch (e) {
      if (mounted) setState(() { _error = e; _loading = false; });
    }
  }

  @override
  Widget build(BuildContext context) {
    if (_loading) return const LoadingView();
    if (_error != null) return ErrorView(_error!, onRetry: _load);
    final byId = {for (final n in _nodes) asInt(n['id']) ?? 0: n};
    final children = <int, List<Json>>{};
    for (final n in _nodes) {
      final m = asInt(n['manager_id']);
      if (m != null && byId.containsKey(m)) children.putIfAbsent(m, () => []).add(n);
    }
    for (final l in children.values) {
      l.sort((a, b) => str(a['name']).compareTo(str(b['name'])));
    }
    final desc = <int, int>{};
    int count(int id, Set<int> guard) {
      if (desc.containsKey(id)) return desc[id]!;
      if (!guard.add(id)) return 0;
      final t = (children[id] ?? const []).fold<int>(0, (s, c) => s + 1 + count(asInt(c['id']) ?? 0, guard));
      desc[id] = t;
      return t;
    }

    for (final n in _nodes) {
      count(asInt(n['id']) ?? 0, {});
    }
    final roots = [for (final r in _roots) if (byId[r] != null) byId[r]!];
    final leaders = roots.where((r) => (children[r['id']] ?? const []).isNotEmpty).toList()
      ..sort((a, b) => (desc[b['id']] ?? 0).compareTo(desc[a['id']] ?? 0));
    final standalone = roots.where((r) => (children[r['id']] ?? const []).isEmpty).toList()..sort((a, b) => str(a['name']).compareTo(str(b['name'])));
    final q = _q.trim().toLowerCase();
    final filtering = q.isNotEmpty || _dept != null;
    final matches = <int>{}, visible = <int>{};
    if (filtering) {
      for (final n in _nodes) {
        final hit = (q.isEmpty || [n['name'], n['designation'], n['department']].any((v) => str(v).toLowerCase().contains(q))) &&
            (_dept == null || n['department'] == _dept);
        if (!hit) continue;
        matches.add(asInt(n['id']) ?? 0);
        Json? cur = n;
        final guard = <int>{};
        while (cur != null && guard.add(asInt(cur['id']) ?? 0)) {
          visible.add(asInt(cur['id']) ?? 0);
          cur = byId[asInt(cur['manager_id'])];
        }
      }
    }
    final depts = _nodes.map((n) => str(n['department'])).where((d) => d.isNotEmpty).toSet().toList()..sort();
    final me = myUserId;
    Widget node(Json n, int depth, Set<int> guard) {
      final id = asInt(n['id']) ?? 0;
      if (guard.contains(id)) return const SizedBox.shrink();
      final g2 = {...guard, id};
      var kids = children[id] ?? const <Json>[];
      if (filtering) kids = kids.where((k) => visible.contains(k['id'])).toList();
      final all = (children[id] ?? const []).length;
      final isOpen = (filtering ? visible.contains(id) : _open.contains(id)) && kids.isNotEmpty;
      return Padding(
        padding: EdgeInsets.only(left: depth == 0 ? 16 : 14, right: depth == 0 ? 16 : 0),
        child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
          Card(
            color: filtering && matches.contains(id) ? Brand.primarySoft : null,
            margin: const EdgeInsets.only(bottom: 6),
            child: ListTile(
              dense: true,
              leading: IconButton(
                icon: Icon(all == 0 ? Icons.person_outline_rounded : (isOpen ? Icons.expand_more_rounded : Icons.chevron_right_rounded)),
                onPressed: all == 0 || filtering ? null : () => setState(() => _open.contains(id) ? _open.remove(id) : _open.add(id)),
              ),
              title: Text('${n['name']}${id == me ? '  (You)' : ''}', style: const TextStyle(fontWeight: FontWeight.w600)),
              subtitle: Text(joinNonEmpty([n['designation'], n['department'], n['branch']]).isEmpty ? '—' : joinNonEmpty([n['designation'], n['department'], n['branch']])),
              trailing: all > 0 ? HrPill('$all direct${(desc[id] ?? 0) > all ? ' · ${desc[id]} total' : ''}', '#475569') : null,
              onTap: isHrUser ? () => openScreen(context, EmployeeDetailScreen(userId: id)) : null,
            ),
          ),
          if (isOpen) for (final k in kids) node(k, depth + 1, g2),
        ]),
      );
    }

    final shownLeaders = filtering ? leaders.where((r) => visible.contains(r['id'])).toList() : leaders;
    final shownStandalone = filtering ? standalone.where((r) => visible.contains(r['id'])).toList() : standalone;
    return RefreshIndicator(
      onRefresh: _load,
      child: ListView(padding: const EdgeInsets.only(bottom: 88), children: [
        PageHeader('Org Chart',
            subtitle: "Who reports to whom, from each person's reporting manager.${_nodes.isEmpty ? '' : ' ${_nodes.length} people.'}",
            actions: [if (isHrUser && widget.openEmployees != null) headerButton('Manage Employees', widget.openEmployees, primary: false)]),
        Padding(padding: const EdgeInsets.fromLTRB(16, 0, 16, 8), child: SearchField(hint: 'Find a person, designation or department…', onChanged: (v) => setState(() => _q = v))),
        Padding(
          padding: const EdgeInsets.fromLTRB(16, 0, 16, 8),
          child: AppSelect<String>(label: 'All departments', value: _dept, options: [for (final d in depts) Option(d, d)], onChanged: (o) => setState(() => _dept = o?.value)),
        ),
        if (!filtering)
          padded(Wrap(spacing: 4, children: [
            LinkAction('Expand all', () => setState(() => _open.addAll(children.keys))),
            LinkAction('Collapse all', () => setState(_open.clear)),
          ]))
        else
          padded(HintText('${matches.length} match${matches.length == 1 ? '' : 'es'}')),
        if (_nodes.isEmpty) const EmptyView('No people to show yet.'),
        if (_nodes.isNotEmpty && shownLeaders.isEmpty && shownStandalone.isEmpty) const EmptyView('Nobody matches your search.'),
        if (_nodes.isNotEmpty && leaders.isEmpty && !filtering)
          padded(HintText('No reporting lines are set yet. ${isHrUser ? 'Set each person’s Reporting Manager on their HR profile to build the chart.' : 'HR sets reporting managers on employee profiles.'}')),
        for (final r in shownLeaders) node(r, 0, {}),
        if (shownStandalone.isNotEmpty) ...[
          BlockTitle('No reporting line (${shownStandalone.length})',
              trailing: filtering ? null : LinkAction(_showStandalone ? 'Hide' : 'Show', () => setState(() => _showStandalone = !_showStandalone))),
          padded(HintText('People with no reporting manager and no direct reports.${isHrUser ? ' Set their manager on the HR profile so their approvals route correctly.' : ''}')),
          if (_showStandalone || filtering) for (final n in shownStandalone) node(n, 0, {}),
        ],
      ]),
    );
  }
}