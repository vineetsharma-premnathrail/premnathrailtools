import 'package:flutter/material.dart';

import '../../api/api.dart';
import '../../theme.dart';
import '../../ui/form.dart';
import '../../ui/format.dart';
import '../../ui/widgets.dart';
import 'design_common.dart';
import 'design_links.dart';
import 'design_requests.dart';

/// My Work - portal design/tasks: my Project Management tasks with their
/// design deliverables, then the review / approval / change queues.

const _pmStatusLabels = {'todo': 'To do', 'in_progress': 'In progress', 'blocked': 'Blocked', 'done': 'Done', 'cancelled': 'Cancelled'};
const _pmStatusColors = {
  'todo': Color(0xFF78716C),
  'in_progress': Color(0xFF2563EB),
  'blocked': Color(0xFFDC2626),
  'done': Color(0xFF16A34A),
  'cancelled': Color(0xFFA8A29E),
};

const _groups = <(String, String, String, Color, String)>[
  ('to_review', 'Drawings to check', 'You are the named checker', Color(0xFF2563EB), 'No drawing revisions are waiting for your check.'),
  ('to_approve', 'Drawings to approve', 'Checked, waiting for your approval', Color(0xFF7C3AED), 'No drawing revisions are waiting for your approval.'),
  ('returned_to_me', 'Drawings returned to me', 'Fix and resubmit', Color(0xFFDC2626), 'No drawings have been returned to you.'),
  ('to_release', 'Ready to release', 'Customer approved — release the revision', Color(0xFF16A34A), 'No customer-approved revisions are waiting for release.'),
  ('boms_to_review', 'BOMs to check', 'You are the named checker', Color(0xFF2563EB), 'No BOM revisions are waiting for your check.'),
  ('boms_to_approve', 'BOMs to approve', 'Checked, waiting for your release', Color(0xFF7C3AED), 'No BOM revisions are waiting for your approval.'),
  ('boms_returned_to_me', 'BOMs returned to me', 'Fix and resubmit', Color(0xFFDC2626), 'No BOMs have been returned to you.'),
  ('customer_comments', 'Customer comments', 'Assigned to you — close with a resolution', Color(0xFF0891B2), 'No open customer comments are assigned to you.'),
  ('ecrs_to_vote', 'Change requests to vote on', 'You are on the change board', Color(0xFFF59E0B), 'No change requests are waiting for your vote.'),
  ('ecrs_to_decide', 'Change requests to progress', 'Impact check or final decision (Design head)', Color(0xFFB45309), 'No change requests are waiting on you.'),
  ('ecns_to_approve', 'Change notices to decide', 'You are the named approver', Color(0xFFF59E0B), 'No change notices are waiting for your decision.'),
  ('ecns_to_implement', 'Change notices to release', 'Open — release once every affected drawing/BOM is released', Color(0xFF0F766E), 'No open change notices of yours.'),
  ('ecns_to_acknowledge', 'Change notices to acknowledge', 'For your department', Color(0xFF0F766E), 'No change notices are waiting for your department’s acknowledgement.'),
  ('my_drafts', 'My drafts', 'Not yet submitted', Color(0xFF78716C), 'You have no draft revisions.'),
];

class DesignMyWorkTab extends StatefulWidget {
  const DesignMyWorkTab({super.key});

  @override
  State<DesignMyWorkTab> createState() => _DesignMyWorkTabState();
}

class _DesignMyWorkTabState extends State<DesignMyWorkTab> {
  Json? _tasks;
  List<Json>? _work;
  Object? _error;
  bool _includeDone = false;
  bool _busy = false;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    try {
      final r = await Future.wait([
        Api.get('/design/my-tasks'),
        Api.list('/design/my-work', query: {'include_done': _includeDone}),
      ]);
      if (!mounted) return;
      setState(() {
        _tasks = jsonMap(r[0]);
        _work = (r[1] as ApiPage).rows;
        _error = null;
      });
    } catch (e) {
      if (mounted) setState(() => _error = e);
    }
  }

  Future<void> _link(Json task) async {
    String kind = 'document';
    int? id;
    String? idL;
    final saved = await showFormSheet(context, title: 'Link a deliverable', saveLabel: 'Link', builder: (ctx, setS) => [
          InfoNote('${task['title']}${str(task['project_label']).isEmpty ? '' : ' · ${task['project_label']}'}'),
          AppSelect<String>(
              label: 'Type',
              required: true,
              clearable: false,
              value: kind,
              options: const [Option('document', 'Drawing'), Option('bom', 'BOM')],
              onChanged: (o) => setS(() {
                    kind = o?.value ?? kind;
                    id = null;
                    idL = null;
                  })),
          AppSelect<int>(
            key: ValueKey(kind),
            label: kind == 'bom' ? 'BOM' : 'Drawing',
            required: true,
            value: id,
            valueLabel: idL,
            loadOptions: (s) => kind == 'bom'
                ? designLookup('boms', s, query: {'released_only': false})
                : designLookup('documents', s, query: {'limit': 500}, sendSearch: true),
            onChanged: (o) => setS(() {
              id = o?.value;
              idL = o?.label;
            }),
          ),
        ], onSave: () async {
      if (id == null) throw 'Pick a ${kind == 'bom' ? 'BOM' : 'drawing'} to link to “${task['title']}”.';
      await Api.post('/design/task-deliverables', data: {
        'pm_task_id': task['task_id'],
        'document_id': kind == 'document' ? id : null,
        'bom_id': kind == 'bom' ? id : null,
      });
    });
    if (saved && mounted) {
      showSnack(context, 'Deliverable linked to “${task['title']}”.');
      _load();
    }
  }

  Future<void> _unlink(int linkId, String label, String task) async {
    final ok = await confirmDialog(context,
        title: 'Unlink this deliverable?',
        message: '$label will no longer count towards “$task”. The drawing/BOM itself is not changed.',
        confirmLabel: 'Unlink',
        danger: true);
    if (!ok || !mounted) return;
    setState(() => _busy = true);
    final done = await runAction(context, () => Api.delete('/design/task-deliverables/$linkId'), success: '$label unlinked from “$task”.');
    if (!mounted) return;
    setState(() => _busy = false);
    if (done) _load();
  }

  @override
  Widget build(BuildContext context) {
    if (_tasks == null && _error != null) return ErrorView(_error!, onRetry: _load);
    if (_tasks == null) return const LoadingView();
    final tasks = _tasks!;
    final work = _work ?? const <Json>[];
    var total = 0;
    for (final g in _groups) {
      if (g.$1 != 'my_drafts') total += jsonList(tasks[g.$1]).length;
    }
    return RefreshIndicator(
      onRefresh: _load,
      child: ListView(padding: const EdgeInsets.only(bottom: 32), children: [
        PageHeader('My Work',
            subtitle: total > 0 ? '$total review/approval item${total == 1 ? '' : 's'} need your action.' : 'No reviews or approvals waiting on you.'),
        DetailSection('My project tasks (${work.length})', children: [
          const Text('Tasks assigned to you in Project Management — link the drawings and BOMs that deliver each one.',
              style: TextStyle(fontSize: 12, color: Brand.muted)),
          const Text('When every linked deliverable is released the task shows “Ready to close” — close the task itself in Project Management.',
              style: TextStyle(fontSize: 12, color: Brand.muted)),
          CheckField(
              label: 'Show closed tasks',
              value: _includeDone,
              onChanged: (v) {
                setState(() => _includeDone = v);
                _load();
              }),
          if (work.isEmpty)
            Text('No ${_includeDone ? '' : 'open '}Project Management tasks are assigned to you.', style: const TextStyle(fontSize: 13, color: Brand.muted)),
          for (final t in work) _taskCard(t),
        ]),
        const Padding(padding: EdgeInsets.fromLTRB(16, 4, 16, 8), child: Caps('Reviews, approvals & changes')),
        for (final g in _groups)
          DetailSection(
            '${g.$2} (${jsonList(tasks[g.$1]).length})',
            children: [
              Text(g.$3, style: TextStyle(fontSize: 12, color: g.$4)),
              const SizedBox(height: 4),
              DesignTaskRows(jsonList(tasks[g.$1]), empty: g.$5, onReturn: _load),
            ],
          ),
      ]),
    );
  }

  Widget _taskCard(Json t) {
    final deliverables = jsonList(t['deliverables']);
    final linkIds = (t['link_ids'] is List) ? (t['link_ids'] as List).map(asInt).toList() : const <int?>[];
    final overdue = t['is_overdue'] == true;
    return Container(
      margin: const EdgeInsets.only(top: 10),
      padding: const EdgeInsets.only(top: 10),
      decoration: const BoxDecoration(border: Border(top: BorderSide(color: Color(0x140F172A)))),
      child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
        Text(str(t['project_label']).isEmpty ? 'Project #${t['project_id']}' : str(t['project_label']),
            style: const TextStyle(fontWeight: FontWeight.w600, color: Brand.heading)),
        if (str(t['milestone_title']).isNotEmpty) Text(str(t['milestone_title']), style: const TextStyle(fontSize: 11.5, color: Brand.muted)),
        const SizedBox(height: 4),
        Text(str(t['title']), style: const TextStyle(fontSize: 14, fontWeight: FontWeight.w600, color: Brand.body)),
        const SizedBox(height: 4),
        Wrap(spacing: 6, runSpacing: 4, crossAxisAlignment: WrapCrossAlignment.center, children: [
          StatusBadge(labelOf(_pmStatusLabels, t['status']), color: _pmStatusColors[str(t['status'])]),
          if (priorityLabel(t['priority']) == 'Urgent') const StatusBadge('Urgent', color: Brand.danger),
          if (t['requirement_changed'] == true) const StatusBadge('⚠ Requirement changed', color: Color(0xFFB45309)),
          if (t['ready_to_close'] == true) const StatusBadge('✓ Ready to close in Project Management', color: Brand.success),
          Text('Due ${fmtDate(t['due_date'])}${overdue ? ' · overdue' : ''}',
              style: TextStyle(fontSize: 12, color: overdue ? Brand.danger : Brand.muted, fontWeight: overdue ? FontWeight.w700 : null)),
        ]),
        const SizedBox(height: 6),
        if (deliverables.isEmpty) const Text('No deliverable linked yet.', style: TextStyle(fontSize: 12.5, color: Brand.muted)),
        for (var i = 0; i < deliverables.length; i++)
          Row(children: [
            Expanded(
              child: InkWell(
                onTap: () => openDeliverable(context, deliverables[i]),
                child: Padding(
                  padding: const EdgeInsets.symmetric(vertical: 4),
                  child: Text.rich(TextSpan(children: [
                    TextSpan(text: str(deliverables[i]['number']), style: const TextStyle(fontWeight: FontWeight.w600, color: Brand.primaryActive)),
                    TextSpan(
                        text: ' · ${labelOf(deliverableLabels, deliverables[i]['status'])} · '
                            '${str(deliverables[i]['released_revision_label']).isEmpty ? 'not released' : 'rel. ${deliverables[i]['released_revision_label']}'}',
                        style: const TextStyle(fontSize: 12, color: Brand.muted)),
                  ])),
                ),
              ),
            ),
            if (i < linkIds.length && linkIds[i] != null)
              IconButton(
                tooltip: 'Unlink',
                icon: const Icon(Icons.link_off_rounded, size: 18, color: Brand.danger),
                onPressed: _busy ? null : () => _unlink(linkIds[i]!, str(deliverables[i]['number']), str(t['title'])),
              ),
          ]),
        TextButton.icon(
            onPressed: _busy ? null : () => _link(t), icon: const Icon(Icons.add_link_rounded, size: 18), label: const Text('+ Link deliverable')),
      ]),
    );
  }
}
