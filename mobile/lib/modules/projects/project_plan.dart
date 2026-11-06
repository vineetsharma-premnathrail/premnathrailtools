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
import 'pm_common.dart';

/// Project Plan & Milestones (frontend/src/components/projects/work/ProjectPlan.tsx).
/// With a project: the project's Milestones tab. Without: My Tasks - the
/// viewer's milestones across every project (Given to me / My tasks in
/// others' milestones / Milestones I gave). Milestone list → milestone screen
/// → task screen with tabs (the portal's table → tabbed split view).

const _palette = ['#2563eb', '#0284c7', '#16a34a', '#f59e0b', '#7c3aed', '#e11d48', '#0d9488'];
const msIcons = ['flag', 'target', 'star', 'gear', 'truck', 'box', 'check', 'calendar', 'clip', 'user'];
const _iconColor = {
  'flag': '#2563eb', 'target': '#e11d48', 'star': '#f59e0b', 'gear': '#0284c7', 'truck': '#ea580c',
  'box': '#7c3aed', 'check': '#16a34a', 'calendar': '#0d9488', 'clip': '#475569', 'user': '#db2777',
};
const _iconLabel = {
  'flag': 'Milestone', 'target': 'Goal', 'star': 'Key', 'gear': 'Engineering', 'truck': 'Dispatch',
  'box': 'Material', 'check': 'Approval', 'calendar': 'Event', 'clip': 'Documents', 'user': 'People',
};
const _iconData = {
  'flag': Icons.flag_outlined, 'target': Icons.gps_fixed_rounded, 'star': Icons.star_outline_rounded,
  'gear': Icons.settings_outlined, 'truck': Icons.local_shipping_outlined, 'box': Icons.inventory_2_outlined,
  'check': Icons.check_rounded, 'calendar': Icons.calendar_today_outlined, 'clip': Icons.attach_file_rounded,
  'user': Icons.person_outline_rounded,
};

Color msColor(Json m, int index) => hx(s(m['color']) ?? _palette[index % _palette.length]);
IconData msIcon(Json m) => _iconData[s(m['icon'])] ?? Icons.flag_outlined;

// Milestone status (todo / in_progress / blocked / done / cancelled).
const _msState = {
  'todo': ('Not Started', '#475569', '#f1f5f9'),
  'in_progress': ('In Progress', '#1d4ed8', '#dbeafe'),
  'blocked': ('On Hold', '#b45309', '#fef3c7'),
  'done': ('Achieved', '#15803d', '#dcfce7'),
  'cancelled': ('Cancelled', '#78716c', '#f5f5f4'),
};
const _taskState = {
  'completed': ('Completed', '#15803d', '#dcfce7'),
  'in_progress': ('In Progress', '#1d4ed8', '#dbeafe'),
  'pending': ('To Do', '#475569', '#f1f5f9'),
  'overdue': ('Overdue', '#be123c', '#ffe4e6'),
  'on_hold': ('On Hold', '#b45309', '#fef3c7'),
};
const _priority = {'standard': ('Standard', '#475569', '#f1f5f9'), 'urgent': ('Urgent', '#be123c', '#ffe4e6')};
const _subStatus = [('todo', 'To Do'), ('in_progress', 'In Progress'), ('on_hold', 'On Hold'), ('done', 'Done')];

Widget chip((String, String, String) st, {bool dot = false}) => Pill(st.$1, hx(st.$2), bg: hx(st.$3), dot: dot);
Widget msChip(Json m) => chip(_msState[s(m['status'])] ?? _msState['todo']!, dot: true);

List<Json> tasksOf(Json m) => rowsOf(m['subtasks']).where((x) => x['parent_id'] == null).toList();
List<Json> kidsOf(Json m, int id) => rowsOf(m['subtasks']).where((x) => i(x['parent_id']) == id).toList();
int msTotal(Json m) => i(m['tasks_total']) ?? tasksOf(m).length;
int msDone(Json m) => i(m['tasks_done']) ?? tasksOf(m).where((x) => s(x['status']) == 'done').length;
int msPercent(Json m) {
  if (s(m['status']) == 'done') return 100;
  final t = msTotal(m);
  return t == 0 ? 0 : (msDone(m) * 100 / t).round();
}

int taskPercent(Json m, Json t) {
  if (s(t['status']) == 'done') return 100;
  if (t['progress'] is num) return n(t['progress']).round();
  final k = kidsOf(m, i(t['id'])!);
  return k.isEmpty ? 0 : (k.where((x) => s(x['status']) == 'done').length * 100 / k.length).round();
}

String taskStateKey(Json m, Json t) {
  if (s(t['status']) == 'done') return 'completed';
  if (b(t['is_overdue'])) return 'overdue';
  if (s(t['status']) == 'on_hold') return 'on_hold';
  return s(t['status']) == 'in_progress' || kidsOf(m, i(t['id'])!).any((k) => s(k['status']) == 'done') ? 'in_progress' : 'pending';
}

/// Holds the milestones of one plan; every screen of the plan listens to it.
class PlanStore extends ChangeNotifier {
  PlanStore(this.project);
  final Json? project;
  bool includeClosed = false;
  List<Json> rows = [];
  bool loaded = false;
  Object? error;
  bool busy = false;

  bool get mineMode => project == null;

  Future<void> load() async {
    try {
      final d = project != null
          ? await Api.get('/projects/${project!['id']}/project-tasks')
          : await Api.get('/pm-ongoing/my', query: {'include_closed': includeClosed});
      rows = rowsOf(d);
      error = null;
    } catch (e) {
      error = e;
    }
    loaded = true;
    notifyListeners();
  }

  Json? byId(int id) {
    for (final r in rows) {
      if (i(r['id']) == id) return r;
    }
    return null;
  }

  void replace(Json m) {
    final idx = rows.indexWhere((x) => i(x['id']) == i(m['id']));
    if (idx >= 0) {
      rows[idx] = m;
    } else {
      rows.add(m);
    }
    notifyListeners();
  }

  void remove(int id) {
    rows.removeWhere((x) => i(x['id']) == id);
    notifyListeners();
  }

  /// Runs a call that returns the updated milestone; shows the server's reason on failure.
  Future<bool> run(BuildContext context, Future<dynamic> Function() fn) async {
    busy = true;
    notifyListeners();
    try {
      final d = obj(await fn());
      if (d != null && d['id'] != null) replace(d);
      return true;
    } catch (e) {
      if (context.mounted) showSnack(context, ApiClient.describe(e), error: true);
      return false;
    } finally {
      busy = false;
      notifyListeners();
    }
  }

  int? projectIdOf(Json m) => i(project?['id']) ?? i(m['project_id']);

  /// Timeline order: by expected date; cancelled ones last.
  List<Json> sorted(Iterable<Json> list) => list.toList()
    ..sort((a, c) {
      final ca = s(a['status']) == 'cancelled' ? 1 : 0, cc = s(c['status']) == 'cancelled' ? 1 : 0;
      if (ca != cc) return ca - cc;
      final d = (s(a['due_date']) ?? '9999').compareTo(s(c['due_date']) ?? '9999');
      return d != 0 ? d : (i(a['id']) ?? 0) - (i(c['id']) ?? 0);
    });
}

const _myViews = [
  ('given', 'Given to me', 'Milestones you are responsible for — split them into tasks and mark them achieved.'),
  ('subs', 'My tasks in others’ milestones', 'Milestones someone else gave, where a task is yours — open it to work your task.'),
  ('gave', 'Milestones I gave', 'Follow-up: who has each one, its tasks and progress.'),
];

bool _inView(String v, Json m) {
  switch (v) {
    case 'given':
      return b(m['mine']);
    case 'subs':
      return !b(m['mine']) && b(m['has_my_subtask']) && !b(m['given_by_me']);
    default:
      return b(m['given_by_me']) && !b(m['mine']);
  }
}

/// My Tasks tab: the plan without a project, in its own scroll.
class MyTasksTab extends StatelessWidget {
  const MyTasksTab({super.key});

  @override
  Widget build(BuildContext context) => const ProjectPlanView(project: null);
}

class ProjectPlanView extends StatefulWidget {
  const ProjectPlanView({super.key, required this.project});
  final Json? project;

  @override
  State<ProjectPlanView> createState() => _ProjectPlanViewState();
}

class _ProjectPlanViewState extends State<ProjectPlanView> {
  late final PlanStore _store = PlanStore(widget.project);
  String? _view;

  @override
  void initState() {
    super.initState();
    _store.load();
  }

  @override
  void dispose() {
    _store.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return ListenableBuilder(
      listenable: _store,
      builder: (ctx, _) {
        final content = _content(ctx);
        if (!_store.mineMode) return content;
        return RefreshIndicator(
          onRefresh: _store.load,
          child: ListView(padding: const EdgeInsets.only(bottom: 40), children: [content]),
        );
      },
    );
  }

  Widget _content(BuildContext context) {
    final st = _store;
    final p = widget.project;
    final counts = {for (final v in _myViews) v.$1: st.rows.where((m) => _inView(v.$1, m)).length};
    final view = _view ?? _myViews.firstWhere((v) => counts[v.$1]! > 0, orElse: () => _myViews.first).$1;
    final viewDef = _myViews.firstWhere((v) => v.$1 == view);
    final ms = st.sorted(st.mineMode ? st.rows.where((m) => _inView(view, m)) : st.rows);
    final live = ms.where((m) => s(m['status']) != 'cancelled').toList();
    final all = [for (final m in live) for (final t in tasksOf(m)) t];
    final overall = live.isEmpty ? 0 : (live.fold<int>(0, (a, m) => a + msPercent(m)) / live.length).round();
    final canAdd = p != null &&
        b(p['can_manage']) &&
        !['closed', 'cancelled'].contains(s(p['status'])) &&
        PmPerm.pmf('milestones', 'create');

    return Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
      Padding(
        padding: const EdgeInsets.fromLTRB(16, 12, 16, 4),
        child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          Text(p != null ? 'Project Plan & Milestones' : 'My Tasks',
              style: const TextStyle(fontSize: 22, fontWeight: FontWeight.w800, color: Brand.heading)),
          const SizedBox(height: 2),
          Text(
              p != null
                  ? '${p['project_code']} · ${p['name']} — ${live.length} milestone${live.length == 1 ? '' : 's'}'
                  : viewDef.$3,
              style: const TextStyle(fontSize: 13, color: Brand.muted)),
          if (ms.isNotEmpty) ...[
            const SizedBox(height: 8),
            Row(children: [
              const Text('Progress  ', style: TextStyle(fontSize: 12, fontWeight: FontWeight.w600, color: Brand.muted)),
              Expanded(child: ProgressBar(overall, color: hx('#2563eb'))),
            ]),
          ],
          if (canAdd) ...[
            const SizedBox(height: 10),
            SmallBtn('Add Milestone', icon: Icons.add_rounded, filled: true, color: hx('#2563eb'),
                onPressed: () => openMilestoneForm(context, st)),
          ],
        ]),
      ),
      if (st.mineMode) ...[
        SizedBox(
          height: 48,
          child: ListView(scrollDirection: Axis.horizontal, padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 6), children: [
            for (final v in _myViews)
              CountChip(v.$2, st.loaded ? counts[v.$1] : '…', selected: view == v.$1, onTap: () => setState(() => _view = v.$1)),
          ]),
        ),
        Padding(
          padding: const EdgeInsets.symmetric(horizontal: 4),
          child: CheckField(
            label: 'Show finished',
            value: st.includeClosed,
            onChanged: (v) {
              st.includeClosed = v;
              st.loaded = false;
              st.load();
              setState(() {});
            },
          ),
        ),
      ],
      if (st.error != null)
        Padding(padding: const EdgeInsets.all(16), child: ErrorView(st.error!, onRetry: st.load))
      else if (!st.loaded)
        const LoadingView()
      else if (ms.isEmpty)
        EmptyView(
            st.mineMode
                ? '${view == 'given' ? 'No milestone is with you.' : view == 'subs' ? 'No task of yours in anyone else’s milestone.' : 'You haven’t given any milestone that is still open.'}'
                    '${st.includeClosed ? '' : ' Tick “Show finished” to see finished ones.'}'
                : 'No milestones yet. Lay out the project as milestones — each with a responsible person and an expected date — then add tasks inside each one.',
            icon: Icons.flag_outlined)
      else ...[
        _Timeline(ms: ms, onOpen: (m) => _open(context, m)),
        for (var k = 0; k < ms.length; k++) _MilestoneCard(m: ms[k], n: k + 1, color: msColor(ms[k], k), showProject: st.mineMode, onOpen: () => _open(context, ms[k])),
        Padding(
          padding: const EdgeInsets.fromLTRB(16, 4, 16, 8),
          child: GridView.count(
            crossAxisCount: 2,
            shrinkWrap: true,
            physics: const NeverScrollableScrollPhysics(),
            childAspectRatio: 2.3,
            mainAxisSpacing: 8,
            crossAxisSpacing: 8,
            children: [
              StatTile(label: 'Total Tasks', value: all.length, icon: Icons.checklist_rounded, color: hx('#2563eb')),
              StatTile(label: 'Completed', value: all.where((t) => s(t['status']) == 'done').length, icon: Icons.check_rounded, color: hx('#16a34a')),
              StatTile(label: 'Pending', value: all.where((t) => s(t['status']) != 'done').length, icon: Icons.schedule_rounded, color: hx('#0284c7')),
              StatTile(
                  label: 'Overdue',
                  value: all.where((t) => s(t['status']) != 'done' && b(t['is_overdue'])).length,
                  icon: Icons.error_outline_rounded,
                  color: hx('#e11d48')),
            ],
          ),
        ),
      ],
    ]);
  }

  void _open(BuildContext context, Json m) {
    openScreen(context, MilestoneScreen(store: _store, msId: i(m['id'])!));
  }
}

class _Timeline extends StatelessWidget {
  const _Timeline({required this.ms, required this.onOpen});
  final List<Json> ms;
  final ValueChanged<Json> onOpen;

  @override
  Widget build(BuildContext context) {
    return SizedBox(
      height: 112,
      child: ListView.builder(
        scrollDirection: Axis.horizontal,
        padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
        itemCount: ms.length,
        itemBuilder: (ctx, k) {
          final m = ms[k];
          final c = msColor(m, k);
          final done = s(m['status']) == 'done';
          return Opacity(
            opacity: s(m['status']) == 'cancelled' ? 0.5 : 1,
            child: InkWell(
              onTap: () => onOpen(m),
              child: SizedBox(
                width: 150,
                child: Column(children: [
                  Container(
                    width: 138,
                    padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 6),
                    decoration: BoxDecoration(
                        color: Brand.background, borderRadius: BorderRadius.circular(10), border: Border.all(color: Brand.border)),
                    child: Column(children: [
                      Text(txt(m['title']),
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
                          style: const TextStyle(fontSize: 13, fontWeight: FontWeight.w700, color: Brand.heading)),
                      Text(fmtDate(m['due_date']),
                          style: TextStyle(fontSize: 12, color: b(m['is_overdue']) ? hx('#be123c') : Brand.body)),
                    ]),
                  ),
                  Container(height: 12, width: 2, color: c.withValues(alpha: 0.5)),
                  Row(children: [
                    Expanded(child: Container(height: 4, color: k == 0 ? Colors.transparent : c)),
                    done
                        ? CircleAvatar(radius: 11, backgroundColor: c, child: const Icon(Icons.check, size: 13, color: Colors.white))
                        : Transform.rotate(
                            angle: 0.785,
                            child: Container(width: 15, height: 15, decoration: BoxDecoration(color: c, borderRadius: BorderRadius.circular(3)))),
                    Expanded(child: Container(height: 4, color: k == ms.length - 1 ? Colors.transparent : c)),
                  ]),
                ]),
              ),
            ),
          );
        },
      ),
    );
  }
}

class _MilestoneCard extends StatelessWidget {
  const _MilestoneCard({required this.m, required this.n, required this.color, required this.onOpen, this.showProject = false});
  final Json m;
  final int n;
  final Color color;
  final VoidCallback onOpen;
  final bool showProject;

  @override
  Widget build(BuildContext context) {
    final ts = tasksOf(m);
    final pct = msPercent(m);
    return Padding(
      padding: const EdgeInsets.fromLTRB(16, 0, 16, 10),
      child: Opacity(
        opacity: s(m['status']) == 'cancelled' ? 0.6 : 1,
        child: Material(
          color: color.withValues(alpha: 0.06),
          shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16), side: BorderSide(color: color.withValues(alpha: 0.2))),
          child: InkWell(
            borderRadius: BorderRadius.circular(16),
            onTap: onOpen,
            child: Padding(
              padding: const EdgeInsets.all(14),
              child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
                  CircleAvatar(radius: 16, backgroundColor: color, child: Text('$n', style: const TextStyle(color: Colors.white, fontWeight: FontWeight.w700))),
                  const SizedBox(width: 10),
                  Expanded(
                    child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                      if (showProject)
                        Text('${txt(m['project_code'])}${s(m['project_name']) != null ? ' · ${m['project_name']}' : ''}',
                            style: TextStyle(fontSize: 11.5, fontWeight: FontWeight.w700, color: color)),
                      Text(txt(m['title']), style: const TextStyle(fontSize: 16, fontWeight: FontWeight.w700, color: Brand.heading)),
                      Text(
                          s(m['start_date']) != null ? '${fmtDate(m['start_date'])} → ${fmtDate(m['due_date'])}' : 'Due ${fmtDate(m['due_date'])}',
                          style: TextStyle(fontSize: 13, color: b(m['is_overdue']) ? hx('#be123c') : Brand.body)),
                    ]),
                  ),
                ]),
                const SizedBox(height: 8),
                Wrap(spacing: 6, children: [
                  msChip(m),
                  if (b(m['is_overdue'])) Pill(dueText(m['due_date']), hx('#be123c'), bg: hx('#ffe4e6')),
                ]),
                const SizedBox(height: 8),
                if (ts.isEmpty) const Text('No tasks yet — open to add tasks.', style: TextStyle(fontSize: 13, color: Brand.muted)),
                for (final t in ts.take(5))
                  Padding(
                    padding: const EdgeInsets.symmetric(vertical: 2),
                    child: Row(children: [
                      Icon(s(t['status']) == 'done' ? Icons.check_circle : Icons.radio_button_unchecked, size: 18, color: color),
                      const SizedBox(width: 8),
                      Expanded(child: Text(txt(t['title']), maxLines: 1, overflow: TextOverflow.ellipsis, style: const TextStyle(fontSize: 13.5))),
                    ]),
                  ),
                if (ts.length > 5) Text('+${ts.length - 5} more', style: TextStyle(fontSize: 12.5, color: color, fontWeight: FontWeight.w600)),
                const SizedBox(height: 8),
                ProgressBar(pct, color: color),
                const SizedBox(height: 8),
                Container(
                  padding: const EdgeInsets.all(10),
                  decoration: BoxDecoration(color: color.withValues(alpha: 0.12), borderRadius: BorderRadius.circular(12)),
                  child: Row(children: [
                    Icon(msIcon(m), size: 18, color: color),
                    const SizedBox(width: 10),
                    Expanded(
                      child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                        const Text('Responsible', style: TextStyle(fontSize: 12, fontWeight: FontWeight.w700)),
                        Text('${txt(m['assignee_name'])}${s(m['department_name']) != null ? ' · ${m['department_name']}' : ''}',
                            maxLines: 1, overflow: TextOverflow.ellipsis, style: const TextStyle(fontSize: 13)),
                      ]),
                    ),
                  ]),
                ),
              ]),
            ),
          ),
        ),
      ),
    );
  }
}

// ── Milestone screen (the portal's opened MilestonePanel) ───────────────────

class MilestoneScreen extends StatefulWidget {
  const MilestoneScreen({super.key, required this.store, required this.msId});
  final PlanStore store;
  final int msId;

  @override
  State<MilestoneScreen> createState() => _MilestoneScreenState();
}

class _MilestoneScreenState extends State<MilestoneScreen> {
  String _filter = 'all';
  String _q = '';

  @override
  Widget build(BuildContext context) {
    final st = widget.store;
    return ListenableBuilder(
      listenable: st,
      builder: (ctx, _) {
        final m = st.byId(widget.msId);
        if (m == null) {
          return const SubPage(title: 'Milestone', body: EmptyView('This milestone is no longer here — it was deleted or moved.'));
        }
        final ordered = st.sorted(st.rows);
        final idx = ordered.indexWhere((x) => i(x['id']) == widget.msId);
        final color = msColor(m, idx < 0 ? 0 : idx);
        final ts = tasksOf(m);
        final doneN = ts.where((x) => s(x['status']) == 'done').length;
        final open = ['todo', 'in_progress', 'blocked'].contains(s(m['status']));
        final mayAchieve = b(m['can_work']) && open && PmPerm.pmf('milestone_status', 'approve');
        final mayEdit = b(m['can_edit']) && PmPerm.pmf('milestones', 'edit');
        final mayReopen = b(m['can_edit']) && s(m['status']) == 'done' && PmPerm.pmf('milestone_status', 'edit');
        final mayCancel = b(m['can_edit']) && open && PmPerm.pmf('milestone_status', 'cancel');
        final shown = ts
            .where((x) =>
                (_filter == 'all' || (_filter == 'completed' ? s(x['status']) == 'done' : s(x['status']) != 'done')) &&
                (_q.isEmpty || txt(x['title']).toLowerCase().contains(_q.toLowerCase())))
            .toList();
        return SubPage(
          title: txt(m['title']),
          fab: b(m['can_plan']) ? CreateFab(label: 'Add Task', onPressed: () => openTaskForm(context, st, m)) : null,
          body: RefreshIndicator(
            onRefresh: st.load,
            child: ListView(padding: const EdgeInsets.only(bottom: 96), children: [
              Container(
                color: color.withValues(alpha: 0.06),
                padding: const EdgeInsets.all(16),
                child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                  Row(children: [
                    Container(
                      width: 40,
                      height: 40,
                      decoration: BoxDecoration(color: color, borderRadius: BorderRadius.circular(12)),
                      child: Icon(msIcon(m), color: Colors.white),
                    ),
                    const SizedBox(width: 12),
                    Expanded(
                      child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                        if (st.mineMode)
                          Text('${txt(m['project_code'])}${s(m['project_name']) != null ? ' · ${m['project_name']}' : ''}',
                              style: TextStyle(fontSize: 12, fontWeight: FontWeight.w700, color: color)),
                        Text(txt(m['title']), style: const TextStyle(fontSize: 19, fontWeight: FontWeight.w800, color: Brand.heading)),
                      ]),
                    ),
                    msChip(m),
                  ]),
                  const SizedBox(height: 8),
                  Text(
                      '${s(m['start_date']) != null ? '${fmtDate(m['start_date'])} → ${fmtDate(m['due_date'])}' : 'Expected by ${fmtDate(m['due_date'])}'}'
                      '  |  ${dueText(m['due_date'], done: s(m['status']) == 'done')}',
                      style: TextStyle(fontSize: 13, color: b(m['is_overdue']) ? hx('#be123c') : Brand.body)),
                  const SizedBox(height: 4),
                  Text('Responsible: ${txt(m['assignee_name'])}${s(m['department_name']) != null ? ' (${m['department_name']})' : ''}',
                      style: const TextStyle(fontSize: 13)),
                  Text('Given by ${txt(m['created_by_name'])}${s(m['created_at']) != null ? ' on ${fmtDate(m['created_at'])}' : ''}',
                      style: const TextStyle(fontSize: 13, color: Brand.muted)),
                  if (s(m['description']) != null)
                    Padding(padding: const EdgeInsets.only(top: 8), child: Text(txt(m['description']))),
                  if (s(m['status']) == 'blocked' && s(m['blocker_reason']) != null)
                    Text('On hold: ${m['blocker_reason']}', style: TextStyle(fontSize: 12.5, color: hx('#b45309'))),
                  if (s(m['status']) == 'cancelled' && s(m['cancel_reason']) != null)
                    Text('Cancelled: ${m['cancel_reason']}', style: const TextStyle(fontSize: 12.5, color: Brand.muted)),
                  if (open && s(m['reopen_reason']) != null)
                    Text('Reopened: ${m['reopen_reason']}', style: TextStyle(fontSize: 12.5, color: hx('#b45309'))),
                  const SizedBox(height: 10),
                  const Text('Milestone Progress', style: TextStyle(fontSize: 13, fontWeight: FontWeight.w700)),
                  const SizedBox(height: 4),
                  ProgressBar(msPercent(m), color: color, height: 10),
                  Text('${msDone(m)} / ${msTotal(m)} Tasks Completed', style: const TextStyle(fontSize: 12.5, color: Brand.muted)),
                ]),
              ),
              if (mayAchieve || mayEdit || mayReopen || mayCancel || b(m['can_delete']))
                Padding(
                  padding: const EdgeInsets.fromLTRB(16, 12, 16, 0),
                  child: Wrap(spacing: 8, runSpacing: 8, children: [
                    if (mayAchieve)
                      SmallBtn('Mark achieved', icon: Icons.check_rounded, color: hx('#15803d'), onPressed: st.busy
                          ? null
                          : () => st.run(context, () => Api.post('/pm-ongoing/tasks/${m['id']}/status', data: {'action': 'done'}))),
                    if (mayEdit)
                      SmallBtn('Edit milestone', icon: Icons.edit_outlined, onPressed: st.busy ? null : () => openMilestoneForm(context, st, m: m)),
                    if (mayReopen) SmallBtn('Reopen', color: hx('#b45309'), onPressed: st.busy ? null : () => _reason(context, m, 'reopen')),
                    if (mayCancel) SmallBtn('Cancel milestone', onPressed: st.busy ? null : () => _reason(context, m, 'cancel')),
                    if (b(m['can_delete']))
                      SmallBtn('Delete', icon: Icons.delete_outline_rounded, color: Brand.danger, onPressed: st.busy ? null : () => _delete(context, m)),
                  ]),
                ),
              Padding(
                padding: const EdgeInsets.fromLTRB(16, 16, 16, 4),
                child: Text('Tasks (${ts.length})', style: TextStyle(fontSize: 16, fontWeight: FontWeight.w700, color: color)),
              ),
              SizedBox(
                height: 46,
                child: ListView(scrollDirection: Axis.horizontal, padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 4), children: [
                  CountChip('All', '(${ts.length})', selected: _filter == 'all', color: color, onTap: () => setState(() => _filter = 'all')),
                  CountChip('Completed', '($doneN)', selected: _filter == 'completed', color: color, onTap: () => setState(() => _filter = _filter == 'completed' ? 'all' : 'completed')),
                  CountChip('Pending', '(${ts.length - doneN})', selected: _filter == 'pending', color: color, onTap: () => setState(() => _filter = _filter == 'pending' ? 'all' : 'pending')),
                ]),
              ),
              if (ts.isNotEmpty)
                Padding(
                  padding: const EdgeInsets.fromLTRB(16, 4, 16, 8),
                  child: SearchField(hint: 'Search tasks…', onChanged: (v) => setState(() => _q = v.trim())),
                ),
              if (ts.isEmpty)
                EmptyView(
                    msTotal(m) > 0
                        ? 'No tasks for you here. This milestone has ${msTotal(m)} task${msTotal(m) == 1 ? '' : 's'}, none created by you or assigned to you — you see only your own tasks.'
                        : 'No tasks yet. Break this milestone into tasks — each with an assignee and a due date.',
                    icon: Icons.checklist_rounded)
              else if (shown.isEmpty)
                const MutedText('No tasks match.')
              else
                for (final t in shown) _taskCard(context, m, t, ts.indexOf(t) + 1, color),
            ]),
          ),
        );
      },
    );
  }

  Widget _taskCard(BuildContext context, Json m, Json t, int n, Color color) {
    final st = _taskState[taskStateKey(m, t)]!;
    final pr = _priority[normPriority(t['priority'])]!;
    final kids = kidsOf(m, i(t['id'])!);
    final extras = [
      ...strs(t['labels']),
      if (kids.isNotEmpty) '☑ ${kids.where((k) => s(k['status']) == 'done').length}/${kids.length}',
      if ((i(t['remarks_count']) ?? 0) > 0 && PmPerm.pmf('task_comments', 'view')) '💬 ${t['remarks_count']}',
      if ((i(t['files_count']) ?? 0) > 0 && PmPerm.pmf('task_files', 'view')) '📎 ${t['files_count']}',
    ];
    return RecordCard(
      code: '#$n',
      title: txt(t['title']),
      subtitle: extras.isEmpty ? null : extras.join('  ·  '),
      trailing: Column(crossAxisAlignment: CrossAxisAlignment.end, children: [
        chip(st),
        const SizedBox(height: 4),
        chip(pr),
      ]),
      meta: [
        ('Assignee', b(t['mine']) ? 'You' : txt(t['assignee_name'])),
        ('Created', fmtDate(t['created_at'])),
        ('Due Date', fmtDate(t['due_date'])),
        ('Progress', '${taskPercent(m, t)}%'),
      ],
      onTap: () => openScreen(context, PlanTaskScreen(store: widget.store, msId: i(m['id'])!, taskId: i(t['id'])!)),
    );
  }

  Future<void> _reason(BuildContext context, Json m, String action) async {
    final r = await promptDialog(context,
        title: action == 'reopen' ? 'Reopen milestone' : 'Cancel milestone',
        message: "Milestone '${m['title']}'. ${action == 'reopen' ? 'The responsible person will see this.' : 'Its record is kept.'}",
        label: action == 'reopen' ? 'Why is it being reopened?' : 'Why is it being cancelled?',
        confirmLabel: action == 'reopen' ? 'Reopen' : 'Cancel milestone');
    if (r == null || !context.mounted) return;
    await widget.store.run(context, () => Api.post('/pm-ongoing/tasks/${m['id']}/status', data: {'action': action, 'reason': r}));
  }

  Future<void> _delete(BuildContext context, Json m) async {
    final ok = await confirmDialog(context,
        title: 'Delete milestone',
        message:
            "Delete '${m['title']}'? Its tasks, sub-tasks, remarks and files are removed too, and this can't be undone. The deletion is kept in History. To stop the work but keep its record, use Cancel instead.",
        confirmLabel: 'Delete milestone',
        danger: true);
    if (!ok || !context.mounted) return;
    final pid = widget.store.projectIdOf(m);
    if (await runAction(context, () => Api.delete('/projects/$pid/project-tasks/${m['id']}'))) {
      widget.store.remove(i(m['id'])!);
      if (context.mounted) Navigator.of(context).pop();
    }
  }
}

// ── Milestone form ──────────────────────────────────────────────────────────

Future<void> openMilestoneForm(BuildContext context, PlanStore st, {Json? m}) async {
  final people = await PmPeople.everyone().catchError((Object _) => <Json>[]);
  final allowed = await PmPeople.allowed('projects:overview.milestones');
  if (!context.mounted) return;
  String suggestedStart() {
    final today = todayIso();
    final ends = st.rows.where((x) => s(x['status']) != 'cancelled' && s(x['due_date']) != null).map((x) => s(x['due_date'])!).toList()..sort();
    String base;
    if (ends.isNotEmpty) {
      base = apiDate(dateOnly(ends.last)!.add(const Duration(days: 1)));
    } else {
      base = s(st.project?['start_date']) ?? today;
    }
    return base.compareTo(today) > 0 ? base : today;
  }

  var title = s(m?['title']) ?? '';
  var description = s(m?['description']) ?? '';
  int? assignee = i(m?['assignee_id']);
  var coOwners = ints(m?['co_owner_ids']);
  var start = m == null ? suggestedStart() : (s(m['start_date']) ?? '');
  var due = s(m?['due_date']) ?? '';
  var status = s(m?['status']) ?? 'todo';
  var blocker = s(m?['blocker_reason']) ?? '';
  var icon = s(m?['icon']) ?? 'flag';
  var color = s(m?['color']) ?? _iconColor['flag']!;
  final editingClosed = m != null && !['todo', 'in_progress', 'blocked'].contains(status);
  final keep = {?assignee, ...coOwners};
  final opts = [
    for (final p in people)
      if (allowed == null || allowed.contains(i(p['id'])) || keep.contains(i(p['id']))) Option(i(p['id'])!, PmPeople.label(p)),
  ];

  await showFormSheet(
    context,
    title: m != null ? 'Edit Milestone' : 'Create Milestone',
    saveLabel: m != null ? 'Save Milestone' : 'Create Milestone',
    builder: (ctx, setS) {
      final days = daysFromToday(due);
      return [
        Text(m != null ? 'Change the milestone details.' : 'Add a new milestone to your project plan.', style: const TextStyle(color: Brand.muted)),
        const SheetTitle('Basic Information', icon: Icons.list_alt_rounded),
        AppTextField(
            key: const ValueKey('ms-title'),
            label: 'Milestone Name',
            required: true,
            initialValue: title,
            hint: 'Enter milestone name (e.g. Design release, Testing, Dispatch)',
            onChanged: (v) => title = v),
        AppTextField(
            key: const ValueKey('ms-desc'),
            label: 'Description',
            maxLines: 3,
            initialValue: description,
            hint: "What 'achieved' means for this milestone — the deliverable or completion criteria",
            onChanged: (v) => description = v),
        const SheetTitle('Schedule', icon: Icons.calendar_today_outlined),
        DateField(label: 'Start Date (auto — change if needed)', value: dateOnly(start), onChanged: (d) => setS(() => start = d == null ? '' : apiDate(d))),
        DateField(label: 'End Date', required: true, value: dateOnly(due), onChanged: (d) => setS(() => due = d == null ? '' : apiDate(d))),
        ReadOnlyField('From today', days == null ? '—' : days < 0 ? '${-days} days ago' : '$days days'),
        const Hint("End date = the expected achievable date. Tasks can't start before the start date or be due after the end date."),
        const SheetTitle('Status', icon: Icons.gps_fixed_rounded),
        if (editingClosed)
          ReadOnlyField('Status', '${(_msState[status] ?? _msState['todo']!).$1} — use Reopen on the milestone to change it.')
        else ...[
          AppSelect<String>(
            label: 'Status',
            value: status,
            clearable: false,
            options: const [Option('todo', 'Not Started'), Option('in_progress', 'In Progress'), Option('blocked', 'On Hold')],
            onChanged: (o) => setS(() => status = o?.value ?? 'todo'),
          ),
          if (status == 'blocked')
            AppTextField(key: const ValueKey('ms-block'), label: 'Why is it on hold?', required: true, initialValue: blocker, onChanged: (v) => blocker = v),
        ],
        const Hint('Achieved and Cancelled are set with the buttons on the milestone.'),
        const SheetTitle('Responsibility', icon: Icons.person_outline_rounded),
        AppSelect<int>(
          label: 'Responsible Person',
          required: true,
          value: assignee,
          valueLabel: s(m?['assignee_name']),
          options: opts,
          onChanged: (o) => setS(() {
            assignee = o?.value;
            coOwners = coOwners.where((x) => x != assignee).toList();
          }),
        ),
        MultiPersonField(
          label: 'More Responsible People (optional)',
          values: coOwners,
          options: opts.where((o) => o.value != assignee).toList(),
          onChanged: (v) => setS(() => coOwners = v),
        ),
        const Hint(
            "Everyone here is notified, sees it in My Tasks, can add its tasks and mark it achieved, and is reminded on the date. The first person's department is shown on the milestone."),
        const SheetTitle('Icons', icon: Icons.star_outline_rounded),
        Wrap(spacing: 8, runSpacing: 8, children: [
          for (final ic in msIcons)
            Tooltip(
              message: _iconLabel[ic]!,
              child: InkWell(
                borderRadius: BorderRadius.circular(12),
                onTap: () => setS(() {
                  icon = ic;
                  color = _iconColor[ic]!;
                }),
                child: Container(
                  width: 50,
                  height: 50,
                  decoration: BoxDecoration(
                    color: icon == ic ? hx(_iconColor[ic]!) : hx(_iconColor[ic]!).withValues(alpha: 0.1),
                    borderRadius: BorderRadius.circular(12),
                  ),
                  child: Icon(_iconData[ic], color: icon == ic ? Colors.white : hx(_iconColor[ic]!)),
                ),
              ),
            ),
        ]),
        const Hint("The icon's colour becomes the milestone's colour on the timeline and cards."),
        const Hint('Attachments and remarks go on the milestone\'s tasks.'),
      ];
    },
    onSave: () async {
      final missing = <String>[];
      if (title.trim().isEmpty) missing.add('Milestone name is required.');
      if (due.isEmpty) missing.add('Expected achievable date is required.');
      if (assignee == null) missing.add('Pick the person responsible for the milestone.');
      if (start.isNotEmpty && due.isNotEmpty && start.compareTo(due) > 0) missing.add('Start date is after the end date.');
      if (status == 'blocked' && blocker.trim().isEmpty) missing.add('Say why the milestone is on hold.');
      if (missing.isNotEmpty) throw missing.join(' ');
      final payload = {
        'title': title.trim(),
        'description': description.trim().isEmpty ? null : description.trim(),
        'assignee_id': assignee,
        'start_date': start.isEmpty ? null : start,
        'due_date': due,
        'status': ['todo', 'in_progress', 'blocked'].contains(status) ? status : null,
        'blocker_reason': blocker.trim().isEmpty ? null : blocker.trim(),
        'color': color,
        'icon': icon,
        'co_owner_ids': coOwners.where((x) => x != assignee).toList(),
      };
      final pid = m == null ? i(st.project?['id']) : st.projectIdOf(m);
      if (pid == null) throw 'This milestone has no project — open it from its project to change it.';
      final saved = obj(m != null
          ? await Api.patch('/projects/$pid/project-tasks/${m['id']}', data: payload)
          : await Api.post('/projects/$pid/project-tasks', data: payload));
      if (saved != null) st.replace(saved);
    },
  );
}

// ── Task form (also sub-tasks) ──────────────────────────────────────────────

Future<void> openTaskForm(BuildContext context, PlanStore st, Json m, {Json? task, Json? parent}) async {
  final people = await PmPeople.everyone().catchError((Object _) => <Json>[]);
  final allowed = await PmPeople.allowed('projects:overview.tasks');
  if (!context.mounted) return;
  final vis = PmVis('projects:overview.tasks');
  final allowedPr = vis.options('priority', _priority.keys.toList(), (k) => k);
  final defaultPr = allowedPr.contains('standard') ? 'standard' : allowedPr.first;
  final parentId = i(parent?['id']) ?? i(task?['parent_id']);
  final parentRow = parentId == null ? null : rowsOf(m['subtasks']).where((x) => i(x['id']) == parentId).firstOrNull;
  final what = parentId != null ? 'Sub-task' : 'Task';
  var title = s(task?['title']) ?? '';
  var description = s(task?['description']) ?? '';
  int? assignee = i(task?['assignee_id']);
  var collaborators = ints(task?['collaborator_ids']);
  var start = s(task?['start_date']) ?? '';
  var due = s(task?['due_date']) ?? '';
  var priority = task == null ? defaultPr : normPriority(task['priority']);
  var status = s(task?['status']) ?? 'todo';
  var labels = strs(task?['labels']);
  final checklist = <String>[''];
  final files = <MultipartFile>[];
  final fileNames = <String>[];
  var labelText = '';
  final prChoices = _priority.keys.where((k) => allowedPr.contains(k) || (task != null && priority == k)).toList();
  final keep = {?assignee, ...collaborators};
  final opts = [
    for (final p in people)
      if (allowed == null || allowed.contains(i(p['id'])) || keep.contains(i(p['id']))) Option(i(p['id'])!, PmPeople.label(p)),
  ];
  final limit = parentRow != null ? (s(parentRow['due_date']) ?? s(m['due_date'])) : s(m['due_date']);

  await showFormSheet(
    context,
    title: task != null ? 'Edit $what' : (parentId != null ? 'Add Sub-task' : 'Create Task'),
    saveLabel: task != null ? 'Save' : (parentId != null ? 'Add Sub-task' : 'Create Task'),
    builder: (ctx, setS) => [
      Text(parentRow != null ? "Part of task '${parentRow['title']}'." : 'Add a task under this milestone and assign it.',
          style: const TextStyle(color: Brand.muted)),
      if (vis.showSection('basic_information')) ...[
        const SheetTitle('Basic Information', icon: Icons.list_alt_rounded),
        AppTextField(key: const ValueKey('t-title'), label: '$what Name', required: true, initialValue: title, hint: 'Enter task name (e.g. Frame GA drawing)', onChanged: (v) => title = v),
        AppTextField(
            key: const ValueKey('t-desc'),
            label: 'Description',
            maxLines: 3,
            initialValue: description,
            hint: 'What to do, what to hand back, anything they should know…',
            onChanged: (v) => description = v),
        ReadOnlyField('Project', s(st.project?['name']) ?? s(m['project_name']) ?? s(m['project_code']) ?? '—'),
        ReadOnlyField('Milestone', txt(m['title'])),
        if (parentRow != null) Hint('Parent task: ${parentRow['title']}'),
      ],
      if (vis.showSection('assignment')) ...[
        const SheetTitle('Assignment', icon: Icons.person_outline_rounded),
        AppSelect<int>(
          label: 'Assignee',
          required: true,
          value: assignee,
          valueLabel: s(task?['assignee_name']),
          options: opts,
          onChanged: (o) => setS(() {
            assignee = o?.value;
            collaborators = collaborators.where((x) => x != assignee).toList();
          }),
        ),
        MultiPersonField(
            label: 'Collaborators',
            values: collaborators,
            options: opts.where((o) => o.value != assignee).toList(),
            onChanged: (v) => setS(() => collaborators = v)),
        const Hint('The assignee owns it. Collaborators are notified, see it in My Tasks and can add comments and files.'),
      ],
      if (vis.showSection('schedule_status')) ...[
        const SheetTitle('Schedule & Status', icon: Icons.calendar_today_outlined),
        DateField(label: 'Start Date', value: dateOnly(start), onChanged: (d) => setS(() => start = d == null ? '' : apiDate(d))),
        DateField(label: 'Due Date', required: true, value: dateOnly(due), onChanged: (d) => setS(() => due = d == null ? '' : apiDate(d))),
        if (limit != null) Hint("Must be due by ${fmtDate(limit)} — the ${parentRow != null ? 'task' : 'milestone'}'s date."),
        AppSelect<String>(
          label: 'Priority',
          value: priority,
          clearable: false,
          options: [for (final k in prChoices) Option(k, _priority[k]!.$1)],
          onChanged: (o) => setS(() => priority = o?.value ?? priority),
        ),
        AppSelect<String>(
          label: 'Status',
          value: status,
          clearable: false,
          options: [for (final x in _subStatus) Option(x.$1, x.$2)],
          onChanged: (o) => setS(() => status = o?.value ?? status),
        ),
      ],
      if (vis.showSection('labels')) ...[
        const SheetTitle('Labels / Tags', icon: Icons.sell_outlined, optional: true),
        if (labels.isNotEmpty)
          Wrap(spacing: 6, runSpacing: 6, children: [
            for (final l in labels) InputChip(label: Text(l), onDeleted: () => setS(() => labels = labels.where((x) => x != l).toList())),
          ]),
        TextField(
          enabled: labels.length < 10,
          onChanged: (v) => labelText = v,
          onSubmitted: (v) => setS(() {
            final t = v.trim().replaceAll(RegExp(r',$'), '').trim();
            if (t.isNotEmpty && !labels.any((l) => l.toLowerCase() == t.toLowerCase()) && labels.length < 10) {
              labels = [...labels, t.length > 30 ? t.substring(0, 30) : t];
            }
            labelText = '';
          }),
          decoration: fieldDecoration(labels.length >= 10 ? 'At most 10 labels' : 'Type a label and press Enter'),
        ),
      ],
      if (task == null && parentId == null && vis.showSection('checklist')) ...[
        const SheetTitle('Checklist', icon: Icons.checklist_rounded, optional: true),
        for (var k = 0; k < checklist.length; k++)
          Row(children: [
            Expanded(
              child: AppTextField(
                key: ValueKey('t-cl-$k-${checklist.length}'),
                label: 'Checklist item ${k + 1}…',
                initialValue: checklist[k],
                onChanged: (v) => checklist[k] = v,
              ),
            ),
            if (checklist.length > 1) IconButton(icon: const Icon(Icons.close_rounded), onPressed: () => setS(() => checklist.removeAt(k))),
          ]),
        Align(alignment: Alignment.centerLeft, child: SmallBtn('Add item', icon: Icons.add_rounded, onPressed: () => setS(() => checklist.add('')))),
        const Hint("Steps to tick off — they belong to this task's assignee and due date."),
      ],
      if (task == null && vis.showSection('attachments')) ...[
        const SheetTitle('Attachments', icon: Icons.attach_file_rounded, optional: true),
        Wrap(spacing: 8, children: [
          SmallBtn('Choose files', icon: Icons.upload_file_rounded, onPressed: () async {
            final p = await Files.pickFiles();
            setS(() {
              files.addAll(p);
              fileNames.addAll(p.map((x) => x.filename ?? 'file'));
            });
          }),
          SmallBtn('Take photo', icon: Icons.photo_camera_outlined, onPressed: () async {
            final p = await Files.takePhoto();
            if (p != null) {
              setS(() {
                files.add(p);
                fileNames.add(p.filename ?? 'photo.jpg');
              });
            }
          }),
        ]),
        for (var k = 0; k < fileNames.length; k++)
          FileRow(title: fileNames[k], onOpen: null, onDelete: () => setS(() {
                files.removeAt(k);
                fileNames.removeAt(k);
              })),
      ],
    ],
    onSave: () async {
      if (labelText.trim().isNotEmpty && labels.length < 10) labels = [...labels, labelText.trim()];
      final missing = <String>[];
      if (title.trim().isEmpty) missing.add('$what name is required.');
      if (assignee == null) missing.add('Pick the person it is assigned to.');
      if (due.isEmpty) missing.add('Due date is required.');
      if (start.isNotEmpty && due.isNotEmpty && start.compareTo(due) > 0) missing.add('Start date is after the due date.');
      if (missing.isNotEmpty) throw missing.join(' ');
      final payload = {
        'title': title.trim(),
        'description': description.trim().isEmpty ? null : description.trim(),
        'assignee_id': assignee,
        'collaborator_ids': collaborators,
        'start_date': start.isEmpty ? null : start,
        'due_date': due,
        'priority': priority,
        'status': status,
        'labels': labels,
      };
      final before = rowsOf(m['subtasks']).map((x) => i(x['id'])).toSet();
      var saved = obj(task != null
          ? await Api.patch('/pm-ongoing/subtasks/${task['id']}', data: payload)
          : parentId != null
              ? await Api.post('/pm-ongoing/subtasks/$parentId/subtasks', data: payload)
              : await Api.post('/pm-ongoing/tasks/${m['id']}/subtasks', data: payload));
      if (saved != null) st.replace(saved);
      if (task == null && saved != null) {
        final created = rowsOf(saved['subtasks']).where((x) => !before.contains(i(x['id']))).firstOrNull;
        final problems = <String>[];
        if (created != null) {
          for (final item in checklist.map((c) => c.trim()).where((c) => c.isNotEmpty)) {
            try {
              saved = obj(await Api.post('/pm-ongoing/subtasks/${created['id']}/subtasks', data: {'title': item})) ?? saved;
            } catch (e) {
              problems.add("Checklist item '$item': ${ApiClient.describe(e)}");
            }
          }
          if (files.isNotEmpty) {
            try {
              await uploadFiles('/pm-ongoing/subtasks/${created['id']}/files', files);
              saved = obj(await Api.get('/pm-ongoing/tasks/${m['id']}')) ?? saved;
            } catch (e) {
              problems.add('Files: ${ApiClient.describe(e)}');
            }
          }
          if (saved != null) st.replace(saved);
        }
        if (problems.isNotEmpty && context.mounted) {
          showSnack(context, "'${title.trim()}' was saved, but: ${problems.join(' ')} Open the task to add them again.", error: true);
        }
      }
    },
  );
}

// ── Task screen: Overview / Checklist / Files / Comments / Activity Log ─────

class PlanTaskScreen extends StatefulWidget {
  const PlanTaskScreen({super.key, required this.store, required this.msId, required this.taskId});
  final PlanStore store;
  final int msId;
  final int taskId;

  @override
  State<PlanTaskScreen> createState() => _PlanTaskScreenState();
}

class _PlanTaskScreenState extends State<PlanTaskScreen> {
  late int _taskId = widget.taskId;
  String _tab = 'overview';
  Json? _activity;
  Object? _actError;
  final _remark = TextEditingController();
  bool _busy = false;

  static const _feature = {'checklist': 'task_checklist', 'files': 'task_files', 'comments': 'task_comments', 'log': 'task_log'};

  @override
  void initState() {
    super.initState();
    _loadActivity();
  }

  @override
  void dispose() {
    _remark.dispose();
    super.dispose();
  }

  Future<void> _loadActivity() async {
    try {
      final d = obj(await Api.get('/pm-ongoing/subtasks/$_taskId/activity'));
      if (mounted) setState(() => _activity = d);
    } catch (e) {
      if (mounted) setState(() => _actError = e);
    }
  }

  void _applyActivity(Object? d) {
    final a = obj(d);
    if (a == null) return;
    setState(() => _activity = a);
    final m = widget.store.byId(widget.msId);
    if (m == null) return;
    final subs = rowsOf(m['subtasks']);
    for (final x in subs) {
      if (i(x['id']) == _taskId) {
        x['remarks_count'] = rowsOf(a['remarks']).length;
        x['files_count'] = rowsOf(a['files']).length;
      }
    }
    widget.store.replace({...m, 'subtasks': subs});
  }

  Future<void> _call(Future<dynamic> Function() fn) async {
    setState(() => _busy = true);
    try {
      _applyActivity(await fn());
    } catch (e) {
      if (mounted) showSnack(context, ApiClient.describe(e), error: true);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final st = widget.store;
    return ListenableBuilder(
      listenable: st,
      builder: (ctx, _) {
        final m = st.byId(widget.msId);
        final ts = m == null ? <Json>[] : tasksOf(m);
        final t = ts.where((x) => i(x['id']) == _taskId).firstOrNull;
        if (m == null || t == null) {
          return const SubPage(title: 'Task', body: EmptyView('This task is no longer here — it was removed.'));
        }
        final idx = ts.indexOf(t);
        final kids = kidsOf(m, _taskId);
        final canStatus = (b(t['can_toggle']) || b(t['can_edit']) || b(t['mine']) || b(t['collab'])) && PmPerm.pmf('tasks', 'edit');
        final tabs = [
          ('overview', 'Overview', null),
          ('checklist', 'Checklist', kids.isEmpty ? '0' : '${kids.where((k) => s(k['status']) == 'done').length}/${kids.length}'),
          ('files', 'Files', '${t['files_count'] ?? 0}'),
          ('comments', 'Comments', '${t['remarks_count'] ?? 0}'),
          ('log', 'Activity Log', null),
        ].where((x) => x.$1 == 'overview' || PmPerm.pmf(_feature[x.$1]!, 'view')).toList();
        final tab = tabs.any((x) => x.$1 == _tab) ? _tab : 'overview';
        void go(int d) {
          final nx = idx + d;
          if (nx < 0 || nx >= ts.length) return;
          setState(() {
            _taskId = i(ts[nx]['id'])!;
            _tab = 'overview';
            _activity = null;
            _actError = null;
          });
          _loadActivity();
        }

        return SubPage(
          title: txt(t['title']),
          actions: [
            IconButton(tooltip: 'Previous task', onPressed: idx <= 0 ? null : () => go(-1), icon: const Icon(Icons.chevron_left_rounded)),
            IconButton(tooltip: 'Next task', onPressed: idx >= ts.length - 1 ? null : () => go(1), icon: const Icon(Icons.chevron_right_rounded)),
            if (b(t['can_edit']))
              IconButton(tooltip: 'Edit', icon: const Icon(Icons.edit_outlined), onPressed: () => openTaskForm(context, st, m, task: t)),
          ],
          body: RefreshIndicator(
            onRefresh: () async {
              await st.load();
              await _loadActivity();
            },
            child: ListView(padding: const EdgeInsets.only(bottom: 40), children: [
              Padding(
                padding: const EdgeInsets.fromLTRB(16, 14, 16, 4),
                child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                  Text(txt(t['title']), style: const TextStyle(fontSize: 19, fontWeight: FontWeight.w700, color: Brand.heading)),
                  Text('Created on ${fmtDate(t['created_at'])} by ${txt(t['created_by_name'])}',
                      style: const TextStyle(fontSize: 12.5, color: Brand.muted)),
                  if (canStatus) ...[
                    const SizedBox(height: 10),
                    Wrap(spacing: 6, runSpacing: 6, children: [
                      for (final o in const [('in_progress', 'In Progress', '#1d4ed8'), ('on_hold', 'On Hold', '#b45309'), ('done', 'Done', '#15803d')])
                        ChoiceChip(
                          label: Text(o.$2),
                          selected: s(t['status']) == o.$1,
                          selectedColor: hx(o.$3).withValues(alpha: 0.15),
                          onSelected: st.busy || s(t['status']) == o.$1
                              ? null
                              : (_) => st.run(context, () => Api.patch('/pm-ongoing/subtasks/$_taskId', data: {'status': o.$1})),
                        ),
                    ]),
                  ],
                ]),
              ),
              PmTabChips(
                labels: [for (final x in tabs) x.$2],
                counts: [for (final x in tabs) x.$3],
                index: tabs.indexWhere((x) => x.$1 == tab),
                onChanged: (k) => setState(() => _tab = tabs[k].$1),
              ),
              if (tab == 'overview') _overview(context, m, t, kids),
              if (tab == 'checklist') _checklist(context, m, t, kids),
              if (tab == 'files') _files(context),
              if (tab == 'comments') _comments(context),
              if (tab == 'log') _log(),
            ]),
          ),
        );
      },
    );
  }

  Widget _overview(BuildContext context, Json m, Json t, List<Json> kids) {
    final st = _taskState[taskStateKey(m, t)]!;
    final pr = _priority[normPriority(t['priority'])]!;
    final labels = strs(t['labels']);
    return Column(children: [
      DetailSection('Description', children: [
        Text(s(t['description']) ?? 'No description.', style: TextStyle(color: s(t['description']) == null ? Brand.muted : Brand.body)),
      ]),
      if (PmPerm.pmf('task_checklist', 'view'))
        DetailSection('Checklist (${kids.length})', children: [_checklistBody(context, t, kids, compact: true)]),
      DetailSection('Task Information', children: [
        InfoLine('Status', chip(st)),
        InfoLine('Priority', chip(pr)),
        InfoLine('Assignee', b(t['mine']) ? 'You' : t['assignee_name']),
        InfoLine('Collaborators', strs(t['collaborator_names']).isEmpty ? null : strs(t['collaborator_names']).join(', ')),
        InfoLine('Start Date', fmtDate(t['start_date'])),
        InfoLine('Due Date', Text(fmtDate(t['due_date']), style: TextStyle(color: b(t['is_overdue']) ? hx('#be123c') : Brand.body))),
        if (s(t['completed_at']) != null) InfoLine('Completed', fmtDate(t['completed_at'])),
        InfoLine('Progress', ProgressBar(taskPercent(m, t), color: hx('#16a34a'))),
      ]),
      DetailSection('Labels / Tags', children: [
        labels.isEmpty
            ? Text('No labels.${b(t['can_edit']) ? ' Add them with Edit.' : ''}', style: const TextStyle(color: Brand.muted))
            : Wrap(spacing: 6, runSpacing: 6, children: [for (final l in labels) Pill(l, hx('#6d28d9'), bg: hx('#f5f3ff'))]),
      ]),
      DetailSection('Related Items', children: [
        InfoLine('Milestone', m['title']),
        InfoLine('Responsible', m['assignee_name']),
      ]),
      if (b(t['can_delete']))
        Padding(
          padding: const EdgeInsets.symmetric(horizontal: 16),
          child: SmallBtn('Remove task', icon: Icons.delete_outline_rounded, color: Brand.danger, onPressed: () => _remove(context, t, kids.isNotEmpty, pop: true)),
        ),
    ]);
  }

  Widget _checklist(BuildContext context, Json m, Json t, List<Json> kids) {
    final done = kids.where((k) => s(k['status']) == 'done').length;
    return Padding(
      padding: const EdgeInsets.all(16),
      child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
        if (kids.isNotEmpty) ...[
          Text('$done / ${kids.length} done', style: const TextStyle(fontSize: 12, color: Brand.muted)),
          ProgressBar(done * 100 / kids.length, color: hx('#16a34a'), showText: false),
        ],
        _checklistBody(context, t, kids),
      ]),
    );
  }

  Widget _checklistBody(BuildContext context, Json t, List<Json> kids, {bool compact = false}) {
    final st = widget.store;
    final ctrl = TextEditingController();
    return Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
      if (kids.isEmpty) const Text('No checklist items.', style: TextStyle(fontSize: 12.5, color: Brand.muted)),
      for (final k in kids)
        Row(children: [
          Checkbox(
            value: s(k['status']) == 'done',
            onChanged: !b(k['can_toggle']) || st.busy
                ? null
                : (v) => st.run(context, () => Api.post('/pm-ongoing/subtasks/${k['id']}/status', data: {'done': v == true})),
          ),
          Expanded(
            child: Text(txt(k['title']),
                style: TextStyle(
                    color: s(k['status']) == 'done' ? Brand.muted : Brand.heading,
                    decoration: s(k['status']) == 'done' ? TextDecoration.lineThrough : null)),
          ),
          if (b(k['can_delete'])) IconButton(icon: const Icon(Icons.close_rounded, size: 18), onPressed: () => _remove(context, k, false)),
        ]),
      if (b(t['can_add_child']))
        Row(children: [
          Expanded(child: TextField(controller: ctrl, decoration: fieldDecoration('Add a checklist item…'))),
          const SizedBox(width: 8),
          SmallBtn('Add', icon: Icons.add_rounded, onPressed: () {
            final v = ctrl.text.trim();
            if (v.isEmpty) return;
            st.run(context, () => Api.post('/pm-ongoing/subtasks/${t['id']}/subtasks', data: {'title': v}));
          }),
        ]),
    ]);
  }

  Future<void> _remove(BuildContext context, Json x, bool hasKids, {bool pop = false}) async {
    final sub = x['parent_id'] != null;
    final ok = await confirmDialog(context,
        title: sub ? 'Remove sub-task' : 'Remove task',
        message: "Remove '${x['title']}'?${!sub && hasKids ? ' Its checklist is removed too.' : ''} This is kept in History.",
        confirmLabel: 'Remove',
        danger: true);
    if (!ok || !context.mounted) return;
    final done = await widget.store.run(context, () => Api.delete('/pm-ongoing/subtasks/${x['id']}'));
    if (done && pop && context.mounted) Navigator.of(context).pop();
  }

  Widget _activityFrame(Widget Function(Json a) body) {
    final a = _activity;
    if (a == null) {
      return _actError == null
          ? const LoadingView()
          : Padding(padding: const EdgeInsets.all(16), child: ErrorView(_actError!, onRetry: _loadActivity));
    }
    return Padding(padding: const EdgeInsets.all(16), child: body(a));
  }

  Widget _files(BuildContext context) => _activityFrame((a) {
        final files = rowsOf(a['files']);
        final canWrite = b(a['can_write']);
        return Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          Caps('Attachments (${files.length})'),
          const SizedBox(height: 6),
          if (files.isEmpty) const Text('No files attached.', style: TextStyle(fontSize: 12.5, color: Brand.muted)),
          for (final f in files)
            FileRow(
              title: txt(f['file_name']),
              sub: s(f['uploaded_by_name']),
              onOpen: PmPerm.pmf('task_files', 'export') ? () => openApiFile(context, '/pm-ongoing/files/${f['id']}/content', txt(f['file_name'])) : null,
              onDelete: canWrite && i(f['uploaded_by_id']) == Perm.userId && PmPerm.pmf('task_files', 'delete')
                  ? () => _call(() => Api.delete('/pm-ongoing/files/${f['id']}'))
                  : null,
            ),
          if (canWrite && PmPerm.pmf('task_files', 'create'))
            Wrap(spacing: 8, children: [
              SmallBtn(_busy ? 'Working…' : 'Attach file', icon: Icons.attach_file_rounded, onPressed: _busy
                  ? null
                  : () => _call(() async => await pickAndUpload('/pm-ongoing/subtasks/$_taskId/files') ?? _activity)),
              SmallBtn('Take photo', icon: Icons.photo_camera_outlined, onPressed: _busy
                  ? null
                  : () => _call(() async {
                        final p = await Files.takePhoto();
                        return p == null ? _activity : await uploadFiles('/pm-ongoing/subtasks/$_taskId/files', [p]);
                      })),
            ]),
        ]);
      });

  Widget _comments(BuildContext context) => _activityFrame((a) {
        final remarks = rowsOf(a['remarks']);
        return Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          Caps('Remarks (${remarks.length})'),
          const SizedBox(height: 6),
          if (remarks.isEmpty) const Text('No remarks yet.', style: TextStyle(fontSize: 12.5, color: Brand.muted)),
          for (final r in remarks)
            Container(
              width: double.infinity,
              margin: const EdgeInsets.only(bottom: 6),
              padding: const EdgeInsets.all(10),
              decoration: BoxDecoration(
                color: i(r['user_id']) == Perm.userId ? hx('#6366f1').withValues(alpha: 0.07) : Colors.white,
                borderRadius: BorderRadius.circular(10),
                border: Border.all(color: Brand.border),
              ),
              child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                Text('${i(r['user_id']) == Perm.userId ? 'You' : txt(r['user_name'])} · ${fmtDateTime(r['created_at'])}',
                    style: const TextStyle(fontSize: 11.5, color: Brand.muted)),
                Text(txt(r['comment'])),
              ]),
            ),
          if (b(a['can_write']) && PmPerm.pmf('task_comments', 'create')) ...[
            const SizedBox(height: 6),
            TextField(controller: _remark, maxLines: 3, minLines: 2, decoration: fieldDecoration('Add a remark…')),
            const SizedBox(height: 6),
            SmallBtn('Save', filled: true, onPressed: _busy
                ? null
                : () {
                    final v = _remark.text.trim();
                    if (v.isEmpty) {
                      showSnack(context, 'Write the remark before saving.', error: true);
                      return;
                    }
                    _call(() async {
                      final d = await Api.post('/pm-ongoing/subtasks/$_taskId/remarks', data: {'comment': v});
                      _remark.clear();
                      return d;
                    });
                  }),
          ],
        ]);
      });

  Widget _log() => _activityFrame((a) {
        final rows = rowsOf(a['log']);
        if (rows.isEmpty) {
          return const Text('Nothing recorded yet. Changes made from now on are listed here.', style: TextStyle(fontSize: 12.5, color: Brand.muted));
        }
        return Column(children: [
          for (final r in rows)
            ListTile(
              contentPadding: EdgeInsets.zero,
              dense: true,
              leading: Icon(Icons.circle, size: 10, color: s(r['to_status']) != null ? hx('#2563eb') : hx('#94a3b8')),
              title: Text(txt(r['text'])),
              subtitle: Text('${txt(r['user_name'])} · ${fmtDateTime(r['created_at'])}'),
            ),
        ]);
      });
}
