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
import 'rnd_project_form.dart';
import 'rnd_task_board.dart';
import 'rnd_timeline.dart';

/// R&D › Prototype / Research (portal: app/dashboard/rnd/projects).

const stageLabels = {
  'initiation': 'Initiation',
  'research': 'Research',
  'development': 'Development',
  'feasibility': 'Feasibility',
  'handover': 'Handover',
  'closed': 'Closed',
};
const stageHex = {
  'initiation': '#78716c',
  'research': '#2563EB',
  'development': '#7C3AED',
  'feasibility': '#F59E0B',
  'handover': '#0891B2',
  'closed': '#16A34A',
};
const projectStatusLabels = {'active': 'Active', 'on_hold': 'On Hold', 'cancelled': 'Cancelled'};
const projectStatusHex = {'active': '#16A34A', 'on_hold': '#F59E0B', 'cancelled': '#DC2626'};

class ProjectsList extends StatefulWidget {
  const ProjectsList({super.key, this.initialStatus});
  final String? initialStatus;

  @override
  State<ProjectsList> createState() => _ProjectsListState();
}

class _ProjectsListState extends State<ProjectsList> {
  final _list = GlobalKey<ApiListViewState>();
  String? _stage;
  late String? _status = widget.initialStatus;
  String? _priority;
  String? _origin;

  int get _activeFilters => [_stage, _status, _priority, _origin].whereType<String>().length;

  Future<void> _filters() async {
    var stage = _stage, status = _status, priority = _priority, origin = _origin;
    final ok = await showFormSheet(
      context,
      title: 'Filters',
      saveLabel: 'Apply',
      builder: (ctx, setS) => [
        const Hint('Narrow the R&D project list, then press Apply.'),
        AppSelect<String>(
          label: 'Stage',
          value: stage,
          options: [for (final e in stageLabels.entries) Option(e.key, e.value)],
          onChanged: (o) => setS(() => stage = o?.value),
        ),
        AppSelect<String>(
          label: 'Status',
          value: status,
          options: [for (final e in projectStatusLabels.entries) Option(e.key, e.value)],
          onChanged: (o) => setS(() => status = o?.value),
        ),
        AppSelect<String>(
          label: 'Priority',
          value: priority,
          options: priorityOptions,
          onChanged: (o) => setS(() => priority = o?.value),
        ),
        AppSelect<String>(
          label: 'Origin',
          value: origin,
          options: [for (final e in originLabels.entries) Option(e.key, e.value)],
          onChanged: (o) => setS(() => origin = o?.value),
        ),
      ],
      onSave: () async {},
    );
    if (!ok) return;
    setState(() {
      _stage = stage;
      _status = status;
      _priority = priority;
      _origin = origin;
    });
    _list.currentState?.reload();
  }

  Future<void> _create() async {
    final p = await showProjectForm(context);
    if (p == null || !mounted) return;
    _list.currentState?.reload();
    if (intOf(p['id']) != null) {
      openThen(context, ProjectDetailScreen(projectId: intOf(p['id'])!, initialTab: 'Tasks'), () => _list.currentState?.reload());
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: Colors.transparent,
      floatingActionButton: RndPerm.can('projects', 'create') ? CreateFab(label: 'New R&D Project', onPressed: _create) : null,
      body: ApiListView(
        key: _list,
        searchHint: 'Search by project number, title, or objective…',
        emptyText: 'No R&D projects found.',
        header: ChipRow(
          children: [
            CountChip(
              _activeFilters > 0 ? 'Filters ($_activeFilters)' : 'Filters',
              null,
              selected: _activeFilters > 0,
              onTap: _filters,
            ),
            if (_activeFilters > 0)
              CountChip(
                'Clear',
                null,
                onTap: () {
                  setState(() => _stage = _status = _priority = _origin = null);
                  _list.currentState?.reload();
                },
              ),
          ],
        ),
        load: (page, search) async {
          final rows = jsonList(
            await Api.get(
              '/rnd/projects',
              query: {'stage': _stage, 'status': _status, 'priority': _priority, 'origin': _origin, 'search': search},
            ),
          );
          rows.sort((a, b) => (str(a, 'project_number') ?? '').compareTo(str(b, 'project_number') ?? ''));
          return ApiPage(rows);
        },
        itemBuilder: (ctx, p, reload) {
          final o = normalizeOrigin(p['origin']);
          return RecordCard(
            code: str(p, 'project_number'),
            title: str(p, 'title') ?? '',
            trailing: Padding(
              padding: const EdgeInsets.only(left: 6),
              child: Pill(
                projectStatusLabels[p['status']] ?? txt(p['status']),
                hexColor(projectStatusHex[p['status']] ?? '#78716c'),
              ),
            ),
            meta: [
              ('Origin', o.isEmpty ? 'Not recorded' : originLabels[o]!),
              ('Priority', priorityLabel(p['priority'])),
              ('Lead', txt(p['lead_name'])),
              ('Target End', p['target_end_date'] == null ? 'Not decided' : fmtDate(p['target_end_date'])),
            ],
            onTap: () => openThen(ctx, ProjectDetailScreen(projectId: intOf(p['id']) ?? 0), reload),
          );
        },
      ),
    );
  }
}

const _projectTaskLabels = TaskLabels(
  manager: 'project lead',
  emptyManager: 'No tasks yet — use “Add Task” to hand work to a team member. Only people under Team Members can be assigned.',
  emptyOther: 'You have no tasks on this project.',
);

TaskRights projectTaskRights() => TaskRights(
  create: RndPerm.feature('projects', 'tasks', 'create'),
  edit: RndPerm.feature('projects', 'tasks', 'edit'),
  approve: RndPerm.feature('projects', 'tasks', 'approve'),
  cancel: RndPerm.feature('projects', 'tasks', 'cancel'),
);

/// One project: Overview · Members · Tasks · Documents · Timeline.
class ProjectDetailScreen extends StatefulWidget {
  const ProjectDetailScreen({super.key, required this.projectId, this.initialTab = 'Overview'});
  final int projectId;
  final String initialTab;

  @override
  State<ProjectDetailScreen> createState() => _ProjectDetailScreenState();
}

class _ProjectDetailScreenState extends State<ProjectDetailScreen> {
  Json? _p;
  bool _isManager = false;
  List<Json> _users = [];
  Object? _error;
  late String _tab = widget.initialTab;
  int _key = 0;

  @override
  void initState() {
    super.initState();
    _load();
    Api.get('/users/directory').then((u) {
      if (mounted) setState(() => _users = jsonList(u));
    }, onError: (_) {});
  }

  Future<void> _load() async {
    try {
      final p = jsonMap(await Api.get('/rnd/projects/${widget.projectId}'));
      final a = jsonMap(await Api.get('/rnd/projects/${widget.projectId}/task-access'));
      if (mounted) {
        setState(() {
          _p = p;
          _isManager = boolOf(a['can_manage']);
          _error = null;
          _key++;
        });
      }
    } catch (e) {
      if (mounted) setState(() => _error = e);
    }
  }

  Future<void> _edit() async {
    final saved = await showProjectForm(context, project: _p);
    if (saved != null) await _load();
  }

  Future<void> _delete() async {
    final p = _p!;
    final ok = await confirmDialog(
      context,
      title: 'Delete this project?',
      message:
          'This deletes "${p['title']}" (${p['project_number']}). A project that still has attachments, experiments or '
          "prototypes can't be deleted — remove those first.",
      confirmLabel: 'Delete',
      danger: true,
    );
    if (!ok || !mounted) return;
    if (await runAction(context, () => Api.delete('/rnd/projects/${widget.projectId}'), success: 'Project deleted.') && mounted) {
      Navigator.pop(context);
    }
  }

  Future<void> _editMembers() async {
    final p = _p!;
    var leads = (p['lead_ids'] is List && (p['lead_ids'] as List).isNotEmpty)
        ? (p['lead_ids'] as List).map(intOf).whereType<int>().toList()
        : [if (intOf(p['lead_id']) != null) intOf(p['lead_id'])!];
    var team = (p['team_member_ids'] is List) ? (p['team_member_ids'] as List).map(intOf).whereType<int>().toList() : <int>[];
    final ok = await showFormSheet(
      context,
      title: 'Edit members',
      saveLabel: 'Save members',
      builder: (ctx, setS) => [
        const Hint(
          'Project Leads plan milestones and hand out tasks. Only people listed here can be given tasks on this project.',
        ),
        PeoplePicker(label: 'Project Leads', users: _users, value: leads, exclude: team, onChanged: (v) => setS(() => leads = v)),
        PeoplePicker(label: 'Team Members', users: _users, value: team, exclude: leads, onChanged: (v) => setS(() => team = v)),
      ],
      onSave: () => Api.patch('/rnd/projects/${widget.projectId}', data: {'lead_ids': leads, 'team_member_ids': team}),
    );
    if (ok) await _load();
  }

  @override
  Widget build(BuildContext context) {
    final p = _p;
    if (p == null) {
      return SubPage(
        title: 'R&D Project',
        body: _error != null ? ErrorView(_error!, onRetry: _load) : const LoadingView(),
      );
    }
    final canEdit = RndPerm.can('projects', 'edit');
    final createdBy = intOf(p['created_by_id']);
    final canDelete = RndPerm.can('projects', 'delete') && (Perm.isAdmin || createdBy == null || createdBy == Perm.userId);
    final tabs = ['Overview', 'Members', if (RndPerm.feature('projects', 'tasks', 'view')) 'Tasks', 'Documents', 'Timeline'];
    final tab = tabs.contains(_tab) ? _tab : 'Overview';
    return SubPage(
      title: str(p, 'project_number') ?? 'R&D Project',
      actions: [
        if (canEdit) IconButton(tooltip: 'Edit', onPressed: _edit, icon: const Icon(Icons.edit_outlined)),
        if (canDelete)
          IconButton(
            tooltip: 'Delete',
            onPressed: _delete,
            icon: const Icon(Icons.delete_outline, color: Brand.danger),
          ),
      ],
      body: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          SubTabs(tabs: tabs, current: tab, onTap: (t) => setState(() => _tab = t)),
          const Divider(height: 1),
          Expanded(
            child: KeyedSubtree(
              key: ValueKey('$tab-$_key'),
              child: switch (tab) {
                'Members' => _members(p, canEdit),
                'Tasks' => TasksBoard(
                  api: RndTaskApi.project(widget.projectId),
                  canManage: _isManager,
                  canCreate: _isManager && RndPerm.feature('projects', 'tasks', 'create'),
                  labels: _projectTaskLabels,
                  rights: projectTaskRights(),
                ),
                'Documents' => ProjectDocumentsPanel(projectId: widget.projectId, canManageFiles: _isManager),
                'Timeline' => RndTimeline(path: '/rnd/projects/${widget.projectId}/history'),
                _ => _overview(p, canEdit),
              },
            ),
          ),
        ],
      ),
    );
  }

  Widget _overview(Json p, bool canEdit) {
    final leads = jsonList(p['leads']).map((m) => m['name']).whereType<String>().join(', ');
    final team = jsonList(p['team_members']).map((m) => m['name']).whereType<String>().join(', ');
    final origin = normalizeOrigin(p['origin']);
    return RefreshIndicator(
      onRefresh: _load,
      child: ListView(
        padding: const EdgeInsets.only(top: 12, bottom: 32),
        children: [
          DetailSection(
            str(p, 'title') ?? '',
            children: [
              Text(str(p, 'objective') ?? '—', style: const TextStyle(fontSize: 14, color: Brand.body)),
              const SizedBox(height: 8),
              Text(
                '${priorityLabel(p['priority'])} · ${fmtDate(p['start_date'])} → '
                '${p['target_end_date'] == null ? 'Not decided' : fmtDate(p['target_end_date'])} · Lead: ${leads.isEmpty ? txt(p['lead_name']) : leads}',
                style: const TextStyle(fontSize: 13, color: Brand.muted),
              ),
            ],
          ),
          DetailSection(
            'Origin & scope',
            children: [
              if (origin.isNotEmpty) ...[
                FieldRow('Why it exists', originLabels[origin] ?? p['origin_label']),
                if (p['source_kind'] != null)
                  FieldRow(
                    kindLabels[p['source_kind']] ?? 'Source',
                    '${p['source_ref'] ?? '#${p['source_id']}'}${boolOf(p['source_exists']) || p['source_exists'] == null ? '' : ' (record no longer exists)'}',
                  ),
                if (p['machine_label'] != null) FieldRow('Existing project being improved', p['machine_label']),
                if (p['product_name'] != null) FieldRow('Product', p['product_name']),
                if (p['improvement_reason_label'] != null) FieldRow('Reason', p['improvement_reason_label']),
                if (p['origin_note'] != null) FieldRow('Who proposed it and why', p['origin_note']),
              ] else
                FieldRow(
                  'Why it exists',
                  Row(
                    children: [
                      Expanded(
                        child: Text(
                          'Not recorded${canEdit && _isManager ? '' : ' — a project lead or admin can set it.'}',
                          style: const TextStyle(color: Brand.muted),
                        ),
                      ),
                      if (canEdit && _isManager) OutlinedButton(onPressed: _edit, child: const Text('Set origin')),
                    ],
                  ),
                ),
              FieldRow('Scope', p['scope']),
            ],
          ),
          DetailSection(
            'Members',
            children: [FieldRow('Team Members', team.isEmpty ? null : team), FieldRow('Remarks', p['remarks'])],
          ),
          DetailSection(
            'Attachments',
            action: TextButton(onPressed: () => setState(() => _tab = 'Documents'), child: const Text('Manage in Documents')),
            children: [_OverviewAttachments(projectId: widget.projectId)],
          ),
          Padding(
            padding: const EdgeInsets.fromLTRB(16, 0, 16, 12),
            child: Text('Created ${fmtDate(p['created_at'])}', style: const TextStyle(fontSize: 12, color: Brand.muted)),
          ),
          _BudgetCard(projectId: widget.projectId, canEdit: canEdit),
        ],
      ),
    );
  }

  Widget _members(Json p, bool canEdit) {
    final leadIds = (p['lead_ids'] is List && (p['lead_ids'] as List).isNotEmpty)
        ? (p['lead_ids'] as List).map(intOf).whereType<int>().toList()
        : [if (intOf(p['lead_id']) != null) intOf(p['lead_id'])!];
    final team = (p['team_member_ids'] is List) ? (p['team_member_ids'] as List).map(intOf).whereType<int>().toList() : <int>[];
    final rows = [
      for (final id in leadIds) (id, 'Project Lead'),
      for (final id in team)
        if (!leadIds.contains(id)) (id, 'Team Member'),
    ];
    String nameOf(int id) {
      for (final m in [...jsonList(p['leads']), ...jsonList(p['team_members']), ..._users]) {
        if (intOf(m['id']) == id) return str(m, 'name') ?? 'User #$id';
      }
      return 'User #$id';
    }

    Json? user(int id) {
      for (final u in _users) {
        if (intOf(u['id']) == id) return u;
      }
      return null;
    }

    return ListView(
      padding: const EdgeInsets.only(top: 12, bottom: 32),
      children: [
        const NoteBox(
          'Project Leads plan milestones and hand out tasks. Only people listed here can be given tasks on this project.',
          color: Brand.muted,
        ),
        if (canEdit)
          Padding(
            padding: const EdgeInsets.fromLTRB(16, 0, 16, 12),
            child: OutlinedButton.icon(
              onPressed: _editMembers,
              icon: const Icon(Icons.group_outlined),
              label: const Text('Edit members'),
            ),
          ),
        if (rows.isEmpty)
          EmptyView(
            'No members yet${canEdit ? ' — use “Edit members” to add the project leads and team.' : '.'}',
            icon: Icons.group_outlined,
          ),
        for (final (id, role) in rows)
          RecordCard(
            title: nameOf(id),
            subtitle: role,
            meta: [('Email', txt(user(id)?['email'])), ('Department', txt(user(id)?['department']))],
          ),
      ],
    );
  }
}

class _OverviewAttachments extends StatelessWidget {
  const _OverviewAttachments({required this.projectId});
  final int projectId;

  @override
  Widget build(BuildContext context) {
    return FutureBuilder<dynamic>(
      future: Api.get('/rnd/documents', query: {'project_id': projectId}),
      builder: (ctx, s) {
        if (s.connectionState != ConnectionState.done) return const Text('Loading…', style: TextStyle(color: Brand.muted));
        if (s.hasError) return Text(ApiClient.describe(s.error!), style: const TextStyle(color: Brand.danger));
        final docs = jsonList(s.data);
        if (docs.isEmpty) return const Text('No attachments.', style: TextStyle(color: Brand.muted));
        return Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            for (final d in docs)
              InkWell(
                onTap: () => openProjectDocument(context, d),
                child: Padding(
                  padding: const EdgeInsets.symmetric(vertical: 4),
                  child: Text(
                    d['title'] != null && d['title'] != d['file_name']
                        ? '${d['title']} — ${d['file_name']}'
                        : txt(d['file_name']),
                    style: const TextStyle(color: Color(0xFF2563EB), fontWeight: FontWeight.w500),
                  ),
                ),
              ),
          ],
        );
      },
    );
  }
}

/// Budget & spend card (portal: ProjectBudgetCard).
class _BudgetCard extends StatelessWidget {
  const _BudgetCard({required this.projectId, required this.canEdit});
  final int projectId;
  final bool canEdit;

  @override
  Widget build(BuildContext context) {
    return FutureBuilder<dynamic>(
      future: Api.get('/rnd/projects/$projectId/budget'),
      builder: (ctx, s) {
        if (s.connectionState != ConnectionState.done) return const SizedBox.shrink();
        if (s.hasError) return DetailSection('Budget & spend', children: [ErrorBanner(ApiClient.describe(s.error!))]);
        final data = jsonMap(s.data);
        if (boolOf(data['hidden'])) {
          return const DetailSection(
            'Budget & spend',
            children: [
              Text(
                'Costs are hidden for your role (R&D › Prototypes › BOM costs). Ask an admin if you need to see the budget.',
                style: TextStyle(color: Brand.muted),
              ),
            ],
          );
        }
        final sm = data['summary'] is Map ? jsonMap(data['summary']) : null;
        if (sm == null) {
          return DetailSection(
            'Budget & spend',
            children: [
              Text(
                canEdit
                    ? 'No budget yet — use Edit to pick a budget Finance created, or type an amount.'
                    : 'No budget set for this project.',
                style: const TextStyle(color: Brand.muted),
              ),
            ],
          );
        }
        final budget = sm['budgeted_amount'];
        final used = numOf(sm['actual_amount']) + numOf(sm['commitment_amount']);
        final over = sm['available_amount'] is num && (sm['available_amount'] as num) < 0;
        final commitments = jsonList(data['commitments']);
        final lines = jsonList(data['recent_lines']);
        return DetailSection(
          'Budget & spend',
          children: [
            if (sm['code'] != null) Text('Finance budget ${sm['code']}${sm['name'] != null ? ' — ${sm['name']}' : ''}'),
            if (!boolOf(data['linked']))
              const Hint('Nothing charged yet — Finance opens the budget with the first purchase charged to this project.'),
            const SizedBox(height: 6),
            KeyValue('Budget', fmtMoney(budget)),
            KeyValue('Committed', fmtMoney(sm['commitment_amount'])),
            KeyValue('Actual spent', fmtMoney(sm['actual_amount'])),
            KeyValue(
              'Available',
              Text(
                fmtMoney(sm['available_amount']),
                style: TextStyle(fontWeight: FontWeight.w700, color: over ? const Color(0xFFB91C1C) : const Color(0xFF15803D)),
              ),
            ),
            if (budget is num && budget > 0) ...[
              const SizedBox(height: 6),
              ProgressLine(
                sm['consumed_pct'] is num ? sm['consumed_pct'] as num : (used / budget * 100).clamp(0, 100),
                color: over ? Brand.danger : const Color(0xFF2563EB),
              ),
              const Hint('of the budget used (committed + actual)'),
            ],
            if (commitments.isNotEmpty) ...[
              const SizedBox(height: 10),
              const Caps('Open purchase orders'),
              for (final c in commitments)
                KeyValue(
                  str(c, 'po_number') ?? '',
                  '${fmtDate(c['po_date'])} · ${c['vendor_name'] ?? '—'} · PO ${fmtMoney(c['po_value'])} · committed ${fmtMoney(c['open_value'])}',
                ),
            ],
            if (boolOf(data['ledger_hidden']) && numOf(data['line_count']) > 0)
              Hint(
                '${data['line_count']} posted voucher line(s) make up the actual spend — Finance users see them here and in Finance › Controlling.',
              ),
            if (lines.isNotEmpty) ...[
              const SizedBox(height: 10),
              const Caps('Spend booked'),
              for (final l in lines)
                KeyValue(
                  fmtDate(l['posting_date']),
                  '${l['entry_number']} · ${l['party_name'] ?? l['description'] ?? '—'} · ${fmtMoney(numOf(l['debit_amount']) - numOf(l['credit_amount']))}',
                ),
            ],
          ],
        );
      },
    );
  }
}

// ── Project documents (portal: RndDocumentsPanel) ────────────────────────────

const docTypeLabels = {
  'specification': 'Specification',
  'drawing': 'Drawing',
  'test_report': 'Test Report',
  'research_note': 'Research Note',
  'process_document': 'Process Document',
  'other': 'Other',
};
const _docTypeHex = {
  'specification': '#2563EB',
  'drawing': '#7C3AED',
  'test_report': '#16A34A',
  'research_note': '#0891B2',
  'process_document': '#F59E0B',
  'other': '#78716c',
};

class ProjectDocumentsPanel extends StatefulWidget {
  const ProjectDocumentsPanel({super.key, required this.projectId, required this.canManageFiles});
  final int projectId;

  /// Project lead / admin - only they may delete a project's files.
  final bool canManageFiles;

  @override
  State<ProjectDocumentsPanel> createState() => _ProjectDocumentsPanelState();
}

class _ProjectDocumentsPanelState extends State<ProjectDocumentsPanel> {
  final _list = GlobalKey<ApiListViewState>();

  bool get _canUpload => RndPerm.can('documents', 'create') || RndPerm.can('projects', 'edit');

  Future<void> _upload() async {
    final title = TextEditingController();
    final version = TextEditingController();
    final description = TextEditingController();
    var type = 'other';
    var files = <MultipartFile>[];
    final ok = await showFormSheet(
      context,
      title: 'Upload Document',
      saveLabel: 'Upload',
      builder: (ctx, setS) => [
        const Hint('Files are saved to SharePoint and stay with the R&D record — Attachments.'),
        AppTextField(label: 'Title', controller: title, required: true, hint: 'e.g. Load test report — frame v2'),
        AppSelect<String>(
          label: 'Type',
          value: type,
          clearable: false,
          options: [for (final e in docTypeLabels.entries) Option(e.key, e.value)],
          onChanged: (o) => setS(() => type = o?.value ?? 'other'),
        ),
        AppTextField(label: 'Version', controller: version, hint: 'A'),
        AppTextField(label: 'Description', controller: description, maxLines: 3),
        FilesField(
          label: 'Files',
          required: true,
          files: files,
          onChanged: (f) => setS(() => files = f),
          hint: 'Every file is filed under the same title, type and version.',
        ),
      ],
      onSave: () async {
        if (title.text.trim().isEmpty) throw 'Document title is required.';
        if (files.isEmpty) throw 'Choose at least one file to upload.';
        await postForm('/rnd/documents', {
          'project_id': widget.projectId,
          'doc_type': type,
          'title': title.text.trim(),
          'version': version.text.trim(),
          'description': description.text.trim(),
        }, files: files);
      },
    );
    if (ok) _list.currentState?.reload();
  }

  Future<void> _delete(Json d) async {
    final ok = await confirmDialog(
      context,
      title: 'Delete this document?',
      message: 'This removes "${d['title']}" (${d['file_name']}) from the R&D record and deletes the file from SharePoint.',
      confirmLabel: 'Delete',
      danger: true,
    );
    if (!ok || !mounted) return;
    if (await runAction(context, () => Api.delete('/rnd/documents/${d['id']}'))) _list.currentState?.reload();
  }

  @override
  Widget build(BuildContext context) {
    final mayDelete = widget.canManageFiles && RndPerm.can('documents', 'delete');
    return ApiListView(
      key: _list,
      emptyText: 'No documents yet — specs, drawings and test reports uploaded here stay with the R&D record.',
      header: _canUpload
          ? Padding(
              padding: const EdgeInsets.fromLTRB(16, 12, 16, 12),
              child: FilledButton.icon(
                onPressed: _upload,
                icon: const Icon(Icons.upload_file_rounded),
                label: const Text('Upload Document'),
              ),
            )
          : const SizedBox(height: 12),
      load: (page, search) async => ApiPage(jsonList(await Api.get('/rnd/documents', query: {'project_id': widget.projectId}))),
      itemBuilder: (ctx, d, reload) => RecordCard(
        title: '${d['title'] ?? ''}${d['version'] != null ? ' · Rev ${d['version']}' : ''}',
        subtitle: '${d['file_name'] ?? ''}${d['file_size'] != null ? ' · ${fmtSize(d['file_size'])}' : ''}',
        trailing: Padding(
          padding: const EdgeInsets.only(left: 6),
          child: Pill(docTypeLabels[d['doc_type']] ?? txt(d['doc_type']), hexColor(_docTypeHex[d['doc_type']] ?? '#78716c')),
        ),
        meta: [
          ('Uploaded by', '${d['uploaded_by_name'] ?? '—'}${d['created_at'] != null ? ' · ${fmtDate(d['created_at'])}' : ''}'),
        ],
        onTap: () => _actions(ctx, d, mayDelete),
      ),
    );
  }

  void _actions(BuildContext ctx, Json d, bool mayDelete) {
    if (!mayDelete) {
      openProjectDocument(ctx, d);
      return;
    }
    showModalBottomSheet<void>(
      context: ctx,
      backgroundColor: Colors.white,
      builder: (s) => SafeArea(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            ListTile(
              leading: const Icon(Icons.visibility_outlined),
              title: const Text('View'),
              onTap: () {
                Navigator.pop(s);
                openProjectDocument(ctx, d);
              },
            ),
            ListTile(
              leading: const Icon(Icons.delete_outline, color: Brand.danger),
              title: const Text('Delete', style: TextStyle(color: Brand.danger)),
              onTap: () {
                Navigator.pop(s);
                _delete(d);
              },
            ),
          ],
        ),
      ),
    );
  }
}

/// R&D tasks on a Project Management (All Projects) project
/// (portal: rnd/project-tasks/[id]).
class PmProjectTasksScreen extends StatelessWidget {
  const PmProjectTasksScreen({super.key, required this.pmProjectId});
  final int pmProjectId;

  @override
  Widget build(BuildContext context) {
    return SubPage(
      title: 'R&D Tasks',
      body: ApiLoader<Json>(
        load: () async => jsonMap(await Api.get('/rnd/pm-projects/$pmProjectId/task-access')),
        builder: (ctx, a, reload) {
          final p = jsonMap(a['project']);
          final canManage = boolOf(a['can_manage']);
          final sub = [
            str(p, 'client_name'),
            p['status'] != null ? 'Status: ${humanize(p['status'])}' : null,
          ].whereType<String>().join(' · ');
          return Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              Container(
                color: Colors.white,
                padding: const EdgeInsets.fromLTRB(16, 10, 16, 10),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      '${p['project_code'] ?? ''} — ${p['name'] ?? ''}',
                      style: const TextStyle(fontSize: 17, fontWeight: FontWeight.w700, color: Brand.heading),
                    ),
                    Text(
                      sub.isEmpty ? 'Project Management › All Projects' : sub,
                      style: const TextStyle(fontSize: 13, color: Brand.muted),
                    ),
                  ],
                ),
              ),
              Expanded(
                child: TasksBoard(
                  api: RndTaskApi.pmProject(pmProjectId),
                  canManage: canManage,
                  canCreate: canManage && RndPerm.feature('projects', 'tasks', 'create'),
                  labels: const TaskLabels(
                    manager: 'R&D head / project manager',
                    emptyManager: 'No R&D tasks on this project yet — use “Add Task”.',
                    emptyOther: 'You have no R&D tasks on this project.',
                  ),
                  rights: projectTaskRights(),
                ),
              ),
            ],
          );
        },
      ),
    );
  }
}
