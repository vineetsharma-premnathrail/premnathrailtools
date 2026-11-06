import 'package:flutter/material.dart';

import '../../api/api.dart';
import '../../modules.dart';
import '../../theme.dart';
import '../../ui/app_frame.dart';
import '../../ui/files.dart';
import '../../ui/form.dart';
import '../../ui/format.dart';
import '../../ui/perms.dart';
import '../../ui/widgets.dart';
import 'department_work.dart';
import 'machine_form.dart';
import 'machine_screen.dart';
import 'pm_common.dart';
import 'project_plan.dart';
import 'project_workspace.dart';

/// Project Management - native copy of frontend/src/app/dashboard/projects/
/// (ProjectsNav: Dashboard, All Projects, Department Board, Department Work,
/// My Tasks).
class ProjectsModuleHome extends StatelessWidget {
  const ProjectsModuleHome({super.key, required this.module});
  final ErpModule module;

  @override
  Widget build(BuildContext context) {
    final hasPm = Perm.hasApp('projects');
    return ModuleScaffold(module: module, tabs: [
      ModuleTab(
          label: 'Dashboard',
          icon: Icons.dashboard_outlined,
          visible: hasPm && PmPerm.tabAllowed('dashboard'),
          builder: (_) => const PmDashboardTab()),
      ModuleTab(
          label: 'All Projects',
          icon: Icons.folder_copy_outlined,
          visible: hasPm && PmPerm.tabAllowed('all_projects'),
          builder: (_) => const AllProjectsView()),
      ModuleTab(
          label: 'Department Board',
          icon: Icons.bar_chart_rounded,
          visible: hasPm && PmPerm.tabAllowed('department_board'),
          builder: (_) => const DepartmentBoardTab()),
      ModuleTab(
          label: 'Department Work',
          icon: Icons.groups_outlined,
          visible: PmPerm.tabAllowed('department_work'),
          builder: (_) => const DepartmentWorkTab()),
      ModuleTab(
          label: 'My Tasks',
          icon: Icons.check_box_outlined,
          visible: PmPerm.tabAllowed('my_tasks') || PmPerm.tabAllowed('department_work'),
          builder: (_) => const MyTasksTab()),
    ]);
  }
}

Future<void> openProject(BuildContext context, Json p) =>
    Navigator.of(context).push(MaterialPageRoute(builder: (_) => ProjectWorkspaceScreen(projectId: i(p['id'])!, title: s(p['project_code']))));

// ── Dashboard ───────────────────────────────────────────────────────────────

class PmDashboardTab extends StatelessWidget {
  const PmDashboardTab({super.key});

  @override
  Widget build(BuildContext context) {
    return ApiLoader<Json>(
      load: () async => obj(await Api.get('/projects/dashboard')) ?? {},
      builder: (ctx, d, reload) {
        final today = todayIso();
        final in30 = apiDate(DateTime.now().add(const Duration(days: 30)));
        final live = rowsOf(d['projects'])
          ..sort((a, c) {
            final x = (s(a['target_handover_date']) ?? '9999').compareTo(s(c['target_handover_date']) ?? '9999');
            return x != 0 ? x : txt(a['project_code']).compareTo(txt(c['project_code']));
          });
        bool late(Json p) => s(p['target_handover_date']) != null && s(p['target_handover_date'])!.compareTo(today) < 0;
        final overdue = live.where(late).length;
        final soon = live
            .where((p) =>
                s(p['target_handover_date']) != null &&
                s(p['target_handover_date'])!.compareTo(today) >= 0 &&
                s(p['target_handover_date'])!.compareTo(in30) <= 0)
            .length;
        void openAll(String? due) => openScreen(
            ctx,
            SubPage(title: 'All Projects', body: AllProjectsView(due: due)));
        return ListView(padding: const EdgeInsets.only(bottom: 32), children: [
          const PageHeader('Projects Dashboard', subtitle: 'Every open project, nearest closing date first.'),
          Padding(
            padding: const EdgeInsets.symmetric(horizontal: 16),
            child: Column(children: [
              StatTile(label: 'OPEN PROJECTS', value: live.length, onTap: () => openAll(null)),
              const SizedBox(height: 8),
              StatTile(label: 'CLOSING IN NEXT 30 DAYS', value: soon, color: hx('#b45309'), onTap: () => openAll('soon')),
              const SizedBox(height: 8),
              StatTile(label: 'CLOSING DATE PASSED', value: overdue, color: hx('#dc2626'), onTap: () => openAll('passed')),
            ]),
          ),
          GroupTitle('Open projects (${live.length})'),
          if (live.isEmpty) const MutedText('No open projects right now — new ones are started from All Projects › + Create Project.'),
          for (final p in live)
            RecordCard(
              code: s(p['project_code']),
              title: txt(p['name']),
              subtitle: s(p['client_name']),
              trailing: Pill.of(s(p['status']), projectLabels, projectHex),
              meta: [
                ('Project manager', txt(p['project_manager_name'])),
                ('Closing date', '${fmtDate(p['target_handover_date'])}${late(p) ? ' · passed' : ''}'),
              ],
              onTap: () => openProject(ctx, p).then((_) => reload()),
            ),
        ]);
      },
    );
  }
}

// ── All Projects ────────────────────────────────────────────────────────────

/// PEW number first, then letter suffixes (A, B ...) before numeric ones; non-PEW codes last.
int compareCode(String a, String b) {
  (int, String) key(String v) {
    final m = RegExp(r'^PEW-(\d+)-?(.*)$', caseSensitive: false).firstMatch(v.trim());
    return m == null ? (1 << 62, v.trim()) : (int.parse(m.group(1)!), m.group(2)!.toUpperCase());
  }

  final ka = key(a), kb = key(b);
  if (ka.$1 != kb.$1) return ka.$1.compareTo(kb.$1);
  if (ka.$2 == kb.$2) return 0;
  if (ka.$2.isEmpty) return -1;
  if (kb.$2.isEmpty) return 1;
  final ad = RegExp(r'^\d').hasMatch(ka.$2), bd = RegExp(r'^\d').hasMatch(kb.$2);
  if (ad != bd) return ad ? 1 : -1;
  final na = int.tryParse(ka.$2), nb = int.tryParse(kb.$2);
  if (na != null && nb != null) return na.compareTo(nb);
  return ka.$2.toLowerCase().compareTo(kb.$2.toLowerCase());
}

class AllProjectsView extends StatefulWidget {
  const AllProjectsView({super.key, this.due});

  /// 'soon' | 'passed' - from the Dashboard counters.
  final String? due;

  @override
  State<AllProjectsView> createState() => _AllProjectsViewState();
}

class _AllProjectsViewState extends State<AllProjectsView> {
  List<Json> _projects = [];
  List<Json> _machines = [];
  bool _loading = true;
  Object? _error;
  bool _canCreate = false;
  String? _status;
  String? _stage;
  bool _activeScope = false;
  String _search = '';
  late String? _due = widget.due;

  bool get _canCurrent => Perm.can('projects', 'all_projects', 'view');
  final _vis = PmVis('projects:all_projects');

  @override
  void initState() {
    super.initState();
    _load();
    Api.get('/projects/meta').then((m) {
      if (mounted) setState(() => _canCreate = b(obj(m)?['can_create']));
    }).catchError((Object _) {});
  }

  Future<void> _load() async {
    setState(() => _loading = true);
    try {
      final r = await Future.wait([
        _canCurrent ? Api.get('/projects') : Future.value(<dynamic>[]),
        _canCurrent ? Api.get('/erp/projects', query: {'limit': 10000}) : Future.value(<dynamic>[]),
      ]);
      if (!mounted) return;
      setState(() {
        _projects = ApiPage.from(r[0]).rows;
        _machines = ApiPage.from(r[1]).rows;
        _error = null;
        _loading = false;
      });
    } catch (e) {
      if (mounted) {
        setState(() {
          _error = e;
          _loading = false;
        });
      }
    }
  }

  List<(bool, String, Json)> get _allRows {
    final out = <(bool, String, Json)>[
      for (final p in _projects) (true, txt(p['project_code']), p),
      for (final m in _machines)
        if (!(m['pm_project_id'] != null && _canCurrent)) (false, txt(m['serial_number']), m),
    ];
    out.sort((a, c) => compareCode(a.$2, c.$2));
    return out;
  }

  String _stageOf((bool, String, Json) r) => s(r.$3['lifecycle_stage']) ?? 'planned';

  void _pickStage(String k, {bool onlyActive = false}) {
    final same = _stage == k && _activeScope == onlyActive;
    setState(() {
      _stage = same ? null : k;
      _activeScope = !same && onlyActive;
    });
  }

  @override
  Widget build(BuildContext context) {
    final all = _allRows;
    final byStage = <String, int>{};
    for (final r in all) {
      byStage[_stageOf(r)] = (byStage[_stageOf(r)] ?? 0) + 1;
    }
    final breakdown = [for (final k in lifecycleOrder) if ((byStage[k] ?? 0) > 0) (k, byStage[k]!)];
    final active = all.where((r) => _stageOf(r) != 'closed').length;
    final today = todayIso();
    final in30 = apiDate(DateTime.now().add(const Duration(days: 30)));
    final q = _search.toLowerCase();
    bool hit(List<Object?> parts) => q.isEmpty || parts.whereType<Object>().join(' ').toLowerCase().contains(q);
    bool stageOk(String st) => (_stage == null || st == _stage) && (!_activeScope || st != 'closed');
    final rows = all.where((r) {
      final x = r.$3;
      if (r.$1) {
        if (_status != null && s(x['status']) != _status) return false;
        if (!stageOk(_stageOf(r)) || !hit([x['project_code'], x['name'], x['client_name'], x['project_manager_name']])) return false;
        final hd = s(x['target_handover_date']);
        if (_due == 'passed' && !(hd != null && hd.compareTo(today) < 0)) return false;
        if (_due == 'soon' && !(hd != null && hd.compareTo(today) >= 0 && hd.compareTo(in30) <= 0)) return false;
        return true;
      }
      if (_status != null || _due != null) return false;
      return stageOk(_stageOf(r)) && hit([x['serial_number'], x['model_name'], x['client_company'], x['site_name'], x['machine_type']]);
    }).toList();
    final filtered = _search.isNotEmpty || _status != null || _stage != null || _activeScope;
    final canExport = _canCurrent && Perm.can('projects', 'all_projects', 'export');
    final canImport = _canCurrent && Perm.can('projects', 'all_projects', 'import') && PmPerm.erp('project_create');
    final isAll = _stage == null && !_activeScope;

    final header = <Widget>[
      PageHeader('All Projects', subtitle: 'Project Management', actions: [
        if (canExport || canImport)
          PopupMenuButton<String>(
            tooltip: 'Export / Import',
            onSelected: (_) => runAction(context, () => Files.openInPortal('/dashboard/projects/all')),
            itemBuilder: (_) => [
              if (canExport) const PopupMenuItem(value: 'export', child: Text('Export (opens the portal)')),
              if (canImport) const PopupMenuItem(value: 'import', child: Text('Import (opens the portal)')),
            ],
          ),
      ]),
      if (_error != null) Padding(padding: const EdgeInsets.symmetric(horizontal: 16), child: ErrorBanner(ApiClient.describe(_error!))),
      if (_due == 'soon' || _due == 'passed')
        Padding(
          padding: const EdgeInsets.symmetric(horizontal: 16),
          child: Row(children: [
            Expanded(
                child: Text('Showing projects ${_due == 'soon' ? 'closing in the next 30 days' : 'whose closing date has passed'}.',
                    style: const TextStyle(fontSize: 13, color: Color(0xFF475569)))),
            TextButton(onPressed: () => setState(() => _due = null), child: const Text('Show all projects')),
          ]),
        ),
      SizedBox(
        height: 46,
        child: ListView(scrollDirection: Axis.horizontal, padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 4), children: [
          CountChip('Projects', all.length, color: hx('#ea580c'), selected: isAll, onTap: () => setState(() {
                _stage = null;
                _activeScope = false;
              })),
          CountChip('Active', active, color: hx('#ca8a04'), selected: _activeScope && _stage == null, onTap: () => setState(() {
                final same = _activeScope && _stage == null;
                _activeScope = !same;
                _stage = null;
              })),
          CountChip('Dispatched', byStage['dispatched'] ?? 0,
              color: hx(lifecycleHex['dispatched']!), selected: _stage == 'dispatched' && !_activeScope, onTap: () => _pickStage('dispatched')),
          CountChip('Closed / Delivered', byStage['closed'] ?? 0,
              color: hx(lifecycleHex['closed']!), selected: _stage == 'closed', onTap: () => _pickStage('closed')),
        ]),
      ),
      if (!_loading)
        _StageBars(
          title: 'Projects by Stage',
          rows: breakdown,
          empty: 'No projects yet.',
          isActive: (k) => _stage == k && !_activeScope,
          onTap: (k) => _pickStage(k),
        ),
      if (!_loading)
        _StageBars(
          title: 'Active Projects Breakdown',
          rows: breakdown.where((x) => x.$1 != 'closed').toList(),
          empty: 'No active projects.',
          isActive: (k) => _stage == k && _activeScope,
          onTap: (k) => _pickStage(k, onlyActive: true),
        ),
      Padding(
        padding: const EdgeInsets.fromLTRB(16, 4, 16, 8),
        child: SearchField(hint: 'Search project number, name, client, model or site…', onChanged: (v) => setState(() => _search = v.trim())),
      ),
      Padding(
        padding: const EdgeInsets.fromLTRB(16, 0, 16, 8),
        child: Row(children: [
          if (_canCurrent)
            Expanded(
              child: AppSelect<String>(
                label: 'All statuses',
                value: _status,
                options: [for (final e in projectLabels.entries) Option(e.key, e.value)],
                onChanged: (o) => setState(() => _status = o?.value),
              ),
            ),
          if (_canCurrent) const SizedBox(width: 8),
          Expanded(
            child: AppSelect<String>(
              label: 'All stages',
              value: _stage,
              options: [for (final k in lifecycleOrder) Option(k, lifecycleLabels[k]!)],
              onChanged: (o) => setState(() {
                _stage = o?.value;
                _activeScope = false;
              }),
            ),
          ),
        ]),
      ),
      if (!_loading) Padding(padding: const EdgeInsets.fromLTRB(16, 0, 16, 6), child: Text('${rows.length} shown', style: const TextStyle(fontSize: 12, color: Brand.muted))),
    ];

    final body = RefreshIndicator(
      onRefresh: _load,
      child: ListView.builder(
        padding: const EdgeInsets.only(bottom: 96),
        itemCount: header.length + (_loading || rows.isEmpty ? 1 : rows.length),
        itemBuilder: (ctx, k) {
          if (k < header.length) return header[k];
          if (_loading) return const LoadingView();
          if (rows.isEmpty) {
            return EmptyView(filtered || _due != null
                ? 'No project matches this search or filter — clear it to see every project.'
                : 'No projects yet — use + Create Project to start one.');
          }
          return _row(ctx, rows[k - header.length]);
        },
      ),
    );
    return Scaffold(
      backgroundColor: Colors.transparent,
      body: body,
      floatingActionButton: _canCreate && _canCurrent
          ? CreateFab(
              label: 'Create Project',
              onPressed: () async {
                final created = await openNewProjectForm(context);
                if (created == null || !context.mounted) return;
                _load();
                if (i(created['id']) != null) openProject(context, created);
              })
          : null,
    );
  }

  Widget _row(BuildContext context, (bool, String, Json) r) {
    final x = r.$3;
    bool col(String k) => _vis.showColumn('all_projects', k);
    if (r.$1) {
      return RecordCard(
        code: s(x['project_code']),
        title: txt(x['name']),
        subtitle: col('client') ? s(x['client_name']) : null,
        trailing: StagePills(stage: s(x['lifecycle_stage']), label: s(x['lifecycle_stage_label']), status: s(x['status'])),
        meta: [
          if (col('project_manager')) ('Project manager', txt(x['project_manager_name'])),
          if (col('closing_dispatch')) ('Closing / Dispatch', s(x['target_handover_date']) == null ? '—' : fmtDate(x['target_handover_date'])),
        ],
        onTap: () => openProject(context, x).then((_) => _load()),
      );
    }
    final st = s(x['lifecycle_stage']) ?? 'planned';
    return RecordCard(
      code: s(x['serial_number']),
      title: s(x['model_name']) ?? '—',
      subtitle: col('client') ? s(x['client_company']) : null,
      trailing: Pill(s(x['lifecycle_stage_label']) ?? lifecycleLabels[st] ?? '—', hx(lifecycleHex[st] ?? '#64748b')),
      meta: [
        if (col('site')) ('Site', txt(x['site_name'])),
        if (col('closing_dispatch')) ('Closing / Dispatch', s(x['delivery_date']) == null ? '—' : fmtDate(x['delivery_date'])),
      ],
      onTap: () => openScreen(context, MachineScreen(machineId: i(x['id'])!, title: s(x['serial_number']))),
    );
  }
}

/// Clickable stage counts (the portal's bar / pie charts): tap filters the list.
class _StageBars extends StatelessWidget {
  const _StageBars({required this.title, required this.rows, required this.empty, required this.isActive, required this.onTap});
  final String title;
  final List<(String, int)> rows;
  final String empty;
  final bool Function(String) isActive;
  final ValueChanged<String> onTap;

  @override
  Widget build(BuildContext context) {
    final max = rows.fold<int>(0, (a, r) => r.$2 > a ? r.$2 : a);
    return DetailSection(title, children: [
      if (rows.isEmpty) Text(empty, style: const TextStyle(fontSize: 13, color: Brand.muted)),
      for (final r in rows)
        InkWell(
          onTap: () => onTap(r.$1),
          borderRadius: BorderRadius.circular(8),
          child: Container(
            padding: const EdgeInsets.symmetric(vertical: 5, horizontal: 4),
            decoration: BoxDecoration(
                color: isActive(r.$1) ? hx(lifecycleHex[r.$1]!).withValues(alpha: 0.1) : null, borderRadius: BorderRadius.circular(8)),
            child: Row(children: [
              SizedBox(width: 120, child: Text(lifecycleLabels[r.$1] ?? r.$1, style: const TextStyle(fontSize: 12.5))),
              Expanded(
                child: ClipRRect(
                  borderRadius: BorderRadius.circular(4),
                  child: LinearProgressIndicator(
                      value: max == 0 ? 0 : r.$2 / max,
                      minHeight: 10,
                      color: hx(lifecycleHex[r.$1]!),
                      backgroundColor: const Color(0xFFF1F5F9)),
                ),
              ),
              SizedBox(width: 36, child: Text('${r.$2}', textAlign: TextAlign.right, style: const TextStyle(fontWeight: FontWeight.w700))),
            ]),
          ),
        ),
    ]);
  }
}

// ── Department Board ────────────────────────────────────────────────────────

class DepartmentBoardTab extends StatelessWidget {
  const DepartmentBoardTab({super.key});

  @override
  Widget build(BuildContext context) {
    return ApiLoader<Json>(
      load: () async => obj(await Api.get('/projects/board')) ?? {},
      builder: (ctx, board, reload) {
        final depts = rowsOf(board['departments']);
        final rows = rowsOf(board['rows']);
        return ListView(padding: const EdgeInsets.only(bottom: 32), children: [
          const PageHeader('Department Board',
              subtitle: 'Every live project against every department — red border means overdue, amber means at risk.'),
          if (rows.isEmpty) const MutedText('No live projects.'),
          for (final r in rows)
            Builder(builder: (_) {
              final p = obj(r['project']) ?? {};
              final cells = obj(r['cells']) ?? {};
              return DetailSection(
                '${p['project_code']}',
                action: Pill.of(s(p['status']), projectLabels, projectHex),
                children: [
                  InkWell(
                    onTap: () => openProject(ctx, p).then((_) => reload()),
                    child: Text(txt(p['name']), style: TextStyle(fontSize: 13, color: hx('#2563eb'))),
                  ),
                  const SizedBox(height: 6),
                  for (final d in depts)
                    InfoLine(
                      txt(d['name']),
                      rowsOf(cells['${d['id']}']).isEmpty
                          ? const Text('—', style: TextStyle(color: Brand.muted))
                          : Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                              for (final c in rowsOf(cells['${d['id']}'])) _cell(ctx, c),
                            ]),
                    ),
                ],
              );
            }),
        ]);
      },
    );
  }

  Widget _cell(BuildContext context, Json c) {
    final color = hx(milestoneHex[s(c['status'])] ?? '#64748b');
    final border = b(c['is_overdue']) ? hx('#dc2626') : b(c['is_at_risk']) ? hx('#f59e0b') : color.withValues(alpha: 0.2);
    return InkWell(
      onTap: () => openScreen(context, MilestoneWorkspaceScreen(milestoneId: i(c['id'])!)),
      child: Container(
        width: double.infinity,
        margin: const EdgeInsets.only(bottom: 4),
        padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 6),
        decoration: BoxDecoration(
            color: color.withValues(alpha: 0.08), borderRadius: BorderRadius.circular(8), border: Border.all(color: border, width: 1.5)),
        child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          Text('${milestoneLabels[s(c['status'])] ?? c['status']}${s(c['status']) != 'achieved' ? ' · ${c['progress_percent'] ?? 0}%' : ''}',
              style: TextStyle(fontSize: 11, fontWeight: FontWeight.w700, color: color)),
          Text(txt(c['title']), maxLines: 1, overflow: TextOverflow.ellipsis, style: const TextStyle(fontSize: 12)),
          Text(fmtDate(c['target_date']), style: TextStyle(fontSize: 11, color: b(c['is_overdue']) ? hx('#dc2626') : Brand.muted)),
        ]),
      ),
    );
  }
}
