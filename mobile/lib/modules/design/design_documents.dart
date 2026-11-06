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
import 'design_boms.dart';
import 'design_changes.dart';
import 'design_common.dart';
import 'design_requests.dart';
import 'design_reviews.dart';

/// Drawings - portal design/documents (Document Register), documents/new and
/// documents/[id].

const docStatusLabels = <String, String>{
  'draft': 'Draft',
  'in_review': 'In Review',
  'in_approval': 'In Approval',
  'approved': 'Approved · awaiting customer',
  'released': 'Released',
  'revising': 'Released · Revising',
  'obsolete': 'Obsolete',
  'customer_rejected': 'Customer rejected',
  'superseded': 'Superseded',
};

const docStatusColors = <String, Color>{
  'draft': Color(0xFF78716C),
  'in_review': Color(0xFF2563EB),
  'in_approval': Color(0xFF7C3AED),
  'approved': Color(0xFF0891B2),
  'released': Color(0xFF16A34A),
  'revising': Color(0xFF0F766E),
  'obsolete': Color(0xFFDC2626),
  'customer_rejected': Color(0xFFB91C1C),
  'superseded': Color(0xFFA8A29E),
};

Widget docStatusBadge(Object? s) =>
    StatusBadge(labelOf(docStatusLabels, s), color: docStatusColors[str(s)] ?? const Color(0xFF78716C));

const _openRevLabels = {'draft': 'draft', 'in_review': 'in review', 'in_approval': 'in approval', 'approved': 'awaiting customer'};

const _statusTabs = <(String, String)>[
  ('draft,in_review,in_approval,approved,released,revising,customer_rejected', 'Active'),
  ('released,revising', 'Released'),
  ('in_review,in_approval', 'In Workflow'),
  ('in_review', 'In Review'),
  ('in_approval', 'In Approval'),
  ('approved', 'Awaiting Customer'),
  ('customer_rejected', 'Customer Rejected'),
  ('draft', 'Draft'),
  ('obsolete', 'Obsolete'),
  ('', 'All'),
];

// ── List ─────────────────────────────────────────────────────────────────────

class DesignDocumentsTab extends StatefulWidget {
  const DesignDocumentsTab({super.key, this.initialStatus});

  /// Status filter to open with (dashboard KPI links).
  final String? initialStatus;

  @override
  State<DesignDocumentsTab> createState() => _DesignDocumentsTabState();
}

class _DesignDocumentsTabState extends State<DesignDocumentsTab> {
  final _list = GlobalKey<ApiListViewState>();
  late String _status = widget.initialStatus ?? _statusTabs.first.$1;
  String? _type;
  String? _discipline;
  Json _me = const {};

  @override
  void initState() {
    super.initState();
    DesignMe.load().then((m) {
      if (mounted) setState(() => _me = m);
    });
  }

  Future<void> _new() async {
    final id = await showNewDocumentForm(context);
    if (id != null && mounted) {
      _list.currentState?.reload();
      openScreen(context, DesignDocumentDetail(id: id));
    }
  }

  @override
  Widget build(BuildContext context) {
    final canCreate = _me.isNotEmpty && DesignMe.role(_me) != 'viewer';
    return Scaffold(
      backgroundColor: Colors.transparent,
      floatingActionButton: canCreate ? CreateFab(label: 'New Document', onPressed: _new) : null,
      body: ApiListView(
        key: _list,
        searchHint: 'Search by number, legacy number, title or description…',
        emptyText: _status.isNotEmpty ? 'No documents match these filters. Try the “All” tab.' : 'No documents match these filters. Use + New Document to create one.',
        header: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
          const PageHeader('Document Register', subtitle: 'Design Module'),
          ChipRow(children: [
            for (final t in _statusTabs)
              CountChip(t.$2, null, selected: _status == t.$1, onTap: () {
                setState(() => _status = t.$1);
                _list.currentState?.reload();
              }),
          ]),
          Padding(
            padding: const EdgeInsets.fromLTRB(16, 4, 16, 10),
            child: Row(children: [
              Expanded(
                child: AppSelect<String>(
                  label: 'All types',
                  value: _type,
                  options: optionsOf(docTypeLabels),
                  onChanged: (o) {
                    setState(() => _type = o?.value);
                    _list.currentState?.reload();
                  },
                ),
              ),
              const SizedBox(width: 8),
              Expanded(
                child: AppSelect<String>(
                  label: 'All disciplines',
                  value: _discipline,
                  options: optionsOf(disciplineLabels),
                  onChanged: (o) {
                    setState(() => _discipline = o?.value);
                    _list.currentState?.reload();
                  },
                ),
              ),
            ]),
          ),
        ]),
        load: (page, search) => Api.list('/design/documents', query: {
          'status': _status,
          'document_type': _type,
          'discipline': _discipline,
          'search': search,
        }),
        itemBuilder: (ctx, d, reload) => RecordCard(
          code: str(d['doc_number']) + (str(d['legacy_number']).isEmpty ? '' : '  (old: ${d['legacy_number']})'),
          title: str(d['title']),
          subtitle: nullIfEmpty(str(d['pm_project_label'] ?? d['erp_project_label'])),
          trailing: Padding(padding: const EdgeInsets.only(left: 8), child: docStatusBadge(d['display_status'])),
          meta: [
            ('Type', labelOf(docTypeLabels, d['document_type'])),
            ('Discipline', labelOf(disciplineLabels, d['discipline'])),
            if (str(d['customer_name']).isNotEmpty)
              ('Customer', '${d['customer_name']}${d['customer_approval_required'] == true ? ' · approval required' : ''}'),
            (
              'Controlled Rev',
              str(d['released_revision_label']).isEmpty
                  ? 'Not released'
                  : '${d['released_revision_label']} · ${fmtDate(d['released_at'])}'
            ),
            if (str(d['open_revision_label']).isNotEmpty)
              (
                'Work in Progress',
                '${d['open_revision_label']} ${_openRevLabels[str(d['open_revision_status'])] ?? ''}'
                    '${str(d['pending_with_name']).isEmpty ? '' : ' · with ${d['pending_with_name']}'}'
              ),
            ('Owner', txt(d['owner_name'])),
          ],
          onTap: () async {
            await Navigator.of(ctx).push(MaterialPageRoute(builder: (_) => DesignDocumentDetail(id: asInt(d['id'])!)));
            reload();
          },
        ),
      ),
    );
  }
}

// ── New document (documents/new) ────────────────────────────────────────────

class _Staged {
  _Staged(this.file, this.role);
  final MultipartFile file;
  final String role;
}

/// The portal's "New Document" form. Returns the new document id.
Future<int?> showNewDocumentForm(BuildContext context, {int? requestId, String? requestLabel}) async {
  final title = TextEditingController();
  final description = TextEditingController();
  final legacy = TextEditingController();
  final issueNote = TextEditingController();
  String type = 'part_drawing';
  String discipline = 'mechanical';
  int? standardId, projectId, machineId, itemId, departmentId, customerId, ownerId, reviewerId, approverId;
  int? reqId = requestId;
  String? standardL, projectL, machineL, itemL, departmentL, customerL, ownerL, reviewerL, approverL;
  String? reqL = requestLabel;
  bool customerApproval = false;
  bool submitNow = true;
  String nextRole = 'primary';
  final staged = <_Staged>[];
  final me = await DesignMe.load();
  if (!context.mounted) return null;
  ownerId = Perm.userId;
  ownerL = str(Perm.user['name']);
  int? createdId;

  await showFormSheet(
    context,
    title: 'New Document',
    saveLabel: 'Create',
    builder: (ctx, setS) => [
      const InfoNote('Creates the document with its first revision (R0). The number is assigned automatically from the type.'),
      if (me.isNotEmpty && !DesignMe.isTeam(me))
        const InfoNote('Only the Design team can create documents - you can view released drawings.', color: Brand.danger),
      const Caps('Document'),
      AppTextField(label: 'Title', controller: title, required: true, hint: 'e.g. Front bogie frame — general arrangement'),
      AppSelect<String>(
          label: 'Type', required: true, value: type, options: optionsOf(docTypeLabels), onChanged: (o) => setS(() => type = o?.value ?? type)),
      AppSelect<String>(
          label: 'Discipline',
          required: true,
          value: discipline,
          options: optionsOf(disciplineLabels),
          onChanged: (o) => setS(() => discipline = o?.value ?? discipline)),
      AppTextField(label: 'Legacy drawing number', controller: legacy, hint: 'Old number, if migrated'),
      AppSelect<int>(
          label: 'Standard',
          value: standardId,
          valueLabel: standardL,
          loadOptions: (s) => designLookup('standards', s),
          onChanged: (o) => setS(() {
                standardId = o?.value;
                standardL = o?.label;
              })),
      AppTextField(label: 'Description', controller: description, maxLines: 3, hint: 'Scope, applicable variant, key notes…'),
      const Caps('Associations'),
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
          label: 'Machine (RRV / asset)',
          value: machineId,
          valueLabel: machineL,
          loadOptions: (s) => designLookup('machines', s),
          onChanged: (o) => setS(() {
                machineId = o?.value;
                machineL = o?.label;
              })),
      AppSelect<int>(
          label: 'Part (Store item)',
          value: itemId,
          valueLabel: itemL,
          loadOptions: (s) => designLookup('items', s, query: {'limit': 200}, sendSearch: true),
          onChanged: (o) => setS(() {
                itemId = o?.value;
                itemL = o?.label;
              })),
      AppSelect<int>(
          label: 'Department',
          value: departmentId,
          valueLabel: departmentL,
          loadOptions: (s) => designLookup('departments', s),
          onChanged: (o) => setS(() {
                departmentId = o?.value;
                departmentL = o?.label;
              })),
      AppSelect<int>(
          label: 'Design request',
          value: reqId,
          valueLabel: reqL,
          loadOptions: designOpenRequests,
          onChanged: (o) => setS(() {
                reqId = o?.value;
                reqL = o?.label;
              })),
      const Caps('Customer'),
      AppSelect<int>(
          label: 'Customer',
          value: customerId,
          valueLabel: customerL,
          loadOptions: (s) => designLookup('customers', s, sendSearch: true),
          onChanged: (o) => setS(() {
                customerId = o?.value;
                customerL = o?.label;
              })),
      CheckField(label: 'Customer approval required', value: customerApproval, onChanged: (v) => setS(() => customerApproval = v)),
      const Caps('R0 — sign-off'),
      AppSelect<int>(
          label: 'Owner (responsible engineer)',
          value: ownerId,
          valueLabel: ownerL,
          loadOptions: (s) => designUsers(s),
          onChanged: (o) => setS(() {
                ownerId = o?.value;
                ownerL = o?.label;
              })),
      AppSelect<int>(
          label: 'Checked by',
          value: reviewerId,
          valueLabel: reviewerL,
          loadOptions: (s) => designUsers(s, excludeMe: true),
          onChanged: (o) => setS(() {
                reviewerId = o?.value;
                reviewerL = o?.label;
              })),
      AppSelect<int>(
          label: 'Approved by',
          value: approverId,
          valueLabel: approverL,
          loadOptions: (s) => designUsers(s, excludeMe: true),
          onChanged: (o) => setS(() {
                approverId = o?.value;
                approverL = o?.label;
              })),
      AppTextField(label: 'Issue note', controller: issueNote, hint: 'Initial issue'),
      const Caps('Files'),
      AppSelect<String>(
          label: 'Add as',
          value: nextRole,
          options: optionsOf(fileRoleLabels),
          clearable: false,
          onChanged: (o) => setS(() => nextRole = o?.value ?? nextRole)),
      OutlinedButton.icon(
        icon: const Icon(Icons.attach_file_rounded),
        label: const Text('Choose files'),
        onPressed: () async {
          final f = await Files.pickFile(extensions: designFileExtensions);
          if (f == null) return;
          if (staged.any((s) => (s.file.filename ?? '').toLowerCase() == (f.filename ?? '').toLowerCase())) return;
          setS(() => staged.add(_Staged(f, nextRole)));
        },
      ),
      for (final s in staged)
        Row(children: [
          const Icon(Icons.insert_drive_file_outlined, size: 18, color: Brand.muted),
          const SizedBox(width: 8),
          Expanded(child: Text('${s.file.filename} · ${fileRoleLabels[s.role]} · ${formatBytes(s.file.length)}', style: const TextStyle(fontSize: 13))),
          IconButton(icon: const Icon(Icons.close_rounded, size: 18), onPressed: () => setS(() => staged.remove(s))),
        ]),
      CheckField(label: 'Submit for check now', value: submitNow, onChanged: (v) => setS(() => submitNow = v)),
    ],
    onSave: () async {
      if (title.text.trim().length < 2) throw 'Give the document a title (at least 2 characters).';
      if (customerApproval && customerId == null) {
        throw '“Customer approval required” needs a customer — pick the customer who must approve this drawing, or untick the box.';
      }
      if (reviewerId != null && reviewerId == approverId) throw 'The checker and the approver must be two different people.';
      if (submitNow) {
        if (reviewerId == null || approverId == null) {
          throw 'To submit for check right away, name both a checker and an approver — or untick “Submit for check now”.';
        }
        if (staged.isEmpty) throw 'To submit for check right away, attach at least one file — or untick “Submit for check now”.';
      }
      if (createdId == null) {
        final created = jsonMap(await Api.post('/design/documents', data: {
          'title': title.text.trim(),
          'description': nullIfEmpty(description.text),
          'document_type': type,
          'discipline': discipline,
          'pm_project_id': projectId,
          'erp_project_id': machineId,
          'store_item_id': itemId,
          'department_id': departmentId,
          'customer_id': customerId,
          'customer_approval_required': customerApproval,
          'standard_id': standardId,
          'design_request_id': reqId,
          'legacy_number': nullIfEmpty(legacy.text),
          'owner_id': ownerId,
          'reviewer_id': reviewerId,
          'approver_id': approverId,
          'change_summary': nullIfEmpty(issueNote.text),
        }));
        createdId = asInt(created['id']);
        final revs = jsonList(created['revisions']);
        final revId = revs.isEmpty ? null : asInt(revs.first['id']);
        // The document exists now - file/submit problems are shown, not blocking.
        final problems = <String>[];
        if (revId != null) {
          for (final role in const ['primary', 'native', 'supporting']) {
            final files = staged.where((s) => s.role == role).map((s) => s.file).toList();
            if (files.isEmpty) continue;
            try {
              await uploadRevisionFiles(revId, files, role);
            } catch (e) {
              problems.add('Uploading ${fileRoleLabels[role]} files failed: ${ApiClient.describe(e)}');
            }
          }
          if (submitNow && problems.isEmpty) {
            try {
              await Api.post('/design/revisions/$revId/submit', data: {});
            } catch (e) {
              problems.add('The document was saved, but submitting it for check failed: ${ApiClient.describe(e)}');
            }
          }
        }
        if (problems.isNotEmpty && context.mounted) {
          showSnack(context, 'The document was created, but: ${problems.join(' ')}', error: true);
        }
      }
    },
  );
  return createdId;
}

// ── Detail (documents/[id]) ──────────────────────────────────────────────────

const _openStatuses = ['draft', 'in_review', 'in_approval', 'approved'];
const _resultLabels = {'ok': 'OK', 'not_ok': 'Not OK', 'na': 'N/A'};
const _resultColors = {'ok': Color(0xFF16A34A), 'not_ok': Color(0xFFDC2626), 'na': Color(0xFF78716C)};

const _eventLabels = {
  'created': 'created the document',
  'details_updated': 'updated the details',
  'revision_started': 'started a new revision',
  'revision_updated': 'edited the revision',
  'revision_discarded': 'discarded the draft revision',
  'file_added': 'added files',
  'file_removed': 'removed a file',
  'submitted': 'submitted for check',
  'recalled': 'recalled it to draft',
  'review_passed': 'passed the check',
  'review_returned': 'returned it from check',
  'approval_returned': 'returned it from approval',
  'approved_released': 'approved and released it',
  'superseded': 'superseded the revision',
  'obsoleted': 'marked the document obsolete',
  'reactivated': 'reactivated the document',
  'deleted': 'deleted the document',
  'comment': 'commented',
  'approved_for_customer': 'approved it — now awaiting the customer',
  'sent_to_customer': 'sent it to the customer',
  'customer_approved': 'recorded customer approval',
  'customer_rejected': 'recorded customer rejection',
  'document_created': 'created the document for a design request',
  'document_released': 'released it after customer approval',
};

class DesignDocumentDetail extends StatefulWidget {
  const DesignDocumentDetail({super.key, required this.id});
  final int id;

  @override
  State<DesignDocumentDetail> createState() => _DesignDocumentDetailState();
}

class _DesignDocumentDetailState extends State<DesignDocumentDetail> {
  Json? _doc;
  Object? _error;
  bool _busy = false;
  int? _selectedRevId;
  final _expanded = <int>{};
  int _approvalKey = 0;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    try {
      final d = jsonMap(await Api.get('/design/documents/${widget.id}'));
      if (mounted) _apply(d);
    } catch (e) {
      if (mounted) setState(() => _error = e);
    }
  }

  void _apply(Json d, {bool resetSelection = false}) {
    setState(() {
      _doc = d;
      _error = null;
      _approvalKey++;
      final revs = jsonList(d['revisions']);
      if (resetSelection || _selectedRevId == null || !revs.any((r) => asInt(r['id']) == _selectedRevId)) {
        final open = _openRev(d);
        _selectedRevId = asInt(open?['id']) ?? asInt(d['released_revision_id']) ?? (revs.isEmpty ? null : asInt(revs.first['id']));
      }
    });
  }

  Json? _openRev(Json d) {
    for (final r in jsonList(d['revisions'])) {
      if (_openStatuses.contains(str(r['status']))) return r;
    }
    return null;
  }

  bool _can(String a) => strList(_doc?['allowed_actions']).contains(a);

  /// Runs an action that returns the document detail.
  Future<bool> _act(Future<dynamic> Function() fn, String success, {bool reset = true}) async {
    setState(() => _busy = true);
    Json? out;
    final ok = await runAction(context, () async {
      final r = await fn();
      if (r is Map) out = jsonMap(r);
    }, success: success);
    if (!mounted) return ok;
    setState(() => _busy = false);
    if (ok) {
      if (out != null && out!.containsKey('doc_number')) {
        _apply(out!, resetSelection: reset);
      } else {
        _load();
      }
    }
    return ok;
  }

  // ── Prompts / confirms (PROMPT_TEXT / CONFIRM_TEXT) ──

  Future<void> _prompt(String which) async {
    final d = _doc!;
    final rev = _openRev(d);
    final ref = '${d['doc_number']} ${rev?['revision_label'] ?? ''}'.trim();
    final customer = d['customer_approval_required'] == true;
    const fix = 'What needs fixing';
    final cfg = switch (which) {
      'recall' => ('Recall to draft', 'The checker/approver is told no action is needed. You can then change files and resubmit.', 'Reason', false, 'Recall'),
      'review_pass' => ('Pass the check', 'The revision moves to the approver.', 'Check remarks', false, 'Pass check'),
      'review_return' => ('Return to author', 'The revision goes back to draft. Say exactly what needs fixing.', fix, true, 'Return'),
      'approve_pass' => customer
          ? ('Approve for customer', 'Approved internally — it then waits for the customer before it can be released.', 'Approval remarks', false, 'Approve for Customer')
          : ('Approve & release', 'This becomes the controlled revision. Any previously released revision is superseded.', 'Approval remarks', false, 'Approve & Release'),
      'approve_return' => ('Return to author', 'The revision goes back to draft. Say exactly what needs fixing.', fix, true, 'Return'),
      'release' => (
          'Release after customer approval',
          'The customer has approved this revision. Releasing makes it the controlled revision and supersedes the previous one.',
          'Release remarks',
          false,
          'Release'
        ),
      _ => ('Mark document obsolete', 'The document is withdrawn from use. Its revisions stay on record and retrievable.', 'Reason', true, 'Mark Obsolete'),
    };
    final subject = which == 'obsolete' ? str(d['doc_number']) : ref;
    final value = await promptDialog(context,
        title: cfg.$1, message: '$subject — ${cfg.$2}', label: cfg.$3, required: cfg.$4, confirmLabel: cfg.$5);
    if (value == null || !mounted) return;
    final revId = asInt(rev?['id']);
    final c = value.isEmpty ? null : value;
    switch (which) {
      case 'obsolete':
        await _act(() => Api.post('/design/documents/${d['id']}/obsolete', data: {'reason': value}), '${d['doc_number']} marked obsolete.');
      case 'release':
        await _act(() => Api.post('/design/revisions/$revId/release', data: {'comment': c}), '$ref released — it is now the controlled revision.');
      case 'recall':
        await _act(() => Api.post('/design/revisions/$revId/recall', data: {'comment': c}), '$ref recalled to draft.');
      case 'review_pass':
        await _act(() => Api.post('/design/revisions/$revId/review', data: {'decision': 'pass', 'comment': c}),
            '$ref checked — sent to ${rev?['approver_name'] ?? 'the approver'}.');
      case 'review_return':
        await _act(() => Api.post('/design/revisions/$revId/review', data: {'decision': 'return', 'comment': c}),
            '$ref returned to ${rev?['created_by_name'] ?? 'the author'}.');
      case 'approve_pass':
        await _act(() => Api.post('/design/revisions/$revId/approve', data: {'decision': 'pass', 'comment': c}),
            customer ? '$ref approved — now awaiting the customer.' : '$ref released — it is now the controlled revision.');
      case 'approve_return':
        await _act(() => Api.post('/design/revisions/$revId/approve', data: {'decision': 'return', 'comment': c}),
            '$ref returned to ${rev?['created_by_name'] ?? 'the author'}.');
    }
  }

  Future<void> _confirm(String which) async {
    final d = _doc!;
    final rev = _openRev(d);
    final (title, message, label) = switch (which) {
      'submit' => (
          'Submit for check?',
          '${d['doc_number']} ${rev?['revision_label']} goes to ${rev?['reviewer_name'] ?? 'the checker'} for check.',
          'Submit'
        ),
      'discard' => ('Discard this draft revision?', 'Draft ${rev?['revision_label']} and its files are removed.', 'Discard'),
      'delete' => (
          'Delete this document?',
          "${d['doc_number']} has never been released, so it will be deleted with its draft files. This can't be undone.",
          'Delete'
        ),
      _ => ('Reactivate this document?', '${d['doc_number']} becomes active again and can be revised.', 'Reactivate'),
    };
    final ok = await confirmDialog(context,
        title: title, message: message, confirmLabel: label, danger: which == 'discard' || which == 'delete');
    if (!ok || !mounted) return;
    final revId = asInt(rev?['id']);
    switch (which) {
      case 'submit':
        await _act(() => Api.post('/design/revisions/$revId/submit', data: {}),
            '${d['doc_number']} ${rev?['revision_label']} submitted — ${rev?['reviewer_name'] ?? 'the checker'} has been notified.');
      case 'discard':
        await _act(() => Api.delete('/design/revisions/$revId'), 'Draft ${rev?['revision_label']} discarded.');
      case 'reactivate':
        await _act(() => Api.post('/design/documents/${d['id']}/reactivate'), '${d['doc_number']} is active again.');
      case 'delete':
        setState(() => _busy = true);
        final done = await runAction(context, () => Api.delete('/design/documents/${d['id']}'), success: '${d['doc_number']} deleted.');
        if (!mounted) return;
        setState(() => _busy = false);
        if (done) Navigator.of(context).pop();
    }
  }

  // ── Checklist review ──

  Future<void> _checklistReview() async {
    final d = _doc!;
    final cl = jsonMap(d['checklist']);
    final rev = _openRev(d);
    if (rev == null) return;
    final items = jsonList(cl['items']);
    final answers = <int, String>{};
    final remarks = <int, TextEditingController>{for (final it in items) asInt(it['id'])!: TextEditingController()};
    final comment = TextEditingController();
    String decision = 'pass';
    final ref = '${d['doc_number']} ${rev['revision_label']}';
    final saved = await showFormSheet(
      context,
      title: 'Check $ref',
      saveLabel: 'Save check',
      builder: (ctx, setS) => [
        InfoNote('${cl['name']} — answer every item. You can pass only when nothing is Not OK; returning needs a comment for the author.'),
        const Caps('Checklist'),
        for (var i = 0; i < items.length; i++)
          Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            Text('${i + 1}. ${items[i]['text']}', style: const TextStyle(fontSize: 14, color: Brand.heading)),
            const SizedBox(height: 6),
            Wrap(spacing: 6, children: [
              for (final res in const ['ok', 'not_ok', 'na'])
                ChoiceChip(
                  label: Text(_resultLabels[res]!),
                  selected: answers[asInt(items[i]['id'])] == res,
                  selectedColor: _resultColors[res]!.withValues(alpha: 0.2),
                  onSelected: (_) => setS(() => answers[asInt(items[i]['id'])!] = res),
                ),
            ]),
            const SizedBox(height: 6),
            AppTextField(
                label: answers[asInt(items[i]['id'])] == 'not_ok' ? 'What is wrong…' : 'Remark (optional)',
                controller: remarks[asInt(items[i]['id'])]),
          ]),
        const Caps('Check comment'),
        AppTextField(label: 'Overall remarks (required when returning)', controller: comment, maxLines: 3),
        AppSelect<String>(
          label: 'Decision',
          required: true,
          clearable: false,
          value: decision,
          options: const [Option('pass', 'Pass Check'), Option('return', 'Return to Author')],
          onChanged: (o) => setS(() => decision = o?.value ?? decision),
        ),
      ],
      onSave: () async {
        final unanswered = items.where((it) => answers[asInt(it['id'])] == null).toList();
        if (decision == 'pass') {
          if (unanswered.isNotEmpty) {
            throw 'Answer every checklist item before passing — ${unanswered.length} still unanswered (first: “${unanswered.first['text']}”).';
          }
          final bad = items.where((it) => answers[asInt(it['id'])] == 'not_ok').length;
          if (bad > 0) throw "You can't pass the check with $bad item${bad == 1 ? '' : 's'} marked Not OK — return it to the author instead.";
        }
        if (decision == 'return' && comment.text.trim().isEmpty) throw 'Say what needs fixing in the comment — the author sees it.';
        final out = await Api.post('/design/revisions/${rev['id']}/review', data: {
          'decision': decision,
          'comment': nullIfEmpty(comment.text),
          'checklist': [
            for (final it in items)
              if (answers[asInt(it['id'])] != null)
                {
                  'checklist_item_id': asInt(it['id']),
                  'result': answers[asInt(it['id'])],
                  'remark': nullIfEmpty(remarks[asInt(it['id'])]!.text),
                },
          ],
        });
        if (mounted && out is Map) _apply(jsonMap(out), resetSelection: true);
      },
    );
    if (saved && mounted) {
      showSnack(context,
          decision == 'pass' ? '$ref checked — sent to ${rev['approver_name'] ?? 'the approver'}.' : '$ref returned to ${rev['created_by_name'] ?? 'the author'}.');
    }
  }

  // ── Revision forms ──

  List<Option<int>> _ecnOptions(Json d) => [
        for (final e in jsonList(d['open_ecns'])) Option<int>(asInt(e['id'])!, '${e['ecn_number']} — ${e['title']}'),
      ];

  Future<void> _newRevision() async {
    final d = _doc!;
    final revs = jsonList(d['revisions']);
    final nextIndex = (revs.isEmpty ? 0 : (asInt(revs.first['revision_index']) ?? 0)) + 1;
    final summary = TextEditingController();
    int? ecnId, reviewerId, approverId;
    String? reviewerL, approverL;
    final ecns = _ecnOptions(d);
    final saved = await showFormSheet(
      context,
      title: 'Start revision R$nextIndex',
      saveLabel: 'Start Revision',
      builder: (ctx, setS) => [
        InfoNote('${d['doc_number']} — the released revision stays in use until the new one is released.'),
        const Caps('Change'),
        AppTextField(
            label: 'Change summary — what changes and why',
            controller: summary,
            required: true,
            maxLines: 3,
            hint: 'e.g. Gusset plate thickened 10 → 12 mm after FEA review'),
        ecns.isEmpty
            ? const InfoNote('No approved ECN lists this document', color: Brand.muted)
            : AppSelect<int>(label: 'Under change notice', value: ecnId, options: ecns, onChanged: (o) => setS(() => ecnId = o?.value)),
        const Caps('Signatories'),
        AppSelect<int>(
            label: 'Checked by',
            value: reviewerId,
            valueLabel: reviewerL,
            loadOptions: (s) => designUsers(s, excludeMe: true),
            onChanged: (o) => setS(() {
                  reviewerId = o?.value;
                  reviewerL = o?.label;
                })),
        AppSelect<int>(
            label: 'Approved by',
            value: approverId,
            valueLabel: approverL,
            loadOptions: (s) => designUsers(s),
            onChanged: (o) => setS(() {
                  approverId = o?.value;
                  approverL = o?.label;
                })),
        const Text('Both can be set later, before you submit for check.', style: TextStyle(fontSize: 12, color: Brand.muted)),
      ],
      onSave: () async {
        if (summary.text.trim().length < 3) throw 'Change summary is required — say what changes and why (at least 3 characters).';
        if (reviewerId != null && reviewerId == approverId) throw 'The checker and the approver must be two different people.';
        final out = await Api.post('/design/documents/${d['id']}/revisions', data: {
          'change_summary': summary.text.trim(),
          'reviewer_id': reviewerId,
          'approver_id': approverId,
          'ecn_id': ecnId,
        });
        if (mounted && out is Map) _apply(jsonMap(out), resetSelection: true);
      },
    );
    if (saved && mounted) showSnack(context, 'Revision R$nextIndex started.');
  }

  Future<void> _editRevision(Json rev) async {
    final d = _doc!;
    final summary = TextEditingController(text: str(rev['change_summary']));
    int? ecnId = asInt(rev['ecn_id']);
    int? reviewerId = asInt(rev['reviewer_id']);
    int? approverId = asInt(rev['approver_id']);
    String? reviewerL = nullIfEmpty(str(rev['reviewer_name']));
    String? approverL = nullIfEmpty(str(rev['approver_name']));
    final ecns = _ecnOptions(d);
    final saved = await showFormSheet(
      context,
      title: 'Edit ${rev['revision_label']}',
      builder: (ctx, setS) => [
        InfoNote('${d['doc_number']} — change summary, signatories and change notice can change until the revision is submitted.'),
        const Caps('Change'),
        AppTextField(label: 'Change summary', controller: summary, maxLines: 3),
        AppSelect<int>(
            label: 'Under change notice',
            value: ecnId,
            valueLabel: nullIfEmpty(str(rev['ecn_number'])),
            options: ecns,
            onChanged: (o) => setS(() => ecnId = o?.value)),
        const Caps('Signatories'),
        AppSelect<int>(
            label: 'Checked by',
            value: reviewerId,
            valueLabel: reviewerL,
            loadOptions: (s) => designUsers(s, excludeMe: true),
            onChanged: (o) => setS(() {
                  reviewerId = o?.value;
                  reviewerL = o?.label;
                })),
        AppSelect<int>(
            label: 'Approved by',
            value: approverId,
            valueLabel: approverL,
            loadOptions: (s) => designUsers(s),
            onChanged: (o) => setS(() {
                  approverId = o?.value;
                  approverL = o?.label;
                })),
      ],
      onSave: () async {
        if (reviewerId != null && reviewerId == approverId) throw 'The checker and the approver must be two different people.';
        final out = await Api.patch('/design/revisions/${rev['id']}', data: {
          'change_summary': summary.text.trim(),
          'reviewer_id': reviewerId,
          'approver_id': approverId,
          'ecn_id': ecnId,
        });
        if (mounted && out is Map) _apply(jsonMap(out));
      },
    );
    if (saved && mounted) showSnack(context, '${rev['revision_label']} saved.');
  }

  Future<void> _upload(Json rev) async {
    String role = 'primary';
    final staged = <MultipartFile>[];
    final saved = await showFormSheet(
      context,
      title: 'Upload files to ${rev['revision_label']}',
      saveLabel: 'Upload',
      builder: (ctx, setS) => [
        InfoNote('${_doc!['doc_number']} — attach the controlled print (PDF) as primary and the CAD source as native.'),
        AppSelect<String>(
            label: 'Add as', required: true, clearable: false, value: role, options: optionsOf(fileRoleLabels), onChanged: (o) => setS(() => role = o?.value ?? role)),
        OutlinedButton.icon(
          icon: const Icon(Icons.attach_file_rounded),
          label: const Text('Choose files'),
          onPressed: () async {
            final f = await Files.pickFile(extensions: designFileExtensions);
            if (f == null) return;
            if (staged.any((s) => (s.filename ?? '').toLowerCase() == (f.filename ?? '').toLowerCase())) return;
            setS(() => staged.add(f));
          },
        ),
        for (final f in staged)
          Row(children: [
            Expanded(child: Text('${f.filename} · ${formatBytes(f.length)}', style: const TextStyle(fontSize: 13))),
            IconButton(icon: const Icon(Icons.close_rounded, size: 18), onPressed: () => setS(() => staged.remove(f))),
          ]),
        const Text('All files picked here get the role above — upload other roles in a second go. Files can be removed until the revision is submitted.',
            style: TextStyle(fontSize: 12, color: Brand.muted)),
      ],
      onSave: () async {
        if (staged.isEmpty) throw 'Choose at least one file to upload.';
        final out = await uploadRevisionFiles(asInt(rev['id'])!, staged, role);
        if (mounted) _apply(out);
      },
    );
    if (saved && mounted) showSnack(context, '${staged.length} file${staged.length == 1 ? '' : 's'} uploaded to ${rev['revision_label']}.');
  }

  Future<void> _editDetails() async {
    final d = _doc!;
    final title = TextEditingController(text: str(d['title']));
    final description = TextEditingController(text: str(d['description']));
    final legacy = TextEditingController(text: str(d['legacy_number']));
    String discipline = str(d['discipline']);
    int? standardId = asInt(d['standard_id']), projectId = asInt(d['pm_project_id']), machineId = asInt(d['erp_project_id']);
    int? itemId = asInt(d['store_item_id']), departmentId = asInt(d['department_id']), ownerId = asInt(d['owner_id']);
    int? customerId = asInt(d['customer_id']), requestId = asInt(d['design_request_id']);
    String? standardL = nullIfEmpty(str(d['standard_label'])), projectL = nullIfEmpty(str(d['pm_project_label']));
    String? machineL = nullIfEmpty(str(d['erp_project_label'])), itemL = nullIfEmpty(str(d['store_item_label']));
    String? departmentL = nullIfEmpty(str(d['department_name'])), ownerL = nullIfEmpty(str(d['owner_name']));
    String? customerL = nullIfEmpty(str(d['customer_name'])), requestL = nullIfEmpty(str(d['request_number']));
    bool customerApproval = d['customer_approval_required'] == true;
    final saved = await showFormSheet(
      context,
      title: 'Edit document details',
      builder: (ctx, setS) => [
        InfoNote("${d['doc_number']} — the type and number can't change."),
        const Caps('Document'),
        AppTextField(label: 'Title', controller: title, required: true),
        AppSelect<String>(
            label: 'Discipline', required: true, clearable: false, value: discipline, options: optionsOf(disciplineLabels), onChanged: (o) => setS(() => discipline = o?.value ?? discipline)),
        AppTextField(label: 'Legacy drawing number', controller: legacy),
        AppSelect<int>(
            label: 'Standard',
            value: standardId,
            valueLabel: standardL,
            loadOptions: (s) => designLookup('standards', s),
            onChanged: (o) => setS(() {
                  standardId = o?.value;
                  standardL = o?.label;
                })),
        AppTextField(label: 'Description', controller: description, maxLines: 3),
        AppSelect<int>(
            label: 'Owner (responsible engineer)',
            value: ownerId,
            valueLabel: ownerL,
            loadOptions: (s) => designUsers(s),
            onChanged: (o) => setS(() {
                  ownerId = o?.value;
                  ownerL = o?.label;
                })),
        const Caps('Customer'),
        AppSelect<int>(
            label: 'Customer',
            value: customerId,
            valueLabel: customerL,
            loadOptions: (s) => designLookup('customers', s, sendSearch: true),
            onChanged: (o) => setS(() {
                  customerId = o?.value;
                  customerL = o?.label;
                })),
        CheckField(label: 'Customer approval required', value: customerApproval, onChanged: (v) => setS(() => customerApproval = v)),
        const Caps('Associations'),
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
            label: 'Machine (RRV / asset)',
            value: machineId,
            valueLabel: machineL,
            loadOptions: (s) => designLookup('machines', s),
            onChanged: (o) => setS(() {
                  machineId = o?.value;
                  machineL = o?.label;
                })),
        AppSelect<int>(
            label: 'Part (Store item)',
            value: itemId,
            valueLabel: itemL,
            loadOptions: (s) => designLookup('items', s, query: {'limit': 200}, sendSearch: true),
            onChanged: (o) => setS(() {
                  itemId = o?.value;
                  itemL = o?.label;
                })),
        AppSelect<int>(
            label: 'Department',
            value: departmentId,
            valueLabel: departmentL,
            loadOptions: (s) => designLookup('departments', s),
            onChanged: (o) => setS(() {
                  departmentId = o?.value;
                  departmentL = o?.label;
                })),
        AppSelect<int>(
            label: 'Design request',
            value: requestId,
            valueLabel: requestL,
            loadOptions: designOpenRequests,
            onChanged: (o) => setS(() {
                  requestId = o?.value;
                  requestL = o?.label;
                })),
      ],
      onSave: () async {
        if (title.text.trim().length < 2) throw 'Give the document a title (at least 2 characters).';
        if (customerApproval && customerId == null) {
          throw '“Customer approval required” needs a customer — pick the customer who must approve this drawing, or untick the box.';
        }
        final out = await Api.patch('/design/documents/${d['id']}', data: {
          'title': title.text.trim(),
          'description': nullIfEmpty(description.text),
          'discipline': discipline,
          'pm_project_id': projectId,
          'erp_project_id': machineId,
          'store_item_id': itemId,
          'department_id': departmentId,
          'owner_id': ownerId,
          'customer_id': customerId,
          'customer_approval_required': customerApproval,
          'standard_id': standardId,
          'design_request_id': requestId,
          'legacy_number': nullIfEmpty(legacy.text),
        });
        if (mounted && out is Map) _apply(jsonMap(out));
      },
    );
    if (saved && mounted) showSnack(context, 'Details saved.');
  }

  // ── Build ──

  List<DAction> _actions(Json d) {
    final rev = _openRev(d);
    final label = str(rev?['revision_label']);
    final engine = d['approval_engine'] == true;
    final checklist = d['checklist'] is Map;
    return [
      if (_can('submit')) DAction('Submit $label for Check', () => _confirm('submit'), primary: true),
      if (_can('review') && checklist) DAction('Check against Checklist', _checklistReview, primary: true),
      if (_can('review') && !checklist && !engine) DAction('Pass Check', () => _prompt('review_pass'), primary: true),
      if (_can('review') && !checklist && !engine) DAction('Return to Author', () => _prompt('review_return'), danger: true),
      if (_can('approve') && !engine)
        DAction(d['customer_approval_required'] == true ? 'Approve for Customer' : 'Approve & Release', () => _prompt('approve_pass'), primary: true),
      if (_can('release')) DAction('Release $label', () => _prompt('release'), primary: true),
      if (_can('approve') && !engine) DAction('Return to Author', () => _prompt('approve_return'), danger: true),
      if (_can('recall')) DAction('Recall to Draft', () => _prompt('recall')),
      if (_can('new_revision')) DAction('+ New Revision', _newRevision, primary: true),
      if (_can('discard_revision')) DAction('Discard $label', () => _confirm('discard'), danger: true),
      if (_can('obsolete')) DAction('Mark Obsolete', () => _prompt('obsolete'), danger: true),
      if (_can('reactivate')) DAction('Reactivate', () => _confirm('reactivate')),
      if (_can('delete')) DAction('Delete Document', () => _confirm('delete'), danger: true),
      if (_can('raise_ecr') && d['released_revision_id'] != null)
        DAction('Raise ECR', () async {
          if (await showCreateEcrForm(context, documentId: asInt(d['id'])) && mounted) _load();
        }),
      if (_can('edit')) DAction('Edit details', _editDetails),
    ];
  }

  @override
  Widget build(BuildContext context) {
    final d = _doc;
    return SubPage(
      title: d == null ? 'Document' : str(d['doc_number']),
      bottom: d == null ? null : actionBar(context, _actions(d), busy: _busy),
      body: d == null
          ? (_error != null ? ErrorView(_error!, onRetry: _load) : const LoadingView())
          : RefreshIndicator(onRefresh: _load, child: _body(d)),
    );
  }

  Widget _body(Json d) {
    final revs = jsonList(d['revisions']);
    final selected = revs.where((r) => asInt(r['id']) == _selectedRevId).firstOrNull;
    final openRev = _openRev(d);
    final isOpenSelected = selected != null && openRev != null && asInt(selected['id']) == asInt(openRev['id']);
    final seeFiles = designFeature('documents', 'files', 'view');
    final removeFiles = designFeature('documents', 'files', 'delete');
    final seeWhereUsed = designFeature('documents', 'where_used', 'view');
    final seeTimeline = designFeature('documents', 'timeline', 'view');
    final submissions = jsonList(d['submissions']);
    final whereUsed = jsonList(d['where_used']);
    final viewerOnly = d['viewer_only'] == true;

    return ListView(padding: const EdgeInsets.only(top: 12, bottom: 24), children: [
      if (str(d['status']) == 'obsolete')
        Padding(
          padding: const EdgeInsets.fromLTRB(16, 0, 16, 12),
          child: ErrorBanner('Obsolete — not for use. Marked obsolete by ${txt(d['obsoleted_by_name'])} on ${fmtDate(d['obsoleted_at'])}: ${txt(d['obsolete_reason'])}'),
        ),
      DetailSection(str(d['title']), children: [
        if (str(d['description']).isNotEmpty) Text(str(d['description']), style: const TextStyle(color: Brand.body)),
        const SizedBox(height: 6),
        Wrap(spacing: 8, runSpacing: 6, crossAxisAlignment: WrapCrossAlignment.center, children: [
          docStatusBadge(d['display_status']),
          Text(
              'Controlled revision ${str(d['released_revision_label']).isEmpty ? 'none yet' : d['released_revision_label']}'
              '${d['released_at'] != null ? ' (released ${fmtDate(d['released_at'])})' : ''}',
              style: const TextStyle(fontSize: 12.5, color: Brand.muted)),
          if (str(d['open_revision_label']).isNotEmpty)
            Text(
                '${d['open_revision_label']} ${labelOf(docStatusLabels, d['open_revision_status']).toLowerCase()}'
                '${str(d['pending_with_name']).isEmpty ? '' : ' with ${d['pending_with_name']}'}',
                style: const TextStyle(fontSize: 12.5, color: Brand.muted)),
          Text('Owner ${txt(d['owner_name'])}', style: const TextStyle(fontSize: 12.5, color: Brand.muted)),
        ]),
      ]),
      DetailSection('Document', children: [
        FieldRow('Type · Discipline', '${labelOf(docTypeLabels, d['document_type'])} · ${labelOf(disciplineLabels, d['discipline'])}'),
        FieldRow('Standard', d['standard_label']),
        FieldRow('Department', d['department_name']),
        if (str(d['legacy_number']).isNotEmpty) FieldRow('Legacy number', d['legacy_number']),
      ]),
      DetailSection('Customer', children: [
        FieldRow('Customer', d['customer_name']),
        FieldRow('Customer approval', d['customer_approval_required'] == true ? 'Required before release' : 'Not required'),
      ]),
      DetailSection('Linked to', children: [
        FieldRow('Project', d['pm_project_label']),
        FieldRow('Machine', d['erp_project_label']),
        FieldRow('Part (Store item)', d['store_item_label']),
        FieldRow(
            'Design request',
            d['design_request_id'] == null
                ? null
                : _link(d['request_number'] ?? 'Request #${d['design_request_id']}',
                    () => openScreen(context, DesignRequestDetail(id: asInt(d['design_request_id'])!)))),
        if (jsonList(d['open_ecns']).isNotEmpty)
          FieldRow(
              'Approved change notices',
              Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                for (final e in jsonList(d['open_ecns']))
                  _link('${e['ecn_number']} — ${e['title']}', () => openScreen(context, DesignChangeNoticeDetail(id: asInt(e['id'])!))),
              ])),
        Text('Created by ${txt(d['created_by_name'])} on ${fmtDate(d['created_at'])}', style: const TextStyle(fontSize: 12, color: Brand.muted)),
      ]),
      if (!viewerOnly)
        DesignApprovalPanel(
            key: ValueKey('ap$_approvalKey'),
            entityType: 'design_document',
            entityId: asInt(d['id'])!,
            title: 'Check & approval',
            onChanged: _load),
      if (viewerOnly)
        const Padding(
          padding: EdgeInsets.fromLTRB(16, 0, 16, 12),
          child: InfoNote(
              "You're viewing released revisions only. Drafts and revisions in check or approval are visible to the Design team. To ask for a change, raise an ECR."),
        ),
      if (openRev != null && str(openRev['status']) == 'approved')
        Padding(
          padding: const EdgeInsets.fromLTRB(16, 0, 16, 12),
          child: InfoNote(
              '${openRev['revision_label']} is approved internally and waiting on ${str(d['customer_name']).isEmpty ? 'the customer' : d['customer_name']}. '
              'Send it on a customer submission (Reviews & Approvals); it can be released once the customer approves it.',
              color: const Color(0xFF0891B2)),
        ),
      // Revision panel
      DetailSection('Revision', children: [
        Wrap(spacing: 6, runSpacing: 6, children: [
          for (final r in revs)
            ChoiceChip(
              label: Text(str(r['revision_label'])),
              selected: asInt(r['id']) == _selectedRevId,
              labelStyle: TextStyle(color: asInt(r['id']) == _selectedRevId ? null : docStatusColors[str(r['status'])]),
              onSelected: (_) => setState(() => _selectedRevId = asInt(r['id'])),
            ),
        ]),
        if (selected != null) ...[
          const SizedBox(height: 10),
          if (str(selected['status']) == 'superseded')
            InfoNote('Superseded — not for use. Kept for traceability. The controlled revision is ${txt(d['released_revision_label'])}.',
                color: Brand.muted),
          if (str(selected['status']) == 'customer_rejected')
            InfoNote(
                'Rejected by the customer — frozen. Start the next revision to address their comments'
                '${str(d['released_revision_label']).isEmpty ? '' : '; ${d['released_revision_label']} stays the controlled revision'}.',
                color: Brand.danger),
          const SizedBox(height: 6),
          Wrap(spacing: 8, runSpacing: 6, crossAxisAlignment: WrapCrossAlignment.center, children: [
            Text(str(selected['revision_label']), style: const TextStyle(fontSize: 18, fontWeight: FontWeight.w700, color: Brand.heading)),
            docStatusBadge(selected['status']),
            if ((asInt(selected['returned_count']) ?? 0) > 0)
              Text('returned ${selected['returned_count']}×', style: const TextStyle(fontSize: 12, color: Color(0xFFB45309))),
            if (str(selected['ecn_number']).isNotEmpty)
              _link('under ${selected['ecn_number']}', () => openScreen(context, DesignChangeNoticeDetail(id: asInt(selected['ecn_id'])!))),
            if (isOpenSelected && _can('edit_revision'))
              TextButton(onPressed: () => _editRevision(selected), child: const Text('Edit revision')),
          ]),
          FieldRow('Change summary', selected['change_summary']),
          FieldRow('Prepared by', '${txt(selected['created_by_name'])} · ${fmtDate(selected['created_at'])}'),
          FieldRow(
              'Checked by',
              selected['reviewed_at'] != null
                  ? '${txt(selected['reviewed_by_name'])} · ${fmtDate(selected['reviewed_at'])}'
                  : '${str(selected['reviewer_name']).isEmpty ? 'Not named yet' : selected['reviewer_name']} (pending)'),
          FieldRow(
              'Approved by',
              selected['approved_at'] != null && str(selected['status']) != 'draft'
                  ? '${txt(selected['approved_by_name'])} · ${fmtDate(selected['approved_at'])}'
                  : '${str(selected['approver_name']).isEmpty ? 'Not named yet' : selected['approver_name']} (pending)'),
          FieldRow('Released', selected['released_at'] == null ? null : fmtDateTime(selected['released_at'])),
          if (str(selected['review_comment']).isNotEmpty) FieldRow('Checker remarks', selected['review_comment']),
          if (str(selected['approval_comment']).isNotEmpty) FieldRow('Approver remarks', selected['approval_comment']),
          if (seeFiles) ...[
            const SizedBox(height: 8),
            const Caps('Files'),
            const SizedBox(height: 6),
            if (jsonList(selected['files']).isEmpty)
              Text(
                  'No files on ${selected['revision_label']} yet.${isOpenSelected && _can('manage_files') ? ' Upload the controlled PDF and the CAD source below.' : ''}',
                  style: const TextStyle(fontSize: 13, color: Brand.muted)),
            for (final f in jsonList(selected['files']))
              Container(
                margin: const EdgeInsets.only(bottom: 6),
                padding: const EdgeInsets.fromLTRB(12, 8, 4, 8),
                decoration: BoxDecoration(border: Border.all(color: Brand.border), borderRadius: BorderRadius.circular(10)),
                child: Row(children: [
                  Expanded(
                    child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                      Text(str(f['file_name']), style: const TextStyle(fontWeight: FontWeight.w600, color: Brand.heading, fontSize: 13)),
                      Text(
                          '${labelOf(fileRoleLabels, f['file_role'])} · ${formatBytes(f['file_size'])} · ${txt(f['uploaded_by_name'])} · ${fmtDate(f['created_at'])}',
                          style: const TextStyle(fontSize: 11.5, color: Brand.muted)),
                    ]),
                  ),
                  TextButton(onPressed: () => openDesignFile(context, f['id'], str(f['file_name'])), child: const Text('Open')),
                  if (isOpenSelected && _can('manage_files') && removeFiles)
                    IconButton(
                      tooltip: 'Remove',
                      icon: const Icon(Icons.delete_outline_rounded, color: Brand.danger),
                      onPressed: _busy
                          ? null
                          : () => _act(() => Api.delete('/design/revisions/${selected['id']}/files/${f['id']}'), '${f['file_name']} removed.',
                              reset: false),
                    ),
                ]),
              ),
            if (isOpenSelected && _can('manage_files'))
              Align(
                alignment: Alignment.centerLeft,
                child: OutlinedButton.icon(
                    onPressed: _busy ? null : () => _upload(selected),
                    icon: const Icon(Icons.upload_file_rounded),
                    label: const Text('+ Upload files')),
              ),
          ],
        ],
      ]),
      // Revision history
      DetailSection('Revision history (${revs.length})', children: [
        for (final r in revs) _historyRow(r),
      ]),
      if (!viewerOnly && (d['customer_approval_required'] == true || submissions.isNotEmpty))
        DetailSection('Customer submissions', children: [
          if (submissions.isEmpty)
            Text(
                'Not sent to ${str(d['customer_name']).isEmpty ? 'the customer' : d['customer_name']} yet. Once a revision is approved internally, add it to a customer submission under Reviews & Approvals.',
                style: const TextStyle(fontSize: 13, color: Brand.muted)),
          for (final sb in submissions)
            ListTile(
              contentPadding: EdgeInsets.zero,
              onTap: () => openScreen(context, DesignSubmissionDetail(id: asInt(sb['submission_id'])!)),
              title: Text('${sb['submission_number']} · ${txt(sb['revision_label'])}',
                  style: const TextStyle(fontWeight: FontWeight.w700, color: Brand.primaryActive, fontSize: 14)),
              subtitle: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                const SizedBox(height: 4),
                Wrap(spacing: 6, children: [
                  StatusBadge(labelOf(submissionStatusLabels, sb['status'])),
                  StatusBadge(labelOf(customerResponseLabels, sb['response'])),
                ]),
                Text('Sent ${fmtDate(sb['sent_date'])} · Responded ${fmtDate(sb['response_date'])}', style: const TextStyle(fontSize: 12)),
                if (str(sb['response_comment']).isNotEmpty) Text(str(sb['response_comment']), style: const TextStyle(fontSize: 12)),
              ]),
            ),
        ]),
      if (seeWhereUsed)
        DetailSection('Where used', children: [
          if (whereUsed.isEmpty)
            const Text("This drawing isn't referenced on any BOM line yet.", style: TextStyle(fontSize: 13, color: Brand.muted)),
          for (final w in whereUsed)
            ListTile(
              contentPadding: EdgeInsets.zero,
              onTap: () => openScreen(context, DesignBomDetail(id: asInt(w['bom_id'])!)),
              title: Text('${w['bom_number']} · ${w['revision_label']}', style: const TextStyle(fontWeight: FontWeight.w700, color: Brand.primaryActive, fontSize: 14)),
              subtitle: Text(
                  [
                    str(w['bom_title']),
                    'Product: ${txt(w['product_item_label'])}',
                    'Qty: ${txt(w['quantity'])}',
                    [str(w['pm_project_label']), str(w['erp_project_label'])].where((s) => s.isNotEmpty).join(' · '),
                  ].where((s) => s.isNotEmpty).join('\n'),
                  style: const TextStyle(fontSize: 12)),
            ),
        ]),
      if (seeTimeline) _timeline(d, selected),
    ]);
  }

  Widget _historyRow(Json r) {
    final results = jsonList(r['review_results']);
    final notOk = results.where((x) => str(x['result']) == 'not_ok').length;
    final id = asInt(r['id'])!;
    final expanded = _expanded.contains(id);
    final cycles = results.map((x) => asInt(x['cycle']) ?? 0).toSet().toList()..sort();
    return InkWell(
      onTap: () => setState(() => _selectedRevId = id),
      child: Container(
        padding: const EdgeInsets.symmetric(vertical: 8),
        decoration: const BoxDecoration(border: Border(top: BorderSide(color: Color(0x140F172A)))),
        child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          Row(children: [
            Text(str(r['revision_label']), style: const TextStyle(fontWeight: FontWeight.w700, color: Brand.heading)),
            const SizedBox(width: 8),
            docStatusBadge(r['status']),
          ]),
          if (str(r['change_summary']).isNotEmpty || str(r['ecn_number']).isNotEmpty)
            Text('${txt(r['change_summary'])}${str(r['ecn_number']).isEmpty ? '' : ' (${r['ecn_number']})'}', style: const TextStyle(fontSize: 13)),
          Text(
              'Prepared ${txt(r['created_by_name'])} · Checked ${r['reviewed_at'] != null ? txt(r['reviewed_by_name']) : '—'} · '
              'Approved ${r['approved_at'] != null && str(r['status']) != 'draft' ? txt(r['approved_by_name']) : '—'} · Released ${fmtDate(r['released_at'])}'
              '${str(r['released_by_name']).isNotEmpty && r['released_by_name'] != r['approved_by_name'] ? ' by ${r['released_by_name']}' : ''}'
              '${r['superseded_at'] != null ? ' · superseded ${fmtDate(r['superseded_at'])}' : ''}',
              style: const TextStyle(fontSize: 12, color: Brand.muted)),
          if (results.isNotEmpty)
            InkWell(
              onTap: () => setState(() => expanded ? _expanded.remove(id) : _expanded.add(id)),
              child: Padding(
                padding: const EdgeInsets.only(top: 4),
                child: Text(
                    'Checklist: ${results.length} answer${results.length == 1 ? '' : 's'}${notOk > 0 ? ' · $notOk not OK' : ''} ${expanded ? '▴' : '▾'}',
                    style: TextStyle(fontSize: 12, fontWeight: FontWeight.w600, color: notOk > 0 ? Brand.danger : Brand.primaryActive)),
              ),
            ),
          if (expanded)
            for (final cycle in cycles) ...[
              const SizedBox(height: 6),
              Caps(() {
                final rows = results.where((x) => asInt(x['cycle']) == cycle).toList();
                final first = rows.first;
                return 'Check $cycle${str(first['reviewer_name']).isEmpty ? '' : ' · ${first['reviewer_name']}'}'
                    '${first['created_at'] == null ? '' : ' · ${fmtDate(first['created_at'])}'}';
              }()),
              for (final x in results.where((x) => asInt(x['cycle']) == cycle))
                Padding(
                  padding: const EdgeInsets.symmetric(vertical: 2),
                  child: Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
                    StatusBadge(_resultLabels[str(x['result'])] ?? str(x['result']), color: _resultColors[str(x['result'])]),
                    const SizedBox(width: 8),
                    Expanded(
                        child: Text('${x['item_text']}${str(x['remark']).isEmpty ? '' : ' — ${x['remark']}'}',
                            style: const TextStyle(fontSize: 12.5))),
                  ]),
                ),
            ],
        ]),
      ),
    );
  }

  Widget _timeline(Json d, Json? selected) {
    final events = jsonList(d['events']);
    return DetailSection(
      'Timeline',
      action: _can('comment')
          ? TextButton.icon(
              icon: const Icon(Icons.add_comment_outlined, size: 18),
              label: const Text('Comment'),
              onPressed: () async {
                final t = await promptDialog(context,
                    title: selected != null ? 'Comment on ${selected['revision_label']}' : 'Add a comment', label: 'Comment', confirmLabel: 'Post');
                if (t == null || t.isEmpty || !mounted) return;
                await _act(() => Api.post('/design/documents/${d['id']}/comments', data: {'comment': t, 'revision_id': asInt(selected?['id'])}),
                    'Comment added.',
                    reset: false);
              })
          : null,
      children: [
        if (events.isEmpty) const Text('No activity yet.', style: TextStyle(color: Brand.muted)),
        for (final e in events)
          Padding(
            padding: const EdgeInsets.symmetric(vertical: 6),
            child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
              Text.rich(TextSpan(style: const TextStyle(fontSize: 13, color: Brand.body), children: [
                TextSpan(text: str(e['actor_name']).isEmpty ? 'System' : str(e['actor_name']), style: const TextStyle(fontWeight: FontWeight.w700)),
                TextSpan(text: ' ${_eventLabels[str(e['action'])] ?? str(e['action']).replaceAll('_', ' ')}'),
                if (str(e['revision_label']).isNotEmpty) TextSpan(text: ' · ${e['revision_label']}', style: const TextStyle(color: Brand.muted)),
              ])),
              if (str(e['comment']).isNotEmpty) Text(str(e['comment']), style: const TextStyle(fontSize: 12.5, color: Brand.muted)),
              Text(fmtDateTime(e['created_at']), style: const TextStyle(fontSize: 11, color: Brand.muted)),
            ]),
          ),
      ],
    );
  }

  Widget _link(Object? text, VoidCallback onTap) => InkWell(
        onTap: onTap,
        child: Padding(
          padding: const EdgeInsets.symmetric(vertical: 2),
          child: Text(txt(text), style: const TextStyle(color: Brand.primaryActive, fontWeight: FontWeight.w600)),
        ),
      );
}
