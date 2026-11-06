import 'package:dio/dio.dart';
import 'package:flutter/material.dart';

import '../../api/api.dart';
import '../../theme.dart';
import '../../ui/app_frame.dart';
import '../../ui/files.dart';
import '../../ui/format.dart';
import '../../ui/perms.dart';
import '../../ui/widgets.dart';
import 'home_common.dart';

/// Project Management milestone / task screens used by My Tasks - the
/// portal's MilestonePanel and TaskSplit (components/projects/work/
/// ProjectPlan.tsx + TaskActivity.tsx) at phone width. Every action
/// returns the whole milestone from /pm-ongoing, which replaces the copy.

// ── Helpers (same rules as the portal) ──────────────────────────────────────

List<Json> pmTasksOf(Json m) => rowsOf(m['subtasks']).where((s) => s['parent_id'] == null).toList();
List<Json> pmKidsOf(Json m, Object? id) => rowsOf(m['subtasks']).where((s) => s['parent_id'] == id).toList();

int pmMilestoneTotal(Json m) => m['tasks_total'] is int ? m['tasks_total'] as int : pmTasksOf(m).length;
int pmMilestoneDone(Json m) =>
    m['tasks_done'] is int ? m['tasks_done'] as int : pmTasksOf(m).where((s) => s['status'] == 'done').length;
int pmMilestonePercent(Json m) {
  if (m['status'] == 'done') return 100;
  final t = pmMilestoneTotal(m);
  return t == 0 ? 0 : (pmMilestoneDone(m) * 100 / t).round();
}

int pmTaskPercent(Json m, Json s) {
  if (s['status'] == 'done') return 100;
  if (s['progress'] is num) return (s['progress'] as num).round();
  final k = pmKidsOf(m, s['id']);
  return k.isEmpty ? 0 : (k.where((x) => x['status'] == 'done').length * 100 / k.length).round();
}

(String, Color) pmMilestoneState(Object? status) => switch ('$status') {
      'in_progress' => ('In Progress', const Color(0xFF1D4ED8)),
      'blocked' => ('On Hold', const Color(0xFFB45309)),
      'done' => ('Achieved', const Color(0xFF15803D)),
      'cancelled' => ('Cancelled', const Color(0xFF78716C)),
      _ => ('Not Started', const Color(0xFF475569)),
    };

(String, Color) pmTaskState(Json m, Json s) {
  if (s['status'] == 'done') return ('Completed', const Color(0xFF15803D));
  if (truthy(s['is_overdue'])) return ('Overdue', const Color(0xFFBE123C));
  if (s['status'] == 'on_hold') return ('On Hold', const Color(0xFFB45309));
  if (s['status'] == 'in_progress' || pmKidsOf(m, s['id']).any((k) => k['status'] == 'done')) {
    return ('In Progress', const Color(0xFF1D4ED8));
  }
  return ('To Do', const Color(0xFF475569));
}

(String, Color) pmPriority(Object? v) => const {'urgent', 'critical', 'high'}.contains('${v ?? ''}'.trim().toLowerCase())
    ? ('Urgent', const Color(0xFFBE123C))
    : ('Standard', const Color(0xFF475569));

Json _asJson(dynamic d) => d is Map ? Map<String, dynamic>.from(d) : <String, dynamic>{};

Future<void> openMilestone(BuildContext context, Json m) =>
    Navigator.of(context).push(MaterialPageRoute(builder: (_) => MilestoneScreen(milestone: m)));

// ── Milestone ────────────────────────────────────────────────────────────────

class MilestoneScreen extends StatefulWidget {
  const MilestoneScreen({super.key, required this.milestone});
  final Json milestone;

  @override
  State<MilestoneScreen> createState() => _MilestoneScreenState();
}

class _MilestoneScreenState extends State<MilestoneScreen> {
  late Json _m = widget.milestone;
  bool _busy = false;
  String _filter = 'all';

  Future<void> _refresh() async {
    try {
      final d = _asJson(await Api.get('/pm-ongoing/tasks/${_m['id']}'));
      if (mounted && d.isNotEmpty) setState(() => _m = d);
    } catch (e) {
      if (mounted) showSnack(context, ApiClient.describe(e), error: true);
    }
  }

  Future<void> _status(String action, {String? reason, required String success}) async {
    setState(() => _busy = true);
    await runAction(context, () async {
      final d = _asJson(await Api.post('/pm-ongoing/tasks/${_m['id']}/status',
          data: {'action': action, 'reason': ?reason}));
      if (d.isNotEmpty && mounted) setState(() => _m = d);
    }, success: success);
    if (mounted) setState(() => _busy = false);
  }

  Future<void> _achieve() async {
    final ok = await confirmDialog(context,
        title: 'Mark achieved?',
        message: "'${txt(_m['title'])}' will be marked achieved.",
        confirmLabel: 'Mark achieved');
    if (ok) await _status('done', success: "'${txt(_m['title'])}' marked achieved.");
  }

  Future<void> _withReason(String action) async {
    final verb = action == 'reopen' ? 'reopened' : 'cancelled';
    final reason = await promptDialog(context,
        title: action == 'reopen' ? 'Reopen milestone' : 'Cancel milestone',
        message: "Say why '${txt(_m['title'])}' is being $verb.",
        confirmLabel: action == 'reopen' ? 'Reopen' : 'Cancel milestone');
    if (reason == null || !mounted) return;
    await _status(action, reason: reason, success: "'${txt(_m['title'])}' $verb.");
  }

  Future<void> _openTask(Json s) async {
    final updated = await Navigator.of(context).push<Json>(
        MaterialPageRoute(builder: (_) => PmTaskScreen(milestone: _m, taskId: asInt(s['id']))));
    if (updated != null && mounted) setState(() => _m = updated);
  }

  @override
  Widget build(BuildContext context) {
    final m = _m;
    final st = pmMilestoneState(m['status']);
    final open = const {'todo', 'in_progress', 'blocked'}.contains(m['status']);
    final mayAchieve = truthy(m['can_work']) && open && pmFeature('milestone_status', 'approve');
    final mayReopen = truthy(m['can_edit']) && m['status'] == 'done' && pmFeature('milestone_status', 'edit');
    final mayCancel = truthy(m['can_edit']) && open && pmFeature('milestone_status', 'cancel');
    final ts = pmTasksOf(m);
    final doneN = ts.where((s) => s['status'] == 'done').length;
    final shown = ts
        .where((s) => _filter == 'all' || (_filter == 'completed' ? s['status'] == 'done' : s['status'] != 'done'))
        .toList();
    final total = pmMilestoneTotal(m);
    final project = [m['project_code'], m['project_name']].where((x) => x != null && '$x'.isNotEmpty).join(' · ');
    return SubPage(
      title: txt(m['title']),
      body: RefreshIndicator(
        onRefresh: _refresh,
        child: ListView(
          padding: const EdgeInsets.only(top: 12, bottom: 32),
          children: [
            DetailSection(
              txt(m['title']),
              action: Pill(st.$1, st.$2),
              children: [
                if (project.isNotEmpty) FieldRow('Project', project),
                FieldRow(
                    'Dates',
                    m['start_date'] != null
                        ? '${fmtDate(m['start_date'])} → ${fmtDate(m['due_date'])}'
                        : 'Expected by ${fmtDate(m['due_date'])}'),
                FieldRow(
                    'Due',
                    Text(dueText(m['due_date'], done: m['status'] == 'done'),
                        style: TextStyle(
                            fontSize: 14,
                            color: truthy(m['is_overdue']) ? const Color(0xFFBE123C) : Brand.body,
                            fontWeight: truthy(m['is_overdue']) ? FontWeight.w600 : FontWeight.w400))),
                FieldRow('Responsible',
                    '${txt(m['assignee_name'])}${m['department_name'] != null ? ' (${m['department_name']})' : ''}'),
                FieldRow('Given by',
                    '${txt(m['created_by_name'])}${m['created_at'] != null ? ' on ${fmtDate(m['created_at'])}' : ''}'),
                if ('${m['description'] ?? ''}'.isNotEmpty) FieldRow('Description', m['description']),
                if (m['status'] == 'blocked' && m['blocker_reason'] != null) FieldRow('On hold', m['blocker_reason']),
                if (m['status'] == 'cancelled' && m['cancel_reason'] != null) FieldRow('Cancelled', m['cancel_reason']),
                if (open && m['reopen_reason'] != null) FieldRow('Reopened', m['reopen_reason']),
                FieldRow('Milestone Progress', ProgressLine(pmMilestonePercent(m))),
                FieldRow('Tasks Completed', '${pmMilestoneDone(m)} / $total'),
              ],
            ),
            DetailSection(
              'Tasks (${ts.length})',
              children: [
                if (ts.isNotEmpty)
                  SingleChildScrollView(
                    scrollDirection: Axis.horizontal,
                    child: Row(children: [
                      CountChip('All', ts.length, selected: _filter == 'all', onTap: () => setState(() => _filter = 'all')),
                      CountChip('Completed', doneN,
                          selected: _filter == 'completed',
                          onTap: () => setState(() => _filter = _filter == 'completed' ? 'all' : 'completed')),
                      CountChip('Pending', ts.length - doneN,
                          selected: _filter == 'pending',
                          onTap: () => setState(() => _filter = _filter == 'pending' ? 'all' : 'pending')),
                    ]),
                  ),
                if (ts.isEmpty)
                  Padding(
                    padding: const EdgeInsets.symmetric(vertical: 8),
                    child: Text(
                      total > 0
                          ? 'This milestone has $total task${total == 1 ? '' : 's'}, none created by you or assigned to you — you see only your own tasks.'
                          : 'No tasks yet.',
                      style: const TextStyle(color: Brand.muted, fontSize: 13),
                    ),
                  )
                else if (shown.isEmpty)
                  const Padding(
                    padding: EdgeInsets.symmetric(vertical: 8),
                    child: Text('No tasks match.', style: TextStyle(color: Brand.muted, fontSize: 13)),
                  ),
                for (final s in shown) _TaskTile(m: m, s: s, onTap: () => _openTask(s)),
              ],
            ),
          ],
        ),
      ),
      bottom: (mayAchieve || mayReopen || mayCancel)
          ? Row(
              children: [
                if (mayCancel)
                  Expanded(
                    child: OutlinedButton(
                      style: OutlinedButton.styleFrom(minimumSize: const Size.fromHeight(48)),
                      onPressed: _busy ? null : () => _withReason('cancel'),
                      child: const Text('Cancel milestone'),
                    ),
                  ),
                if (mayCancel && (mayAchieve || mayReopen)) const SizedBox(width: 8),
                if (mayReopen)
                  Expanded(
                    child: OutlinedButton(
                      style: OutlinedButton.styleFrom(
                          minimumSize: const Size.fromHeight(48), foregroundColor: const Color(0xFFB45309)),
                      onPressed: _busy ? null : () => _withReason('reopen'),
                      child: const Text('Reopen'),
                    ),
                  ),
                if (mayAchieve)
                  Expanded(
                    child: FilledButton.icon(
                      style: FilledButton.styleFrom(backgroundColor: Brand.success),
                      icon: const Icon(Icons.check_rounded),
                      onPressed: _busy ? null : _achieve,
                      label: const Text('Mark achieved'),
                    ),
                  ),
              ],
            )
          : null,
    );
  }
}

class _TaskTile extends StatelessWidget {
  const _TaskTile({required this.m, required this.s, required this.onTap});
  final Json m;
  final Json s;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final state = pmTaskState(m, s);
    final pr = pmPriority(s['priority']);
    final kids = pmKidsOf(m, s['id']);
    return InkWell(
      onTap: onTap,
      child: Container(
        padding: const EdgeInsets.symmetric(vertical: 10),
        decoration: const BoxDecoration(border: Border(top: BorderSide(color: Color(0xFFE2E8F0)))),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(children: [
              Expanded(
                child: Text(txt(s['title']),
                    style: const TextStyle(fontSize: 14, fontWeight: FontWeight.w600, color: Brand.heading)),
              ),
              Pill(state.$1, state.$2),
            ]),
            const SizedBox(height: 4),
            Wrap(spacing: 12, runSpacing: 4, crossAxisAlignment: WrapCrossAlignment.center, children: [
              Text(truthy(s['mine']) ? 'You' : txt(s['assignee_name']),
                  style: TextStyle(
                      fontSize: 12.5,
                      color: truthy(s['mine']) ? const Color(0xFF2563EB) : Brand.body,
                      fontWeight: truthy(s['mine']) ? FontWeight.w700 : FontWeight.w400)),
              Pill(pr.$1, pr.$2),
              Text('Due ${fmtDate(s['due_date'])}',
                  style: TextStyle(
                      fontSize: 12.5, color: truthy(s['is_overdue']) ? const Color(0xFFBE123C) : Brand.muted)),
              if (kids.isNotEmpty)
                Text('☑ ${kids.where((k) => k['status'] == 'done').length}/${kids.length}',
                    style: const TextStyle(fontSize: 12, color: Brand.muted)),
              if (asInt(s['remarks_count']) > 0 && pmFeature('task_comments', 'view'))
                Text('💬 ${s['remarks_count']}', style: const TextStyle(fontSize: 12, color: Brand.muted)),
              if (asInt(s['files_count']) > 0 && pmFeature('task_files', 'view'))
                Text('📎 ${s['files_count']}', style: const TextStyle(fontSize: 12, color: Brand.muted)),
            ]),
            const SizedBox(height: 6),
            ProgressLine(pmTaskPercent(m, s)),
          ],
        ),
      ),
    );
  }
}

// ── Task ─────────────────────────────────────────────────────────────────────

/// One task of a milestone: status (In Progress / On Hold / Done),
/// information, checklist, comments, files and activity log. Pops the
/// updated milestone.
class PmTaskScreen extends StatefulWidget {
  const PmTaskScreen({super.key, required this.milestone, required this.taskId});
  final Json milestone;
  final int taskId;

  @override
  State<PmTaskScreen> createState() => _PmTaskScreenState();
}

const _statusChoices = [
  ('in_progress', 'In Progress', Color(0xFF1D4ED8)),
  ('on_hold', 'On Hold', Color(0xFFB45309)),
  ('done', 'Done', Color(0xFF15803D)),
];

class _PmTaskScreenState extends State<PmTaskScreen> {
  late Json _m = widget.milestone;
  bool _busy = false;
  Json? _activity;
  Object? _activityError;

  Json? get _task {
    for (final s in rowsOf(_m['subtasks'])) {
      if (asInt(s['id']) == widget.taskId) return s;
    }
    return null;
  }

  @override
  void initState() {
    super.initState();
    _loadActivity();
  }

  Future<void> _loadActivity() async {
    try {
      final d = _asJson(await Api.get('/pm-ongoing/subtasks/${widget.taskId}/activity'));
      if (mounted) {
        setState(() {
          _activity = d;
          _activityError = null;
        });
      }
    } catch (e) {
      if (mounted) setState(() => _activityError = e);
    }
  }

  /// Runs a call that returns the milestone.
  Future<bool> _run(Future<dynamic> Function() call, {String? success}) async {
    setState(() => _busy = true);
    final ok = await runAction(context, () async {
      final d = _asJson(await call());
      if (d['subtasks'] is List && mounted) setState(() => _m = d);
    }, success: success);
    if (mounted) setState(() => _busy = false);
    return ok;
  }

  Future<void> _addChecklist(Json task) async {
    final t = await promptDialog(context,
        title: 'Add a checklist item', label: 'Checklist item', confirmLabel: 'Add');
    if (t == null || t.isEmpty || !mounted) return;
    await _run(() => Api.post('/pm-ongoing/subtasks/${task['id']}/subtasks', data: {'title': t}),
        success: "'$t' added to the checklist.");
  }

  Future<void> _addRemark() async {
    final t = await promptDialog(context, title: 'Add a remark', label: 'Remark', confirmLabel: 'Save');
    if (t == null || t.isEmpty || !mounted) return;
    setState(() => _busy = true);
    final ok = await runAction(
        context, () => Api.post('/pm-ongoing/subtasks/${widget.taskId}/remarks', data: {'comment': t}),
        success: 'Remark saved.');
    if (mounted) setState(() => _busy = false);
    if (ok) {
      await _loadActivity();
      _bumpCounts();
    }
  }

  Future<void> _attach() async {
    final files = await Files.pickFiles();
    if (files.isEmpty || !mounted) return;
    setState(() => _busy = true);
    final ok = await runAction(context, () async {
      final form = FormData();
      for (final f in files) {
        form.files.add(MapEntry('files', f));
      }
      await Api.post('/pm-ongoing/subtasks/${widget.taskId}/files', data: form);
    }, success: files.length == 1 ? 'File attached.' : '${files.length} files attached.');
    if (mounted) setState(() => _busy = false);
    if (ok) {
      await _loadActivity();
      _bumpCounts();
    }
  }

  Future<void> _removeFile(Json f) async {
    final yes = await confirmDialog(context,
        title: 'Remove file?', message: "'${txt(f['file_name'])}' will be removed from this task.",
        confirmLabel: 'Remove', danger: true);
    if (!yes || !mounted) return;
    final ok = await runAction(context, () => Api.delete('/pm-ongoing/files/${f['id']}'),
        success: '${txt(f['file_name'])} removed.');
    if (ok) {
      await _loadActivity();
      _bumpCounts();
    }
  }

  /// Keeps the remark / file counts on the list in step (portal onCounts).
  void _bumpCounts() {
    final a = _activity;
    if (a == null) return;
    setState(() {
      _m = {
        ..._m,
        'subtasks': [
          for (final s in rowsOf(_m['subtasks']))
            if (asInt(s['id']) == widget.taskId)
              {...s, 'remarks_count': rowsOf(a['remarks']).length, 'files_count': rowsOf(a['files']).length}
            else
              s,
        ],
      };
    });
  }

  @override
  Widget build(BuildContext context) {
    final task = _task;
    return PopScope(
      canPop: false,
      onPopInvokedWithResult: (didPop, _) {
        if (!didPop) Navigator.of(context).pop(_m);
      },
      child: SubPage(
        title: task == null ? 'Task' : txt(task['title']),
        body: task == null
            ? const EmptyView('This task is no longer on the milestone — go back and refresh.')
            : RefreshIndicator(onRefresh: _loadActivity, child: _body(task)),
      ),
    );
  }

  Widget _body(Json task) {
    final m = _m;
    final state = pmTaskState(m, task);
    final pr = pmPriority(task['priority']);
    final kids = pmKidsOf(m, task['id']);
    final canStatus = (truthy(task['can_toggle']) || truthy(task['can_edit']) || truthy(task['mine']) ||
            truthy(task['collab'])) &&
        pmFeature('tasks', 'edit');
    final labels = (task['labels'] is List) ? (task['labels'] as List).map((e) => '$e').toList() : <String>[];
    final collaborators =
        (task['collaborator_names'] is List) ? (task['collaborator_names'] as List).join(', ') : '';
    final a = _activity;
    final me = Perm.userId;
    final canWrite = a != null && a['can_write'] == true;
    return ListView(
      padding: const EdgeInsets.only(top: 12, bottom: 32),
      children: [
        DetailSection(
          txt(task['title']),
          action: Pill(state.$1, state.$2),
          children: [
            Text('Created on ${fmtDate(task['created_at'])} by ${txt(task['created_by_name'])}',
                style: const TextStyle(fontSize: 12.5, color: Brand.muted)),
            if (canStatus) ...[
              const SizedBox(height: 10),
              Wrap(spacing: 8, runSpacing: 8, children: [
                for (final (k, label, color) in _statusChoices)
                  ChoiceChip(
                    label: Text(label),
                    selected: task['status'] == k,
                    selectedColor: color.withValues(alpha: 0.15),
                    labelStyle: TextStyle(
                        color: task['status'] == k ? color : Brand.body, fontWeight: FontWeight.w600, fontSize: 13),
                    side: BorderSide(color: task['status'] == k ? color : Brand.border),
                    onSelected: _busy || task['status'] == k
                        ? null
                        : (_) => _run(() => Api.patch('/pm-ongoing/subtasks/${task['id']}', data: {'status': k}),
                            success: "'${txt(task['title'])}' is now $label."),
                  ),
              ]),
            ],
          ],
        ),
        DetailSection('Description', children: [
          Text('${task['description'] ?? ''}'.isEmpty ? 'No description.' : '${task['description']}',
              style: TextStyle(
                  fontSize: 14, color: '${task['description'] ?? ''}'.isEmpty ? Brand.muted : Brand.body)),
        ]),
        DetailSection('Task Information', children: [
          FieldRow('Priority', Align(alignment: Alignment.centerLeft, child: Pill(pr.$1, pr.$2))),
          FieldRow('Assignee', truthy(task['mine']) ? 'You' : txt(task['assignee_name'])),
          FieldRow('Collaborators', collaborators.isEmpty ? '—' : collaborators),
          FieldRow('Start Date', fmtDate(task['start_date'])),
          FieldRow(
              'Due Date',
              Text(fmtDate(task['due_date']),
                  style: TextStyle(
                      fontSize: 14, color: truthy(task['is_overdue']) ? const Color(0xFFBE123C) : Brand.body))),
          if (task['completed_at'] != null) FieldRow('Completed', fmtDate(task['completed_at'])),
          FieldRow('Progress', ProgressLine(pmTaskPercent(m, task), color: Brand.success)),
          FieldRow('Labels / Tags', labels.isEmpty ? 'No labels.' : labels.join(', ')),
          FieldRow('Milestone', m['title']),
          FieldRow('Responsible', m['assignee_name']),
        ]),
        if (pmFeature('task_checklist', 'view'))
          DetailSection(
            'Checklist (${kids.length})',
            action: truthy(task['can_add_child'])
                ? TextButton.icon(
                    onPressed: _busy ? null : () => _addChecklist(task),
                    icon: const Icon(Icons.add_rounded, size: 18),
                    label: const Text('Add'))
                : null,
            children: [
              if (kids.isEmpty)
                const Text('No checklist items.', style: TextStyle(fontSize: 13, color: Brand.muted))
              else
                Text('${kids.where((k) => k['status'] == 'done').length} / ${kids.length} completed',
                    style: const TextStyle(fontSize: 12, color: Brand.muted)),
              for (final k in kids)
                CheckboxListTile(
                  contentPadding: EdgeInsets.zero,
                  controlAffinity: ListTileControlAffinity.leading,
                  dense: true,
                  value: k['status'] == 'done',
                  title: Text(txt(k['title']),
                      style: TextStyle(
                          decoration: k['status'] == 'done' ? TextDecoration.lineThrough : null,
                          color: k['status'] == 'done' ? Brand.muted : Brand.heading)),
                  onChanged: !truthy(k['can_toggle']) || _busy
                      ? null
                      : (v) => _run(() => Api.post('/pm-ongoing/subtasks/${k['id']}/status', data: {'done': v == true})),
                ),
            ],
          ),
        if (_activityError != null && a == null)
          Padding(
            padding: const EdgeInsets.fromLTRB(16, 0, 16, 12),
            child: ErrorBanner(ApiClient.describe(_activityError!)),
          ),
        if (pmFeature('task_comments', 'view'))
          DetailSection(
            'Comments (${a == null ? asInt(task['remarks_count']) : rowsOf(a['remarks']).length})',
            action: canWrite && pmFeature('task_comments', 'create')
                ? TextButton.icon(
                    onPressed: _busy ? null : _addRemark,
                    icon: const Icon(Icons.add_comment_outlined, size: 18),
                    label: const Text('Add'))
                : null,
            children: [
              if (a == null)
                const Text('Loading remarks…', style: TextStyle(fontSize: 13, color: Brand.muted))
              else if (rowsOf(a['remarks']).isEmpty)
                const Text('No remarks yet.', style: TextStyle(fontSize: 13, color: Brand.muted))
              else
                for (final r in rowsOf(a['remarks']))
                  Padding(
                    padding: const EdgeInsets.symmetric(vertical: 6),
                    child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                      Text('${r['user_id'] == me ? 'You' : txt(r['user_name'])} · ${fmtDateTime(r['created_at'])}',
                          style: const TextStyle(fontSize: 11.5, color: Brand.muted)),
                      Text(txt(r['comment']), style: const TextStyle(fontSize: 13.5, color: Brand.body)),
                    ]),
                  ),
            ],
          ),
        if (pmFeature('task_files', 'view'))
          DetailSection(
            'Files (${a == null ? asInt(task['files_count']) : rowsOf(a['files']).length})',
            action: canWrite && pmFeature('task_files', 'create')
                ? TextButton.icon(
                    onPressed: _busy ? null : _attach,
                    icon: const Icon(Icons.attach_file_rounded, size: 18),
                    label: const Text('Attach file'))
                : null,
            children: [
              if (a == null)
                const Text('Loading files…', style: TextStyle(fontSize: 13, color: Brand.muted))
              else if (rowsOf(a['files']).isEmpty)
                const Text('No files attached.', style: TextStyle(fontSize: 13, color: Brand.muted))
              else
                for (final f in rowsOf(a['files']))
                  ListTile(
                    contentPadding: EdgeInsets.zero,
                    dense: true,
                    leading: const Icon(Icons.attach_file_rounded),
                    title: Text(txt(f['file_name'])),
                    subtitle: Text(txt(f['uploaded_by_name'])),
                    onTap: pmFeature('task_files', 'export')
                        ? () => runAction(
                            context,
                            () => Files.downloadAndOpen(
                                '/pm-ongoing/files/${f['id']}/content', '${f['file_name'] ?? 'file'}'))
                        : null,
                    trailing: canWrite && f['uploaded_by_id'] == me && pmFeature('task_files', 'delete')
                        ? IconButton(
                            tooltip: 'Remove',
                            icon: const Icon(Icons.delete_outline_rounded, color: Brand.danger),
                            onPressed: _busy ? null : () => _removeFile(f),
                          )
                        : null,
                  ),
            ],
          ),
        if (pmFeature('task_log', 'view'))
          DetailSection('Activity Log', children: [
            if (a == null)
              const Text('Loading…', style: TextStyle(fontSize: 13, color: Brand.muted))
            else if (rowsOf(a['log']).isEmpty)
              const Text('Nothing recorded yet. Changes made from now on are listed here.',
                  style: TextStyle(fontSize: 13, color: Brand.muted))
            else
              for (final l in rowsOf(a['log']))
                Padding(
                  padding: const EdgeInsets.symmetric(vertical: 5),
                  child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                    Text(
                        [
                          txt(l['text']),
                          if (l['to_status'] != null)
                            '${humanize(l['from_status'] ?? '')} → ${humanize(l['to_status'])}',
                        ].join(' · '),
                        style: const TextStyle(fontSize: 13, color: Brand.body)),
                    Text('${txt(l['user_name'])} · ${fmtDateTime(l['created_at'])}',
                        style: const TextStyle(fontSize: 11.5, color: Brand.muted)),
                  ]),
                ),
          ]),
      ],
    );
  }
}
