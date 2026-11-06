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
import 'approval_panel.dart';
import 'pm_common.dart';
import 'project_workspace.dart';

/// Department Work (components/projects/work/DepartmentWork.tsx): milestones
/// given to the departments the user heads, team workload and open team
/// tasks. Opens the milestone workspace (MilestoneWorkspace.tsx) and the task
/// page (TaskDetailView.tsx).
class DepartmentWorkTab extends StatefulWidget {
  const DepartmentWorkTab({super.key});

  @override
  State<DepartmentWorkTab> createState() => _DepartmentWorkTabState();
}

class _DepartmentWorkTabState extends State<DepartmentWorkTab> {
  Json? _ctx;
  int? _deptId;
  List<Json> _projects = [];
  List<Json> _workload = [];
  List<Json> _tasks = [];
  bool _showClosed = false;
  Object? _error;
  bool _loading = true;

  @override
  void initState() {
    super.initState();
    _start();
  }

  Future<void> _start() async {
    try {
      final c = obj(await Api.get('/pm-work/me')) ?? {};
      final own = rowsOf(c['departments']).where((d) => b(d['is_head'])).toList();
      _ctx = c;
      if (own.length == 1) _deptId = i(own.first['id']);
      await _load();
    } catch (e) {
      if (mounted) {
        setState(() {
          _error = e;
          _loading = false;
        });
      }
    }
  }

  bool get _onAny {
    final c = _ctx;
    return c != null &&
        (rowsOf(c['departments']).isNotEmpty || (i(c['lead_milestone_count']) ?? 0) > 0 || (i(c['member_milestone_count']) ?? 0) > 0);
  }

  Future<void> _load() async {
    if (!_onAny) {
      if (mounted) setState(() => _loading = false);
      return;
    }
    setState(() => _loading = true);
    try {
      final r = await Future.wait([
        Api.get('/pm-work/department/projects', query: {'department_id': _deptId}),
        Api.get('/pm-work/department/workload', query: {'department_id': _deptId}),
        Api.get('/pm-work/department/tasks', query: {'department_id': _deptId}),
      ]);
      if (!mounted) return;
      setState(() {
        _projects = rowsOf(r[0])
            .map((x) {
              final ms = rowsOf(x['milestones']);
              return {...x, 'milestones': ms, 'open_milestones': ms.where((m) => !['achieved', 'cancelled'].contains(s(m['status']))).length};
            })
            .where((x) => rowsOf(x['milestones']).isNotEmpty)
            .toList();
        _workload = rowsOf(r[1]);
        _tasks = rowsOf(r[2]);
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

  @override
  Widget build(BuildContext context) {
    final c = _ctx;
    final children = <Widget>[
      const PageHeader('Department Work',
          subtitle: 'Milestones given to the departments you head: create and assign tasks, follow your team\'s work, attach evidence and submit.'),
    ];
    if (c == null) {
      children.add(_error != null ? ErrorView(_error!, onRetry: _start) : const LoadingView());
    } else if (!_onAny) {
      children.add(const MutedText(
          'You are not on any milestone here yet. When a project manager makes you a milestone lead or assistant, it shows up on this page.'));
    } else {
      final depts = rowsOf(c['departments']).where((d) => b(d['is_head'])).toList();
      final shown = _projects.where((p) => _showClosed || (i(p['open_milestones']) ?? 0) > 0).toList();
      final leads = depts.isNotEmpty || (i(c['lead_milestone_count']) ?? 0) > 0;
      final canOpenProject = Perm.hasApp('projects');
      children.addAll([
        if (_error != null) Padding(padding: const EdgeInsets.all(16), child: ErrorBanner(ApiClient.describe(_error!))),
        const GroupTitle('My projects'),
        if (rowsOf(c['departments']).length > 1)
          Padding(
            padding: const EdgeInsets.symmetric(horizontal: 16),
            child: AppSelect<int>(
              label: 'All my departments',
              value: _deptId,
              options: [for (final d in rowsOf(c['departments'])) Option(i(d['id'])!, '${d['name']} (#${d['id']})')],
              onChanged: (o) {
                _deptId = o?.value;
                _load();
              },
            ),
          ),
        Padding(
          padding: const EdgeInsets.symmetric(horizontal: 4),
          child: CheckField(label: 'Show finished', value: _showClosed, onChanged: (v) => setState(() => _showClosed = v)),
        ),
        if (_loading) const LoadingView(),
        if (!_loading && shown.isEmpty) const MutedText('No open milestones for you.'),
        if (!_loading)
          for (final p in shown) _projectBlock(context, p, canOpenProject),
        if (leads && !_loading) ...[
          GroupTitle('Team workload (${_workload.length})'),
          if (_workload.isEmpty && _tasks.isEmpty)
            const MutedText('No open team tasks. Open a milestone above and assign its tasks — workload and open tasks show up here.')
          else if (_workload.isEmpty)
            const MutedText('No open tasks.')
          else
            for (final w in _workload)
              RecordCard(
                title: txt(w['name']),
                meta: [
                  ('Open', '${w['open']}'),
                  ('In progress', '${w['in_progress']}'),
                  ('Blocked', '${w['blocked']}'),
                  ('Overdue', '${w['overdue']}'),
                  ('Est. h', n(w['hours']) == 0 ? '—' : n(w['hours']).toStringAsFixed(1)),
                  ('Logged h', n(w['logged']) == 0 ? '—' : n(w['logged']).toStringAsFixed(1)),
                ],
              ),
          GroupTitle('Open team tasks (${_tasks.length})'),
          if (_tasks.isEmpty) const MutedText('No open tasks.'),
          for (final t in [..._tasks]..sort((a, c) {
                final bl = (s(c['status']) == 'blocked' ? 1 : 0) - (s(a['status']) == 'blocked' ? 1 : 0);
                return bl != 0 ? bl : (b(c['is_overdue']) ? 1 : 0) - (b(a['is_overdue']) ? 1 : 0);
              }))
            WorkTaskCard(task: t, showProject: true, onChanged: _load),
        ],
      ]);
    }
    children.add(const MutedText(
        'Only department heads see milestones here (set in Organization > Departments). Tasks assigned to you are under My Tasks.'));
    return RefreshIndicator(
      onRefresh: _ctx == null ? _start : _load,
      child: ListView(padding: const EdgeInsets.only(bottom: 40), children: children),
    );
  }

  Widget _projectBlock(BuildContext context, Json p, bool canOpen) {
    final pr = obj(p['project']) ?? {};
    final ms = rowsOf(p['milestones']).where((m) => _showClosed || !['achieved', 'cancelled'].contains(s(m['status']))).toList();
    return DetailSection(
      '${pr['project_code']} · ${pr['name']}',
      action: Pill.of(s(pr['status']), projectLabels, projectHex),
      children: [
        Text('PM ${txt(pr['project_manager_name'])} · handover ${fmtDate(pr['target_handover_date'])}',
            style: const TextStyle(fontSize: 12, color: Brand.muted)),
        if (canOpen)
          Align(
            alignment: Alignment.centerLeft,
            child: TextButton(
              onPressed: () => openScreen(context, ProjectWorkspaceScreen(projectId: i(pr['id'])!, title: s(pr['project_code']))),
              child: const Text('Open project'),
            ),
          ),
        if (s(pr['status']) == 'on_hold')
          Text('On hold: ${txt(pr['hold_reason'])}', style: TextStyle(fontSize: 12.5, color: hx('#b45309'))),
        for (final m in ms) _wbsRow(context, m),
      ],
    );
  }

  Widget _wbsRow(BuildContext context, Json m) {
    String nextStep(String st) =>
        const {'not_started': 'Create & assign tasks', 'in_progress': 'Team working', 'submitted': 'Waiting for management', 'achieved': 'Accepted', 'cancelled': 'Cancelled'}[st] ??
        '';
    final hint = b(m['is_locked'])
        ? (s(m['waiting_reason']) != null ? 'Waits for ${m['waiting_reason']}' : 'Waits for step ${m['waiting_for_sequence']}')
        : s(m['my_role']) == 'member'
            ? '${m['task_count']} open task(s) for you'
            : nextStep(s(m['status']) ?? '');
    final role = s(m['my_role']) == 'member' ? 'assistant · lead ${txt(m['lead_name'])}' : 'lead ${txt(m['lead_name'])}';
    final sameAsDept = txt(m['title']).trim().toLowerCase() == txt(m['department_name']).trim().toLowerCase();
    final open = !['achieved', 'cancelled'].contains(s(m['status']));
    final days = daysFromToday(m['target_date']);
    final dueColor = !open
        ? Brand.muted
        : (b(m['is_overdue']) || (days != null && days < 0))
            ? hx('#dc2626')
            : days != null && days <= 3
                ? hx('#c2410c')
                : Brand.muted;
    return InkWell(
      onTap: () => Navigator.of(context).push(MaterialPageRoute<void>(builder: (_) => MilestoneWorkspaceScreen(milestoneId: i(m['id'])!))).then((_) => _load()),
      child: Padding(
        padding: const EdgeInsets.symmetric(vertical: 8),
        child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          Text('STEP ${m['sequence']}  ${m['title']}', style: const TextStyle(fontSize: 13.5, fontWeight: FontWeight.w600, color: Brand.heading)),
          Text(sameAsDept ? role : '${m['department_name']} · $role', style: const TextStyle(fontSize: 11.5, color: Brand.muted)),
          const SizedBox(height: 4),
          Wrap(spacing: 6, runSpacing: 4, children: [
            Pill.of(s(m['status']), milestoneLabels, milestoneHex),
            if (b(m['is_overdue'])) Pill('OVERDUE', hx('#dc2626')),
            if (b(m['is_at_risk'])) Pill('AT RISK', hx('#f59e0b')),
            if (b(m['is_locked'])) Pill('LOCKED', hx('#64748b')),
          ]),
          const SizedBox(height: 4),
          if (!(s(m['my_role']) == 'member' || (s(m['status']) == 'not_started' && n(m['progress_percent']) == 0)))
            ProgressBar(n(m['progress_percent'])),
          Row(children: [
            Text('Due ${fmtDate(m['target_date'])}', style: TextStyle(fontSize: 12, color: dueColor, fontWeight: FontWeight.w600)),
            const Spacer(),
            Text(hint, style: const TextStyle(fontSize: 12, fontWeight: FontWeight.w600, color: Brand.muted)),
          ]),
          const Divider(height: 14),
        ]),
      ),
    );
  }
}

/// One department task as a card (DepartmentWork.tsx TaskTable row).
class WorkTaskCard extends StatelessWidget {
  const WorkTaskCard({super.key, required this.task, this.showProject = false, this.showAssignee = true, this.onChanged, this.actions});
  final Json task;
  final bool showProject;
  final bool showAssignee;
  final VoidCallback? onChanged;
  final Widget? actions;

  @override
  Widget build(BuildContext context) {
    final t = task;
    final sub = [
      if (showProject) '${txt(t['project_code'])} · ${txt(t['milestone_title'])}',
      if (s(t['status']) == 'blocked' && s(t['blocker_reason']) != null) 'Blocked: ${t['blocker_reason']}',
      if (s(t['status']) == 'cancelled' && s(t['cancel_reason']) != null) 'Cancelled: ${t['cancel_reason']}',
    ];
    return Opacity(
      opacity: s(t['status']) == 'cancelled' ? 0.55 : 1,
      child: RecordCard(
        title: txt(t['title']),
        subtitle: sub.isEmpty ? null : sub.join('\n'),
        trailing: Column(crossAxisAlignment: CrossAxisAlignment.end, children: [
          Pill.of(s(t['status']), taskLabels, taskHex),
          if (b(t['is_overdue'])) ...[const SizedBox(height: 4), Pill('OVERDUE', hx('#dc2626'))],
          const SizedBox(height: 4),
          Pill.of(normPriority(t['priority']), priorityLabels, priorityHex),
        ]),
        meta: [
          if (showAssignee) ('Assigned to', txt(t['assignee_name'])),
          ('Due', fmtDate(t['due_date'])),
          ('Progress', '${n(t['progress_percent']).round()}%${(i(t['subtasks_total']) ?? 0) > 0 ? ' · ${t['subtasks_done']}/${t['subtasks_total']} sub-tasks' : ''}'),
        ],
        onTap: () => Navigator.of(context).push(MaterialPageRoute<void>(builder: (_) => WorkTaskScreen(taskId: i(t['id'])!))).then((_) => onChanged?.call()),
      ).withActions(actions),
    );
  }
}

extension on Widget {
  Widget withActions(Widget? a) =>
      a == null ? this : Column(children: [this, Padding(padding: const EdgeInsets.fromLTRB(16, 0, 16, 10), child: a)]);
}

// ── Milestone workspace ─────────────────────────────────────────────────────

class MilestoneWorkspaceScreen extends StatefulWidget {
  const MilestoneWorkspaceScreen({super.key, required this.milestoneId});
  final int milestoneId;

  @override
  State<MilestoneWorkspaceScreen> createState() => _MilestoneWorkspaceScreenState();
}

class _MilestoneWorkspaceScreenState extends State<MilestoneWorkspaceScreen> {
  Json? _ws;
  Object? _error;
  bool _busy = false;
  bool? _engineRequest;
  String _docType = 'drawing';
  int _reload = 0;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    try {
      final d = obj(await Api.get('/pm-work/milestones/${widget.milestoneId}'));
      if (!mounted) return;
      setState(() {
        _ws = d;
        _error = null;
        _reload++;
      });
      if (s(obj(d?['milestone'])?['status']) == 'submitted') {
        try {
          final a = obj(await Api.get('/approvals/entity/pm_milestone/${widget.milestoneId}'));
          final cur = obj(a?['current']);
          if (mounted) setState(() => _engineRequest = cur != null && s(cur['status']) == 'pending');
        } catch (_) {
          if (mounted) setState(() => _engineRequest = null);
        }
      }
    } catch (e) {
      if (mounted) setState(() => _error = e);
    }
  }

  Future<void> _act(Future<dynamic> Function() fn, {String? success}) async {
    setState(() => _busy = true);
    final ok = await runAction(context, fn, success: success);
    if (mounted) setState(() => _busy = false);
    if (ok) _load();
  }

  @override
  Widget build(BuildContext context) {
    final ws = _ws;
    return SubPage(
      title: ws == null ? 'Milestone' : txt(obj(ws['milestone'])?['title']),
      body: ws == null
          ? (_error == null ? const LoadingView() : ErrorView(_error!, onRetry: _load))
          : RefreshIndicator(onRefresh: _load, child: _body(ws)),
    );
  }

  Widget _body(Json ws) {
    final m = obj(ws['milestone']) ?? {};
    final tasks = rowsOf(ws['tasks']);
    final evidence = rowsOf(ws['evidence']);
    final role = s(ws['role']);
    final projectActive = s(m['project_status']) == 'active';
    final open = ['not_started', 'in_progress'].contains(s(m['status']));
    final canPlan = b(ws['can_plan']) && projectActive && open;
    final full = role == 'manage' || role == 'lead';
    final canAddOwn = (role == 'member' || b(ws['can_plan'])) && projectActive && open;
    final live = tasks.where((t) => s(t['status']) != 'cancelled').toList();
    final doneCount = live.where((t) => s(t['status']) == 'done').length;
    final allDone = live.isNotEmpty && doneCount == live.length;
    final submitBlocker = b(m['is_locked'])
        ? 'Waits for step ${m['waiting_for_sequence']} to be achieved'
        : live.isEmpty
            ? 'Add tasks first — nothing to submit yet'
            : !allDone
                ? '$doneCount of ${live.length} task(s) done — every task must be Done'
                : '';
    final assistants = rowsOf(m['assistants']);
    return ListView(padding: const EdgeInsets.only(bottom: 40), children: [
      Padding(
        padding: const EdgeInsets.fromLTRB(16, 14, 16, 4),
        child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          InkWell(
            onTap: Perm.hasApp('projects')
                ? () => openScreen(context, ProjectWorkspaceScreen(projectId: i(m['project_id'])!, title: s(m['project_code'])))
                : null,
            child: Text('${txt(m['project_code'])} · ${txt(m['project_name'])}',
                style: TextStyle(fontSize: 12, fontWeight: FontWeight.w700, color: Perm.hasApp('projects') ? hx('#2563eb') : Brand.muted)),
          ),
          const SizedBox(height: 4),
          Text.rich(TextSpan(children: [
            TextSpan(text: 'Step ${m['sequence']}  ', style: TextStyle(fontSize: 13, fontWeight: FontWeight.w700, color: hx('#4338ca'))),
            TextSpan(text: txt(m['title']), style: const TextStyle(fontSize: 20, fontWeight: FontWeight.w700, color: Brand.heading)),
          ])),
          const SizedBox(height: 6),
          Wrap(spacing: 6, runSpacing: 4, children: [
            Pill.of(s(m['status']), milestoneLabels, milestoneHex),
            if (b(m['is_overdue'])) Pill('OVERDUE', hx('#dc2626')),
            if (b(m['is_at_risk'])) Pill('AT RISK', hx('#f59e0b')),
            if (b(m['is_locked'])) Pill('LOCKED', hx('#64748b')),
          ]),
          const SizedBox(height: 4),
          Text(
              '${txt(m['department_name'])} · due ${fmtDate(m['target_date'])}'
              '${s(m['original_target_date']) != null ? ' (originally ${fmtDate(m['original_target_date'])})' : ''}'
              '${s(m['actual_date']) != null ? ' · achieved ${fmtDate(m['actual_date'])}' : ''}',
              style: const TextStyle(fontSize: 12.5, color: Brand.muted)),
          if (full) ...[
            const SizedBox(height: 6),
            Text('$doneCount/${live.length} tasks done', style: const TextStyle(fontSize: 11.5, color: Brand.muted)),
            ProgressBar(n(m['progress_percent'])),
          ],
          const SizedBox(height: 8),
          Text('Deliverable: ${txt(m['deliverable'])}', style: const TextStyle(fontSize: 13)),
          const SizedBox(height: 4),
          Text('Lead: ${txt(m['lead_name'])}', style: const TextStyle(fontSize: 12.5)),
          Text('Assistants: ${assistants.isEmpty ? '—' : assistants.map((a) => a['name']).join(', ')}', style: const TextStyle(fontSize: 12.5)),
          if (b(ws['can_plan']) && !['achieved', 'cancelled'].contains(s(m['status'])))
            Align(alignment: Alignment.centerLeft, child: TextButton(onPressed: () => _editTeam(m), child: const Text('Edit team'))),
          if (full) _stepper(s(m['status']) ?? '', live.isNotEmpty, allDone, evidence.isNotEmpty),
          const SizedBox(height: 8),
          if (role == 'member')
            Notice(
                '${live.isNotEmpty ? 'Your tasks: $doneCount of ${live.length} done' : 'No tasks for you yet'} · Milestone stage: ${milestoneLabels[s(m['status'])] ?? m['status']}'
                '${open && live.isNotEmpty && doneCount < live.length ? ' — the lead can submit only when your tasks are Done.' : ''}'),
          if (b(m['is_locked']))
            Notice(
                'Locked — step ${m['waiting_for_sequence']} "${m['waiting_for_title']}" must be achieved before work here can start. You can already plan tasks and use the team chat.',
                tone: 'warn'),
          if (role == 'guest') const Notice("You were tagged in this milestone's chat — you can read and reply below."),
          if (!projectActive)
            Notice("The project is ${(projectLabels[s(m['project_status'])] ?? txt(m['project_status'])).toLowerCase()} — work can't be recorded right now.",
                tone: 'warn'),
          if (s(m['status']) == 'in_progress' && s(m['return_reason']) != null) Notice('Rejected by management: ${m['return_reason']}', tone: 'bad'),
          if (s(m['status']) == 'submitted') Notice('Submitted by ${txt(m['submitted_by_name'])}: ${txt(m['submission_note'])}'),
          if (s(m['status']) == 'cancelled') Notice('Cancelled: ${txt(m['cancel_reason'])}', tone: 'bad'),
          Wrap(spacing: 8, runSpacing: 8, crossAxisAlignment: WrapCrossAlignment.center, children: [
            if (b(ws['can_manage']) && s(m['status']) == 'submitted' && _engineRequest == false) ...[
              SmallBtn('Accept Milestone', filled: true, onPressed: _busy ? null : () => _accept(m)),
              SmallBtn('Reject', color: Brand.danger, onPressed: _busy
                  ? null
                  : () async {
                      final r = await promptDialog(context,
                          title: 'Reject "${m['title']}"?', message: 'Say what is missing or wrong — the department head sees this.', confirmLabel: 'Reject');
                      if (r != null) _act(() => Api.post('/projects/${m['project_id']}/milestones/${m['id']}/reject', data: {'reason': r}));
                    }),
            ],
            if (canPlan) ...[
              if (submitBlocker.isNotEmpty) Text(submitBlocker, style: const TextStyle(fontSize: 12, color: Brand.muted)),
              SmallBtn('Submit Milestone', filled: true, onPressed: _busy || submitBlocker.isNotEmpty ? null : () => _submit(m, live.length, evidence.length)),
            ],
          ]),
        ]),
      ),
      ApprovalPanel(key: ValueKey('ap-$_reload'), title: 'Acceptance', entityType: 'pm_milestone', entityId: i(m['id'])!, onChanged: _load),
      if (role != 'guest') ...[
        GroupTitle(full ? 'Tasks (${live.length})' : 'My tasks (${live.length})'),
        Padding(
          padding: const EdgeInsets.symmetric(horizontal: 16),
          child: Wrap(spacing: 8, children: [
            if (canAddOwn) SmallBtn('+ My own task', filled: !canPlan, onPressed: () => _taskForm(m, self: true)),
            if (canPlan) SmallBtn('+ Assign task', filled: true, onPressed: () => _taskForm(m)),
          ]),
        ),
        const SizedBox(height: 8),
        if (tasks.isEmpty)
          MutedText(
              'No tasks yet.${canPlan ? ' Break the milestone into tasks and assign each to someone on the team.' : canAddOwn ? ' Your lead will assign tasks; you can also add your own.' : ''}')
        else
          for (final t in tasks)
            WorkTaskCard(
              task: t,
              onChanged: _load,
              actions: canPlan ? _taskActions(m, t) : null,
            ),
      ],
      if (full) ...[
        const GroupTitle('Evidence'),
        Padding(
          padding: const EdgeInsets.symmetric(horizontal: 16),
          child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            Text(
                'Drawings, reports or certificates that prove the deliverable — management checks these before accepting.'
                '${evidence.isEmpty && !allDone && open ? ' Attach them once the work is done, before you submit.' : ''}',
                style: const TextStyle(fontSize: 12.5, color: Brand.muted)),
            const SizedBox(height: 8),
            if (canPlan) ...[
              AppSelect<String>(
                label: 'Document type',
                value: _docType,
                clearable: false,
                options: [for (final e in docTypeLabels.entries) Option(e.key, e.value)],
                onChanged: (o) => setState(() => _docType = o?.value ?? 'drawing'),
              ),
              const SizedBox(height: 8),
              SmallBtn('Attach files', icon: Icons.attach_file_rounded, onPressed: _busy
                  ? null
                  : () => _act(() => pickAndUpload('/pm-work/milestones/${m['id']}/files', fields: {'doc_type': _docType}))),
              const SizedBox(height: 8),
            ],
            if (evidence.isEmpty) const Text('No files attached.', style: TextStyle(fontSize: 12.5, color: Brand.muted)),
            for (final f in evidence)
              FileRow(
                title: s(f['title']) != null && s(f['title']) != s(f['file_name']) ? '${f['title']} — ${f['file_name']}' : txt(f['file_name']),
                tag: s(f['doc_type']) != null && s(f['doc_type']) != 'other' ? docTypeLabels[s(f['doc_type'])] : null,
                sub: [s(f['uploaded_by_name']), if (s(f['created_at']) != null) fmtDate(f['created_at'])].whereType<String>().join(' · '),
                onOpen: () => openApiFile(context, '/pm-work/files/${f['id']}/content', txt(f['file_name'])),
                onDelete: canPlan && (Perm.user['role'] == 'admin' || i(f['uploaded_by_id']) == Perm.userId)
                    ? () => _act(() => Api.delete('/pm-work/files/${f['id']}'))
                    : null,
              ),
          ]),
        ),
      ],
      _MilestoneChat(key: ValueKey('chat-${m['id']}'), milestoneId: i(m['id'])!, readOnly: ['closed', 'cancelled'].contains(s(m['project_status']))),
      if (full) _Breakdown(key: ValueKey('bd-$_reload'), milestoneId: i(m['id'])!),
    ]);
  }

  Widget _stepper(String status, bool hasTasks, bool allDone, bool hasEvidence) {
    if (status == 'cancelled') return const SizedBox.shrink();
    final submitted = status == 'submitted' || status == 'achieved';
    final steps = [
      ('Plan tasks', hasTasks || submitted),
      ('Work', allDone || submitted),
      ('Evidence', hasEvidence || submitted),
      ('Submit', submitted),
      ('Accepted', status == 'achieved'),
    ];
    final current = steps.indexWhere((x) => !x.$2);
    return Padding(
      padding: const EdgeInsets.only(top: 10),
      child: Wrap(spacing: 4, runSpacing: 4, crossAxisAlignment: WrapCrossAlignment.center, children: [
        for (var k = 0; k < steps.length; k++) ...[
          Pill('${steps[k].$2 ? '✓' : '${k + 1}'} ${steps[k].$1}',
              hx(steps[k].$2 ? '#16a34a' : k == current ? '#6366f1' : '#94a3b8')),
          if (k < steps.length - 1) const Text('→', style: TextStyle(color: Color(0xFFCBD5E1))),
        ],
      ]),
    );
  }

  Widget _taskActions(Json m, Json t) {
    final st = s(t['status']);
    final openTask = ['todo', 'in_progress', 'blocked'].contains(st);
    return Wrap(spacing: 6, runSpacing: 6, alignment: WrapAlignment.end, children: [
      if (openTask) SmallBtn('Edit', onPressed: () => _taskForm(m, task: t)),
      if (st == 'done')
        SmallBtn('Reopen', onPressed: () async {
          final r = await promptDialog(context,
              title: 'Reopen "${t['title']}"?', message: 'What still needs doing? It goes back to the person as In progress.', confirmLabel: 'Reopen');
          if (r != null) _act(() => Api.post('/pm-work/tasks/${t['id']}/reopen', data: {'reason': r}));
        }),
      if (openTask)
        SmallBtn('Cancel', color: Brand.danger, onPressed: () async {
          final r = await promptDialog(context, title: 'Cancel "${t['title']}"?', message: 'Why is this task no longer needed?', confirmLabel: 'Cancel task');
          if (r != null) _act(() => Api.post('/pm-work/tasks/${t['id']}/cancel', data: {'reason': r}));
        }),
      if (st == 'todo' && t['started_at'] == null && (i(t['subtasks_total']) ?? 0) == 0)
        SmallBtn('Delete', color: Brand.danger, onPressed: () async {
          final ok = await confirmDialog(context,
              title: 'Delete this task?', message: 'Delete "${t['title']}"? No work has been recorded on it yet.', confirmLabel: 'Delete', danger: true);
          if (ok) _act(() => Api.delete('/pm-work/tasks/${t['id']}'));
        }),
    ]);
  }

  Future<void> _accept(Json m) async {
    var date = todayIso();
    final ok = await showFormSheet(context,
        title: 'Accept Milestone',
        saveLabel: 'Accept',
        builder: (ctx, setS) => [
              Text("Accept '${m['title']}' as achieved."),
              DateField(label: 'Actual date achieved', value: dateOnly(date), onChanged: (d) => setS(() => date = d == null ? todayIso() : apiDate(d))),
            ],
        onSave: () async => Api.post('/projects/${m['project_id']}/milestones/${m['id']}/accept', data: {'actual_date': date}));
    if (ok) _load();
  }

  Future<void> _submit(Json m, int liveCount, int evidenceCount) async {
    var note = '';
    final ok = await showFormSheet(context,
        title: 'Submit Milestone',
        saveLabel: 'Submit',
        builder: (ctx, setS) => [
              Text("'${m['title']}' goes to management to accept or reject."),
              Hint('All $liveCount task(s) are Done. $evidenceCount evidence file(s) attached. Management will accept or reject it.'),
              AppTextField(
                  label: 'Handover note',
                  required: true,
                  maxLines: 4,
                  hint: 'What is attached (drawing no., report, certificate) and anything management should check',
                  onChanged: (v) => note = v),
            ],
        onSave: () async {
          requireField(note, 'Handover note');
          await Api.post('/pm-work/milestones/${m['id']}/submit', data: {'submission_note': note.trim()});
        });
    if (ok) _load();
  }

  Future<void> _editTeam(Json m) async {
    final deptId = i(m['department_id']);
    final dir = await PmPeople.directory().catchError((Object _) => <Json>[]);
    List<Json> dept = [];
    if (deptId != null) {
      try {
        dept = rowsOf(await Api.get('/projects/lookups/departments/$deptId/people'));
      } catch (_) {}
    }
    if (!mounted) return;
    final seen = dept.map((d) => i(d['id'])).toSet();
    final opts = [
      for (final d in dept)
        Option(i(d['id'])!, txt(d['name']), subtitle: b(d['is_head']) ? 'Department head' : (s(d['designation']) ?? 'In department')),
      for (final u in dir)
        if (!seen.contains(i(u['id']))) Option(i(u['id'])!, txt(u['name']), subtitle: s(u['department']) ?? s(u['designation'])),
    ].where((o) => o.value != i(m['lead_user_id'])).toList();
    var ids = ints(m['assistant_user_ids']);
    final ok = await showFormSheet(context,
        title: 'Edit Team',
        saveLabel: 'Save team',
        builder: (ctx, setS) => [
              Text("Milestone '${m['title']}' — lead ${txt(m['lead_name'])}."),
              MultiPersonField(label: 'Assistants (optional)', values: ids, options: opts, onChanged: (v) => setS(() => ids = v)),
              const Hint('Assistants see the milestone, their own tasks, and can add tasks for themselves.'),
            ],
        onSave: () async => Api.put('/pm-work/milestones/${m['id']}/team', data: {'assistant_user_ids': ids}));
    if (ok) _load();
  }

  Future<void> _taskForm(Json m, {Json? task, bool self = false}) async {
    final vis = PmVis('projects:overview.tasks');
    final allowedPr = vis.options('priority', priorityLabels.keys.toList(), (k) => k);
    final defaultPr = allowedPr.contains('standard') ? 'standard' : allowedPr.first;
    List<Json> people = [];
    if (!self && b(_ws?['can_plan']) && i(m['department_id']) != null) {
      try {
        people = rowsOf(await Api.get('/pm-work/departments/${m['department_id']}/people'));
      } catch (_) {}
    }
    if (!mounted) return;
    final teamIds = [?i(m['lead_user_id']), ...ints(m['assistant_user_ids'])];
    final teamNames = <int, String>{
      if (i(m['lead_user_id']) != null) i(m['lead_user_id'])!: txt(m['lead_name']),
      for (final a in rowsOf(m['assistants'])) i(a['id'])!: txt(a['name']),
    };
    final opts = [
      for (final id in teamIds)
        Option(id, '${people.where((p) => i(p['id']) == id).map((p) => txt(p['name'])).firstOrNull ?? teamNames[id] ?? 'User #$id'}${id == i(m['lead_user_id']) ? ' (lead)' : ''}',
            subtitle: 'Milestone team'),
      for (final p in people)
        if (!teamIds.contains(i(p['id'])))
          Option(i(p['id'])!, '${p['name']}${s(p['designation']) != null ? ' — ${p['designation']}' : ''}',
              subtitle: 'Others in ${s(m['department_name']) ?? 'the department'} (joins the team)'),
    ];
    var title = s(task?['title']) ?? '';
    var desc = s(task?['description']) ?? '';
    int? assignee = i(task?['assignee_id']);
    var due = s(task?['due_date']) ?? '';
    var priority = task == null ? defaultPr : normPriority(task['priority']);
    var hours = task?['estimated_hours'] == null ? '' : '${task!['estimated_hours']}';
    final prChoices = priorityLabels.keys.where((k) => allowedPr.contains(k) || (task != null && k == priority)).toList();
    final ok = await showFormSheet(context,
        title: task != null ? 'Edit Task' : self ? 'Add My Task' : 'Assign Task',
        saveLabel: task != null ? 'Save' : self ? 'Add my task' : 'Create & assign',
        builder: (ctx, setS) => [
              Text("Milestone '${m['title']}' — tasks must be due by ${fmtDate(m['target_date'])}.", style: const TextStyle(color: Brand.muted)),
              const SheetTitle('Basic Information', icon: Icons.list_alt_rounded),
              AppTextField(key: const ValueKey('wt-t'), label: 'Task name', required: true, initialValue: title, hint: 'e.g. Prepare GA drawing', onChanged: (v) => title = v),
              AppTextField(key: const ValueKey('wt-d'), label: 'Description', maxLines: 3, initialValue: desc, onChanged: (v) => desc = v),
              SheetTitle(self ? 'Schedule' : 'Assignment & Schedule', icon: Icons.calendar_today_outlined),
              if (!self)
                AppSelect<int>(
                    label: 'Assigned to',
                    required: true,
                    value: assignee,
                    valueLabel: s(task?['assignee_name']),
                    options: opts,
                    onChanged: (o) => setS(() => assignee = o?.value)),
              DateField(label: 'Due date', required: true, value: dateOnly(due), onChanged: (d) => setS(() => due = d == null ? '' : apiDate(d))),
              AppSelect<String>(
                  label: 'Priority',
                  required: true,
                  value: priority,
                  options: [for (final k in prChoices) Option(k, priorityLabels[k]!)],
                  onChanged: (o) => setS(() => priority = o?.value ?? priority)),
              AppTextField(key: const ValueKey('wt-h'), label: 'Estimated hours', initialValue: hours, keyboardType: AppTextField.number, onChanged: (v) => hours = v),
              Hint('Due on or before the milestone date (${fmtDate(m['target_date'])}).'),
            ],
        onSave: () async {
          final missing = <String>[];
          if (title.trim().isEmpty) missing.add('Task name is required.');
          if (!self && assignee == null) missing.add('Assign the task to someone on the team.');
          if (due.isEmpty) missing.add('Due date is required.');
          if (due.isNotEmpty && s(m['target_date']) != null && due.compareTo(s(m['target_date'])!) > 0) {
            missing.add('Due date must be on or before the milestone date (${fmtDate(m['target_date'])}).');
          }
          if (missing.isNotEmpty) throw missing.join(' ');
          final payload = {
            'title': title.trim(),
            'description': desc.trim().isEmpty ? null : desc.trim(),
            'due_date': due,
            'priority': priority,
            'estimated_hours': hours.trim().isEmpty ? null : num.tryParse(hours.trim()),
          };
          if (self) {
            await Api.post('/pm-work/milestones/${m['id']}/my-tasks', data: payload);
          } else if (task != null) {
            await Api.patch('/pm-work/tasks/${task['id']}', data: {...payload, 'assignee_id': assignee});
          } else {
            await Api.post('/pm-work/milestones/${m['id']}/tasks', data: {...payload, 'assignee_id': assignee});
          }
        });
    if (ok) _load();
  }
}

/// Team chat of a milestone (PmChat.tsx): messages, @tags and files.
class _MilestoneChat extends StatefulWidget {
  const _MilestoneChat({super.key, required this.milestoneId, required this.readOnly});
  final int milestoneId;
  final bool readOnly;

  @override
  State<_MilestoneChat> createState() => _MilestoneChatState();
}

class _MilestoneChatState extends State<_MilestoneChat> {
  List<Json>? _items;
  String? _error;
  final _text = TextEditingController();
  List<int> _tags = [];
  final List<MultipartFile> _files = [];
  final List<String> _names = [];
  List<Json> _people = [];
  bool _busy = false;

  @override
  void initState() {
    super.initState();
    _load();
    PmPeople.directory().then((p) {
      if (mounted) setState(() => _people = p);
    }).catchError((Object _) {});
  }

  @override
  void dispose() {
    _text.dispose();
    super.dispose();
  }

  Future<void> _load() async {
    try {
      final d = rowsOf(await Api.get('/pm-work/milestones/${widget.milestoneId}/messages'));
      if (mounted) setState(() => _items = d);
    } catch (e) {
      if (mounted) setState(() => _error = ApiClient.describe(e));
    }
  }

  Future<void> _send() async {
    final body = _text.text.trim();
    if (body.isEmpty && _files.isEmpty) return;
    setState(() => _busy = true);
    try {
      final fd = FormData();
      fd.fields
        ..add(MapEntry('body', body))
        ..add(MapEntry('mention_user_ids', _tags.join(',')));
      for (final f in _files) {
        fd.files.add(MapEntry('files', f));
      }
      final m = obj((await Api.dio.post('/pm-work/milestones/${widget.milestoneId}/messages', data: fd)).data);
      setState(() {
        if (m != null) _items = [...?_items, m];
        _text.clear();
        _tags = [];
        _files.clear();
        _names.clear();
      });
    } catch (e) {
      if (mounted) showSnack(context, ApiClient.describe(e), error: true);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final items = _items;
    return DetailSection('Team chat', children: [
      if (_error != null) ErrorBanner(_error!),
      if (items == null && _error == null) const LoadingView(),
      if (items != null && items.isEmpty) const Text('No messages yet.', style: TextStyle(fontSize: 12.5, color: Brand.muted)),
      for (final msg in items ?? <Json>[])
        Container(
          width: double.infinity,
          margin: const EdgeInsets.only(bottom: 6),
          padding: const EdgeInsets.all(10),
          decoration: BoxDecoration(
            color: i(msg['user_id']) == Perm.userId ? hx('#6366f1').withValues(alpha: 0.07) : Colors.white,
            borderRadius: BorderRadius.circular(10),
            border: Border.all(color: Brand.border),
          ),
          child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            Text('${txt(msg['user_name'])} · ${fmtDateTime(msg['created_at'])}', style: const TextStyle(fontSize: 11.5, color: Brand.muted)),
            if (s(msg['body']) != null) Text(txt(msg['body'])),
            if (rowsOf(msg['mentions']).isNotEmpty)
              Text('Tagged: ${rowsOf(msg['mentions']).map((p) => '@${p['name']}').join(', ')}', style: TextStyle(fontSize: 12, color: hx('#4f46e5'))),
            for (final f in rowsOf(msg['files']))
              TextButton.icon(
                style: TextButton.styleFrom(padding: EdgeInsets.zero, alignment: Alignment.centerLeft),
                onPressed: () => openApiFile(context, '/pm-work/files/${f['id']}/content', txt(f['file_name'])),
                icon: const Icon(Icons.attach_file_rounded, size: 16),
                label: Text(txt(f['file_name'])),
              ),
          ]),
        ),
      if (!widget.readOnly) ...[
        const SizedBox(height: 6),
        TextField(controller: _text, maxLines: 3, minLines: 1, decoration: fieldDecoration('Write a message…')),
        const SizedBox(height: 6),
        MultiPersonField(
          label: 'Tag people',
          values: _tags,
          options: [for (final p in _people) Option(i(p['id'])!, txt(p['name']))],
          onChanged: (v) => setState(() => _tags = v),
        ),
        for (var k = 0; k < _names.length; k++)
          FileRow(title: _names[k], onOpen: null, onDelete: () => setState(() {
                _files.removeAt(k);
                _names.removeAt(k);
              })),
        const SizedBox(height: 6),
        Wrap(spacing: 8, children: [
          SmallBtn('Attach', icon: Icons.attach_file_rounded, onPressed: () async {
            final p = await Files.pickFiles();
            setState(() {
              _files.addAll(p);
              _names.addAll(p.map((x) => x.filename ?? 'file'));
            });
          }),
          SmallBtn(_busy ? 'Sending…' : 'Send', filled: true, onPressed: _busy ? null : _send),
        ]),
      ],
    ]);
  }
}

/// Who did what (WorkBreakdown.tsx) - the people summary of the milestone.
class _Breakdown extends StatelessWidget {
  const _Breakdown({super.key, required this.milestoneId});
  final int milestoneId;

  @override
  Widget build(BuildContext context) {
    return PmBlock<Json>(
      load: () async => obj(await Api.get('/pm-work/milestones/$milestoneId/breakdown')) ?? {},
      builder: (ctx, d, _) {
        final ms = rowsOf(d['milestones']);
        final people = rowsOf(d['people']).isNotEmpty ? rowsOf(d['people']) : (ms.isEmpty ? <Json>[] : rowsOf(ms.first['people']));
        return DetailSection('Work breakdown', children: [
          if (people.isEmpty) const Text('No tasks given yet.', style: TextStyle(fontSize: 12.5, color: Brand.muted)),
          for (final r in people)
            Padding(
              padding: const EdgeInsets.symmetric(vertical: 6),
              child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                Text(txt(r['name']), style: const TextStyle(fontWeight: FontWeight.w600)),
                Text(
                    'Given by lead ${r['given'] ?? 0} · added by self ${r['self_added'] ?? 0} · done ${r['done'] ?? 0} · open ${r['open'] ?? 0} · '
                    'overdue ${r['overdue'] ?? 0} · cancelled ${r['cancelled'] ?? 0} · est. ${n(r['estimated_hours']) == 0 ? '—' : n(r['estimated_hours']).toStringAsFixed(1)} h · '
                    'logged ${n(r['logged_hours']) == 0 ? '—' : n(r['logged_hours']).toStringAsFixed(1)} h · last completed ${fmtDateTime(r['last_completed_at'])}',
                    style: const TextStyle(fontSize: 12, color: Brand.muted)),
              ]),
            ),
        ]);
      },
    );
  }
}

// ── Department task page (TaskDetailView.tsx) ───────────────────────────────

class WorkTaskScreen extends StatefulWidget {
  const WorkTaskScreen({super.key, required this.taskId});
  final int taskId;

  @override
  State<WorkTaskScreen> createState() => _WorkTaskScreenState();
}

class _WorkTaskScreenState extends State<WorkTaskScreen> {
  Json? _d;
  Object? _error;
  bool _busy = false;
  final _comment = TextEditingController();
  List<int> _tags = [];
  List<Json> _people = [];

  @override
  void initState() {
    super.initState();
    _load();
    PmPeople.directory().then((p) {
      if (mounted) setState(() => _people = p);
    }).catchError((Object _) {});
  }

  @override
  void dispose() {
    _comment.dispose();
    super.dispose();
  }

  Future<void> _load() async {
    try {
      final r = obj(await Api.get('/pm-work/tasks/${widget.taskId}'));
      if (mounted) {
        setState(() {
          _d = r;
          _error = null;
        });
      }
    } catch (e) {
      if (mounted) setState(() => _error = e);
    }
  }

  Future<bool> _act(Future<dynamic> Function() fn) async {
    setState(() => _busy = true);
    try {
      final res = obj(await fn());
      if (res != null && res.containsKey('task')) {
        setState(() => _d = res);
      } else {
        await _load();
      }
      return true;
    } catch (e) {
      if (mounted) showSnack(context, ApiClient.describe(e), error: true);
      return false;
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final d = _d;
    return SubPage(
      title: d == null ? 'Task' : txt(obj(d['task'])?['title']),
      body: d == null ? (_error == null ? const LoadingView() : ErrorView(_error!, onRetry: _load)) : RefreshIndicator(onRefresh: _load, child: _body(d)),
    );
  }

  Widget _body(Json d) {
    final t = obj(d['task']) ?? {};
    final subs = rowsOf(d['subtasks']);
    final updates = rowsOf(d['updates']);
    final files = rowsOf(d['files']);
    final logs = rowsOf(d['time_logs']);
    final status = s(t['status']);
    final workable = b(t['is_assignee']) && s(t['project_status']) == 'active' && !['submitted', 'achieved', 'cancelled'].contains(s(t['milestone_status']) ?? '');
    final isOpen = ['todo', 'in_progress', 'blocked'].contains(status);
    final openSubs = subs.where((x) => s(x['status']) != 'done').length;
    final comments = updates.where((u) => s(u['kind']) == 'comment').toList();
    final history = updates.where((u) => s(u['kind']) == 'status').toList();
    final canLog = b(t['is_assignee']) && s(t['project_status']) == 'active' && ['in_progress', 'blocked', 'done'].contains(status);
    return ListView(padding: const EdgeInsets.only(bottom: 40), children: [
      Padding(
        padding: const EdgeInsets.fromLTRB(16, 14, 16, 4),
        child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          InkWell(
            onTap: t['milestone_id'] == null ? null : () => openScreen(context, MilestoneWorkspaceScreen(milestoneId: i(t['milestone_id'])!)),
            child: Text('${txt(t['project_code'])} · ${txt(t['department_name'])} · ${txt(t['milestone_title'])}',
                style: TextStyle(fontSize: 12, fontWeight: FontWeight.w700, color: hx('#2563eb'))),
          ),
          const SizedBox(height: 4),
          Text(txt(t['title']), style: const TextStyle(fontSize: 20, fontWeight: FontWeight.w700, color: Brand.heading)),
          const SizedBox(height: 6),
          Wrap(spacing: 6, runSpacing: 4, children: [
            Pill.of(status, taskLabels, taskHex),
            Pill.of(normPriority(t['priority']), priorityLabels, priorityHex),
            if (b(t['is_overdue'])) Pill('OVERDUE', hx('#dc2626')),
          ]),
          const SizedBox(height: 4),
          Text(
              '${txt(t['assignee_name'])} · due ${fmtDate(t['due_date'])} (milestone ${fmtDate(t['milestone_target_date'])})'
              '${t['estimated_hours'] != null ? ' · ${t['estimated_hours']} h est.' : ''} · ${t['logged_hours'] ?? 0} h logged'
              '${b(t['is_self_created']) ? ' · added by assignee' : ''}',
              style: const TextStyle(fontSize: 12.5, color: Brand.muted)),
          const SizedBox(height: 6),
          ProgressBar(n(t['progress_percent'])),
          if (s(t['description']) != null) Padding(padding: const EdgeInsets.only(top: 10), child: Text(txt(t['description']))),
          const SizedBox(height: 10),
          if (status == 'blocked') Notice('Blocked: ${txt(t['blocker_reason'])}', tone: 'bad'),
          if (status == 'in_progress' && s(t['reopen_reason']) != null) Notice('Sent back by your head: ${t['reopen_reason']}', tone: 'warn'),
          if (status == 'cancelled') Notice('Cancelled: ${txt(t['cancel_reason'])}', tone: 'bad'),
          if (b(t['is_assignee']) && s(t['project_status']) != 'active')
            Notice('The project is ${(projectLabels[s(t['project_status'])] ?? txt(t['project_status'])).toLowerCase()} — work is frozen.', tone: 'warn'),
          Wrap(spacing: 8, runSpacing: 8, children: [
            if (workable && status == 'todo') SmallBtn('Start task', filled: true, onPressed: _busy ? null : () => _act(() => Api.post('/pm-work/tasks/${t['id']}/start'))),
            if (workable && status == 'in_progress') ...[
              SmallBtn('Blocked', color: Brand.danger, onPressed: _busy
                  ? null
                  : () async {
                      final r = await promptDialog(context,
                          title: 'What is blocking this task?', message: 'Your department head is notified so they can help.', confirmLabel: 'Mark blocked');
                      if (r != null) _act(() => Api.post('/pm-work/tasks/${t['id']}/block', data: {'reason': r}));
                    }),
              SmallBtn(openSubs > 0 ? 'Mark done ($openSubs sub-task${openSubs > 1 ? 's' : ''} open)' : 'Mark done', filled: true, onPressed: _busy || openSubs > 0
                  ? null
                  : () async {
                      final r = await promptDialog(context,
                          title: 'Mark "${t['title']}" done?',
                          message: 'What did you deliver? (drawing no., report, file name) — your lead checks this before submitting the milestone.',
                          label: 'What you delivered',
                          confirmLabel: 'Mark done');
                      if (r != null) _act(() => Api.post('/pm-work/tasks/${t['id']}/complete', data: {'note': r}));
                    }),
            ],
            if (workable && status == 'blocked')
              SmallBtn('Unblocked — continue', filled: true, onPressed: _busy ? null : () => _act(() => Api.post('/pm-work/tasks/${t['id']}/unblock'))),
            if (!b(t['is_assignee']) && b(t['is_head']) && status == 'blocked')
              SmallBtn('Mark unblocked', onPressed: _busy ? null : () => _act(() => Api.post('/pm-work/tasks/${t['id']}/unblock'))),
          ]),
        ]),
      ),
      DetailSection('Sub-tasks (${subs.where((x) => s(x['status']) == 'done').length}/${subs.length})', children: [
        const Text('Split the task into smaller steps. The task can only be marked done when every step is ticked.',
            style: TextStyle(fontSize: 12.5, color: Brand.muted)),
        for (final x in subs)
          Row(children: [
            Checkbox(
              value: s(x['status']) == 'done',
              onChanged: !workable || !isOpen || _busy
                  ? null
                  : (v) => _act(() => Api.patch('/pm-work/subtasks/${x['id']}', data: {'status': v == true ? 'done' : 'todo'})),
            ),
            Expanded(
                child: Text(txt(x['title']),
                    style: TextStyle(
                        color: s(x['status']) == 'done' ? Brand.muted : Brand.body,
                        decoration: s(x['status']) == 'done' ? TextDecoration.lineThrough : null))),
            if (s(x['due_date']) != null) Text(fmtDate(x['due_date']), style: const TextStyle(fontSize: 12, color: Brand.muted)),
            if (workable && isOpen && s(x['status']) != 'done')
              IconButton(
                  icon: const Icon(Icons.close_rounded, size: 18, color: Brand.danger),
                  onPressed: () async {
                    final ok = await confirmDialog(context, title: 'Delete this sub-task?', message: 'Delete "${x['title']}"?', confirmLabel: 'Delete', danger: true);
                    if (ok) _act(() => Api.delete('/pm-work/subtasks/${x['id']}'));
                  }),
          ]),
        if (workable && isOpen) Align(alignment: Alignment.centerLeft, child: SmallBtn('+ Add sub-task', onPressed: () => _addSub(t))),
      ]),
      DetailSection('Files & drawings', children: [
        if (isOpen && (b(t['is_assignee']) || b(t['is_head'])))
          Padding(
            padding: const EdgeInsets.only(bottom: 8),
            child: Wrap(spacing: 8, children: [
              SmallBtn('Attach files', icon: Icons.attach_file_rounded, onPressed: _busy ? null : () => _act(() => pickAndUpload('/pm-work/tasks/${t['id']}/files'))),
              SmallBtn('Take photo', icon: Icons.photo_camera_outlined, onPressed: _busy
                  ? null
                  : () => _act(() async {
                        final p = await Files.takePhoto();
                        return p == null ? null : uploadFiles('/pm-work/tasks/${t['id']}/files', [p]);
                      })),
            ]),
          ),
        if (files.isEmpty) const Text('No files attached.', style: TextStyle(fontSize: 12.5, color: Brand.muted)),
        for (final f in files)
          FileRow(
            title: txt(f['file_name']),
            sub: [s(f['uploaded_by_name']), if (s(f['created_at']) != null) fmtDate(f['created_at'])].whereType<String>().join(' · '),
            onOpen: () => openApiFile(context, '/pm-work/files/${f['id']}/content', txt(f['file_name'])),
            onDelete: isOpen && (Perm.user['role'] == 'admin' || i(f['uploaded_by_id']) == Perm.userId) ? () => _act(() => Api.delete('/pm-work/files/${f['id']}')) : null,
          ),
      ]),
      DetailSection('Time spent (${t['logged_hours'] ?? 0} h${t['estimated_hours'] != null ? ' of ${t['estimated_hours']} h estimated' : ''})', children: [
        const Text('Log the hours you worked on this task each day — your lead sees actual effort against the estimate.',
            style: TextStyle(fontSize: 12.5, color: Brand.muted)),
        if (canLog) Align(alignment: Alignment.centerLeft, child: SmallBtn('+ Log time', onPressed: () => _logTime(t))),
        if (logs.isEmpty) const Text('No time logged yet.', style: TextStyle(fontSize: 13, color: Brand.muted)),
        for (final lg in logs)
          Row(children: [
            SizedBox(width: 90, child: Text(fmtDate(lg['work_date']), style: const TextStyle(fontSize: 13, color: Brand.muted))),
            SizedBox(width: 50, child: Text('${lg['hours']} h', style: const TextStyle(fontWeight: FontWeight.w700))),
            Expanded(child: Text('${s(lg['note']) ?? ''}  ${txt(lg['user_name'])}', style: const TextStyle(fontSize: 13))),
            if (i(lg['user_id']) == Perm.userId && s(t['project_status']) == 'active')
              IconButton(icon: const Icon(Icons.close_rounded, size: 18, color: Brand.danger), onPressed: () => _act(() => Api.delete('/pm-work/time/${lg['id']}'))),
          ]),
      ]),
      DetailSection('Comments', children: [
        TextField(controller: _comment, maxLines: 3, minLines: 1, decoration: fieldDecoration('Write a comment…')),
        const SizedBox(height: 6),
        MultiPersonField(
            label: 'Tag people',
            values: _tags,
            options: [for (final p in _people) Option(i(p['id'])!, txt(p['name']))],
            onChanged: (v) => setState(() => _tags = v)),
        const SizedBox(height: 6),
        Align(
          alignment: Alignment.centerLeft,
          child: SmallBtn('Post', filled: true, onPressed: _busy
              ? null
              : () async {
                  final body = _comment.text.trim();
                  if (body.isEmpty) return;
                  if (await _act(() => Api.post('/pm-work/tasks/${t['id']}/comments', data: {'comment': body, 'mention_user_ids': _tags}))) {
                    _comment.clear();
                    setState(() => _tags = []);
                  }
                }),
        ),
        const SizedBox(height: 8),
        if (comments.isEmpty) const Text('No comments yet.', style: TextStyle(fontSize: 13, color: Brand.muted)),
        for (final c in comments)
          Padding(
            padding: const EdgeInsets.symmetric(vertical: 6),
            child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
              Text('${txt(c['user_name'])}  ${fmtDateTime(c['created_at'])}', style: const TextStyle(fontSize: 12, fontWeight: FontWeight.w700)),
              Text(txt(c['comment'])),
              if (rowsOf(c['mentions']).isNotEmpty)
                Text('Tagged: ${rowsOf(c['mentions']).map((p) => '@${p['name']}').join(', ')}', style: TextStyle(fontSize: 12, color: hx('#4f46e5'))),
            ]),
          ),
        if (history.isNotEmpty) ...[
          const SizedBox(height: 8),
          const Caps('Status history'),
          for (final h in history)
            Text(
                '${fmtDateTime(h['created_at'])} — ${txt(h['user_name'])}: ${taskLabels[s(h['from_status'])] ?? txt(h['from_status'])} → ${taskLabels[s(h['to_status'])] ?? txt(h['to_status'])}'
                '${s(h['comment']) != null ? ' (${h['comment']})' : ''}',
                style: const TextStyle(fontSize: 12.5, color: Brand.muted)),
        ],
      ]),
    ]);
  }

  Future<void> _addSub(Json t) async {
    var title = '';
    var due = '';
    final ok = await showFormSheet(context,
        title: 'Add Sub-task',
        saveLabel: 'Add sub-task',
        builder: (ctx, setS) => [
              Text("Part of task '${t['title']}'.", style: const TextStyle(color: Brand.muted)),
              AppTextField(label: 'Sub-task', required: true, hint: 'e.g. Check weld sizes on the frame', onChanged: (v) => title = v),
              DateField(label: 'Due date (optional)', value: dateOnly(due), onChanged: (d) => setS(() => due = d == null ? '' : apiDate(d))),
              const Hint('The task can only be marked done when every sub-task is ticked.'),
            ],
        onSave: () async {
          if (title.trim().isEmpty) throw 'Write the sub-task first.';
          await Api.post('/pm-work/tasks/${t['id']}/subtasks', data: {'title': title.trim(), 'due_date': due.isEmpty ? null : due});
        });
    if (ok) _load();
  }

  Future<void> _logTime(Json t) async {
    var date = todayIso();
    var hours = '';
    var note = '';
    final ok = await showFormSheet(context,
        title: 'Log Time',
        saveLabel: 'Log time',
        builder: (ctx, setS) => [
              Text("Hours worked on '${t['title']}'.", style: const TextStyle(color: Brand.muted)),
              DateField(label: 'Date', required: true, value: dateOnly(date), onChanged: (d) => setS(() => date = d == null ? '' : apiDate(d))),
              AppTextField(label: 'Hours', required: true, hint: 'e.g. 2.5', keyboardType: AppTextField.number, onChanged: (v) => hours = v),
              AppTextField(label: 'What you did', hint: 'e.g. Finished the GA drawing views', onChanged: (v) => note = v),
              const Hint('More than 0 and at most 24 hours. Your lead sees actual effort against the estimate.'),
            ],
        onSave: () async {
          final h = num.tryParse(hours.trim());
          if (date.isEmpty || h == null || h <= 0 || h > 24) throw 'Enter the date and the hours spent (more than 0, at most 24).';
          await Api.post('/pm-work/tasks/${t['id']}/time', data: {'work_date': date, 'hours': h, 'note': note.trim().isEmpty ? null : note.trim()});
        });
    if (ok) _load();
  }
}
