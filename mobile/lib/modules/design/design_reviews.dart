import 'package:flutter/material.dart';

import '../../api/api.dart';
import '../../theme.dart';
import '../../ui/app_frame.dart';
import '../../ui/files.dart';
import '../../ui/form.dart';
import '../../ui/format.dart';
import '../../ui/perms.dart';
import '../../ui/widgets.dart';
import 'design_common.dart';
import 'design_documents.dart';
import 'design_links.dart';

/// Reviews & Approvals - portal design/reviews, reviews/submissions/new and
/// reviews/submissions/[id] (customer transmittals).

const _subStatusColors = {
  'draft': Color(0xFF78716C),
  'sent': Color(0xFF2563EB),
  'closed': Color(0xFF16A34A),
  'cancelled': Color(0xFFA8A29E),
};
const _responseColors = {
  'pending': Color(0xFF78716C),
  'approved': Color(0xFF16A34A),
  'approved_with_comments': Color(0xFF0F766E),
  'rejected': Color(0xFFDC2626),
};
const _revStatusLabels = {
  'draft': 'Draft',
  'in_review': 'In check',
  'in_approval': 'In approval',
  'approved': 'Approved — awaiting customer',
  'released': 'Released',
  'superseded': 'Superseded',
  'customer_rejected': 'Customer rejected',
};

Widget subStatusBadge(Object? s) => StatusBadge(labelOf(submissionStatusLabels, s), color: _subStatusColors[str(s)]);
Widget responseBadge(Object? s) => StatusBadge(labelOf(customerResponseLabels, s), color: _responseColors[str(s)]);

const _subTabs = <(String, String)>[
  ('draft,sent', 'Open'),
  ('sent', 'With customer'),
  ('draft', 'Draft'),
  ('closed', 'Closed'),
  ('cancelled', 'Cancelled'),
  ('', 'All'),
];

const _queues = <(String, String, Color)>[
  ('to_review', 'Check drawing', Color(0xFF2563EB)),
  ('to_approve', 'Approve drawing', Color(0xFF7C3AED)),
  ('boms_to_review', 'Check BOM', Color(0xFF2563EB)),
  ('boms_to_approve', 'Approve BOM', Color(0xFF7C3AED)),
  ('to_release', 'Release (customer approved)', Color(0xFF16A34A)),
];

// ── Tab ──────────────────────────────────────────────────────────────────────

class DesignReviewsTab extends StatefulWidget {
  const DesignReviewsTab({super.key});

  @override
  State<DesignReviewsTab> createState() => _DesignReviewsTabState();
}

class _DesignReviewsTabState extends State<DesignReviewsTab> {
  final _list = GlobalKey<ApiListViewState>();
  Json _me = const {};
  Json? _tasks;
  List<Json>? _awaiting;
  String _status = _subTabs.first.$1;
  bool _overdue = false;

  @override
  void initState() {
    super.initState();
    DesignMe.load().then((m) {
      if (mounted) setState(() => _me = m);
    });
    _loadTop();
  }

  Future<void> _loadTop() async {
    try {
      final t = jsonMap(await Api.get('/design/my-tasks'));
      final a = (await Api.list('/design/lookups/awaiting-customer')).rows;
      if (mounted) setState(() => (_tasks = t, _awaiting = a));
    } catch (_) {
      if (mounted) setState(() => (_tasks = const {}, _awaiting = const []));
    }
  }

  bool get _isTeam => DesignMe.isTeam(_me);
  bool get _showSubs => _isTeam && designFeature('reviews', 'customer_submissions', 'view');
  bool get _canCreate => _isTeam && designFeature('reviews', 'customer_submissions', 'create');

  Future<void> _new() async {
    final id = await showSubmissionForm(context);
    if (id != null && mounted) {
      _list.currentState?.reload();
      openScreen(context, DesignSubmissionDetail(id: id));
    }
  }

  Widget _top() {
    final queueRows = <(Json, String, Color)>[
      for (final q in _queues)
        for (final t in jsonList(_tasks?[q.$1])) (t, q.$2, q.$3),
    ];
    final awaiting = _awaiting ?? const <Json>[];
    return Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
      const PageHeader('Reviews & Approvals',
          subtitle: 'Internal checks waiting on you, drawings waiting on the customer, and the customer submission register.'),
      DetailSection('Internal reviews — waiting on you (${queueRows.length})', children: [
        if (_tasks == null) const Text('Loading…', style: TextStyle(color: Brand.muted)),
        if (_tasks != null && queueRows.isEmpty)
          const Text('Nothing to check, approve or release right now.', style: TextStyle(fontSize: 13, color: Brand.muted)),
        for (final (t, label, color) in queueRows)
          InkWell(
            onTap: () => openDesignTaskItem(context, t, onReturn: _loadTop),
            child: Padding(
              padding: const EdgeInsets.symmetric(vertical: 8),
              child: Row(children: [
                Expanded(
                  child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                    Text(taskRef(t), style: const TextStyle(fontWeight: FontWeight.w600, color: Brand.heading)),
                    Text('${t['title']}${str(t['author_name']).isEmpty ? '' : ' · from ${t['author_name']}'}',
                        style: const TextStyle(fontSize: 12, color: Brand.muted)),
                  ]),
                ),
                Text((asInt(t['days_waiting']) ?? 0) == 0 ? 'today' : '${t['days_waiting']}d',
                    style: const TextStyle(fontSize: 11, color: Brand.muted)),
                const SizedBox(width: 8),
                StatusBadge(label, color: color),
              ]),
            ),
          ),
      ]),
      if (_isTeam)
        DetailSection('Approved — waiting on the customer (${awaiting.length})', children: [
          if (awaiting.isEmpty)
            const Text('No approved drawings are waiting to be sent to a customer.', style: TextStyle(fontSize: 13, color: Brand.muted)),
          for (final a in awaiting)
            ListTile(
              contentPadding: EdgeInsets.zero,
              dense: true,
              onTap: asInt(a['extra']) == null ? null : () => openScreen(context, DesignDocumentDetail(id: asInt(a['extra'])!)),
              title: Text(str(a['code']).isEmpty ? str(a['label']) : str(a['code']), style: const TextStyle(fontWeight: FontWeight.w600)),
              subtitle: Text(str(a['label']), maxLines: 1, overflow: TextOverflow.ellipsis),
            ),
        ]),
      if (_showSubs) ...[
        const Padding(padding: EdgeInsets.fromLTRB(16, 4, 16, 4), child: Caps('Customer submissions')),
        ChipRow(children: [
          for (final t in _subTabs)
            CountChip(t.$2, null, selected: _status == t.$1, onTap: () {
              setState(() => _status = t.$1);
              _list.currentState?.reload();
            }),
          CountChip('${_overdue ? '✓ ' : ''}Overdue only', null, selected: _overdue, color: Brand.danger, onTap: () {
            setState(() => _overdue = !_overdue);
            _list.currentState?.reload();
          }),
        ]),
      ],
    ]);
  }

  @override
  Widget build(BuildContext context) {
    if (!_showSubs) {
      return RefreshIndicator(onRefresh: _loadTop, child: ListView(children: [_top()]));
    }
    return Scaffold(
      backgroundColor: Colors.transparent,
      floatingActionButton: _canCreate ? CreateFab(label: 'New submission', onPressed: _new) : null,
      body: ApiListView(
        key: _list,
        header: _top(),
        searchHint: 'Search by submission number or customer…',
        emptyText: 'No customer submissions here — use + New submission to send approved drawings to a customer.',
        load: (p, s) => Api.list('/design/submissions', query: {'status': _status, 'overdue': _overdue ? true : null, 'search': s}),
        itemBuilder: (ctx, s, reload) => RecordCard(
          code: str(s['submission_number']),
          title: str(s['customer_name']),
          subtitle: nullIfEmpty(str(s['pm_project_label'] ?? s['erp_project_label'])),
          trailing: Padding(padding: const EdgeInsets.only(left: 8), child: subStatusBadge(s['status'])),
          meta: [
            ('Drawings', '${jsonList(s['lines']).length}'),
            ('Sent', fmtDate(s['sent_date'])),
            ('Due', '${fmtDate(s['response_due_date'])}${s['is_overdue'] == true ? ' · overdue' : ''}'),
            if (str(s['status']) == 'sent') ('Waiting', '${s['days_waiting']} days'),
            ('Response', fmtDate(s['response_date'])),
            if (s['turnaround_days'] != null) ('Turnaround', '${s['turnaround_days']} days'),
            ('Open comments', '${s['open_comments'] ?? 0}'),
          ],
          onTap: () async {
            await Navigator.of(ctx).push(MaterialPageRoute(builder: (_) => DesignSubmissionDetail(id: asInt(s['id'])!)));
            reload();
            _loadTop();
          },
        ),
      ),
    );
  }
}

// ── Create / edit submission ─────────────────────────────────────────────────

/// New Customer Submission (or Edit when [existing] is given). Returns the id.
Future<int?> showSubmissionForm(BuildContext context, {Json? existing}) async {
  final e = existing;
  int? customerId = asInt(e?['customer_id']);
  String? customerL = e == null || customerId == null ? null : str(e['customer_name']);
  final customerName = TextEditingController(text: e == null || customerId != null ? '' : str(e['customer_name']));
  final contactName = TextEditingController(text: str(e?['contact_name']));
  final contactEmail = TextEditingController(text: str(e?['contact_email']));
  final cover = TextEditingController(text: str(e?['cover_note']));
  int? projectId = asInt(e?['pm_project_id']), machineId = asInt(e?['erp_project_id']);
  String? projectL = nullIfEmpty(str(e?['pm_project_label'])), machineL = nullIfEmpty(str(e?['erp_project_label']));
  final selected = <int, String>{
    for (final l in jsonList(e?['lines'])) asInt(l['revision_id'])!: '${str(l['doc_number']).isEmpty ? 'Drawing' : l['doc_number']} ${str(l['revision_label'])}'.trim(),
  };
  int? resultId;
  await showFormSheet(
    context,
    title: e == null ? 'New Customer Submission' : 'Edit ${e['submission_number']}',
    saveLabel: e == null ? 'Save Draft' : 'Save',
    builder: (ctx, setS) => [
      InfoNote(e == null
          ? 'Saved as a draft transmittal — send it from its page once the drawing list is final.'
          : 'Draft transmittal — change the customer, links, cover note or the drawing list before it is sent.'),
      const Caps('Customer'),
      AppSelect<int>(
          label: 'Customer',
          required: true,
          value: customerId,
          valueLabel: customerL,
          loadOptions: (s) => designLookup('customers', s, sendSearch: true),
          onChanged: (o) => setS(() {
                customerId = o?.value;
                customerL = o?.label;
              })),
      if (customerId == null)
        AppTextField(label: 'Customer name (not in the customer list)', controller: customerName, required: true, hint: 'e.g. RDSO, Lucknow'),
      AppTextField(label: 'Contact name', controller: contactName),
      AppTextField(label: 'Contact email', controller: contactEmail, keyboardType: TextInputType.emailAddress),
      const Caps('Drawings to send *'),
      Wrap(spacing: 6, runSpacing: 6, children: [
        for (final en in selected.entries)
          InputChip(label: Text(en.value), onDeleted: () => setS(() => selected.remove(en.key))),
      ]),
      AppSelect<int>(
        key: ValueKey('aw$customerId${selected.length}'),
        label: 'Search by drawing number or title to add…',
        value: null,
        loadOptions: (s) async {
          final rows = (await Api.list('/design/lookups/awaiting-customer', query: {'customer_id': customerId})).rows;
          final q = s.toLowerCase();
          return [
            for (final a in rows)
              if (asInt(a['id']) != null && !selected.containsKey(asInt(a['id'])) && str(a['label']).toLowerCase().contains(q))
                Option<int>(asInt(a['id'])!, str(a['code']).isEmpty ? str(a['label']) : str(a['code']), subtitle: str(a['label'])),
          ];
        },
        onChanged: (o) {
          if (o != null) setS(() => selected[o.value] = o.label);
        },
      ),
      const Text('Only drawings approved internally and marked "customer approval required" are listed.',
          style: TextStyle(fontSize: 12, color: Brand.muted)),
      const Caps('Links'),
      AppSelect<int>(
          label: 'Project',
          value: projectId,
          valueLabel: projectL,
          loadOptions: (s) => designLookup('projects', s),
          onChanged: (o) => setS(() {
                projectId = o?.value;
                projectL = o?.label;
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
      const Caps('Cover note'),
      AppTextField(
          label: 'Cover note', controller: cover, maxLines: 4, hint: 'e.g. Please review and return with your approval / comments within 15 days.'),
    ],
    onSave: () async {
      if (customerId == null && customerName.text.trim().length < 2) {
        throw 'Pick the customer, or type the customer name if they are not in the customer list.';
      }
      if (selected.isEmpty) {
        throw e == null
            ? 'Add at least one drawing to send — only drawings approved internally and marked "customer approval required" can be submitted.'
            : 'Keep at least one drawing on the submission — or delete the draft instead.';
      }
      final payload = {
        'customer_id': customerId,
        'customer_name': customerId == null ? customerName.text.trim() : null,
        'contact_name': nullIfEmpty(contactName.text),
        'contact_email': nullIfEmpty(contactEmail.text),
        'pm_project_id': projectId,
        'erp_project_id': machineId,
        'cover_note': nullIfEmpty(cover.text),
        'lines': [for (final id in selected.keys) {'revision_id': id}],
      };
      final out = jsonMap(e == null ? await Api.post('/design/submissions', data: payload) : await Api.patch('/design/submissions/${e['id']}', data: payload));
      resultId = asInt(out['id']);
    },
  );
  return resultId;
}

// ── Detail ───────────────────────────────────────────────────────────────────

const _eventLabels = {
  'submission_created': 'prepared the submission',
  'submission_updated': 'edited the submission',
  'submission_sent': 'sent it to the customer',
  'customer_response': 'recorded the customer response',
  'submission_cancelled': 'cancelled the submission',
  'letter_attached': 'attached the customer letter',
  'comment': 'added a customer comment action',
  'comment_closed': 'closed a customer comment',
};

class DesignSubmissionDetail extends StatefulWidget {
  const DesignSubmissionDetail({super.key, required this.id});
  final int id;

  @override
  State<DesignSubmissionDetail> createState() => _DesignSubmissionDetailState();
}

class _DesignSubmissionDetailState extends State<DesignSubmissionDetail> {
  Json? _sub;
  Object? _error;
  bool _busy = false;
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
      final d = jsonMap(await Api.get('/design/submissions/${widget.id}'));
      if (mounted) setState(() => (_sub = d, _error = null));
    } catch (e) {
      if (mounted) setState(() => _error = e);
    }
  }

  bool _can(String a) => strList(_sub?['allowed_actions']).contains(a);

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
      if (ok && out != null && out!.containsKey('submission_number')) _sub = out;
    });
  }

  Future<void> _send() async {
    final s = _sub!;
    DateTime? sent = DateTime.now();
    final saved = await showFormSheet(context, title: 'Send ${s['submission_number']} to the customer', saveLabel: 'Mark as Sent', builder: (ctx, setS) => [
          InfoNote('${s['customer_name']} — the drawing list is locked once sent.'),
          const Caps('Dispatch'),
          DateField(label: 'Sent on', required: true, value: sent, lastDate: DateTime.now(), onChanged: (d) => setS(() => sent = d)),
        ], onSave: () async {
      if (sent == null) throw 'Pick the date the drawings were sent to the customer.';
      final out = await Api.post('/design/submissions/${s['id']}/send', data: {'sent_date': apiDate(sent!)});
      if (mounted && out is Map) setState(() => _sub = jsonMap(out));
    });
    if (saved && mounted) {
      showSnack(context, '${s['submission_number']} marked as sent — the customer response is now being tracked against its due date.');
    }
  }

  Future<void> _response() async {
    final s = _sub!;
    final pending = jsonList(s['lines']).where((l) => str(l['response']) == 'pending').toList();
    final answers = <int, String?>{for (final l in pending) asInt(l['id'])!: null};
    final comments = <int, TextEditingController>{for (final l in pending) asInt(l['id'])!: TextEditingController()};
    DateTime? date = DateTime.now();
    final remarks = TextEditingController();
    final saved = await showFormSheet(context, title: 'Record customer response', builder: (ctx, setS) => [
          InfoNote('${s['submission_number']} — ${s['customer_name']}. Drawings left on “No response yet” stay pending.'),
          const Caps('Response per drawing'),
          for (final l in pending)
            Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
              Text('${l['doc_number']} ${txt(l['revision_label'])} — ${txt(l['title'])}', style: const TextStyle(fontWeight: FontWeight.w600)),
              const SizedBox(height: 6),
              AppSelect<String>(
                label: 'Customer response',
                value: answers[asInt(l['id'])],
                options: const [
                  Option('approved', 'Approved'),
                  Option('approved_with_comments', 'Approved with comments'),
                  Option('rejected', 'Rejected'),
                ],
                onChanged: (o) => setS(() => answers[asInt(l['id'])!] = o?.value),
              ),
              const SizedBox(height: 6),
              AppTextField(
                  label: answers[asInt(l['id'])] != null && answers[asInt(l['id'])] != 'approved'
                      ? 'Customer comment (required)'
                      : 'Customer comment (optional)',
                  controller: comments[asInt(l['id'])],
                  maxLines: 2),
            ]),
          const Caps('Response'),
          DateField(label: 'Response date', required: true, value: date, lastDate: DateTime.now(), onChanged: (d) => setS(() => date = d)),
          AppTextField(label: 'Remarks', controller: remarks, hint: 'e.g. Letter ref. RDSO/MP/2026/114'),
        ], onSave: () async {
      final picked = answers.entries.where((a) => a.value != null).toList();
      if (picked.isEmpty) throw "Pick the customer's response for at least one drawing.";
      final missing = picked.where((a) => a.value != 'approved' && comments[a.key]!.text.trim().isEmpty).toList();
      if (missing.isNotEmpty) {
        final names = missing.map((a) => str(pending.firstWhere((l) => asInt(l['id']) == a.key)['doc_number'])).join(', ');
        throw "Write the customer's comment for $names — a comment is required when the drawing is approved with comments or rejected.";
      }
      if (date == null) throw 'Pick the date the customer responded.';
      final out = await Api.post('/design/submissions/${s['id']}/response', data: {
        'response_date': apiDate(date!),
        'remarks': nullIfEmpty(remarks.text),
        'lines': [
          for (final a in picked) {'line_id': a.key, 'response': a.value, 'comment': nullIfEmpty(comments[a.key]!.text)},
        ],
      });
      if (mounted && out is Map) setState(() => _sub = jsonMap(out));
    });
    if (saved && mounted) showSnack(context, 'Customer response recorded.');
  }

  Future<void> _addAction() async {
    final s = _sub!;
    final comment = TextEditingController();
    int? docId, assignee;
    String? assigneeL;
    final docs = <Option<int>>[
      for (final l in jsonList(s['lines'])) Option<int>(asInt(l['document_id'])!, '${l['doc_number']} ${txt(l['revision_label'])}'),
    ];
    final saved = await showFormSheet(context, title: 'Add customer comment action', saveLabel: 'Add Action', builder: (ctx, setS) => [
          InfoNote('${s['submission_number']} — log a customer comment that needs work, and who does it.'),
          const Caps('Comment'),
          AppTextField(label: 'Customer comment', controller: comment, required: true, maxLines: 3, hint: 'e.g. Show weld symbol on section B-B'),
          const Caps('Drawing & assignee'),
          AppSelect<int>(label: 'Drawing', value: docId, options: docs, onChanged: (o) => setS(() => docId = o?.value)),
          AppSelect<int>(
              label: 'Assigned to',
              value: assignee,
              valueLabel: assigneeL,
              loadOptions: (q) => designUsers(q),
              onChanged: (o) => setS(() {
                    assignee = o?.value;
                    assigneeL = o?.label;
                  })),
        ], onSave: () async {
      if (comment.text.trim().length < 2) throw "Write the customer's comment that needs action.";
      final out = await Api.post('/design/submissions/${s['id']}/comments',
          data: {'document_id': docId, 'comment': comment.text.trim(), 'assigned_to_id': assignee});
      if (mounted && out is Map) setState(() => _sub = jsonMap(out));
    });
    if (saved && mounted) showSnack(context, 'Customer comment action added.');
  }

  Future<void> _closeAction(Json c) async {
    final text = str(c['comment']);
    final v = await promptDialog(context,
        title: 'Close customer comment',
        message: '“${text.length > 160 ? '${text.substring(0, 160)}…' : text}” — say how it was resolved.',
        label: 'Resolution',
        confirmLabel: 'Close Comment');
    if (v == null || !mounted) return;
    if (v.length < 2) {
      showSnack(context, 'Say how the customer comment was resolved — e.g. "Revised in R2, gusset thickened".', error: true);
      return;
    }
    await _act(() => Api.post('/design/submissions/comments/${c['id']}/close', data: {'resolution': v}), 'Customer comment closed.');
  }

  Future<void> _cancel() async {
    final s = _sub!;
    final v = await promptDialog(context,
        title: 'Cancel ${s['submission_number']}',
        message: 'The submission is kept on record as cancelled. Its drawings go back to waiting on the customer.',
        confirmLabel: 'Cancel Submission');
    if (v == null || !mounted) return;
    if (v.length < 3) {
      showSnack(context, 'Give a reason for cancelling the submission (at least 3 characters).', error: true);
      return;
    }
    await _act(() => Api.post('/design/submissions/${s['id']}/cancel', data: {'reason': v}), '${s['submission_number']} cancelled.');
  }

  Future<void> _delete() async {
    final s = _sub!;
    final ok = await confirmDialog(context,
        title: 'Delete this draft submission?',
        message: '${s['submission_number']} is deleted. The drawings stay approved and waiting on the customer.',
        confirmLabel: 'Delete',
        danger: true);
    if (!ok || !mounted) return;
    setState(() => _busy = true);
    final done = await runAction(context, () => Api.delete('/design/submissions/${s['id']}'), success: '${s['submission_number']} deleted.');
    if (!mounted) return;
    setState(() => _busy = false);
    if (done) Navigator.of(context).pop();
  }

  Future<void> _uploadLetter() async {
    final s = _sub!;
    final f = await Files.pickFile(extensions: const ['pdf', 'doc', 'docx', 'png', 'jpg', 'jpeg', 'msg', 'eml', 'zip']);
    if (f == null || !mounted) return;
    await _act(() async {
      final res = await Api.dio.post('/design/submissions/${s['id']}/letter', data: formData({'file': f}));
      return res.data;
    }, '${f.filename} attached as the customer letter.');
  }

  List<DAction> _actions(Json s) => [
        if (_can('send')) DAction('Send to Customer', _send, primary: true),
        if (_can('record_response')) DAction('Record Customer Response', _response, primary: true),
        if (_can('edit'))
          DAction('Edit', () async {
            final id = await showSubmissionForm(context, existing: s);
            if (id != null && mounted) {
              showSnack(context, '${s['submission_number']} saved.');
              _load();
            }
          }),
        if (_can('cancel')) DAction('Cancel Submission', _cancel, danger: true),
        if (_can('delete')) DAction('Delete Draft', _delete, danger: true),
      ];

  @override
  Widget build(BuildContext context) {
    final s = _sub;
    return SubPage(
      title: s == null ? 'Submission' : str(s['submission_number']),
      bottom: s == null ? null : actionBar(context, _actions(s), busy: _busy),
      body: s == null ? (_error != null ? ErrorView(_error!, onRetry: _load) : const LoadingView()) : RefreshIndicator(onRefresh: _load, child: _body(s)),
    );
  }

  Widget _body(Json s) {
    final lines = jsonList(s['lines']);
    final comments = jsonList(s['comments']);
    final events = jsonList(s['events']);
    final seeActions = designFeature('reviews', 'comment_actions', 'view');
    final addActions = designFeature('reviews', 'comment_actions', 'create');
    final closeActions = designFeature('reviews', 'comment_actions', 'edit');
    bool canClose(Json c) =>
        closeActions &&
        str(c['status']) == 'open' &&
        (asInt(c['assigned_to_id']) == Perm.userId || DesignMe.isHead(_me) || DesignMe.role(_me) == 'admin');
    return ListView(padding: const EdgeInsets.only(top: 12, bottom: 24), children: [
      DetailSection('Drawings for ${s['customer_name']}', children: [
        Wrap(spacing: 8, runSpacing: 6, children: [
          subStatusBadge(s['status']),
          if (s['is_overdue'] == true) const StatusBadge('Overdue', color: Brand.danger),
          if (str(s['status']) == 'sent') Text('${s['days_waiting']} days with the customer', style: const TextStyle(fontSize: 12.5, color: Brand.muted)),
        ]),
        if (str(s['cover_note']).isNotEmpty) Padding(padding: const EdgeInsets.only(top: 6), child: Text(str(s['cover_note']))),
        if (str(s['status']) == 'cancelled' && str(s['cancel_reason']).isNotEmpty)
          Padding(padding: const EdgeInsets.only(top: 6), child: ErrorBanner('Cancelled: ${s['cancel_reason']}')),
      ]),
      DetailSection('Customer', children: [
        FieldRow('Customer', s['customer_name']),
        FieldRow('Contact', [str(s['contact_name']), str(s['contact_email'])].where((x) => x.isNotEmpty).join(' · ')),
      ]),
      DetailSection('Dates', children: [
        FieldRow('Prepared by', '${txt(s['created_by_name'])} · ${fmtDate(s['created_at'])}'),
        FieldRow('Sent', s['sent_date'] == null ? null : fmtDate(s['sent_date'])),
        FieldRow('Response due', s['response_due_date'] == null ? null : '${fmtDate(s['response_due_date'])}${s['is_overdue'] == true ? ' — overdue' : ''}'),
        FieldRow('Customer responded',
            s['response_date'] == null ? null : '${fmtDate(s['response_date'])}${s['turnaround_days'] != null ? ' (${s['turnaround_days']} days)' : ''}'),
        if (str(s['response_remarks']).isNotEmpty) FieldRow('Response remarks', s['response_remarks']),
      ]),
      DetailSection('Linked to', children: [
        FieldRow('Project', s['pm_project_label']),
        FieldRow('Machine', s['erp_project_label']),
      ]),
      DetailSection('Drawings (${lines.length})', children: [
        if (lines.isEmpty) const Text('No drawings on this submission.', style: TextStyle(color: Brand.muted)),
        for (final l in lines)
          InkWell(
            onTap: () => openScreen(context, DesignDocumentDetail(id: asInt(l['document_id'])!)),
            child: Padding(
              padding: const EdgeInsets.symmetric(vertical: 8),
              child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                Text('${txt(l['doc_number'])} · ${txt(l['revision_label'])}', style: const TextStyle(fontWeight: FontWeight.w700, color: Brand.heading)),
                Text(txt(l['title']), style: const TextStyle(fontSize: 12.5)),
                const SizedBox(height: 4),
                Wrap(spacing: 6, children: [
                  if (str(l['revision_status']).isNotEmpty) StatusBadge(labelOf(_revStatusLabels, l['revision_status']), color: docStatusColors[str(l['revision_status'])]),
                  responseBadge(l['response']),
                ]),
                if (str(l['response_comment']).isNotEmpty) Text(str(l['response_comment']), style: const TextStyle(fontSize: 12.5, color: Brand.muted)),
              ]),
            ),
          ),
      ]),
      if (seeActions)
        DetailSection(
          'Customer comment actions',
          action: DesignMe.isTeam(_me) && addActions && str(s['status']) != 'draft' && str(s['status']) != 'cancelled'
              ? TextButton(onPressed: _busy ? null : _addAction, child: const Text('+ Add action'))
              : null,
          children: [
            if (comments.isEmpty) const Text('No customer comments logged as actions.', style: TextStyle(fontSize: 13, color: Brand.muted)),
            for (final c in comments)
              Padding(
                padding: const EdgeInsets.symmetric(vertical: 8),
                child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                  Row(children: [
                    Expanded(child: Text(str(c['comment']), style: const TextStyle(fontSize: 13.5))),
                    str(c['status']) == 'open' ? const StatusBadge('Open', color: Brand.warning) : const StatusBadge('Done', color: Brand.success),
                  ]),
                  Text(
                      '${fmtDate(c['created_at'])}${c['document_id'] != null ? ' · ${txt(c['doc_number'])}' : ''} · Assigned to ${txt(c['assigned_to_name'])}',
                      style: const TextStyle(fontSize: 11.5, color: Brand.muted)),
                  if (str(c['resolution']).isNotEmpty)
                    Text('Resolution: ${c['resolution']}${c['closed_at'] != null ? ' (${txt(c['closed_by_name'])} · ${fmtDate(c['closed_at'])})' : ''}',
                        style: const TextStyle(fontSize: 12.5)),
                  if (canClose(c))
                    Align(alignment: Alignment.centerLeft, child: TextButton(onPressed: _busy ? null : () => _closeAction(c), child: const Text('Close'))),
                ]),
              ),
          ],
        ),
      DetailSection('Customer letter', children: [
        if (str(s['letter_file_name']).isEmpty)
          const Text('No customer letter attached.', style: TextStyle(fontSize: 13, color: Brand.muted))
        else
          Row(children: [
            Expanded(
              child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                Text(str(s['letter_file_name']), style: const TextStyle(fontWeight: FontWeight.w600)),
                Text(formatBytes(s['letter_size']), style: const TextStyle(fontSize: 11.5, color: Brand.muted)),
              ]),
            ),
            TextButton(
                onPressed: () => openApiFile(context, '/design/submissions/${s['id']}/letter', str(s['letter_file_name']), query: {'download': true}),
                child: const Text('Open')),
          ]),
        if (_can('upload_letter'))
          Align(
            alignment: Alignment.centerLeft,
            child: OutlinedButton.icon(
              onPressed: _busy ? null : _uploadLetter,
              icon: const Icon(Icons.upload_file_rounded),
              label: Text(str(s['letter_file_name']).isEmpty ? "Upload the customer's letter" : 'Replace letter'),
            ),
          ),
      ]),
      DetailSection('Timeline', children: [
        if (events.isEmpty) const Text('No activity yet.', style: TextStyle(color: Brand.muted)),
        for (final e in events)
          Padding(
            padding: const EdgeInsets.symmetric(vertical: 6),
            child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
              Text.rich(TextSpan(style: const TextStyle(fontSize: 13), children: [
                TextSpan(text: str(e['actor_name']).isEmpty ? 'System' : str(e['actor_name']), style: const TextStyle(fontWeight: FontWeight.w700)),
                TextSpan(text: ' ${_eventLabels[str(e['action'])] ?? str(e['action']).replaceAll('_', ' ')}'),
                if (str(e['doc_number']).isNotEmpty) TextSpan(text: ' · ${e['doc_number']}', style: const TextStyle(color: Brand.muted)),
              ])),
              if (str(e['comment']).isNotEmpty) Text(str(e['comment']), style: const TextStyle(fontSize: 12.5, color: Brand.muted)),
              Text(fmtDateTime(e['created_at']), style: const TextStyle(fontSize: 11, color: Brand.muted)),
            ]),
          ),
      ]),
    ]);
  }
}
