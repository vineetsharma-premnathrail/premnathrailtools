import 'package:dio/dio.dart';
import 'package:flutter/material.dart';

import '../../api/api.dart';
import '../../theme.dart';
import '../../ui/app_frame.dart';
import '../../ui/form.dart';
import '../../ui/format.dart';
import '../../ui/perms.dart';
import '../../ui/widgets.dart';
import 'rnd_common.dart';
import 'rnd_task_board.dart';

const _eventMeta = <String, (String, String, String)>{
  'created': ('assigned this task', '#2563EB', 'Brief'),
  'update': ('posted an update', '#7C3AED', 'Update'),
  'completed': ('completed the task', '#16A34A', 'Completion note'),
  'extended': ('moved the due date', '#D97706', 'Reason'),
  'reopened': ('reopened the task', '#B45309', 'What still needs to be done'),
  'cancelled': ('cancelled the task', '#78716c', 'Reason'),
  'edited': ('edited the task', '#78716c', 'Changes'),
  'approval_requested': ('asked for approval', '#D97706', 'Request'),
  'approved': ('approved the request', '#16A34A', 'Remarks'),
  'rejected': ('rejected the request', '#DC2626', 'Reason'),
  'approval_withdrawn': ('withdrew the approval request', '#78716c', ''),
  'progress': ('updated progress', '#7C3AED', ''),
  'submitted': ('marked it done', '#16A34A', 'Completion note'),
  'closed': ('closed the task', '#16A34A', 'Remarks'),
};
const _approvalLabels = {
  'pending': 'Waiting for decision',
  'approved': 'Approved',
  'rejected': 'Rejected',
  'withdrawn': 'Withdrawn',
};
const _approvalHex = {'pending': '#D97706', 'approved': '#16A34A', 'rejected': '#DC2626', 'withdrawn': '#78716c'};

/// One task opened (portal: TaskView): header, then Overview · Sub-tasks ·
/// Files · Approvals · Activity, and the actions this person may do in the
/// bottom bar.
class TaskDetailScreen extends StatefulWidget {
  const TaskDetailScreen({
    super.key,
    required this.api,
    required this.all,
    required this.taskId,
    required this.canManage,
    required this.rights,
    required this.labels,
    required this.people,
    required this.team,
  });

  final RndTaskApi api;
  final List<Json> all;
  final int taskId;
  final bool canManage;
  final TaskRights rights;
  final TaskLabels labels;
  final List<Json> people;
  final List<Json> team;

  @override
  State<TaskDetailScreen> createState() => _TaskDetailScreenState();
}

class _TaskDetailScreenState extends State<TaskDetailScreen> {
  late List<Json> _all = [...widget.all];
  late int _id = widget.taskId;
  String _tab = 'Overview';
  bool _busy = false;
  final _pct = TextEditingController();

  int get _me => Perm.userId ?? -1;
  String get _myName => str(Perm.user, 'name') ?? '';

  Json? _find(Object? id) {
    for (final t in _all) {
      if (tid(t) == intOf(id)) return t;
    }
    return null;
  }

  Json? get _task => _find(_id);

  @override
  void initState() {
    super.initState();
    _syncPct();
  }

  @override
  void dispose() {
    _pct.dispose();
    super.dispose();
  }

  void _syncPct() => _pct.text = '${intOf(_task?['progress_percent']) ?? 0}';

  void _replace(Json t) {
    if (t.isEmpty || !mounted) return;
    setState(() {
      _all = [for (final x in _all) tid(x) == tid(t) ? t : x];
      _syncPct();
    });
  }

  Future<void> _reload() async {
    try {
      final l = await widget.api.list();
      if (mounted) {
        setState(() {
          _all = l;
          _syncPct();
        });
      }
    } catch (e) {
      if (mounted) showSnack(context, ApiClient.describe(e), error: true);
    }
  }

  void _openTask(int id) => setState(() {
    _id = id;
    _tab = 'Overview';
    _syncPct();
  });

  Future<void> _progress(Json body) async {
    setState(() => _busy = true);
    try {
      _replace(await widget.api.progress(_id, body));
    } catch (e) {
      if (mounted) showSnack(context, ApiClient.describe(e), error: true);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  // ── Action popups (portal: PANEL_META) ──

  Future<void> _textAction({
    required String title,
    required String saveLabel,
    required String textLabel,
    String? textHint,
    required String emptyError,
    required String hint,
    bool withFiles = true,
    String filesLabel = 'Attach documents',
    bool askDelay = false,
    String? Function()? precheck,
    required Future<Json> Function(String text, String? delay, List<MultipartFile> files) run,
  }) async {
    final t = _task!;
    final text = TextEditingController();
    final delay = TextEditingController();
    var files = <MultipartFile>[];
    Json? result;
    final block = precheck?.call();
    final ok = await showFormSheet(
      context,
      title: title,
      saveLabel: saveLabel,
      builder: (ctx, setS) => [
        Hint("Task '${str(t, 'title')}'"),
        if (block != null) NoteBox(block, color: const Color(0xFFB45309), margin: EdgeInsets.zero),
        AppTextField(label: textLabel, controller: text, required: true, maxLines: 4, hint: textHint),
        if (askDelay)
          AppTextField(
            label: 'Reason for the delay (was due ${fmtDate(t['due_date'])})',
            controller: delay,
            required: true,
            maxLines: 3,
          ),
        if (withFiles) FilesField(label: '$filesLabel (optional)', files: files, onChanged: (f) => setS(() => files = f)),
        Hint(hint),
      ],
      onSave: () async {
        final b = precheck?.call();
        if (b != null) throw b;
        if (text.text.trim().isEmpty) throw emptyError;
        if (askDelay && delay.text.trim().isEmpty) throw 'This task is past its due date — enter the reason for the delay.';
        result = await run(text.text.trim(), askDelay ? delay.text.trim() : null, files);
      },
    );
    if (ok && result != null) {
      _replace(result!);
      if (str(result, 'status') == 'cancelled') await _reload();
    }
  }

  Future<void> _complete() {
    final t = _task!;
    final subs = _all.where((s) => intOf(s['parent_task_id']) == _id && s['status'] == 'open').toList();
    final unticked = jsonList(t['checklist']).where((c) => !boolOf(c['done'])).toList();
    return _textAction(
      title: 'Complete Task',
      saveLabel: 'Complete task',
      textLabel: 'What you did',
      textHint: 'Result, assumptions, open points',
      emptyError: 'Describe what you did before completing the task.',
      hint: 'The task is closed and the person who assigned it is notified. They can reopen it if something is missing.',
      filesLabel: 'Attach work',
      askDelay: boolOf(t['is_overdue']),
      precheck: () {
        if (subs.isNotEmpty) return '${subs.length} sub-task(s) are still open — they must be completed or cancelled first.';
        if (boolOf(t['pending_approval'])) {
          return 'Your approval request is still waiting for a decision — wait for it or withdraw it first.';
        }
        if (unticked.isNotEmpty) {
          return '${unticked.length} checklist step(s) are not ticked yet: '
              '${unticked.take(3).map((c) => '“${c['text']}”').join(', ')}. Tick them off on the Overview tab before completing.';
        }
        return null;
      },
      run: (text, delay, files) => widget.api.complete(_id, text, delay, files),
    );
  }

  Future<void> _update() => _textAction(
    title: 'Add Update',
    saveLabel: 'Post update',
    textLabel: 'Update / remarks',
    textHint: 'Progress so far, findings, questions for the reviewer',
    emptyError: 'Write the update — what you did or found so far.',
    hint: 'The task stays open; the person who assigned it is notified. Use “Complete task” when the work is finished.',
    run: (text, _, files) => widget.api.update(_id, text, files),
  );

  Future<void> _approval() {
    final t = _task!;
    final by = '${t['created_by']}${intOf(t['created_by_id']) == _me ? ' (you)' : ''}';
    return _textAction(
      title: 'Ask for Approval',
      saveLabel: 'Send for approval',
      textLabel: 'What do you need approved?',
      textHint: 'e.g. Approve EN24 instead of EN8 for the axle — EN8 fails the fatigue check (calc attached)',
      emptyError: 'Write what you need approved — e.g. the drawing, material or deviation and why.',
      hint: 'Goes to $by (and the ${widget.labels.manager}). The task stays open while they decide.',
      run: (text, _, files) => widget.api.requestApproval(_id, text, files),
    );
  }

  Future<void> _cancelTask() {
    final open = _all.where((s) => intOf(s['parent_task_id']) == _id && s['status'] == 'open').length;
    return _textAction(
      title: 'Cancel Task',
      saveLabel: 'Cancel task',
      textLabel: 'Why is it cancelled?',
      emptyError: 'Enter why the task is cancelled.',
      hint:
          '${open > 0 ? 'Its $open open sub-task(s) will be cancelled too. ' : ''}The task and its history are kept; the assignee is notified.',
      withFiles: false,
      run: (text, _, _) => widget.api.cancel(_id, text),
    );
  }

  Future<void> _extend() async {
    final t = _task!;
    final text = TextEditingController();
    DateTime? date;
    Json? result;
    final ok = await showFormSheet(
      context,
      title: 'Need More Time',
      saveLabel: 'Save new date',
      builder: (ctx, setS) => [
        Hint("Task '${str(t, 'title')}'"),
        AppTextField(
          label: 'Reason it isn’t complete',
          controller: text,
          required: true,
          maxLines: 3,
          hint: 'e.g. Waiting for RDSO drawing approval',
        ),
        DateField(label: 'New completion date', required: true, value: date, onChanged: (d) => setS(() => date = d)),
        Hint(
          'The new date becomes the task’s due date; the ${widget.labels.manager} is notified and the original date '
          '(${fmtDate(t['original_due_date'])}) stays on record.',
        ),
      ],
      onSave: () async {
        if (text.text.trim().isEmpty) throw 'Enter the reason the task isn’t complete by its due date.';
        if (date == null) throw 'Pick the new completion date.';
        if (apiDate(date!).compareTo(isoDay(t['due_date'])) <= 0) {
          throw 'The new completion date must be after the current due date (${fmtDate(t['due_date'])}).';
        }
        result = await widget.api.extend(_id, text.text.trim(), apiDate(date!));
      },
    );
    if (ok && result != null) _replace(result!);
  }

  Future<void> _reopen() async {
    final t = _task!;
    final dueMissed = isoDay(t['due_date']).compareTo(todayIso()) < 0;
    final text = TextEditingController();
    DateTime? date;
    Json? result;
    final ok = await showFormSheet(
      context,
      title: 'Reopen Task',
      saveLabel: 'Reopen task',
      builder: (ctx, setS) => [
        Hint("Task '${str(t, 'title')}'"),
        AppTextField(label: 'What still needs to be done', controller: text, required: true, maxLines: 3),
        DateField(label: 'New due date', required: dueMissed, value: date, onChanged: (d) => setS(() => date = d)),
      ],
      onSave: () async {
        if (text.text.trim().isEmpty) throw 'Enter what still needs to be done.';
        if (dueMissed && date == null) throw 'The due date has passed — set a new due date.';
        result = await widget.api.reopen(_id, text.text.trim(), date == null ? null : apiDate(date!));
      },
    );
    if (ok && result != null) _replace(result!);
  }

  Future<void> _edit() async {
    final t = _task!;
    final isSub = t['parent_task_id'] != null;
    final parent = _find(t['parent_task_id']);
    final saved = await showTaskForm(
      context,
      mode: 'edit',
      people: isSub ? widget.team : (widget.people.isNotEmpty ? widget.people : widget.team),
      initial: t,
      parentTitle: str(parent, 'title'),
      onSubmit: (f, _) => widget.api.edit(_id, Map<String, dynamic>.from(f)),
    );
    if (saved != null) _replace(saved);
  }

  Future<void> _subtask() async {
    final t = _task!;
    final saved = await showTaskForm(
      context,
      mode: 'subtask',
      people: widget.team,
      maxDue: str(t, 'due_date'),
      parentTitle: str(t, 'title'),
      onSubmit: (f, files) => widget.api.create(f, files, parentId: _id),
    );
    if (saved != null) {
      await _reload();
      if (mounted) setState(() => _tab = 'Sub-tasks');
    }
  }

  Future<void> _decide(Json a, bool approve) async {
    final remarks = await promptDialog(
      context,
      title: approve ? 'Approve the request?' : 'Reject the request?',
      message: approve ? null : 'Enter why you reject it — the assignee needs to know what to change.',
      label: approve ? 'Remarks (optional)' : 'Reason',
      required: !approve,
      confirmLabel: approve ? 'Approve' : 'Reject',
    );
    if (remarks == null || !mounted) return;
    await runAction(context, () async {
      _replace(await widget.api.decide(intOf(a['id'])!, approve ? 'approve' : 'reject', remarks.isEmpty ? null : remarks));
    });
  }

  Future<void> _withdraw(Json a) async {
    final ok = await confirmDialog(
      context,
      title: 'Withdraw request?',
      message: 'Your approval request is taken back; you can ask again later.',
      confirmLabel: 'Withdraw',
    );
    if (!ok || !mounted) return;
    await runAction(context, () async => _replace(await widget.api.withdraw(intOf(a['id'])!)));
  }

  @override
  Widget build(BuildContext context) {
    final t = _task;
    if (t == null) {
      return const SubPage(title: 'Task', body: EmptyView('This task is no longer on the list — it may have been removed.'));
    }
    final mine = intOf(t['assigned_to_id']) == _me;
    final isSub = t['parent_task_id'] != null;
    final parent = _find(t['parent_task_id']);
    final subtasks = _all.where((s) => intOf(s['parent_task_id']) == _id).toList();
    final canReview = widget.canManage || intOf(t['created_by_id']) == _me;
    final canProgress = mine || (canReview && widget.rights.edit);
    final isOpen = t['status'] == 'open';
    final isDone = isDoneTask(t);
    final canEdit = canReview && widget.rights.edit && isOpen;
    final canSplit = mine && !isSub && isOpen && widget.rights.create;
    final approvals = jsonList(t['approvals']);
    final events = jsonList(t['events']);
    final (stText, stColor) = taskState(t);
    final pending = boolOf(t['pending_approval']);

    final tabs = [
      'Overview',
      if (!isSub && (subtasks.isNotEmpty || canSplit)) 'Sub-tasks ${subtasks.where(isDoneTask).length}/${subtasks.length}',
      'Files ${docCount(t)}',
      'Approvals ${approvals.length}',
      'Activity ${events.length}',
    ];
    final current = tabs.firstWhere((x) => x.startsWith(_tab), orElse: () => tabs.first);

    // The assignee's work first, then the giver's controls - only what this person may do.
    final actions = <(String, IconData, VoidCallback?)>[
      if (mine && isOpen) ...[
        ('Complete task', Icons.check_rounded, _complete),
        ('Add update', Icons.chat_bubble_outline_rounded, _update),
        (pending ? 'Approval pending' : 'Ask for approval', Icons.verified_user_outlined, pending ? null : _approval),
        (boolOf(t['is_overdue']) ? 'Reason & new date' : 'Need more time', Icons.schedule_rounded, _extend),
      ],
      if (canSplit) ('Sub-task', Icons.add_rounded, _subtask),
      if (canReview && widget.rights.edit && isDone) ('Reopen', Icons.undo_rounded, _reopen),
      if (canReview && widget.rights.cancel && isOpen) ('Cancel task', Icons.close_rounded, _cancelTask),
    ];

    return SubPage(
      title: isSub ? 'Sub-task' : 'Task',
      actions: [if (canEdit) IconButton(tooltip: 'Edit', onPressed: _busy ? null : _edit, icon: const Icon(Icons.edit_outlined))],
      bottom: actions.isEmpty ? null : ActionBar(actions: actions),
      body: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Container(
            color: Colors.white,
            padding: const EdgeInsets.fromLTRB(16, 12, 16, 8),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                if (parent != null)
                  InkWell(
                    onTap: () => _openTask(tid(parent)),
                    child: Padding(
                      padding: const EdgeInsets.only(bottom: 4),
                      child: Text(
                        '← Sub-task of “${str(parent, 'title')}”',
                        style: const TextStyle(fontSize: 12.5, color: Color(0xFF7C3AED), fontWeight: FontWeight.w600),
                      ),
                    ),
                  ),
                Row(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Expanded(
                      child: Text(
                        str(t, 'title') ?? '',
                        style: const TextStyle(fontSize: 18, fontWeight: FontWeight.w700, color: Brand.heading),
                      ),
                    ),
                    const SizedBox(width: 8),
                    Pill(stText, stColor),
                  ],
                ),
                const SizedBox(height: 4),
                Text(
                  'Given by ${t['created_by'] ?? '—'}${intOf(t['created_by_id']) == _me ? ' (you)' : ''}'
                  '${t['created_at'] != null ? ' on ${fmtDate(t['created_at'])}' : ''}',
                  style: const TextStyle(fontSize: 12.5, color: Brand.muted),
                ),
                if (isOpen && canProgress) ...[
                  const SizedBox(height: 8),
                  const Text('Work status — how the task stands', style: TextStyle(fontSize: 12, color: Brand.muted)),
                  const SizedBox(height: 4),
                  Segmented<String>(
                    options: [for (final e in workLabels.entries) Option(e.key, e.value)],
                    value: str(t, 'work_status') ?? 'not_started',
                    onChanged: (v) {
                      if (!_busy && v != t['work_status']) _progress({'work_status': v});
                    },
                  ),
                ],
              ],
            ),
          ),
          if (mine && isOpen && boolOf(t['is_overdue']))
            NoteBox(
              'This task was due on ${fmtDate(t['due_date'])}. Use “Reason & new date” to give the reason and your new '
              'completion date, or complete it with a delay reason.',
              color: const Color(0xFFDC2626),
              margin: const EdgeInsets.fromLTRB(16, 10, 16, 0),
            ),
          SubTabs(tabs: tabs, current: current, onTap: (x) => setState(() => _tab = x.split(' ').first)),
          const Divider(height: 1),
          Expanded(
            child: RefreshIndicator(
              onRefresh: _reload,
              child: ListView(
                padding: const EdgeInsets.only(top: 12, bottom: 32),
                children: switch (current.split(' ').first) {
                  'Sub-tasks' => _subtasksTab(subtasks, canSplit),
                  'Files' => _filesTab(t, mine && isOpen),
                  'Approvals' => _approvalsTab(t, approvals, canReview && widget.rights.approve && !mine, mine && isOpen),
                  'Activity' =>
                    events.isEmpty
                        ? [const EmptyView('Nothing recorded yet.', icon: Icons.history_rounded)]
                        : [for (final e in events.reversed) EventTile(event: e, me: _myName)],
                  _ => _overviewTab(t, mine, isOpen, canProgress, canEdit, parent, subtasks, approvals, events),
                },
              ),
            ),
          ),
        ],
      ),
    );
  }

  List<Widget> _overviewTab(
    Json t,
    bool mine,
    bool isOpen,
    bool canProgress,
    bool canEdit,
    Json? parent,
    List<Json> subtasks,
    List<Json> approvals,
    List<Json> events,
  ) {
    final checklist = jsonList(t['checklist']);
    final pctText = _pct.text.trim();
    final pctValid = RegExp(r'^\d{1,3}$').hasMatch(pctText) && int.parse(pctText) <= 100;
    final dueChanged = isoDay(t['due_date']) != isoDay(t['original_due_date']);
    final st = taskState(t);
    return [
      DetailSection(
        'Description',
        children: [
          Text(
            str(t, 'remarks') ?? 'No description.',
            style: TextStyle(fontSize: 13.5, color: t['remarks'] == null ? Brand.muted : Brand.body),
          ),
        ],
      ),
      DetailSection(
        'Checklist (${checklist.length})',
        action: checklist.isEmpty
            ? null
            : Text(
                '${t['checklist_done'] ?? 0} / ${checklist.length} completed',
                style: const TextStyle(fontSize: 12, color: Brand.muted),
              ),
        children: [
          if (checklist.isEmpty)
            Text('No checklist steps.${canEdit ? ' Add them with Edit.' : ''}', style: const TextStyle(color: Brand.muted)),
          for (final c in checklist)
            CheckboxListTile(
              contentPadding: EdgeInsets.zero,
              dense: true,
              controlAffinity: ListTileControlAffinity.leading,
              value: boolOf(c['done']),
              onChanged: isOpen && canProgress && !_busy ? (v) => _progress({'item_id': c['id'], 'done': v == true}) : null,
              title: Text(
                str(c, 'text') ?? '',
                style: TextStyle(
                  fontSize: 13.5,
                  color: boolOf(c['done']) ? Brand.muted : Brand.heading,
                  decoration: boolOf(c['done']) ? TextDecoration.lineThrough : null,
                ),
              ),
              subtitle: boolOf(c['done']) && c['done_by'] != null
                  ? Text(
                      '${c['done_by']}${c['done_at'] != null ? ' · ${fmtDateTime(c['done_at'])}' : ''}',
                      style: const TextStyle(fontSize: 11),
                    )
                  : null,
            ),
        ],
      ),
      if (events.isNotEmpty)
        DetailSection(
          'Latest activity',
          action: events.length > 1
              ? TextButton(onPressed: () => setState(() => _tab = 'Activity'), child: Text('See all (${events.length})'))
              : null,
          children: [EventTile(event: events.last, me: _myName, padded: false)],
        ),
      DetailSection(
        'Task Information',
        children: [
          KeyValue('Status', Align(alignment: Alignment.centerLeft, child: Pill(st.$1, st.$2))),
          KeyValue(
            'Priority',
            Align(alignment: Alignment.centerLeft, child: Pill(priorityLabel(t['priority']), priorityColor(t['priority']))),
          ),
          KeyValue('Assignee', mine ? 'You' : t['assigned_to']),
          KeyValue('Start Date', fmtDate(t['start_date'])),
          KeyValue(
            'Due Date',
            Text(
              '${fmtDate(t['due_date'])}${dueChanged ? ' (re-dated ${t['extensions'] ?? 0}×, was ${fmtDate(t['original_due_date'])})' : ''}',
              style: TextStyle(
                fontSize: 13.5,
                color: boolOf(t['is_overdue']) ? const Color(0xFFBE123C) : Brand.body,
                fontWeight: boolOf(t['is_overdue']) ? FontWeight.w600 : FontWeight.w400,
              ),
            ),
          ),
          if (t['closed_at'] != null) KeyValue(t['status'] == 'cancelled' ? 'Cancelled' : 'Completed', fmtDate(t['closed_at'])),
          KeyValue('Progress', ProgressLine(taskPercent(t))),
          if (checklist.isNotEmpty)
            Hint('Follows the ticked checklist steps (${t['checklist_done'] ?? 0} of ${checklist.length}).'),
          if (checklist.isEmpty && isOpen && canProgress) ...[
            const SizedBox(height: 8),
            Row(
              children: [
                SizedBox(
                  width: 110,
                  child: TextField(
                    controller: _pct,
                    keyboardType: TextInputType.number,
                    onChanged: (_) => setState(() {}),
                    decoration: fieldDecoration('Progress %'),
                  ),
                ),
                const SizedBox(width: 8),
                OutlinedButton(
                  onPressed: _busy || !pctValid || int.parse(pctText) == (intOf(t['progress_percent']) ?? 0)
                      ? null
                      : () => _progress({'progress_percent': int.parse(pctText)}),
                  child: const Text('Save progress'),
                ),
              ],
            ),
            if (!pctValid) const Hint('Progress must be a whole number from 0 to 100.', color: Color(0xFFB91C1C)),
          ],
          if (boolOf(t['requirement_changed']) && isOpen)
            const NoteBox(
              'The requirement changed since this task was created — check the latest revision before you continue.',
              color: Color(0xFFEA580C),
              margin: EdgeInsets.only(top: 8),
            ),
        ],
      ),
      DetailSection(
        'Related Items',
        children: [
          if (t['requirement_ref'] != null)
            KeyValue(
              'Requirement',
              '${t['requirement_ref']}${t['requirement_title'] != null ? ' — ${t['requirement_title']}' : ''}',
            ),
          if (parent != null)
            KeyValue(
              'Main task',
              InkWell(
                onTap: () => _openTask(tid(parent)),
                child: Text(
                  str(parent, 'title') ?? '',
                  style: const TextStyle(color: Color(0xFF2563EB), fontWeight: FontWeight.w600),
                ),
              ),
            ),
          if (t['parent_task_id'] == null)
            KeyValue(
              'Sub-tasks',
              subtasks.isEmpty ? 'None' : '${subtasks.where(isDoneTask).length} of ${subtasks.length} completed',
            ),
          KeyValue('Files', '${docCount(t)}'),
          KeyValue(
            'Approvals',
            approvals.isEmpty ? 'None' : '${approvals.length}${boolOf(t['pending_approval']) ? ' · 1 waiting' : ''}',
          ),
        ],
      ),
    ];
  }

  List<Widget> _subtasksTab(List<Json> subs, bool canSplit) => [
    const NoteBox(
      'The assignee splits the work; the main task completes once every sub-task is completed or cancelled.',
      color: Brand.muted,
    ),
    if (canSplit)
      Padding(
        padding: const EdgeInsets.fromLTRB(16, 0, 16, 12),
        child: FilledButton.icon(onPressed: _subtask, icon: const Icon(Icons.add_rounded), label: const Text('Add Sub-task')),
      ),
    if (subs.isEmpty) const EmptyView('No sub-tasks yet.', icon: Icons.checklist_rounded),
    for (final s in subs) TaskRowCard(task: s, depth: 0, all: _all, me: _me, onTap: () => _openTask(tid(s))),
  ];

  List<Widget> _filesTab(Json t, bool canUpload) {
    final groups = [
      ('Attached when the task was given', jsonList(t['brief_documents'])),
      ('Work & updates from the assignee', jsonList(t['work_documents'])),
      ('With approval requests', [for (final a in jsonList(t['approvals'])) ...jsonList(a['documents'])]),
    ];
    return [
      const NoteBox("Files given with the task, the assignee's work, and files sent with approval requests.", color: Brand.muted),
      if (canUpload)
        Padding(
          padding: const EdgeInsets.fromLTRB(16, 0, 16, 12),
          child: FilledButton.icon(
            onPressed: _update,
            icon: const Icon(Icons.upload_file_rounded),
            label: const Text('Upload files'),
          ),
        ),
      if (docCount(t) == 0)
        EmptyView(
          'No files yet.${canUpload ? ' Upload your work with “Upload files” — it is posted as an update.' : ''}',
          icon: Icons.attach_file_rounded,
        ),
      for (final (title, docs) in groups)
        if (docs.isNotEmpty)
          DetailSection(
            '$title (${docs.length})',
            children: [for (final d in docs) DocTile(doc: d, onOpen: () => widget.api.openDoc(context, d))],
          ),
    ];
  }

  List<Widget> _approvalsTab(Json t, List<Json> approvals, bool canDecide, bool canAsk) {
    final by = '${t['created_by']}${intOf(t['created_by_id']) == _me ? ' (you)' : ''}';
    return [
      NoteBox(
        'Something task-related the assignee needs signed off — $by or the ${widget.labels.manager} decides; the task stays open.',
        color: Brand.muted,
      ),
      if (canAsk && !boolOf(t['pending_approval']))
        Padding(
          padding: const EdgeInsets.fromLTRB(16, 0, 16, 12),
          child: FilledButton.icon(
            onPressed: _approval,
            icon: const Icon(Icons.verified_user_outlined),
            label: const Text('Ask for approval'),
          ),
        ),
      if (approvals.isEmpty) const EmptyView('No approval requests.', icon: Icons.verified_user_outlined),
      for (final a in approvals)
        Padding(
          padding: const EdgeInsets.fromLTRB(16, 0, 16, 10),
          child: Card(
            child: Padding(
              padding: const EdgeInsets.all(12),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Row(
                    children: [
                      Expanded(
                        child: Text(
                          '${a['requested_by'] ?? '—'}${intOf(a['requested_by_id']) == _me ? ' (you)' : ''} · ${fmtDateTime(a['requested_at'])}',
                          style: const TextStyle(fontSize: 12, color: Brand.muted),
                        ),
                      ),
                      Pill(_approvalLabels[a['status']] ?? txt(a['status']), hexColor(_approvalHex[a['status']] ?? '#78716c')),
                    ],
                  ),
                  const SizedBox(height: 6),
                  Text(str(a, 'request') ?? '', style: const TextStyle(fontSize: 13.5, color: Brand.body)),
                  for (final d in jsonList(a['documents'])) DocTile(doc: d, onOpen: () => widget.api.openDoc(context, d)),
                  if (a['status'] == 'approved' || a['status'] == 'rejected')
                    Padding(
                      padding: const EdgeInsets.only(top: 6),
                      child: Text(
                        '${a['status'] == 'approved' ? 'Approved' : 'Rejected'} by ${a['decided_by'] ?? '—'} · ${fmtDateTime(a['decided_at'])}'
                        '${a['decision_remarks'] != null ? ' — ${a['decision_remarks']}' : ''}',
                        style: const TextStyle(fontSize: 12.5, color: Brand.muted),
                      ),
                    ),
                  if (a['status'] == 'pending' && canDecide)
                    Padding(
                      padding: const EdgeInsets.only(top: 8),
                      child: Row(
                        children: [
                          Expanded(
                            child: OutlinedButton(
                              style: OutlinedButton.styleFrom(foregroundColor: Brand.success),
                              onPressed: () => _decide(a, true),
                              child: const Text('Approve'),
                            ),
                          ),
                          const SizedBox(width: 8),
                          Expanded(
                            child: OutlinedButton(
                              style: OutlinedButton.styleFrom(foregroundColor: Brand.danger),
                              onPressed: () => _decide(a, false),
                              child: const Text('Reject'),
                            ),
                          ),
                        ],
                      ),
                    ),
                  if (a['status'] == 'pending' && !canDecide && intOf(a['requested_by_id']) == _me)
                    Padding(
                      padding: const EdgeInsets.only(top: 8),
                      child: OutlinedButton(onPressed: () => _withdraw(a), child: const Text('Withdraw request')),
                    ),
                ],
              ),
            ),
          ),
        ),
    ];
  }
}

/// Sticky bottom bar: the first action as the main button, the rest under "More".
class ActionBar extends StatelessWidget {
  const ActionBar({super.key, required this.actions});
  final List<(String, IconData, VoidCallback?)> actions;

  @override
  Widget build(BuildContext context) {
    final first = actions.first;
    final rest = actions.skip(1).toList();
    return Row(
      children: [
        Expanded(
          child: FilledButton.icon(
            style: FilledButton.styleFrom(minimumSize: const Size.fromHeight(44)),
            onPressed: first.$3,
            icon: Icon(first.$2, size: 18),
            label: Text(first.$1, maxLines: 1, overflow: TextOverflow.ellipsis),
          ),
        ),
        if (rest.isNotEmpty) ...[
          const SizedBox(width: 8),
          OutlinedButton.icon(
            style: OutlinedButton.styleFrom(minimumSize: const Size(0, 44)),
            onPressed: () => showModalBottomSheet<void>(
              context: context,
              backgroundColor: Colors.white,
              builder: (ctx) => SafeArea(
                child: Column(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    for (final a in rest)
                      ListTile(
                        enabled: a.$3 != null,
                        leading: Icon(
                          a.$2,
                          color: a.$2 == Icons.close_rounded || a.$2 == Icons.delete_outline ? Brand.danger : null,
                        ),
                        title: Text(
                          a.$1,
                          style: TextStyle(
                            color: a.$2 == Icons.close_rounded || a.$2 == Icons.delete_outline ? Brand.danger : null,
                          ),
                        ),
                        onTap: () {
                          Navigator.pop(ctx);
                          a.$3?.call();
                        },
                      ),
                  ],
                ),
              ),
            ),
            icon: const Icon(Icons.more_horiz_rounded),
            label: const Text('More'),
          ),
        ],
      ],
    );
  }
}

/// A file chip in a task / approval (opens the document).
class DocTile extends StatelessWidget {
  const DocTile({super.key, required this.doc, required this.onOpen});
  final Json doc;
  final VoidCallback onOpen;

  @override
  Widget build(BuildContext context) => ListTile(
    contentPadding: EdgeInsets.zero,
    dense: true,
    leading: const Icon(Icons.description_outlined, color: Color(0xFF2563EB)),
    title: Text(
      str(doc, 'name') ?? str(doc, 'file_name') ?? 'Document',
      style: const TextStyle(color: Color(0xFF2563EB), fontWeight: FontWeight.w600),
    ),
    subtitle: doc['uploaded_by'] != null ? Text('Uploaded by ${doc['uploaded_by']}') : null,
    onTap: onOpen,
  );
}

/// One entry of a task's activity feed.
class EventTile extends StatelessWidget {
  const EventTile({super.key, required this.event, required this.me, this.padded = true});
  final Json event;
  final String me;
  final bool padded;

  @override
  Widget build(BuildContext context) {
    final e = event;
    final action = str(e, 'action') ?? '';
    final meta = _eventMeta[action] ?? (action, '#78716c', '');
    final color = hexColor(meta.$2);
    final by = str(e, 'by') ?? '—';
    final body = Row(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        CircleAvatar(
          radius: 15,
          backgroundColor: color.withValues(alpha: 0.12),
          child: Text(
            initialsOf(by),
            style: TextStyle(fontSize: 11, fontWeight: FontWeight.w700, color: color),
          ),
        ),
        const SizedBox(width: 10),
        Expanded(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text.rich(
                TextSpan(
                  children: [
                    TextSpan(
                      text: by,
                      style: const TextStyle(fontWeight: FontWeight.w700, color: Brand.heading),
                    ),
                    if (me.isNotEmpty && by == me)
                      const TextSpan(
                        text: ' (you)',
                        style: TextStyle(color: Brand.muted),
                      ),
                    TextSpan(
                      text: ' ${meta.$1}',
                      style: TextStyle(color: color, fontWeight: FontWeight.w600),
                    ),
                  ],
                ),
                style: const TextStyle(fontSize: 13),
              ),
              Text(fmtDateTime(e['at']), style: const TextStyle(fontSize: 11.5, color: Brand.muted)),
              if (e['old_due_date'] != null && e['new_due_date'] != null)
                Padding(
                  padding: const EdgeInsets.only(top: 4),
                  child: Pill('Due ${fmtDate(e['old_due_date'])} → ${fmtDate(e['new_due_date'])}', const Color(0xFFB45309)),
                )
              else if (e['new_due_date'] != null)
                Padding(
                  padding: const EdgeInsets.only(top: 4),
                  child: Pill('Due ${fmtDate(e['new_due_date'])}', const Color(0xFF1D4ED8)),
                ),
              if (e['remarks'] != null)
                Container(
                  width: double.infinity,
                  margin: const EdgeInsets.only(top: 6),
                  padding: const EdgeInsets.all(10),
                  decoration: BoxDecoration(
                    color: Colors.white,
                    borderRadius: BorderRadius.circular(10),
                    border: Border.all(color: color.withValues(alpha: 0.35)),
                  ),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      if (meta.$3.isNotEmpty) Caps(meta.$3),
                      Text(str(e, 'remarks') ?? '', style: const TextStyle(fontSize: 13, color: Brand.body)),
                    ],
                  ),
                ),
            ],
          ),
        ),
      ],
    );
    return padded ? Padding(padding: const EdgeInsets.fromLTRB(16, 0, 16, 14), child: body) : body;
  }
}
