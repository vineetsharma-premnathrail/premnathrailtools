import 'package:flutter/material.dart';

import '../../api/api.dart';
import '../../theme.dart';
import '../../ui/app_frame.dart';
import '../../ui/form.dart';
import '../../ui/format.dart';
import '../../ui/widgets.dart';
import 'design_boms.dart';
import 'design_common.dart';
import 'design_documents.dart';

/// Requests - portal design/project-work (Requests tab) and requests/[id].

const _reqStatusColors = <String, Color>{
  'open': Color(0xFF2563EB),
  'accepted': Color(0xFF7C3AED),
  'in_progress': Color(0xFF0F766E),
  'on_hold': Color(0xFFB45309),
  'completed': Color(0xFF16A34A),
  'cancelled': Color(0xFFA8A29E),
};

Widget reqStatusBadge(Object? s) => StatusBadge(labelOf(requestStatusLabels, s), color: _reqStatusColors[str(s)]);

Widget priorityBadge(Object? p) {
  final l = priorityLabel(p);
  return StatusBadge(l, color: l == 'Urgent' ? Brand.danger : const Color(0xFF64748B));
}

const deliverableLabels = <String, String>{
  'draft': 'Draft',
  'in_review': 'In check',
  'in_approval': 'In approval',
  'approved': 'Awaiting customer',
  'released': 'Released',
  'revising': 'Released · revising',
  'obsolete': 'Obsolete',
  'customer_rejected': 'Customer rejected',
};

const _milestoneStatusLabels = {
  'not_started': 'Not started',
  'in_progress': 'In progress',
  'submitted': 'Submitted',
  'achieved': 'Achieved',
  'cancelled': 'Cancelled',
};

const _statusFilters = <(String, String)>[
  ('open,accepted,in_progress,on_hold', 'Active'),
  ('open', 'Open'),
  ('accepted', 'Accepted'),
  ('in_progress', 'In progress'),
  ('on_hold', 'On hold'),
  ('completed', 'Completed'),
  ('cancelled', 'Cancelled'),
  ('', 'All'),
];

/// Opens a drawing / BOM deliverable row ({kind, id, number, ...}).
void openDeliverable(BuildContext context, Json d) {
  final id = asInt(d['id']);
  if (id == null) return;
  openScreen(context, str(d['kind']) == 'bom' ? DesignBomDetail(id: id) : DesignDocumentDetail(id: id));
}

Widget deliverableChip(BuildContext context, Json d) => ActionChip(
      label: Text('${d['number']}${str(d['released_revision_label']).isEmpty ? '' : ' ${d['released_revision_label']}'}',
          style: const TextStyle(fontSize: 12)),
      tooltip: '${d['title']} · ${labelOf(deliverableLabels, d['status'])}',
      onPressed: () => openDeliverable(context, d),
    );

// ── List ─────────────────────────────────────────────────────────────────────

class DesignRequestsTab extends StatefulWidget {
  const DesignRequestsTab({super.key});

  @override
  State<DesignRequestsTab> createState() => _DesignRequestsTabState();
}

class _DesignRequestsTabState extends State<DesignRequestsTab> {
  final _list = GlobalKey<ApiListViewState>();
  String _status = _statusFilters.first.$1;
  String? _source;
  String? _waiting;
  bool _mine = false;

  void _reload() => _list.currentState?.reload();

  Future<void> _new() async {
    final id = await showNewRequestForm(context);
    if (id != null && mounted) {
      _reload();
      openScreen(context, DesignRequestDetail(id: id));
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: Colors.transparent,
      floatingActionButton: CreateFab(label: 'New Request', onPressed: _new),
      body: ApiListView(
        key: _list,
        searchHint: 'Search by request number, title or CRM reference…',
        emptyText: 'No design requests match these filters.${_status.isNotEmpty ? ' Try the “All” tab.' : ''}',
        header: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
          const PageHeader('Requests',
              subtitle:
                  'Work brought to Design by BD, projects and R&D, the evidence for each design WBS, and your Project Management WBS elements and tasks.'),
          Padding(
            padding: const EdgeInsets.fromLTRB(16, 0, 16, 4),
            child: OutlinedButton.icon(
              icon: const Icon(Icons.account_tree_outlined, size: 18),
              label: const Text('Design WBS elements'),
              onPressed: () => openScreen(context, const SubPage(title: 'Design WBS elements', body: _MilestonesView())),
            ),
          ),
          ChipRow(children: [
            for (final t in _statusFilters)
              CountChip(t.$2, null, selected: _status == t.$1, onTap: () {
                setState(() => _status = t.$1);
                _reload();
              }),
          ]),
          Padding(
            padding: const EdgeInsets.fromLTRB(16, 4, 16, 0),
            child: Row(children: [
              Expanded(
                child: AppSelect<String>(
                    label: 'All sources',
                    value: _source,
                    options: optionsOf(requestSourceLabels),
                    onChanged: (o) {
                      setState(() => _source = o?.value);
                      _reload();
                    }),
              ),
              const SizedBox(width: 8),
              Expanded(
                child: AppSelect<String>(
                    label: 'Waiting on anyone',
                    value: _waiting,
                    options: const [Option('design', 'Waiting on Design'), Option('requester', 'Waiting on requester')],
                    onChanged: (o) {
                      setState(() => _waiting = o?.value);
                      _reload();
                    }),
              ),
            ]),
          ),
          Padding(
            padding: const EdgeInsets.symmetric(horizontal: 8),
            child: CheckField(
                label: 'Mine (lead / raised by me)',
                value: _mine,
                onChanged: (v) {
                  setState(() => _mine = v);
                  _reload();
                }),
          ),
        ]),
        load: (page, search) => Api.list('/design/requests', query: {
          'status': _status,
          'source': _source,
          'waiting_on': _waiting,
          'mine': _mine ? true : null,
          'search': search,
        }),
        itemBuilder: (ctx, r, reload) {
          final active = const ['open', 'accepted', 'in_progress', 'on_hold'].contains(str(r['status']));
          return RecordCard(
            code: str(r['request_number']),
            title: str(r['title']),
            subtitle: [
              if (r['changed_since_review'] == true) 'Requirement changed · rev ${r['requirement_revision']}',
              if (str(r['crm_reference']).isNotEmpty) str(r['crm_reference']),
            ].join(' · '),
            trailing: Padding(padding: const EdgeInsets.only(left: 8), child: reqStatusBadge(r['status'])),
            meta: [
              ('Priority', priorityLabel(r['priority'])),
              ('Source', labelOf(requestSourceLabels, r['source'])),
              ('Customer', txt(r['customer_name'])),
              (
                'Project',
                [
                  str(r['order_project_display'] ?? r['order_project_number']),
                  str(r['pm_project_label'] ?? r['erp_project_label']),
                  str(r['pm_milestone_label']),
                ].where((s) => s.isNotEmpty).join(' · ').ifEmpty('—')
              ),
              ('Lead designer', str(r['lead_designer_name']).isEmpty ? 'Not assigned' : str(r['lead_designer_name'])),
              ('Due', '${fmtDate(r['due_date'])}${r['is_overdue'] == true ? ' · overdue' : ''}'),
              if (active) ('Waiting on', str(r['waiting_on']) == 'design' ? 'Design' : 'Requester'),
              (
                'Drawings',
                (asInt(r['document_count']) ?? 0) > 0 ? '${r['released_count']} / ${r['document_count']} released' : 'none yet'
              ),
            ],
            onTap: () async {
              await Navigator.of(ctx).push(MaterialPageRoute(builder: (_) => DesignRequestDetail(id: asInt(r['id'])!)));
              reload();
            },
          );
        },
      ),
    );
  }
}

extension _IfEmpty on String {
  String ifEmpty(String other) => isEmpty ? other : this;
}

/// "Design WBS elements" - evidence for each Design WBS (GET /design/milestones).
class _MilestonesView extends StatefulWidget {
  const _MilestonesView();

  @override
  State<_MilestonesView> createState() => _MilestonesViewState();
}

class _MilestonesViewState extends State<_MilestonesView> {
  bool _includeClosed = false;

  @override
  Widget build(BuildContext context) {
    return ApiListView(
      key: ValueKey(_includeClosed),
      emptyText: 'No Design WBS elements${_includeClosed ? '' : ' open'} in Project Management.',
      header: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
        const Padding(
          padding: EdgeInsets.fromLTRB(16, 12, 16, 0),
          child: InfoNote(
              'Released drawings and BOMs are the evidence when you submit a WBS in Project Management. Pending documents and open customer approvals hold it back.'),
        ),
        Padding(
          padding: const EdgeInsets.symmetric(horizontal: 8),
          child: CheckField(label: 'Include closed', value: _includeClosed, onChanged: (v) => setState(() => _includeClosed = v)),
        ),
      ]),
      load: (p, s) => Api.list('/design/milestones', query: {'include_closed': _includeClosed}),
      itemBuilder: (ctx, m, reload) {
        final released = [...jsonList(m['released_documents']), ...jsonList(m['released_boms'])];
        final pending = jsonList(m['pending_documents']);
        final custPending = asInt(m['customer_approvals_pending']) ?? 0;
        final target = parseDate(m['target_date']);
        final overdue = target != null &&
            target.add(const Duration(days: 1)).isBefore(DateTime.now()) &&
            !const ['submitted', 'achieved', 'cancelled'].contains(str(m['status']));
        final ready = pending.isEmpty && custPending == 0 && released.isNotEmpty;
        return DetailSection(str(m['milestone_title']), children: [
          Text(txt(m['project_label']), style: const TextStyle(fontSize: 12, color: Brand.muted)),
          const SizedBox(height: 6),
          Wrap(spacing: 8, runSpacing: 4, children: [
            StatusBadge(labelOf(_milestoneStatusLabels, m['status'])),
            Text('Target ${fmtDate(m['target_date'])}${overdue ? ' · overdue' : ''}',
                style: TextStyle(fontSize: 12, color: overdue ? Brand.danger : Brand.muted)),
            if (ready) const StatusBadge('Ready to submit', color: Brand.success),
          ]),
          const SizedBox(height: 8),
          Caps('Released drawings & BOMs · ${released.length}'),
          released.isEmpty
              ? const Text('None yet', style: TextStyle(fontSize: 12.5, color: Brand.muted))
              : Wrap(spacing: 6, children: [for (final d in released) deliverableChip(ctx, d)]),
          const SizedBox(height: 6),
          Caps('Pending documents · ${pending.length}'),
          pending.isEmpty
              ? const Text('None', style: TextStyle(fontSize: 12.5, color: Brand.muted))
              : Wrap(spacing: 6, children: [for (final d in pending) deliverableChip(ctx, d)]),
          const SizedBox(height: 6),
          const Caps('Customer approvals pending'),
          Text('$custPending',
              style: TextStyle(fontSize: 14, fontWeight: FontWeight.w700, color: custPending > 0 ? const Color(0xFFB45309) : Brand.success)),
        ]);
      },
    );
  }
}

// ── New request ──────────────────────────────────────────────────────────────

Future<int?> showNewRequestForm(BuildContext context) async {
  final title = TextEditingController();
  final requirement = TextEditingController();
  String source = 'project';
  String priority = 'standard';
  String crmSource = 'inquiry';
  DateTime? due;
  int? crmId, customerId, projectId, milestoneId, leadId;
  String? crmL, customerL, projectL, milestoneL, leadL;
  int? createdId;
  await showFormSheet(
    context,
    title: 'New design request',
    saveLabel: 'Create Request',
    builder: (ctx, setS) => [
      const InfoNote('Record what Design is being asked to produce and to what requirement. The Design head is notified to accept it.'),
      const Caps('Request'),
      AppTextField(label: 'Title', controller: title, required: true, hint: 'e.g. Ballast regulator — hopper redesign for RDSO spec'),
      AppSelect<String>(
          label: 'Source', required: true, clearable: false, value: source, options: optionsOf(requestSourceLabels), onChanged: (o) => setS(() => source = o?.value ?? source)),
      AppSelect<String>(
          label: 'Priority', clearable: false, value: priority, options: optionsOf(priorityLabels), onChanged: (o) => setS(() => priority = o?.value ?? priority)),
      DateField(label: 'Due date', value: due, onChanged: (d) => setS(() => due = d)),
      const Caps('Technical requirement'),
      AppTextField(
          label: 'Requirement',
          controller: requirement,
          required: true,
          maxLines: 6,
          hint:
              'What must be designed: scope, key dimensions/loads, standards (RDSO/IS/EN), customer specification references, interfaces, deliverables expected…'),
      if (source == 'bd') ...[
        const Caps('CRM reference'),
        AppSelect<String>(
            label: 'Record',
            clearable: false,
            value: crmSource,
            options: const [Option('inquiry', 'Inquiry'), Option('tender', 'Tender')],
            onChanged: (o) => setS(() {
                  crmSource = o?.value ?? crmSource;
                  crmId = null;
                  crmL = null;
                })),
        AppSelect<int>(
          key: ValueKey('crm$crmSource'),
          label: crmSource == 'tender' ? 'Tender' : 'Inquiry',
          value: crmId,
          valueLabel: crmL,
          loadOptions: (s) async {
            final rows = (await Api.list('/design/lookups/crm-records', query: {'source': crmSource, 'search': s})).rows;
            return [
              for (final r in rows)
                if (asInt(r['id']) != null) Option<int>(asInt(r['id'])!, str(r['label']), subtitle: str(r['extra'])),
            ];
          },
          onChanged: (o) => setS(() {
            crmId = o?.value;
            crmL = o?.label;
            // The inquiry/tender's organisation becomes the customer unless one is already picked.
            final org = int.tryParse(o?.subtitle ?? '');
            if (customerId == null && org != null) {
              customerId = org;
              customerL = 'Customer of $crmL';
            }
          }),
        ),
      ],
      const Caps('Links'),
      AppSelect<int>(
          label: 'Customer',
          value: customerId,
          valueLabel: customerL,
          loadOptions: (s) => designLookup('customers', s, sendSearch: true),
          onChanged: (o) => setS(() {
                customerId = o?.value;
                customerL = o?.label;
              })),
      AppSelect<int>(
          label: 'Project',
          value: projectId,
          valueLabel: projectL,
          loadOptions: (s) => designLookup('projects', s),
          onChanged: (o) => setS(() {
                projectId = o?.value;
                projectL = o?.label;
                milestoneId = null;
                milestoneL = null;
              })),
      AppSelect<int>(
          key: ValueKey('ms$projectId'),
          label: projectId == null ? 'WBS (pick a project first)' : 'WBS',
          enabled: projectId != null,
          value: milestoneId,
          valueLabel: milestoneL,
          loadOptions: (s) => designLookup('milestones', s, query: {'pm_project_id': projectId}),
          onChanged: (o) => setS(() {
                milestoneId = o?.value;
                milestoneL = o?.label;
              })),
      const Caps('Lead designer'),
      AppSelect<int>(
          label: 'Lead designer',
          value: leadId,
          valueLabel: leadL,
          loadOptions: (s) => designUsers(s),
          onChanged: (o) => setS(() {
                leadId = o?.value;
                leadL = o?.label;
              })),
    ],
    onSave: () async {
      if (title.text.trim().length < 3) throw 'Give the request a title (at least 3 characters).';
      if (requirement.text.trim().length < 5) {
        throw 'Describe the technical requirement (at least 5 characters) — this is what Design works to.';
      }
      if (milestoneId != null && projectId == null) throw 'Pick the project before its WBS.';
      final out = jsonMap(await Api.post('/design/requests', data: {
        'title': title.text.trim(),
        'source': source,
        'crm_source': source == 'bd' && crmId != null ? crmSource : null,
        'crm_record_id': source == 'bd' ? crmId : null,
        'customer_id': customerId,
        'pm_project_id': projectId,
        'pm_milestone_id': milestoneId,
        'requirement': requirement.text.trim(),
        'priority': priority,
        'due_date': apiDateOrNull(due),
        'lead_designer_id': leadId,
      }));
      createdId = asInt(out['id']);
    },
  );
  return createdId;
}

// ── Detail ───────────────────────────────────────────────────────────────────

const _eventLabels = {
  'request_created': 'raised the request',
  'drawing_milestone_due': 'drawing-approval billing milestone fell due',
  'request_updated': 'updated the details',
  'request_accept': 'accepted the request',
  'request_start': 'started work',
  'request_hold': 'put it on hold',
  'request_resume': 'resumed work',
  'request_complete': 'completed the request',
  'request_cancel': 'cancelled the request',
  'request_reopen': 'reopened the request',
  'requirement_revised': 'revised the requirement',
  'requirement_reviewed': 'reviewed the revised requirement',
  'waiting_on_design': 'set it waiting on Design',
  'waiting_on_requester': 'set it waiting on the requester',
  'document_created': 'created a drawing for it',
  'bom_created': 'created a BOM for it',
  'comment': 'commented',
};

class DesignRequestDetail extends StatefulWidget {
  const DesignRequestDetail({super.key, required this.id});
  final int id;

  @override
  State<DesignRequestDetail> createState() => _DesignRequestDetailState();
}

class _DesignRequestDetailState extends State<DesignRequestDetail> {
  Json? _req;
  Object? _error;
  bool _busy = false;
  bool _showHistory = false;
  Json _me = const {};

  @override
  void initState() {
    super.initState();
    _load();
    DesignMe.load().then((m) {
      if (mounted) setState(() => _me = m);
    });
  }

  Future<void> _load() async {
    try {
      final d = jsonMap(await Api.get('/design/requests/${widget.id}'));
      if (mounted) setState(() => (_req = d, _error = null));
    } catch (e) {
      if (mounted) setState(() => _error = e);
    }
  }

  bool _can(String a) => strList(_req?['allowed_actions']).contains(a);

  Future<void> _act(Future<dynamic> Function() fn, String done) async {
    setState(() => _busy = true);
    Json? out;
    final ok = await runAction(context, () async {
      final r = await fn();
      if (r is Map) out = jsonMap(r);
    }, success: done);
    if (!mounted) return;
    setState(() {
      _busy = false;
      if (ok && out != null && out!.containsKey('request_number')) _req = out;
    });
    if (ok && out == null) _load();
  }

  Future<void> _statusConfirm(String which) async {
    final r = _req!;
    final (title, label, done) = switch (which) {
      'accept' => ('Accept this request?', 'Accept', 'accepted'),
      'start' => ('Start work?', 'Start', 'started'),
      'resume' => ('Resume work?', 'Resume', 'resumed'),
      _ => ('Mark the request completed?', 'Complete', 'completed'),
    };
    if (!await confirmDialog(context, title: title, message: '${r['request_number']} — ${r['title']}', confirmLabel: label)) return;
    if (!mounted) return;
    await _act(() => Api.post('/design/requests/${r['id']}/status', data: {'action': which}), '${r['request_number']} $done.');
  }

  Future<void> _statusPrompt(String which) async {
    final r = _req!;
    final (title, message, label) = switch (which) {
      'hold' => ('Put the request on hold', 'Work stops until it is resumed. The requester is told why.', 'Put on Hold'),
      'cancel' => ('Cancel the request', 'Design stops work on it. The requester is told why. It can be reopened later.', 'Cancel Request'),
      _ => ('Reopen the request', 'It goes back to In progress.', 'Reopen'),
    };
    final v = await promptDialog(context, title: title, message: '${r['request_number']} — $message', confirmLabel: label);
    if (v == null || !mounted) return;
    final done = which == 'hold' ? 'put on hold' : which == 'cancel' ? 'cancelled' : 'reopened';
    await _act(() => Api.post('/design/requests/${r['id']}/status', data: {'action': which, 'reason': v}), '${r['request_number']} $done.');
  }

  Future<void> _waiting() async {
    final r = _req!;
    String on = str(r['waiting_on']) == 'design' ? 'requester' : 'design';
    final note = TextEditingController();
    final saved = await showFormSheet(context, title: 'Who is this waiting on?', builder: (ctx, setS) => [
          InfoNote('${r['request_number']} — when it waits on the requester they are notified with your note.'),
          AppSelect<String>(
              label: 'Waiting on',
              required: true,
              clearable: false,
              value: on,
              options: [
                const Option('design', 'Design'),
                Option('requester', str(r['requested_by_name']).isEmpty ? 'The requester' : 'The requester (${r['requested_by_name']})'),
              ],
              onChanged: (o) => setS(() => on = o?.value ?? on)),
          AppTextField(
              label: on == 'requester' ? 'What Design needs from them' : 'Note',
              required: on == 'requester',
              controller: note,
              maxLines: 3,
              hint: on == 'requester' ? 'e.g. Customer track gauge and loading-gauge drawing' : 'Optional — e.g. inputs received on 06-10'),
        ], onSave: () async {
      if (on == 'requester' && note.text.trim().isEmpty) throw 'Say what Design needs from the requester — they are notified with your note.';
      final out = await Api.post('/design/requests/${r['id']}/waiting', data: {'waiting_on': on, 'note': nullIfEmpty(note.text)});
      if (mounted && out is Map) setState(() => _req = jsonMap(out));
    });
    if (saved && mounted) showSnack(context, on == 'design' ? 'Back with Design.' : 'Now waiting on the requester.');
  }

  Future<void> _revise() async {
    final r = _req!;
    final requirement = TextEditingController(text: str(r['requirement']));
    final note = TextEditingController();
    final saved = await showFormSheet(context, title: 'Revise requirement', saveLabel: 'Save Revision', builder: (ctx, setS) => [
          InfoNote('${r['request_number']} — the lead designer is asked to review the new revision.'),
          const Caps('Technical requirement'),
          AppTextField(label: 'Requirement', controller: requirement, required: true, maxLines: 8),
          const Caps('Change note'),
          AppTextField(
              label: 'What changed and why',
              controller: note,
              required: true,
              hint: 'e.g. Customer raised axle load from 20 t to 22.5 t (tender corrigendum 2)'),
        ], onSave: () async {
      if (requirement.text.trim().length < 5) throw 'Describe the technical requirement (at least 5 characters).';
      if (note.text.trim().length < 3) throw 'Say what changed and why (at least 3 characters).';
      final out = await Api.post('/design/requests/${r['id']}/revise', data: {'requirement': requirement.text.trim(), 'change_note': note.text.trim()});
      if (mounted && out is Map) setState(() => _req = jsonMap(out));
    });
    if (saved && mounted) showSnack(context, 'Requirement revised.');
  }

  Future<void> _edit() async {
    final r = _req!;
    final title = TextEditingController(text: str(r['title']));
    String priority = priorityLabel(r['priority']) == 'Urgent' ? 'urgent' : 'standard';
    DateTime? due = parseDate(r['due_date']);
    int? customerId = asInt(r['customer_id']), projectId = asInt(r['pm_project_id']), milestoneId = asInt(r['pm_milestone_id']);
    int? machineId = asInt(r['erp_project_id']), leadId = asInt(r['lead_designer_id']);
    String? customerL = nullIfEmpty(str(r['customer_name'])), projectL = nullIfEmpty(str(r['pm_project_label']));
    String? milestoneL = nullIfEmpty(str(r['pm_milestone_label'])), machineL = nullIfEmpty(str(r['erp_project_label']));
    String? leadL = nullIfEmpty(str(r['lead_designer_name']));
    final saved = await showFormSheet(context, title: 'Edit request details', builder: (ctx, setS) => [
          InfoNote('${r['request_number']} — source and CRM reference are fixed once raised. Change the requirement with “Revise Requirement”.'),
          AppTextField(label: 'Title', controller: title, required: true),
          AppSelect<String>(
              label: 'Priority', clearable: false, value: priority, options: optionsOf(priorityLabels), onChanged: (o) => setS(() => priority = o?.value ?? priority)),
          DateField(label: 'Due date', value: due, onChanged: (d) => setS(() => due = d)),
          AppSelect<int>(
              label: 'Customer',
              value: customerId,
              valueLabel: customerL,
              loadOptions: (s) => designLookup('customers', s, sendSearch: true),
              onChanged: (o) => setS(() {
                    customerId = o?.value;
                    customerL = o?.label;
                  })),
          AppSelect<int>(
              label: 'Project',
              value: projectId,
              valueLabel: projectL,
              loadOptions: (s) => designLookup('projects', s),
              onChanged: (o) => setS(() {
                    projectId = o?.value;
                    projectL = o?.label;
                    milestoneId = null;
                    milestoneL = null;
                  })),
          AppSelect<int>(
              key: ValueKey('ms$projectId'),
              label: projectId == null ? 'WBS (pick a project first)' : 'WBS',
              enabled: projectId != null,
              value: milestoneId,
              valueLabel: milestoneL,
              loadOptions: (s) => designLookup('milestones', s, query: {'pm_project_id': projectId}),
              onChanged: (o) => setS(() {
                    milestoneId = o?.value;
                    milestoneL = o?.label;
                  })),
          AppSelect<int>(
              label: 'Machine',
              value: machineId,
              valueLabel: machineL,
              loadOptions: (s) => designLookup('machines', s),
              onChanged: (o) => setS(() {
                    machineId = o?.value;
                    machineL = o?.label;
                  })),
          AppSelect<int>(
              label: 'Lead designer',
              value: leadId,
              valueLabel: leadL,
              loadOptions: (s) => designUsers(s),
              onChanged: (o) => setS(() {
                    leadId = o?.value;
                    leadL = o?.label;
                  })),
        ], onSave: () async {
      if (title.text.trim().length < 3) throw 'Give the request a title (at least 3 characters).';
      if (milestoneId != null && projectId == null) throw 'Pick the project before its WBS.';
      final out = await Api.patch('/design/requests/${r['id']}', data: {
        'title': title.text.trim(),
        'priority': priority,
        'due_date': apiDateOrNull(due),
        'customer_id': customerId,
        'pm_project_id': projectId,
        'pm_milestone_id': milestoneId,
        'erp_project_id': machineId,
        'lead_designer_id': leadId,
      });
      if (mounted && out is Map) setState(() => _req = jsonMap(out));
    });
    if (saved && mounted) showSnack(context, 'Details saved.');
  }

  List<DAction> _actions(Json r) {
    final active = const ['open', 'accepted', 'in_progress', 'on_hold'].contains(str(r['status']));
    final isTeam = _me.isNotEmpty && DesignMe.role(_me) != 'viewer';
    return [
      if (_can('acknowledge') && r['changed_since_review'] == true)
        DAction("I've reviewed it", () => _act(() => Api.post('/design/requests/${r['id']}/acknowledge'), 'Rev ${r['requirement_revision']} marked as reviewed.'),
            primary: true),
      if (_can('accept')) DAction('Accept', () => _statusConfirm('accept'), primary: true),
      if (_can('start')) DAction('Start Work', () => _statusConfirm('start'), primary: true),
      if (_can('resume')) DAction('Resume', () => _statusConfirm('resume'), primary: true),
      if (_can('complete')) DAction('Mark Completed', () => _statusConfirm('complete'), primary: true),
      if (_can('set_waiting')) DAction(str(r['waiting_on']) == 'design' ? 'Waiting on Requester…' : 'Back with Design…', _waiting),
      if (_can('revise')) DAction('Revise Requirement', _revise),
      if (_can('hold')) DAction('Put on Hold', () => _statusPrompt('hold')),
      if (_can('reopen')) DAction('Reopen', () => _statusPrompt('reopen')),
      if (_can('cancel')) DAction('Cancel Request', () => _statusPrompt('cancel'), danger: true),
      if (_can('edit')) DAction('Edit details', _edit),
      if (isTeam && active)
        DAction('+ New Drawing', () async {
          final id = await showNewDocumentForm(context, requestId: asInt(r['id']), requestLabel: '${r['request_number']} — ${r['title']}');
          if (id != null && mounted) {
            _load();
            openScreen(context, DesignDocumentDetail(id: id));
          }
        }),
    ];
  }

  @override
  Widget build(BuildContext context) {
    final r = _req;
    return SubPage(
      title: r == null ? 'Request' : str(r['request_number']),
      bottom: r == null ? null : actionBar(context, _actions(r), busy: _busy),
      body: r == null ? (_error != null ? ErrorView(_error!, onRetry: _load) : const LoadingView()) : RefreshIndicator(onRefresh: _load, child: _body(r)),
    );
  }

  Widget _body(Json r) {
    final active = const ['open', 'accepted', 'in_progress', 'on_hold'].contains(str(r['status']));
    final history = jsonList(r['history']);
    final deliverables = jsonList(r['deliverables']);
    final events = jsonList(r['events']);
    return ListView(padding: const EdgeInsets.only(top: 12, bottom: 24), children: [
      DetailSection(str(r['title']), children: [
        Wrap(spacing: 8, runSpacing: 6, crossAxisAlignment: WrapCrossAlignment.center, children: [
          reqStatusBadge(r['status']),
          priorityBadge(r['priority']),
          Text('Due ${r['due_date'] == null ? 'not set' : fmtDate(r['due_date'])}${r['is_overdue'] == true ? ' · overdue' : ''}',
              style: TextStyle(
                  fontSize: 12.5, color: r['is_overdue'] == true ? Brand.danger : Brand.muted, fontWeight: r['is_overdue'] == true ? FontWeight.w700 : null)),
          if (active)
            Text(
                'Waiting on ${str(r['waiting_on']) == 'design' ? 'Design' : (str(r['requested_by_name']).isEmpty ? 'the requester' : r['requested_by_name'])}'
                '${str(r['waiting_note']).isEmpty ? '' : ' — ${r['waiting_note']}'}',
                style: TextStyle(fontSize: 12.5, color: str(r['waiting_on']) == 'design' ? const Color(0xFF2563EB) : const Color(0xFFB45309))),
          Text('Lead designer ${str(r['lead_designer_name']).isEmpty ? 'not assigned' : r['lead_designer_name']}',
              style: const TextStyle(fontSize: 12.5, color: Brand.muted)),
        ]),
      ]),
      DetailSection('Request', children: [
        FieldRow('Source', labelOf(requestSourceLabels, r['source'])),
        if (str(r['crm_reference']).isNotEmpty) FieldRow('CRM reference', r['crm_reference']),
        FieldRow('Raised by', '${txt(r['requested_by_name'])} · ${fmtDate(r['created_at'])}'),
        if (r['closed_at'] != null) FieldRow(str(r['status']) == 'cancelled' ? 'Cancelled' : 'Completed', fmtDateTime(r['closed_at'])),
      ]),
      DetailSection('Linked to', children: [
        if (str(r['order_project_display'] ?? r['order_project_number']).isNotEmpty)
          FieldRow('Project', r['order_project_display'] ?? r['order_project_number']),
        FieldRow('Customer', r['customer_name']),
        FieldRow('Project', r['pm_project_label']),
        FieldRow('WBS', r['pm_milestone_label']),
        if (str(r['erp_project_label']).isNotEmpty) FieldRow('Machine', r['erp_project_label']),
      ]),
      if (r['changed_since_review'] == true)
        Padding(
          padding: const EdgeInsets.fromLTRB(16, 0, 16, 12),
          child: ErrorBanner('Requirement changed since your review. It is now rev ${r['requirement_revision']}'
              '${r['requirement_revised_at'] != null ? ' (revised ${fmtDateTime(r['requirement_revised_at'])})' : ''} — read the change before continuing the design.'
              '${history.isNotEmpty && str(history.first['change_note']).isNotEmpty ? ' Change note: “${history.first['change_note']}”.' : ''}'),
        ),
      if (str(r['status']) == 'on_hold' && str(r['close_reason']).isNotEmpty)
        Padding(
            padding: const EdgeInsets.fromLTRB(16, 0, 16, 12),
            child: InfoNote('On hold: ${r['close_reason']}', color: const Color(0xFF92400E))),
      if (str(r['status']) == 'cancelled')
        Padding(
          padding: const EdgeInsets.fromLTRB(16, 0, 16, 12),
          child: ErrorBanner(
              'Cancelled${r['closed_at'] != null ? ' on ${fmtDate(r['closed_at'])}' : ''}${str(r['close_reason']).isNotEmpty ? ': ${r['close_reason']}' : '.'}'),
        ),
      if (designFeature('project_work', 'technical_requirement', 'view'))
        DetailSection(
          'Technical requirement · rev ${r['requirement_revision']}',
          action: history.length > 1
              ? TextButton(
                  onPressed: () => setState(() => _showHistory = !_showHistory),
                  child: Text('${_showHistory ? 'Hide' : 'Show'} history (${history.length})'))
              : null,
          children: [
            SelectableText(str(r['requirement']), style: const TextStyle(fontSize: 14, height: 1.5, color: Brand.body)),
            if ((asInt(r['requirement_revision']) ?? 0) > 0)
              Padding(
                padding: const EdgeInsets.only(top: 6),
                child: Text(
                    'Last revised ${fmtDateTime(r['requirement_revised_at'])}. '
                    '${r['changed_since_review'] == true ? 'Not yet reviewed by Design.' : 'Reviewed by Design (rev ${r['reviewed_revision']}).'}',
                    style: TextStyle(fontSize: 12, color: r['changed_since_review'] == true ? Brand.danger : Brand.muted)),
              ),
            if (_showHistory)
              for (final h in history)
                Container(
                  margin: const EdgeInsets.only(top: 10),
                  padding: const EdgeInsets.only(top: 8),
                  decoration: const BoxDecoration(border: Border(top: BorderSide(color: Color(0x140F172A)))),
                  child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                    Text('Rev ${h['revision']}${h['revision'] == r['requirement_revision'] ? ' (current)' : ''} · ${txt(h['revised_by_name'])} · ${fmtDateTime(h['created_at'])}',
                        style: const TextStyle(fontWeight: FontWeight.w600, fontSize: 12.5)),
                    if (str(h['change_note']).isNotEmpty) Text('“${h['change_note']}”', style: const TextStyle(fontSize: 12.5, color: Brand.muted)),
                    Text(str(h['requirement']), style: const TextStyle(fontSize: 12.5)),
                  ]),
                ),
          ],
        ),
      if (designFeature('project_work', 'deliverables', 'view'))
        DetailSection('Deliverables · ${r['released_count']} / ${r['document_count']} released', children: [
          if (deliverables.isEmpty) const Text('No drawings or BOMs made for this request yet.', style: TextStyle(fontSize: 13, color: Brand.muted)),
          for (final d in deliverables)
            ListTile(
              contentPadding: EdgeInsets.zero,
              dense: true,
              onTap: () => openDeliverable(context, d),
              title: Text('${str(d['kind']) == 'bom' ? 'BOM' : 'Drawing'} · ${d['number']}', style: const TextStyle(fontWeight: FontWeight.w700, color: Brand.primaryActive)),
              subtitle: Text('${d['title']} · Released rev ${txt(d['released_revision_label'])}'),
              trailing: StatusBadge(labelOf(deliverableLabels, d['status'])),
            ),
        ]),
      if (designFeature('project_work', 'timeline', 'view'))
        DetailSection(
          'Timeline',
          action: _can('comment')
              ? TextButton.icon(
                  icon: const Icon(Icons.add_comment_outlined, size: 18),
                  label: const Text('Comment'),
                  onPressed: () async {
                    final t = await promptDialog(context, title: 'Add a comment', label: 'Comment', confirmLabel: 'Post');
                    if (t == null || t.isEmpty || !mounted) return;
                    await _act(() => Api.post('/design/requests/${r['id']}/comments', data: {'comment': t}), 'Comment added.');
                  })
              : null,
          children: [
            if (events.isEmpty) const Text('No activity yet.', style: TextStyle(color: Brand.muted)),
            for (final e in events)
              InkWell(
                onTap: str(e['action']) == 'document_created' && e['document_id'] != null
                    ? () => openScreen(context, DesignDocumentDetail(id: asInt(e['document_id'])!))
                    : (str(e['action']) == 'bom_created' && e['bom_id'] != null
                        ? () => openScreen(context, DesignBomDetail(id: asInt(e['bom_id'])!))
                        : null),
                child: Padding(
                  padding: const EdgeInsets.symmetric(vertical: 6),
                  child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                    Text.rich(TextSpan(style: const TextStyle(fontSize: 13, color: Brand.body), children: [
                      TextSpan(text: str(e['actor_name']).isEmpty ? 'System' : str(e['actor_name']), style: const TextStyle(fontWeight: FontWeight.w700)),
                      TextSpan(text: ' ${_eventLabels[str(e['action'])] ?? str(e['action']).replaceAll('_', ' ')}'),
                      if (str(e['doc_number']).isNotEmpty) TextSpan(text: ' · ${e['doc_number']}', style: const TextStyle(color: Brand.primaryActive)),
                    ])),
                    if (str(e['comment']).isNotEmpty) Text(str(e['comment']), style: const TextStyle(fontSize: 12.5, color: Brand.muted)),
                    Text(fmtDateTime(e['created_at']), style: const TextStyle(fontSize: 11, color: Brand.muted)),
                  ]),
                ),
              ),
          ],
        ),
    ]);
  }
}
