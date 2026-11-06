import 'package:dio/dio.dart';
import 'package:flutter/material.dart';

import '../../api/api.dart';
import '../../theme.dart';
import '../../ui/form.dart';
import '../../ui/format.dart';
import '../../ui/perms.dart';
import '../../ui/widgets.dart';
import 'rnd_common.dart';
import 'rnd_task_detail.dart';

/// Task board shared by requirement tasks, Prototype / Research project tasks
/// and R&D tasks on a Project Management project (portal: TasksBoard.tsx).
/// The three backends return the same task shape; [RndTaskApi] picks the paths.

enum TaskOwner { requirement, project, pmProject }

class RndTaskApi {
  RndTaskApi.requirement(String this.source, int this.recordId)
    : owner = TaskOwner.requirement,
      projectId = null,
      pmProjectId = null;
  RndTaskApi.project(int this.projectId) : owner = TaskOwner.project, source = null, recordId = null, pmProjectId = null;
  RndTaskApi.pmProject(int this.pmProjectId) : owner = TaskOwner.pmProject, source = null, recordId = null, projectId = null;

  final TaskOwner owner;
  final String? source;
  final int? recordId;
  final int? projectId;
  final int? pmProjectId;

  bool get _req => owner == TaskOwner.requirement;

  Future<List<Json>> list() async => jsonList(
    await Api.get(switch (owner) {
      TaskOwner.requirement => '/rnd/requirement-work/$source/$recordId/tasks',
      TaskOwner.project => '/rnd/projects/$projectId/tasks',
      TaskOwner.pmProject => '/rnd/pm-projects/$pmProjectId/tasks',
    }),
  );

  Future<Json> _access() async => jsonMap(
    await Api.get(
      owner == TaskOwner.project ? '/rnd/projects/$projectId/task-access' : '/rnd/pm-projects/$pmProjectId/task-access',
    ),
  );

  /// Who a top-level task can be assigned to.
  Future<List<Json>> people() async =>
      _req ? jsonList(await Api.get('/rnd/requirement-work/$source/$recordId/assignees')) : jsonList((await _access())['people']);

  /// Who a sub-task can be assigned to.
  Future<List<Json>> team() async =>
      _req ? jsonList(await Api.get('/rnd/requirement-work/$source/$recordId/assignees')) : jsonList((await _access())['team']);

  Future<Json> create(Map<String, Object?> fields, List<MultipartFile> files, {int? parentId}) async {
    final path = parentId != null
        ? (_req ? '/rnd/requirement-work/tasks/$parentId/subtasks' : '/rnd/project-tasks/$parentId/subtasks')
        : switch (owner) {
            TaskOwner.requirement => '/rnd/requirement-work/$source/$recordId/tasks',
            TaskOwner.project => '/rnd/projects/$projectId/tasks',
            TaskOwner.pmProject => '/rnd/pm-projects/$pmProjectId/tasks',
          };
    return jsonMap(await postForm(path, fields, files: files));
  }

  String _task(int id) => _req ? '/rnd/requirement-work/tasks/$id' : '/rnd/project-tasks/$id';
  String _approval(int id) => _req ? '/rnd/requirement-work/approvals/$id' : '/rnd/project-task-approvals/$id';

  Future<Json> edit(int id, Json body) async => jsonMap(await Api.patch(_task(id), data: body));
  Future<Json> progress(int id, Json body) async => jsonMap(await Api.post('${_task(id)}/progress', data: body));
  Future<Json> extend(int id, String reason, String date) async =>
      jsonMap(await postForm('${_task(id)}/extend', {'reason': reason, 'new_due_date': date}));
  Future<Json> complete(int id, String remarks, String? delay, List<MultipartFile> files) async =>
      jsonMap(await postForm('${_task(id)}/complete', {'remarks': remarks, 'delay_reason': delay}, files: files));
  Future<Json> update(int id, String remarks, List<MultipartFile> files) async =>
      jsonMap(await postForm('${_task(id)}/update', {'remarks': remarks}, files: files));
  Future<Json> requestApproval(int id, String request, List<MultipartFile> files) async =>
      jsonMap(await postForm('${_task(id)}/approvals', {'request': request}, files: files));
  Future<Json> decide(int approvalId, String decision, String? remarks) async =>
      jsonMap(await Api.post('${_approval(approvalId)}/decide', data: {'decision': decision, 'remarks': remarks}));
  Future<Json> withdraw(int approvalId) async => jsonMap(await Api.post('${_approval(approvalId)}/withdraw'));
  Future<Json> reopen(int id, String remarks, String? date) async =>
      jsonMap(await Api.post('${_task(id)}/reopen', data: {'remarks': remarks, 'new_due_date': date}));
  Future<Json> cancel(int id, String remarks) async => jsonMap(await Api.post('${_task(id)}/cancel', data: {'remarks': remarks}));

  Future<void> openDoc(BuildContext context, Json doc) =>
      _req ? openWorkDocument(context, doc) : openProjectDocument(context, {...doc, 'file_name': doc['name']});
}

/// Wording that differs per board (portal: TaskLabels).
class TaskLabels {
  const TaskLabels({required this.manager, required this.emptyManager, required this.emptyOther});
  final String manager;
  final String emptyManager;
  final String emptyOther;
}

/// Role-level task rights (the module's Tasks feature) on top of the record rules.
class TaskRights {
  const TaskRights({this.create = true, this.edit = true, this.approve = true, this.cancel = true});
  final bool create;
  final bool edit;
  final bool approve;
  final bool cancel;
}

// ── Task helpers ─────────────────────────────────────────────────────────────

const workLabels = {'not_started': 'Not started', 'in_progress': 'In progress', 'on_hold': 'On hold'};
const workHex = {'not_started': '#78716c', 'in_progress': '#7C3AED', 'on_hold': '#D97706'};
const _statusLabels = {'open': 'Open', 'submitted': 'Completed', 'closed': 'Completed', 'cancelled': 'Cancelled'};

int tid(Json t) => intOf(t['id']) ?? 0;
bool isDoneTask(Json t) => t['status'] == 'closed' || t['status'] == 'submitted';

(String, Color) taskState(Json t) {
  if (t['status'] == 'cancelled') return ('Cancelled', const Color(0xFF57534E));
  if (t['status'] != 'open') return ('Completed', const Color(0xFF15803D));
  if (boolOf(t['is_overdue'])) return ('Overdue', const Color(0xFFBE123C));
  if (boolOf(t['pending_approval'])) return ('Approval pending', const Color(0xFFB45309));
  final w = str(t, 'work_status') ?? 'not_started';
  return (workLabels[w] ?? 'Open', hexColor(workHex[w] ?? '#2563EB'));
}

num taskPercent(Json t) {
  if (isDoneTask(t)) return 100;
  if (t['progress_percent'] is num) return t['progress_percent'] as num;
  final c = jsonList(t['checklist']);
  if (c.isNotEmpty) return (numOf(t['checklist_done']) * 100 / c.length).round();
  return 0;
}

int docCount(Json t) =>
    jsonList(t['brief_documents']).length +
    jsonList(t['work_documents']).length +
    jsonList(t['approvals']).fold<int>(0, (n, a) => n + jsonList(a['documents']).length);

int _order(Json a, Json b) {
  final fa = a['status'] != 'open', fb = b['status'] != 'open';
  if (fa != fb) return fa ? 1 : -1;
  if (fa) {
    return (str(b, 'closed_at') ?? str(b, 'created_at') ?? '').compareTo(str(a, 'closed_at') ?? str(a, 'created_at') ?? '');
  }
  final oa = boolOf(a['is_overdue']), ob = boolOf(b['is_overdue']);
  if (oa != ob) return oa ? -1 : 1;
  final d = (str(a, 'due_date') ?? '').compareTo(str(b, 'due_date') ?? '');
  return d != 0 ? d : tid(a) - tid(b);
}

// ── Board ────────────────────────────────────────────────────────────────────

class TasksBoard extends StatefulWidget {
  const TasksBoard({
    super.key,
    required this.api,
    required this.canManage,
    required this.canCreate,
    required this.labels,
    this.rights = const TaskRights(),
    this.createDisabledHint,
  });

  final RndTaskApi api;

  /// Head / lead: create top-level tasks and review every task.
  final bool canManage;
  final bool canCreate;
  final TaskLabels labels;
  final TaskRights rights;

  /// Set while the requirement is not accepted: Add Task is off and the reason shows.
  final String? createDisabledHint;

  @override
  State<TasksBoard> createState() => _TasksBoardState();
}

class _TasksBoardState extends State<TasksBoard> {
  List<Json>? _tasks;
  List<Json> _people = [];
  List<Json> _team = [];
  Object? _error;
  String _query = '';
  String _filter = 'all';

  int get _me => Perm.userId ?? -1;
  bool get _canCreate => widget.canCreate && widget.createDisabledHint == null;

  @override
  void initState() {
    super.initState();
    _load();
    if (_canCreate) {
      widget.api.people().then((p) {
        if (mounted) setState(() => _people = p);
      }, onError: (_) {});
    }
    widget.api.team().then((p) {
      if (mounted) setState(() => _team = p);
    }, onError: (_) {});
  }

  Future<void> _load() async {
    try {
      final t = await widget.api.list();
      if (mounted) {
        setState(() {
          _tasks = t;
          _error = null;
        });
      }
    } catch (e) {
      if (mounted) {
        setState(() {
          _tasks ??= [];
          _error = e;
        });
      }
    }
  }

  bool _inFilter(Json t, String f) => switch (f) {
    'pending' => t['status'] == 'open',
    'completed' => isDoneTask(t),
    'overdue' => boolOf(t['is_overdue']),
    'mine' => intOf(t['assigned_to_id']) == _me,
    'given' => intOf(t['created_by_id']) == _me,
    _ => true,
  };

  String _haystack(Json t) => [
    t['title'],
    t['remarks'],
    t['assigned_to'],
    _statusLabels[t['status']],
    boolOf(t['is_overdue']) ? 'overdue' : '',
    priorityLabel(t['priority']),
    t['status'] == 'open' ? workLabels[str(t, 'work_status') ?? 'not_started'] : '',
    ...jsonList(t['checklist']).map((c) => c['text']),
    t['due_date'],
    fmtDate(t['due_date']),
    isoDay(t['created_at']),
  ].whereType<Object>().join(' ').toLowerCase();

  Future<void> _create() async {
    final created = await showTaskForm(
      context,
      mode: 'create',
      people: _people,
      onSubmit: (fields, files) async => widget.api.create(fields, files),
    );
    if (created != null) {
      await _load();
      if (mounted) _open(created);
    }
  }

  void _open(Json t) {
    openThen(
      context,
      TaskDetailScreen(
        api: widget.api,
        all: _tasks ?? [],
        taskId: tid(t),
        canManage: widget.canManage,
        rights: widget.rights,
        labels: widget.labels,
        people: _people,
        team: _team,
      ),
      _load,
    );
  }

  @override
  Widget build(BuildContext context) {
    final list = _tasks;
    if (list == null) return const LoadingView();
    final ids = list.map(tid).toSet();
    final words = _query.trim().toLowerCase().split(RegExp(r'\s+')).where((w) => w.isNotEmpty).toList();
    bool matches(Json t) => words.every(_haystack(t).contains) && _inFilter(t, _filter);
    final narrowed = words.isNotEmpty || _filter != 'all';
    final rows = <(Json, int)>[];
    final roots = list.where((t) => t['parent_task_id'] == null || !ids.contains(intOf(t['parent_task_id']))).toList()
      ..sort(_order);
    for (final r in roots) {
      final kids = list.where((t) => intOf(t['parent_task_id']) == tid(r)).toList()..sort(_order);
      final shownKids = narrowed ? kids.where(matches).toList() : kids;
      if (narrowed && !matches(r) && shownKids.isEmpty) continue;
      rows.add((r, 0));
      for (final k in shownKids) {
        rows.add((k, 1));
      }
    }
    const chipDefs = [
      ('all', 'All'),
      ('pending', 'Pending'),
      ('completed', 'Completed'),
      ('overdue', 'Overdue'),
      ('mine', 'Assigned to me'),
      ('given', 'Given by me'),
    ];

    return RefreshIndicator(
      onRefresh: _load,
      child: ListView(
        padding: const EdgeInsets.only(top: 12, bottom: 32),
        children: [
          if (widget.createDisabledHint != null) NoteBox(widget.createDisabledHint!, color: const Color(0xFFD97706)),
          if (_error != null)
            Padding(padding: const EdgeInsets.fromLTRB(16, 0, 16, 12), child: ErrorBanner(ApiClient.describe(_error!))),
          Padding(
            padding: const EdgeInsets.fromLTRB(16, 0, 16, 8),
            child: Row(
              children: [
                const Icon(Icons.checklist_rounded, color: Color(0xFF2563EB), size: 20),
                const SizedBox(width: 6),
                Expanded(
                  child: Text(
                    'Tasks (${list.length})',
                    style: const TextStyle(fontSize: 16, fontWeight: FontWeight.w700, color: Color(0xFF2563EB)),
                  ),
                ),
                if (widget.canCreate)
                  FilledButton.icon(
                    style: FilledButton.styleFrom(minimumSize: const Size(0, 38)),
                    onPressed: _canCreate ? _create : null,
                    icon: const Icon(Icons.add_rounded, size: 18),
                    label: const Text('Add Task'),
                  ),
              ],
            ),
          ),
          if (list.isEmpty)
            EmptyView(_canCreate ? widget.labels.emptyManager : widget.labels.emptyOther, icon: Icons.checklist_rounded)
          else ...[
            Padding(
              padding: const EdgeInsets.fromLTRB(16, 0, 16, 4),
              child: SearchField(hint: 'Search task, person, status or date…', onChanged: (v) => setState(() => _query = v)),
            ),
            ChipRow(
              children: [
                for (final (k, label) in chipDefs)
                  if (k == 'all' || _filter == k || list.any((t) => _inFilter(t, k)))
                    CountChip(
                      label,
                      list.where((t) => _inFilter(t, k)).length,
                      selected: _filter == k,
                      onTap: () => setState(() => _filter = _filter == k ? 'all' : k),
                    ),
              ],
            ),
            if (rows.isEmpty)
              Padding(
                padding: const EdgeInsets.all(24),
                child: Column(
                  children: [
                    Text(
                      _query.trim().isNotEmpty ? 'No task matches “${_query.trim()}”.' : 'No tasks match these filters.',
                      style: const TextStyle(color: Brand.muted),
                    ),
                    TextButton(onPressed: () => setState(() => _filter = 'all'), child: const Text('Clear filters')),
                  ],
                ),
              ),
            for (final (t, depth) in rows) TaskRowCard(task: t, depth: depth, all: list, me: _me, onTap: () => _open(t)),
          ],
        ],
      ),
    );
  }
}

/// One task in the board (portal: a row of the task table).
class TaskRowCard extends StatelessWidget {
  const TaskRowCard({
    super.key,
    required this.task,
    required this.depth,
    required this.all,
    required this.me,
    required this.onTap,
  });
  final Json task;
  final int depth;
  final List<Json> all;
  final int me;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final t = task;
    final (stText, stColor) = taskState(t);
    final kids = all.where((k) => intOf(k['parent_task_id']) == tid(t)).toList();
    final checklist = jsonList(t['checklist']);
    final files = docCount(t);
    final overdue = boolOf(t['is_overdue']);
    final notes = <String>[
      if (boolOf(t['requirement_changed']) && t['status'] == 'open') 'Requirement changed',
      if (kids.isNotEmpty) 'Sub-tasks ${kids.where(isDoneTask).length}/${kids.length}',
      if (checklist.isNotEmpty) '☑ ${t['checklist_done'] ?? 0}/${checklist.length}',
      if (files > 0) '📎 $files',
      if (boolOf(t['pending_approval'])) 'Approval waiting',
    ];
    return Padding(
      padding: EdgeInsets.fromLTRB(16 + depth * 20.0, 0, 16, 10),
      child: Card(
        clipBehavior: Clip.antiAlias,
        child: InkWell(
          onTap: onTap,
          child: Padding(
            padding: const EdgeInsets.all(12),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Row(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    if (depth > 0)
                      const Text(
                        '↳ ',
                        style: TextStyle(color: Color(0xFF7C3AED), fontWeight: FontWeight.w700),
                      ),
                    Expanded(
                      child: Text(
                        str(t, 'title') ?? '',
                        style: const TextStyle(fontSize: 14.5, fontWeight: FontWeight.w600, color: Brand.heading),
                      ),
                    ),
                    const SizedBox(width: 8),
                    Pill(stText, stColor),
                  ],
                ),
                if (notes.isNotEmpty)
                  Padding(
                    padding: const EdgeInsets.only(top: 4),
                    child: Text(notes.join('  ·  '), style: const TextStyle(fontSize: 11.5, color: Brand.muted)),
                  ),
                const SizedBox(height: 8),
                Wrap(
                  spacing: 14,
                  runSpacing: 4,
                  crossAxisAlignment: WrapCrossAlignment.center,
                  children: [
                    _meta('Assignee', intOf(t['assigned_to_id']) == me ? 'You' : txt(t['assigned_to'])),
                    _meta('Given by', intOf(t['created_by_id']) == me ? 'You' : txt(t['created_by'])),
                    _meta('Due Date', fmtDate(t['due_date']), color: overdue ? const Color(0xFFBE123C) : null),
                    Pill(priorityLabel(t['priority']), priorityColor(t['priority'])),
                  ],
                ),
                const SizedBox(height: 8),
                ProgressLine(taskPercent(t)),
              ],
            ),
          ),
        ),
      ),
    );
  }

  Widget _meta(String label, String value, {Color? color}) => Column(
    crossAxisAlignment: CrossAxisAlignment.start,
    mainAxisSize: MainAxisSize.min,
    children: [
      Text(label, style: const TextStyle(fontSize: 11, color: Brand.muted)),
      Text(
        value,
        style: TextStyle(fontSize: 13, fontWeight: FontWeight.w500, color: color ?? Brand.body),
      ),
    ],
  );
}

// ── Task form (create / sub-task / edit) ─────────────────────────────────────

/// One form for a new task, a new sub-task and editing a task (no files when
/// editing) - the PM "Create Task" layout. Returns the saved task, or null.
Future<Json?> showTaskForm(
  BuildContext context, {
  required String mode,
  required List<Json> people,
  required Future<Json> Function(Map<String, Object?> fields, List<MultipartFile> files) onSubmit,
  Json? initial,
  String? maxDue,
  String? parentTitle,
}) async {
  final title = TextEditingController(text: str(initial, 'title') ?? '');
  final remarks = TextEditingController(text: str(initial, 'remarks') ?? '');
  int? assignee = intOf(initial?['assigned_to_id']);
  DateTime? start = parseDate(initial?['start_date']);
  DateTime? due = parseDate(initial?['due_date']);
  var priority = normalizePriority(initial?['priority']);
  var work = str(initial, 'work_status') ?? 'not_started';
  var steps = [
    for (final c in jsonList(initial?['checklist'])) <String, dynamic>{'id': c['id'], 'text': c['text'], 'done': c['done']},
  ];
  var files = <MultipartFile>[];
  Json? saved;
  final isSub = mode == 'subtask' || initial?['parent_task_id'] != null;
  final noun = isSub ? 'Sub-task' : 'Task';
  final ok = await showFormSheet(
    context,
    title: mode == 'edit' ? 'Edit $noun' : (mode == 'subtask' ? 'Add Sub-task' : 'Create Task'),
    saveLabel: mode == 'edit' ? 'Save' : (mode == 'subtask' ? 'Add Sub-task' : 'Create Task'),
    builder: (ctx, setS) => [
      Hint(
        parentTitle != null
            ? "Part of task '$parentTitle'."
            : mode == 'edit'
            ? 'Change the task — the assignee sees the change in its activity.'
            : 'Give work to a person and set when it is due.',
      ),
      const FormHeading('Basic Information'),
      AppTextField(label: '$noun Name', controller: title, required: true, hint: 'Enter task name'),
      AppTextField(
        label: 'Description',
        controller: remarks,
        maxLines: 4,
        hint: 'What exactly you need back, references, constraints…',
      ),
      const FormHeading('Assignment'),
      AppSelect<int>(
        label: 'Assignee',
        required: true,
        value: assignee,
        valueLabel: str(initial, 'assigned_to'),
        options: personOptions(people),
        onChanged: (o) => setS(() => assignee = o?.value),
      ),
      const Hint('The assignee is notified, posts updates and completes it; you review it and decide their approval requests.'),
      const FormHeading('Schedule & Status'),
      DateField(label: 'Start Date', value: start, onChanged: (d) => setS(() => start = d)),
      DateField(label: 'Due Date', required: true, value: due, onChanged: (d) => setS(() => due = d)),
      if (maxDue != null) Hint('Must be due by ${fmtDate(maxDue)} — the main task’s date.'),
      AppSelect<String>(
        label: 'Priority',
        value: priority,
        clearable: false,
        options: priorityOptions,
        onChanged: (o) => setS(() => priority = o?.value ?? 'standard'),
      ),
      AppSelect<String>(
        label: 'Status',
        value: work,
        clearable: false,
        options: [for (final e in workLabels.entries) Option(e.key, e.value)],
        onChanged: (o) => setS(() => work = o?.value ?? 'not_started'),
      ),
      ChecklistEditor(steps: steps, onChanged: (s) => setS(() => steps = s)),
      if (mode != 'edit') FilesField(label: 'Attachments', files: files, onChanged: (f) => setS(() => files = f)),
    ],
    onSave: () async {
      if (title.text.trim().isEmpty) throw 'Give the task a title — what should be done.';
      if (assignee == null) throw 'Pick who should do this task.';
      if (due == null) throw 'Set the Due Date.';
      final dueIso = apiDate(due!);
      if (dueIso.compareTo(todayIso()) < 0 && dueIso != isoDay(initial?['due_date'])) {
        throw 'Due Date is in the past — pick today or a later date.';
      }
      if (maxDue != null && dueIso.compareTo(isoDay(maxDue)) > 0) {
        throw "A sub-task can't be due after its main task (${fmtDate(maxDue)}).";
      }
      if (start != null && apiDate(start!).compareTo(dueIso) > 0) {
        throw 'Start date ${fmtDate(start)} is after the Due Date ${fmtDate(due)} — the task must start on or before it is due.';
      }
      final checklist = [
        for (final s in steps)
          if ((str(s, 'text') ?? '').trim().isNotEmpty)
            {if (s['id'] != null) 'id': s['id'], 'text': (str(s, 'text') ?? '').trim(), if (s['done'] != null) 'done': s['done']},
      ];
      saved = await onSubmit({
        'title': title.text.trim(),
        'assigned_to_id': assignee,
        'due_date': dueIso,
        'remarks': remarks.text.trim().isEmpty ? null : remarks.text.trim(),
        'priority': priority,
        'start_date': start == null ? null : apiDate(start!),
        'work_status': work,
        'checklist': checklist,
      }, files);
    },
  );
  return ok ? saved : null;
}
