import 'package:dio/dio.dart';
import 'package:flutter/material.dart';

import '../../api/api.dart';
import '../../theme.dart';
import '../../ui/app_frame.dart';
import '../../ui/form.dart';
import '../../ui/format.dart';
import '../../ui/widgets.dart';
import 'rnd_common.dart';
import 'rnd_projects.dart';
import 'rnd_requirements.dart';
import 'rnd_task_board.dart';

/// R&D › R&D Tasks (portal: app/dashboard/rnd/tasks + RndTaskAnalytics +
/// TaskCreateSheet): tiles, By task / By person / By project views, filters,
/// Create Task by type.
class RndTasksTab extends StatefulWidget {
  const RndTasksTab({super.key, this.initial = const {}});

  /// Opened from a dashboard chip (e.g. my overdue tasks).
  final Map<String, String> initial;

  @override
  State<RndTasksTab> createState() => _RndTasksTabState();
}

const _statusOptions = [
  Option('pending', 'Pending (open, not overdue)'),
  Option('overdue', 'Overdue'),
  Option('completed', 'Completed'),
  Option('cancelled', 'Cancelled'),
];
const _bandOptions = [
  Option('0', '0% — not started'),
  Option('1-49', '1–49%'),
  Option('50-99', '50–99%'),
  Option('100', '100% — done'),
];
const _typeOptions = [Option('requirement', 'Requirement'), Option('prototype', 'Prototype'), Option('project', 'Project')];

class _RndTasksTabState extends State<RndTasksTab> {
  final _list = GlobalKey<ApiListViewState>();
  late Map<String, String> _f = {...widget.initial};
  String _view = 'task';
  Json? _analytics;
  List<Json> _users = [];
  List<Option<String>> _parents = [];

  static const _pageSize = 50;

  @override
  void initState() {
    super.initState();
    _loadPickers();
  }

  Future<void> _loadPickers() async {
    try {
      final u = jsonList(await Api.get('/users/directory'))
        ..sort((a, b) => (str(a, 'name') ?? '').compareTo(str(b, 'name') ?? ''));
      if (mounted) setState(() => _users = u);
    } catch (_) {}
    final parents = <Option<String>>[];
    try {
      final p = jsonList(await Api.get('/rnd/projects'))
        ..sort((a, b) => (str(a, 'project_number') ?? '').compareTo(str(b, 'project_number') ?? ''));
      parents.addAll(
        p.map((x) => Option('project:${x['id']}', '${x['project_number']} — ${x['title']}', subtitle: 'Prototype / Research')),
      );
    } catch (_) {}
    try {
      final p = jsonList(await Api.get('/rnd/tasks/pm-project-options'))
        ..sort((a, b) => (str(a, 'project_code') ?? '').compareTo(str(b, 'project_code') ?? ''));
      parents.addAll(
        p.map(
          (x) =>
              Option('pm_project:${x['id']}', str(x, 'label') ?? '${x['project_code']} — ${x['name']}', subtitle: 'All Projects'),
        ),
      );
    } catch (_) {}
    try {
      final r =
          jsonList(await Api.get('/rnd/requirements'))
              .where((x) => x['rd_number'] != null && x['requirement_id'] != null)
              .toList()
            ..sort((a, b) => (str(a, 'rd_number') ?? '').compareTo(str(b, 'rd_number') ?? ''));
      parents.addAll(
        r.map((x) => Option('requirement:${x['requirement_id']}', str(x, 'rd_number')!, subtitle: 'Requirements (R&D ID)')),
      );
    } catch (_) {}
    if (mounted) setState(() => _parents = parents);
  }

  Map<String, dynamic> _query(String search) {
    final q = <String, dynamic>{};
    final parent = (_f['parent'] ?? '').split(':');
    if (parent.length == 2) {
      q[switch (parent[0]) {
            'requirement' => 'requirement_id',
            'project' => 'rnd_project_id',
            _ => 'pm_project_id',
          }] =
          parent[1];
    }
    for (final k in ['assigned_to_id', 'department', 'type', 'status', 'priority', 'due_from', 'due_to', 'progress_band']) {
      if ((_f[k] ?? '').isNotEmpty) q[k] = _f[k];
    }
    if (search.trim().isNotEmpty) q['q'] = search.trim();
    return q;
  }

  void _loadAnalytics(Map<String, dynamic> q) {
    Api.get('/rnd/tasks/analytics', query: q).then(
      (a) {
        if (mounted) setState(() => _analytics = jsonMap(a));
      },
      onError: (_) {
        if (mounted) setState(() => _analytics = {});
      },
    );
  }

  void _reloadAll() {
    if (_view == 'task') {
      _list.currentState?.reload();
    } else {
      _loadAnalytics(_query(''));
    }
  }

  Future<ApiPage> _load(int page, String search) async {
    final q = _query(search);
    if (page == 1) _loadAnalytics(q);
    final data = await Api.get('/rnd/tasks', query: {...q, 'page': page, 'page_size': _pageSize});
    final p = ApiPage.from(data);
    p.rows.sort((a, b) {
      final c = (str(jsonMap(a['parent']), 'ref') ?? '').compareTo(str(jsonMap(b['parent']), 'ref') ?? '');
      return c != 0 ? c : (intOf(a['id']) ?? 0) - (intOf(b['id']) ?? 0);
    });
    return p;
  }

  void _apply(Map<String, String> f) {
    setState(() => _f = f);
    _reloadAll();
  }

  Future<void> _filters() async {
    final d = {..._f};
    DateTime? from = parseDate(d['due_from']), to = parseDate(d['due_to']);
    final departments = _users.map((u) => str(u, 'department')).whereType<String>().toSet().toList()..sort();
    final ok = await showFormSheet(
      context,
      title: 'Filters',
      saveLabel: 'Apply',
      builder: (ctx, setS) {
        void set(String k, String? v) => setS(() => v == null || v.isEmpty ? d.remove(k) : d[k] = v);
        return [
          const Hint('Narrow the tasks, tiles and grouped views together, then press Apply.'),
          AppSelect<String>(
            label: 'Project / requirement',
            value: d['parent'],
            options: _parents,
            onChanged: (o) => set('parent', o?.value),
          ),
          AppSelect<String>(
            label: 'Assigned user',
            value: d['assigned_to_id'],
            options: [for (final u in _users) Option('${u['id']}', str(u, 'name') ?? '', subtitle: str(u, 'department'))],
            onChanged: (o) => set('assigned_to_id', o?.value),
          ),
          AppSelect<String>(
            label: 'Department',
            value: d['department'],
            options: [for (final x in departments) Option(x, x)],
            onChanged: (o) => set('department', o?.value),
          ),
          AppSelect<String>(label: 'Type', value: d['type'], options: _typeOptions, onChanged: (o) => set('type', o?.value)),
          AppSelect<String>(
            label: 'Status',
            value: d['status'],
            options: _statusOptions,
            onChanged: (o) => set('status', o?.value),
          ),
          AppSelect<String>(
            label: 'Priority',
            value: d['priority'],
            options: priorityOptions,
            onChanged: (o) => set('priority', o?.value),
          ),
          DateField(
            label: 'Due from',
            value: from,
            onChanged: (v) => setS(() {
              from = v;
              set('due_from', v == null ? null : apiDate(v));
            }),
          ),
          DateField(
            label: 'Due to',
            value: to,
            onChanged: (v) => setS(() {
              to = v;
              set('due_to', v == null ? null : apiDate(v));
            }),
          ),
          AppSelect<String>(
            label: 'Completion progress',
            value: d['progress_band'],
            options: _bandOptions,
            onChanged: (o) => set('progress_band', o?.value),
          ),
        ];
      },
      onSave: () async {},
    );
    if (ok) _apply(d);
  }

  void _openParent(Json parent, VoidCallback reload) {
    final kind = parent['kind'];
    final Widget screen;
    if (kind == 'requirement') {
      screen = RequirementDetailScreen(
        source: str(parent, 'source') ?? 'inquiry',
        recordId: intOf(parent['record_id']) ?? 0,
        initialTab: 'Tasks',
      );
    } else if (kind == 'pm_project') {
      screen = PmProjectTasksScreen(pmProjectId: intOf(parent['id']) ?? 0);
    } else {
      screen = ProjectDetailScreen(projectId: intOf(parent['id']) ?? 0, initialTab: 'Tasks');
    }
    openThen(context, screen, reload);
  }

  Future<void> _create() async {
    final ok = await showCreateRndTask(context);
    if (ok) _reloadAll();
  }

  @override
  Widget build(BuildContext context) {
    final t = jsonMap(_analytics?['totals']);
    final seesAll = RndPerm.feature('tasks', 'analytics', 'view');
    final active = _f.length - (_f.containsKey('status') ? 1 : 0);
    Widget tile(String label, String? status, Object? value) => CountChip(
      label,
      value ?? '—',
      selected: status != null && _f['status'] == status,
      onTap: status == null
          ? () => _apply({..._f}..remove('status'))
          : () => _apply(_f['status'] == status ? ({..._f}..remove('status')) : {..._f, 'status': status}),
    );
    final header = Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        PageHeader(
          'R&D Tasks',
          subtitle:
              'Tasks on requirements, on prototype / research projects and on projects from Project Management — '
              'create, track and see progress.'
              '${seesAll ? '' : ' You see the tasks assigned to you or created by you; R&D heads and people with “All R&D tasks & analytics” see every task.'}',
        ),
        ChipRow(
          children: [
            tile('Total', null, t['total']),
            tile('Pending', 'pending', t['pending']),
            tile('Completed', 'completed', t['completed']),
            tile('Overdue', 'overdue', t['overdue']),
            CountChip('Average progress', t['avg_progress'] is num ? '${(t['avg_progress'] as num).round()}%' : '—'),
          ],
        ),
        ChipRow(
          children: [
            CountChip(active > 0 ? 'Filters ($active)' : 'Filters', null, selected: active > 0, onTap: _filters),
            if (_f.isNotEmpty) CountChip('Clear', null, onTap: () => _apply({})),
          ],
        ),
        ChipRow(
          children: [
            for (final (k, l) in const [('task', 'By task'), ('person', 'By person'), ('project', 'By project / requirement')])
              CountChip(l, null, selected: _view == k, onTap: () => setState(() => _view = k)),
          ],
        ),
      ],
    );

    return Scaffold(
      backgroundColor: Colors.transparent,
      floatingActionButton: RndPerm.can('tasks', 'create') ? CreateFab(label: 'Create Task', onPressed: _create) : null,
      body: _view == 'task'
          ? ApiListView(
              key: _list,
              paged: true,
              pageSize: _pageSize,
              searchHint: 'Search task, R&D ID, project or person…',
              header: header,
              emptyText: 'No tasks match these filters.',
              load: _load,
              itemBuilder: (ctx, r, reload) => _taskCard(r, reload),
            )
          : RefreshIndicator(
              onRefresh: () async => _reloadAll(),
              child: ListView(
                padding: const EdgeInsets.only(bottom: 88),
                children: [header, if (_analytics == null) const LoadingView(), ..._groups()],
              ),
            ),
    );
  }

  (String, Color) _rowState(Json r) {
    if (r['status'] == 'cancelled') return ('Cancelled', const Color(0xFF78716C));
    if (r['status'] != 'open') return ('Completed', const Color(0xFF16A34A));
    if (numOf(r['days_overdue']) > 0) return ('Overdue', const Color(0xFFDC2626));
    final w = str(r, 'work_status');
    return (workLabels[w] ?? 'Open', hexColor(workHex[w] ?? '#2563EB'));
  }

  Widget _taskCard(Json r, VoidCallback reload) {
    final parent = jsonMap(r['parent']);
    final assignee = jsonMap(r['assignee']);
    final (st, color) = _rowState(r);
    final type = str(r, 'type');
    final overdue = r['status'] == 'open' && numOf(r['days_overdue']) > 0;
    return Opacity(
      opacity: r['status'] != 'open' ? 0.75 : 1,
      child: RecordCard(
        code: '${parent['ref'] ?? ''}${parent['title'] != null ? ' — ${parent['title']}' : ''}',
        title: str(r, 'title') ?? '',
        subtitle: boolOf(r['requirement_changed']) && r['status'] == 'open'
            ? 'Requirement changed since this task was created'
            : null,
        trailing: Padding(
          padding: const EdgeInsets.only(left: 6),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.end,
            children: [
              Pill(st, color),
              const SizedBox(height: 4),
              Pill(
                type == 'requirement'
                    ? 'Requirement'
                    : type == 'project'
                    ? 'Project'
                    : 'Prototype',
                hexColor(
                  type == 'requirement'
                      ? '#FF6A2A'
                      : type == 'project'
                      ? '#047857'
                      : '#2563EB',
                ),
              ),
            ],
          ),
        ),
        meta: [
          ('Assignee', txt(assignee['name'])),
          ('Department', txt(assignee['department'])),
          ('Priority', priorityLabel(r['priority'])),
          ('Progress', '${numOf(r['progress_percent']).round()}%'),
          ('Start', fmtDate(r['start_date'])),
          ('Due', fmtDate(r['due_date'])),
          if (r['closed_at'] != null && r['status'] != 'cancelled') ('Completed on', fmtDate(r['closed_at'])),
          if (overdue) ('Days overdue', '${r['days_overdue']}'),
        ],
        onTap: () => _openParent(parent, reload),
      ),
    );
  }

  List<Widget> _groups() {
    final a = _analytics;
    if (a == null) return [];
    final byPerson = _view == 'person';
    final rows = jsonList(byPerson ? a['by_user'] : a['by_project']);
    String label(Json g) =>
        g['kind'] != null ? (g['title'] != null ? '${g['ref']} — ${g['title']}' : txt(g['ref'])) : txt(g['name']);
    rows.sort((x, y) => label(x).compareTo(label(y)));
    if (rows.isEmpty) return [const EmptyView('No tasks match these filters.')];
    return [
      for (final g in rows)
        RecordCard(
          title: label(g),
          subtitle: byPerson ? txt(g['department']) : null,
          meta: [
            ('Tasks', '${g['total'] ?? 0}'),
            ('Pending', '${g['pending'] ?? 0}'),
            ('Completed', '${g['completed'] ?? 0}'),
            ('Overdue', '${g['overdue'] ?? 0}'),
            ('Progress', '${numOf(g['progress']).round()}%'),
          ],
          onTap: byPerson
              ? null
              : () => _openParent({
                  'kind': g['kind'],
                  'id': g['id'],
                  'source': g['source'],
                  'record_id': g['record_id'],
                }, _reloadAll),
        ),
    ];
  }
}

/// Create Task by type (portal: TaskCreateSheet).
Future<bool> showCreateRndTask(BuildContext context) async {
  final m = _CreateDraft();
  return showFormSheet(
    context,
    title: 'Create Task',
    saveLabel: 'Create Task',
    builder: (ctx, setS) => [_CreateFields(draft: m)],
    onSave: () async {
      if (m.type == 'requirement' && m.reqKey == null) {
        throw 'Pick the requirement this task is for (only accepted requirements are listed).';
      }
      if (m.type == 'prototype' && m.projectId == null) throw 'Pick the Prototype / Research project this task is for.';
      if (m.type == 'project' && m.pmProjectId == null) throw 'Pick the project this task is for.';
      if (m.title.text.trim().isEmpty) throw 'Give the task a title — what should be done.';
      if (m.assignee == null) throw 'Pick who should do this task.';
      if (m.due == null) throw 'Set the Due Date.';
      if (apiDate(m.due!).compareTo(todayIso()) < 0) throw 'Due Date is in the past — pick today or a later date.';
      if (m.start != null && m.start!.isAfter(m.due!)) {
        throw 'Start date ${fmtDate(m.start)} is after the Due Date ${fmtDate(m.due)} — the task must start on or before it is due.';
      }
      final parts = (m.reqKey ?? '').split(':');
      await postForm('/rnd/tasks', {
        'type': m.type,
        if (m.type == 'requirement') 'source': parts.first,
        if (m.type == 'requirement') 'record_id': parts.last,
        if (m.type == 'prototype') 'rnd_project_id': m.projectId,
        if (m.type == 'project') 'pm_project_id': m.pmProjectId,
        'title': m.title.text.trim(),
        'remarks': m.remarks.text.trim(),
        'assigned_to_id': m.assignee,
        'start_date': m.start == null ? null : apiDate(m.start!),
        'due_date': apiDate(m.due!),
        'priority': m.priority,
        'checklist': [
          for (final s in m.steps)
            if ((str(s, 'text') ?? '').trim().isNotEmpty) {'text': (str(s, 'text') ?? '').trim()},
        ],
      }, files: m.files);
    },
  );
}

class _CreateDraft {
  String type = 'requirement';
  String? reqKey;
  int? projectId;
  int? pmProjectId;
  final title = TextEditingController();
  final remarks = TextEditingController();
  int? assignee;
  DateTime? start;
  DateTime? due;
  String priority = 'standard';
  List<Json> steps = [];
  List<MultipartFile> files = [];
}

class _CreateFields extends StatefulWidget {
  const _CreateFields({required this.draft});
  final _CreateDraft draft;

  @override
  State<_CreateFields> createState() => _CreateFieldsState();
}

class _CreateFieldsState extends State<_CreateFields> {
  List<Option<String>>? _reqs;
  List<Option<int>>? _projects;
  List<Option<int>>? _pm;
  List<Json> _people = [];
  String? _peopleHint;
  String? _error;
  int _token = 0;

  _CreateDraft get d => widget.draft;

  @override
  void initState() {
    super.initState();
    _loadPicker();
  }

  Future<void> _loadPicker() async {
    try {
      if (d.type == 'requirement' && _reqs == null) {
        final rows =
            jsonList(await Api.get('/rnd/requirements', query: {'status': 'accepted'}))
                .where((r) => r['status'] == 'accepted')
                .toList()
              ..sort((a, b) => (str(a, 'rd_number') ?? '').compareTo(str(b, 'rd_number') ?? ''));
        _reqs = [
          for (final r in rows)
            Option(
              '${r['source']}:${r['record_id']}',
              '${r['rd_number'] ?? r['universal_id']}',
              subtitle: [str(r, 'org_name'), str(r, 'product')].whereType<String>().join(' · '),
            ),
        ];
      }
      if (d.type == 'prototype' && _projects == null) {
        final rows = jsonList(await Api.get('/rnd/projects', query: {'status': 'active'}))
          ..sort((a, b) => (str(a, 'project_number') ?? '').compareTo(str(b, 'project_number') ?? ''));
        _projects = [for (final p in rows) Option(intOf(p['id']) ?? 0, '${p['project_number']} — ${p['title']}')];
      }
      if (d.type == 'project' && _pm == null) {
        final rows = jsonList(await Api.get('/rnd/tasks/pm-project-options'))
          ..sort((a, b) => (str(a, 'project_code') ?? '').compareTo(str(b, 'project_code') ?? ''));
        _pm = [for (final p in rows) Option(intOf(p['id']) ?? 0, str(p, 'label') ?? '${p['project_code']} — ${p['name']}')];
      }
      if (mounted) setState(() => _error = null);
    } catch (e) {
      if (mounted) setState(() => _error = ApiClient.describe(e));
    }
  }

  Future<void> _loadPeople() async {
    final t = ++_token;
    setState(() {
      _people = [];
      _peopleHint = null;
    });
    try {
      List<Json> people = [];
      String? hint;
      if (d.type == 'requirement' && d.reqKey != null) {
        final p = d.reqKey!.split(':');
        people = jsonList(await Api.get('/rnd/requirement-work/${p.first}/${p.last}/assignees'));
      } else if (d.type == 'prototype' && d.projectId != null) {
        final a = jsonMap(await Api.get('/rnd/projects/${d.projectId}/task-access'));
        people = jsonList(a['people']);
        if (!boolOf(a['can_manage'])) {
          hint = 'Only the project lead can give tasks on this project — pick another project or ask the lead.';
        }
      } else if (d.type == 'project' && d.pmProjectId != null) {
        final a = jsonMap(await Api.get('/rnd/pm-projects/${d.pmProjectId}/task-access'));
        people = jsonList(a['people']);
        if (!boolOf(a['can_manage'])) {
          hint = 'Only R&D heads or the project manager can give R&D tasks on this project — pick another project or ask them.';
        }
      }
      if (mounted && t == _token) {
        setState(() {
          _people = people;
          _peopleHint = hint;
        });
      }
    } catch (e) {
      if (mounted && t == _token) setState(() => _peopleHint = ApiClient.describe(e));
    }
  }

  Widget _gap() => const SizedBox(height: 14);

  @override
  Widget build(BuildContext context) {
    final picked = d.type == 'requirement'
        ? d.reqKey != null
        : d.type == 'prototype'
        ? d.projectId != null
        : d.pmProjectId != null;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        const Hint(
          'Give R&D work to a person — on a requirement R&D has accepted, on a prototype / research project, or on a '
          'project from Project Management.',
        ),
        if (_error != null) Padding(padding: const EdgeInsets.only(top: 8), child: ErrorBanner(_error!)),
        _gap(),
        const FormHeading('Type'),
        const SizedBox(height: 6),
        Segmented<String>(
          options: _typeOptions,
          value: d.type,
          onChanged: (v) {
            if (v == d.type) return;
            setState(() {
              d.type = v;
              d.reqKey = null;
              d.projectId = null;
              d.pmProjectId = null;
              d.assignee = null;
              _people = [];
              _peopleHint = null;
            });
            _loadPicker();
          },
        ),
        _gap(),
        if (d.type == 'requirement') ...[
          AppSelect<String>(
            label: 'Requirement',
            required: true,
            value: d.reqKey,
            options: _reqs ?? const [],
            enabled: _reqs != null,
            onChanged: (o) {
              setState(() {
                d.reqKey = o?.value;
                d.assignee = null;
              });
              _loadPeople();
            },
          ),
          const Hint('Only requirements whose latest revision R&D has accepted are listed, by R&D ID.'),
        ],
        if (d.type == 'prototype')
          AppSelect<int>(
            label: 'Prototype / Research project',
            required: true,
            value: d.projectId,
            options: _projects ?? const [],
            enabled: _projects != null,
            onChanged: (o) {
              setState(() {
                d.projectId = o?.value;
                d.assignee = null;
              });
              _loadPeople();
            },
          ),
        if (d.type == 'project') ...[
          AppSelect<int>(
            label: 'Project (All Projects)',
            required: true,
            value: d.pmProjectId,
            options: _pm ?? const [],
            enabled: _pm != null,
            onChanged: (o) {
              setState(() {
                d.pmProjectId = o?.value;
                d.assignee = null;
              });
              _loadPeople();
            },
          ),
          const Hint(
            'Projects from Project Management › All Projects, by PEW code. The task stays R&D work — the assignee tracks '
            'it in R&D › R&D Tasks.',
          ),
        ],
        _gap(),
        const FormHeading('Basic Information'),
        const SizedBox(height: 8),
        AppTextField(
          label: 'Task Name',
          controller: d.title,
          required: true,
          hint: 'e.g. Feasibility + GA drawing for 600 mm platform',
        ),
        _gap(),
        AppTextField(
          label: 'Details',
          controller: d.remarks,
          maxLines: 4,
          hint: 'What exactly you need back, references, constraints…',
        ),
        _gap(),
        const FormHeading('Assignment'),
        const SizedBox(height: 8),
        AppSelect<int>(
          label: picked ? 'Assignee' : 'Assignee (pick the requirement / project first)',
          required: true,
          value: d.assignee,
          enabled: picked,
          options: personOptions(_people),
          onChanged: (o) => setState(() => d.assignee = o?.value),
        ),
        if (_peopleHint != null) Hint(_peopleHint!, color: const Color(0xFFB45309)),
        _gap(),
        const FormHeading('Schedule & Priority'),
        const SizedBox(height: 8),
        DateField(label: 'Start Date', value: d.start, onChanged: (v) => setState(() => d.start = v)),
        _gap(),
        DateField(label: 'Due Date', required: true, value: d.due, onChanged: (v) => setState(() => d.due = v)),
        _gap(),
        AppSelect<String>(
          label: 'Priority',
          value: d.priority,
          clearable: false,
          options: priorityOptions,
          onChanged: (o) => setState(() => d.priority = o?.value ?? 'standard'),
        ),
        _gap(),
        ChecklistEditor(steps: d.steps, onChanged: (s) => setState(() => d.steps = s)),
        _gap(),
        FilesField(label: 'Attachments (optional)', files: d.files, onChanged: (f) => setState(() => d.files = f)),
        const SizedBox(height: 4),
        const Hint(
          'Steps the assignee ticks off — progress then follows the ticked steps, and all must be ticked to complete the task.',
          color: Brand.muted,
        ),
      ],
    );
  }
}
