import 'package:flutter/material.dart';

import '../../api/api.dart';
import '../../theme.dart';
import '../../ui/app_frame.dart';
import '../../ui/format.dart';
import '../../ui/perms.dart';
import '../../ui/widgets.dart';
import 'design_my_tasks.dart';
import 'home_common.dart';
import 'pm_task_screens.dart';
import 'rnd_my_tasks.dart';

/// My Tasks - everything assigned to me across modules. The portal has no
/// single page for this; it is the union of:
///  * Project Management › My Tasks (/dashboard/projects/my-tasks, open to
///    everyone) - milestones given to me, my tasks in others' milestones,
///    milestones I gave;
///  * R&D - my requirement and project tasks (R&D dashboard "My open tasks");
///  * Design › My Work - drawings / BOMs / change notices waiting on me.
/// R&D and Design show only for people holding those apps (as the portal).
class MyTasksScreen extends StatefulWidget {
  const MyTasksScreen({super.key});

  @override
  State<MyTasksScreen> createState() => _MyTasksScreenState();
}

enum _Source { projects, rnd, design }

class _MyTasksScreenState extends State<MyTasksScreen> {
  _Source _source = _Source.projects;

  @override
  Widget build(BuildContext context) {
    final sources = [
      _Source.projects,
      if (Perm.hasApp('rnd')) _Source.rnd,
      if (Perm.hasApp('design')) _Source.design,
    ];
    if (!sources.contains(_source)) _source = _Source.projects;
    const labels = {_Source.projects: 'Projects', _Source.rnd: 'R&D', _Source.design: 'Design'};
    return SubPage(
      title: 'My Tasks',
      body: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          if (sources.length > 1) ...[
            Container(
              color: Colors.white,
              child: ChipBar(
                padding: const EdgeInsets.fromLTRB(16, 10, 16, 10),
                children: [
                  for (final s in sources)
                    CountChip(labels[s]!, null, selected: _source == s, onTap: () => setState(() => _source = s)),
                ],
              ),
            ),
            const Divider(height: 1),
          ],
          Expanded(
            child: KeyedSubtree(
              key: ValueKey(_source),
              child: switch (_source) {
                _Source.projects => const PmMyTasks(),
                _Source.rnd => const RndMyTasks(),
                _Source.design => const DesignMyTasks(),
              },
            ),
          ),
        ],
      ),
    );
  }
}

// ── Project Management › My Tasks ────────────────────────────────────────────

enum _MyView { given, subs, gave }

const _viewTitle = {
  _MyView.given: 'Given to me',
  _MyView.subs: 'My tasks in others’ milestones',
  _MyView.gave: 'Milestones I gave',
};
const _viewHelp = {
  _MyView.given: 'Milestones you are responsible for — split them into tasks and mark them achieved.',
  _MyView.subs: 'Milestones someone else gave, where a task is yours — open it to work your task.',
  _MyView.gave: 'Follow-up: who has each one, its tasks and progress.',
};

bool _inView(_MyView v, Json m) => switch (v) {
      _MyView.given => truthy(m['mine']),
      _MyView.subs => !truthy(m['mine']) && truthy(m['has_my_subtask']) && !truthy(m['given_by_me']),
      _MyView.gave => truthy(m['given_by_me']) && !truthy(m['mine']),
    };

/// The portal's ProjectPlan in "mine" mode at phone width.
class PmMyTasks extends StatefulWidget {
  const PmMyTasks({super.key});

  @override
  State<PmMyTasks> createState() => _PmMyTasksState();
}

class _PmMyTasksState extends State<PmMyTasks> {
  final _key = GlobalKey<LoadedState<List<Json>>>();
  bool _includeClosed = false;
  _MyView? _view;
  bool _overdueOnly = false;

  Future<void> _open(Json m) async {
    await openMilestone(context, m);
    _key.currentState?.reload();
  }

  @override
  Widget build(BuildContext context) {
    return Loaded<List<Json>>(
      key: _key,
      load: () async => rowsOf(await Api.get('/pm-ongoing/my', query: {'include_closed': _includeClosed})),
      builder: (ctx, rows, reload) {
        final counts = {for (final v in _MyView.values) v: rows.where((m) => _inView(v, m)).length};
        final view = _view ?? _MyView.values.firstWhere((v) => counts[v]! > 0, orElse: () => _MyView.given);
        final ms = rows.where((m) => _inView(view, m)).toList()
          ..sort((a, b) {
            final c = (a['status'] == 'cancelled' ? 1 : 0) - (b['status'] == 'cancelled' ? 1 : 0);
            if (c != 0) return c;
            final d = '${a['due_date'] ?? '9999'}'.compareTo('${b['due_date'] ?? '9999'}');
            return d != 0 ? d : asInt(a['id']) - asInt(b['id']);
          });
        final live = ms.where((m) => m['status'] != 'cancelled').toList();
        final tasks = [for (final m in live) ...pmTasksOf(m)];
        final done = tasks.where((s) => s['status'] == 'done').length;
        final overdue = tasks.where((s) => s['status'] != 'done' && truthy(s['is_overdue'])).length;
        final overall =
            live.isEmpty ? 0 : (live.map(pmMilestonePercent).reduce((a, b) => a + b) / live.length).round();
        final shown = _overdueOnly
            ? ms
                .where((m) =>
                    truthy(m['is_overdue']) ||
                    pmTasksOf(m).any((s) => s['status'] != 'done' && truthy(s['is_overdue'])))
                .toList()
            : ms;
        return ListView(
          padding: const EdgeInsets.only(bottom: 32),
          children: [
            ChipBar(children: [
              for (final v in _MyView.values)
                CountChip(_viewTitle[v]!, counts[v],
                    selected: view == v,
                    onTap: () => setState(() {
                          _view = v;
                          _overdueOnly = false;
                        })),
            ]),
            Padding(
              padding: const EdgeInsets.fromLTRB(16, 0, 8, 0),
              child: Row(
                children: [
                  Expanded(
                      child: Text(_viewHelp[view]!, style: const TextStyle(fontSize: 12.5, color: Brand.muted))),
                  const Text('Show finished', style: TextStyle(fontSize: 12.5, color: Brand.body)),
                  Switch(
                    value: _includeClosed,
                    onChanged: (v) {
                      setState(() => _includeClosed = v);
                      _key.currentState?.reload();
                    },
                  ),
                ],
              ),
            ),
            if (ms.isNotEmpty) ...[
              Padding(
                padding: const EdgeInsets.fromLTRB(16, 4, 16, 8),
                child: Row(children: [
                  const Text('Progress',
                      style: TextStyle(fontSize: 12, fontWeight: FontWeight.w600, color: Brand.muted)),
                  const SizedBox(width: 10),
                  Expanded(child: ProgressLine(overall)),
                ]),
              ),
              ChipBar(padding: const EdgeInsets.fromLTRB(16, 0, 16, 6), children: [
                CountChip('Total Tasks', tasks.length,
                    selected: !_overdueOnly, onTap: () => setState(() => _overdueOnly = false)),
                CountChip('Completed', done),
                CountChip('Pending', tasks.length - done),
                CountChip('Overdue', overdue,
                    color: const Color(0xFFE11D48),
                    selected: _overdueOnly,
                    onTap: () => setState(() => _overdueOnly = !_overdueOnly)),
              ]),
            ],
            if (ms.isEmpty)
              EmptyView(
                '${switch (view) {
                  _MyView.given => 'No milestone is with you.',
                  _MyView.subs => 'No task of yours in anyone else’s milestone.',
                  _MyView.gave => 'You haven’t given any milestone that is still open.',
                }}${_includeClosed ? '' : ' Turn on “Show finished” to see finished ones.'}',
                icon: Icons.flag_outlined,
              )
            else if (shown.isEmpty)
              const EmptyView('No overdue milestones or tasks here.', icon: Icons.flag_outlined)
            else
              for (final m in shown) MilestoneCard(m: m, showProject: true, onTap: () => _open(m)),
          ],
        );
      },
    );
  }
}

/// One milestone in a list (portal MilestoneCard).
class MilestoneCard extends StatelessWidget {
  const MilestoneCard({super.key, required this.m, required this.onTap, this.showProject = false});
  final Json m;
  final VoidCallback onTap;
  final bool showProject;

  @override
  Widget build(BuildContext context) {
    final st = pmMilestoneState(m['status']);
    final project =
        [m['project_code'], m['project_name']].where((x) => x != null && '$x'.isNotEmpty).join(' · ');
    final isDone = m['status'] == 'done';
    return Opacity(
      opacity: m['status'] == 'cancelled' ? 0.55 : 1,
      child: RecordCard(
        code: showProject && project.isNotEmpty ? project : null,
        title: txt(m['title']),
        subtitle:
            'Responsible: ${txt(m['assignee_name'])}${m['department_name'] != null ? ' (${m['department_name']})' : ''}',
        trailing: Padding(padding: const EdgeInsets.only(left: 8), child: Pill(st.$1, st.$2)),
        meta: [
          ('Expected by', fmtDate(m['due_date'])),
          ('Due', isDone ? 'Achieved' : dueText(m['due_date'])),
          ('Tasks', '${pmMilestoneDone(m)} / ${pmMilestoneTotal(m)}'),
          ('Progress', '${pmMilestonePercent(m)}%'),
        ],
        onTap: onTap,
      ),
    );
  }
}
