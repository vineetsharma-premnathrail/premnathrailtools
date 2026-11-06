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
import 'home_common.dart';

/// R&D tasks assigned to me - requirement tasks (/rnd/requirement-work/
/// tasks/mine) plus R&D project / PM-project tasks (/rnd/project-tasks/mine),
/// the same two lists the R&D dashboard counts as "My open tasks".
/// Grouped Overdue / Due today / Upcoming like the portal's task groups.
class RndMyTasks extends StatefulWidget {
  const RndMyTasks({super.key});

  @override
  State<RndMyTasks> createState() => _RndMyTasksState();
}

class _RndMyTasksState extends State<RndMyTasks> {
  final _key = GlobalKey<LoadedState<List<Json>>>();
  bool _includeDone = false;
  String? _group;

  Future<List<Json>> _load() async {
    final q = _includeDone ? {'include_done': true} : null;
    final r = await Future.wait([
      Api.get('/rnd/requirement-work/tasks/mine', query: q),
      Api.get('/rnd/project-tasks/mine', query: q),
    ]);
    return [...rowsOf(r[0]), ...rowsOf(r[1])];
  }

  Future<void> _open(Json t) async {
    await Navigator.of(context).push(MaterialPageRoute(builder: (_) => RndTaskScreen(task: t)));
    _key.currentState?.reload();
  }

  @override
  Widget build(BuildContext context) {
    return Loaded<List<Json>>(
      key: _key,
      load: _load,
      builder: (ctx, rows, reload) {
        final today = todayIso();
        final open = rows.where((t) => t['status'] == 'open' || t['status'] == 'submitted').toList()
          ..sort((a, b) => '${a['due_date'] ?? '9999'}'.compareTo('${b['due_date'] ?? '9999'}'));
        final groups = <(String, Color, List<Json>)>[
          ('Overdue', const Color(0xFFDC2626),
              open.where((t) => truthy(t['is_overdue']) || '${t['due_date'] ?? '9999'}'.compareTo(today) < 0).toList()),
          ('Due today', const Color(0xFFC2410C),
              open.where((t) => !truthy(t['is_overdue']) && t['due_date'] == today).toList()),
          ('Upcoming', Brand.muted,
              open.where((t) => !truthy(t['is_overdue']) && '${t['due_date'] ?? '9999'}'.compareTo(today) > 0).toList()),
          if (_includeDone)
            ('Done / cancelled', Brand.muted,
                rows.where((t) => t['status'] == 'closed' || t['status'] == 'cancelled').toList()),
        ];
        final group = groups.any((g) => g.$1 == _group) ? _group : null;
        return ListView(
          padding: const EdgeInsets.only(bottom: 32),
          children: [
            ChipBar(children: [
              CountChip('My open tasks', open.length, selected: group == null, onTap: () => setState(() => _group = null)),
              for (final g in groups)
                CountChip(g.$1, g.$3.length,
                    color: g.$2 == Brand.muted ? null : g.$2,
                    selected: group == g.$1,
                    onTap: () => setState(() => _group = group == g.$1 ? null : g.$1)),
            ]),
            Padding(
              padding: const EdgeInsets.fromLTRB(16, 0, 8, 0),
              child: Row(children: [
                const Expanded(
                    child: Text('Requirement and project tasks given to you in R&D.',
                        style: TextStyle(fontSize: 12.5, color: Brand.muted))),
                const Text('Show finished', style: TextStyle(fontSize: 12.5, color: Brand.body)),
                Switch(
                  value: _includeDone,
                  onChanged: (v) {
                    setState(() => _includeDone = v);
                    _key.currentState?.reload();
                  },
                ),
              ]),
            ),
            if (groups.every((g) => g.$3.isEmpty))
              const EmptyView('No R&D tasks are assigned to you.', icon: Icons.task_alt_rounded)
            else
              for (final g in groups)
                if (g.$3.isNotEmpty && (group == null || group == g.$1)) ...[
                  GroupHeading('${g.$1} (${g.$3.length})', color: g.$2),
                  for (final t in g.$3) _RndTaskCard(t: t, onTap: () => _open(t)),
                ],
          ],
        );
      },
    );
  }
}

const _workStatus = {'not_started': 'Not started', 'in_progress': 'In progress', 'on_hold': 'On hold'};

String _taskStatusLabel(Json t) => switch ('${t['status']}') {
      'closed' => 'Completed',
      'cancelled' => 'Cancelled',
      'submitted' => 'Submitted',
      _ => _workStatus['${t['work_status']}'] ?? 'Open',
    };

String _sourceLabel(Json t) => switch ('${t['source']}') {
      'inquiry' => 'Inquiry requirement',
      'tender' => 'Tender requirement',
      'pm_project' => 'Project (PEW)',
      _ => 'R&D project',
    };

class _RndTaskCard extends StatelessWidget {
  const _RndTaskCard({required this.t, required this.onTap});
  final Json t;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final urgent = const {'urgent', 'critical', 'high'}.contains('${t['priority'] ?? ''}'.toLowerCase());
    return RecordCard(
      code: t['requirement_ref'] != null ? '${t['requirement_ref']}' : null,
      title: txt(t['title']),
      subtitle: [_sourceLabel(t), if (t['milestone_title'] != null) '${t['milestone_title']}'].join(' · '),
      status: _taskStatusLabel(t),
      meta: [
        ('Due', fmtDate(t['due_date'])),
        ('Given by', txt(t['created_by'])),
        if (urgent) ('Priority', 'Urgent'),
        if (t['progress_percent'] != null) ('Progress', '${asInt(t['progress_percent'])}%'),
        if (truthy(t['pending_approval'])) ('Approval', 'Waiting'),
      ],
      onTap: onTap,
    );
  }
}

/// One R&D task: details, brief and work documents, checklist, and the
/// assignee's actions (work status, tick steps, extend due date, complete).
class RndTaskScreen extends StatefulWidget {
  const RndTaskScreen({super.key, required this.task});
  final Json task;

  @override
  State<RndTaskScreen> createState() => _RndTaskScreenState();
}

class _RndTaskScreenState extends State<RndTaskScreen> {
  late Json _t = widget.task;
  bool _busy = false;

  bool get _isRequirement => _t['source'] == 'inquiry' || _t['source'] == 'tender';
  String get _base =>
      _isRequirement ? '/rnd/requirement-work/tasks/${_t['id']}' : '/rnd/project-tasks/${_t['id']}';

  Future<bool> _run(Future<dynamic> Function() call, {String? success}) async {
    setState(() => _busy = true);
    final ok = await runAction(context, () async {
      final d = await call();
      if (d is Map && d['id'] != null && mounted) setState(() => _t = Map<String, dynamic>.from(d));
    }, success: success);
    if (mounted) setState(() => _busy = false);
    return ok;
  }

  Future<void> _extend() async {
    DateTime? date;
    final reason = TextEditingController();
    final saved = await showFormSheet(
      context,
      title: 'Ask for more time',
      saveLabel: 'Extend',
      builder: (ctx, setS) => [
        Text('Current due date: ${fmtDate(_t['due_date'])}', style: const TextStyle(color: Brand.muted)),
        DateField(
            label: 'New due date',
            required: true,
            value: date,
            firstDate: DateTime.now(),
            onChanged: (d) => setS(() => date = d)),
        AppTextField(label: 'Reason', required: true, controller: reason, maxLines: 3),
      ],
      onSave: () async {
        requireField(date, 'New due date');
        requireField(reason.text, 'Reason');
        final d = await Api.post('$_base/extend',
            data: FormData.fromMap({'reason': reason.text.trim(), 'new_due_date': apiDate(date!)}));
        if (d is Map && d['id'] != null) _t = Map<String, dynamic>.from(d);
      },
    );
    if (saved && mounted) {
      setState(() {});
      showSnack(context, 'Due date extended.');
    }
  }

  Future<void> _complete() async {
    final remarks = TextEditingController();
    final delay = TextEditingController();
    final files = <MultipartFile>[];
    final overdue = truthy(_t['is_overdue']);
    final saved = await showFormSheet(
      context,
      title: 'Complete task',
      saveLabel: 'Complete',
      builder: (ctx, setS) => [
        Text(txt(_t['title']), style: const TextStyle(fontWeight: FontWeight.w600, color: Brand.heading)),
        AppTextField(label: 'Remarks', required: true, controller: remarks, maxLines: 4, hint: 'What was done'),
        if (overdue) AppTextField(label: 'Reason for delay', required: true, controller: delay, maxLines: 2),
        OutlinedButton.icon(
          icon: const Icon(Icons.attach_file_rounded),
          label: Text(files.isEmpty ? 'Attach files (optional)' : '${files.length} file(s) attached'),
          onPressed: () async {
            final picked = await Files.pickFiles();
            if (picked.isNotEmpty) setS(() => files.addAll(picked));
          },
        ),
      ],
      onSave: () async {
        requireField(remarks.text, 'Remarks');
        if (overdue) requireField(delay.text, 'Reason for delay');
        final form = FormData.fromMap({
          'remarks': remarks.text.trim(),
          if (overdue) 'delay_reason': delay.text.trim(),
        });
        for (final f in files) {
          form.files.add(MapEntry('files', f));
        }
        final d = await Api.post('$_base/complete', data: form);
        if (d is Map && d['id'] != null) _t = Map<String, dynamic>.from(d);
      },
    );
    if (saved && mounted) {
      setState(() {});
      showSnack(context, 'Task completed.');
    }
  }

  @override
  Widget build(BuildContext context) {
    final t = _t;
    final mine = t['assigned_to_id'] == Perm.userId;
    final open = t['status'] == 'open';
    final canWork = mine && open;
    final checklist = rowsOf(t['checklist']);
    final docs = [...rowsOf(t['brief_documents']), ...rowsOf(t['work_documents'])];
    final events = rowsOf(t['events']);
    return SubPage(
      title: txt(t['title']),
      body: ListView(
        padding: const EdgeInsets.only(top: 12, bottom: 32),
        children: [
          DetailSection(
            txt(t['title']),
            action: StatusBadge(_taskStatusLabel(t)),
            children: [
              FieldRow('Work for', _sourceLabel(t)),
              if (t['requirement_ref'] != null)
                FieldRow('Requirement',
                    '${t['requirement_ref']}${t['requirement_title'] != null ? ' — ${t['requirement_title']}' : ''}'),
              if (t['milestone_title'] != null) FieldRow('Milestone', t['milestone_title']),
              if (t['department_label'] != null) FieldRow('Department', t['department_label']),
              FieldRow('Given by', t['created_by']),
              FieldRow('Assigned to', mine ? 'You' : txt(t['assigned_to'])),
              FieldRow('Start date', fmtDate(t['start_date'])),
              FieldRow(
                  'Due date',
                  Text(
                      '${fmtDate(t['due_date'])}${asInt(t['extensions']) > 0 ? ' (extended ${t['extensions']}×, first ${fmtDate(t['original_due_date'])})' : ''}',
                      style: TextStyle(
                          fontSize: 14,
                          color: truthy(t['is_overdue']) ? const Color(0xFFDC2626) : Brand.body))),
              if (open) FieldRow('Due', dueText(t['due_date'])),
              if (t['closed_at'] != null) FieldRow('Completed', fmtDateTime(t['closed_at'])),
              if (t['progress_percent'] != null) FieldRow('Progress', ProgressLine(asInt(t['progress_percent']))),
              if ('${t['remarks'] ?? ''}'.isNotEmpty) FieldRow('Brief', t['remarks']),
              if (truthy(t['requirement_changed']))
                const FieldRow('Note', 'BD re-sent the requirement after this task was given — check what changed.'),
              if (truthy(t['pending_approval'])) const FieldRow('Approval', 'Waiting for approval'),
            ],
          ),
          if (canWork)
            DetailSection('Work status', children: [
              Wrap(spacing: 8, runSpacing: 8, children: [
                for (final e in _workStatus.entries)
                  ChoiceChip(
                    label: Text(e.value),
                    selected: t['work_status'] == e.key,
                    onSelected: _busy || t['work_status'] == e.key
                        ? null
                        : (_) => _run(() => Api.post('$_base/progress', data: {'work_status': e.key}),
                            success: 'Work status set to ${e.value}.'),
                  ),
              ]),
            ]),
          if (checklist.isNotEmpty)
            DetailSection('Checklist (${asInt(t['checklist_done'])}/${checklist.length})', children: [
              for (final c in checklist)
                CheckboxListTile(
                  contentPadding: EdgeInsets.zero,
                  controlAffinity: ListTileControlAffinity.leading,
                  dense: true,
                  value: c['done'] == true,
                  title: Text(txt(c['text'])),
                  subtitle: c['done'] == true && c['done_by'] != null
                      ? Text('${c['done_by']} · ${fmtDateTime(c['done_at'])}')
                      : null,
                  onChanged: !canWork || _busy
                      ? null
                      : (v) => _run(() => Api.post('$_base/progress', data: {'item_id': c['id'], 'done': v == true})),
                ),
            ]),
          if (docs.isNotEmpty)
            DetailSection('Documents (${docs.length})', children: [
              for (final d in docs)
                ListTile(
                  contentPadding: EdgeInsets.zero,
                  dense: true,
                  leading: const Icon(Icons.description_outlined),
                  title: Text(txt(d['name'])),
                  subtitle: Text([
                    if (d['uploaded_by'] != null) '${d['uploaded_by']}',
                    if (d['uploaded_at'] != null) fmtDate(d['uploaded_at']),
                  ].join(' · ')),
                ),
              const Text('Open the files from the portal (R&D › task).',
                  style: TextStyle(fontSize: 12, color: Brand.muted)),
            ]),
          if (events.isNotEmpty)
            DetailSection('History', children: [
              for (final e in events.reversed)
                Padding(
                  padding: const EdgeInsets.symmetric(vertical: 5),
                  child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                    Text(
                        [
                          humanize(e['action']),
                          if (e['new_due_date'] != null) 'due ${fmtDate(e['new_due_date'])}',
                          if ('${e['remarks'] ?? ''}'.isNotEmpty) '${e['remarks']}',
                        ].join(' · '),
                        style: const TextStyle(fontSize: 13, color: Brand.body)),
                    Text('${txt(e['by'])} · ${fmtDateTime(e['at'])}',
                        style: const TextStyle(fontSize: 11.5, color: Brand.muted)),
                  ]),
                ),
            ]),
        ],
      ),
      bottom: canWork
          ? Row(children: [
              Expanded(
                child: OutlinedButton(
                  style: OutlinedButton.styleFrom(minimumSize: const Size.fromHeight(48)),
                  onPressed: _busy ? null : _extend,
                  child: const Text('Extend due date'),
                ),
              ),
              const SizedBox(width: 8),
              Expanded(
                child: FilledButton(onPressed: _busy ? null : _complete, child: const Text('Complete')),
              ),
            ])
          : null,
    );
  }
}
