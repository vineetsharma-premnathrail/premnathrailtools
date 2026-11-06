import 'package:flutter/material.dart';

import '../../api/api.dart';
import '../../theme.dart';
import '../../ui/app_frame.dart';
import '../../ui/form.dart';
import '../../ui/format.dart';
import '../../ui/widgets.dart';
import 'design_bom_lines.dart';
import 'design_changes.dart';
import 'design_common.dart';
import 'design_documents.dart';
import 'design_requests.dart';

/// BOMs - portal design/boms (Bills of Materials), boms/new and boms/[id].

const bomStatusColors = {
  'draft': Color(0xFF78716C),
  'in_review': Color(0xFF2563EB),
  'in_approval': Color(0xFF7C3AED),
  'released': Color(0xFF16A34A),
  'revising': Color(0xFF0F766E),
  'obsolete': Color(0xFFDC2626),
  'superseded': Color(0xFFA8A29E),
};
Widget bomStatusBadge(Object? s) => StatusBadge(labelOf(bomStatusLabels, s), color: bomStatusColors[str(s)]);
const _openRevLabels = {'draft': 'draft', 'in_review': 'in check', 'in_approval': 'awaiting release'};

const _statusTabs = <(String, String)>[
  ('draft,in_review,in_approval,released,revising', 'Active'),
  ('released,revising', 'Released'),
  ('in_review,in_approval', 'In Workflow'),
  ('draft', 'Draft'),
  ('obsolete', 'Obsolete'),
  ('', 'All'),
];

// ── List ─────────────────────────────────────────────────────────────────────

class DesignBomsTab extends StatefulWidget {
  const DesignBomsTab({super.key});

  @override
  State<DesignBomsTab> createState() => _DesignBomsTabState();
}

class _DesignBomsTabState extends State<DesignBomsTab> {
  final _list = GlobalKey<ApiListViewState>();
  String _status = _statusTabs.first.$1;
  Json _me = const {};

  @override
  void initState() {
    super.initState();
    DesignMe.load().then((m) {
      if (mounted) setState(() => _me = m);
    });
  }

  Future<void> _new() async {
    final id = await showNewBomForm(context);
    if (id != null && mounted) {
      _list.currentState?.reload();
      openScreen(context, DesignBomDetail(id: id));
    }
  }

  @override
  Widget build(BuildContext context) {
    final team = _me.isNotEmpty && DesignMe.role(_me) != 'viewer';
    return Scaffold(
      backgroundColor: Colors.transparent,
      floatingActionButton: team ? CreateFab(label: 'New BOM', onPressed: _new) : null,
      body: ApiListView(
        key: _list,
        searchHint: 'Search by BOM number, title or product item…',
        emptyText: 'No BOMs match these filters.${_status.isNotEmpty ? ' Try the “All” tab.' : ' Use + New BOM to create one.'}',
        header: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
          const PageHeader('Bills of Materials',
              subtitle:
                  'Engineering BOMs — one per product item, revision-controlled like drawings. Released BOMs are what Store and Purchase build from.'),
          Padding(
            padding: const EdgeInsets.symmetric(horizontal: 16),
            child: Wrap(spacing: 8, children: [
              if (team)
                OutlinedButton.icon(
                  icon: const Icon(Icons.fiber_new_outlined, size: 18),
                  label: const Text('New item codes requested'),
                  onPressed: () => openScreen(context, const SubPage(title: 'New item codes requested', body: _NewItemRequests())),
                ),
              OutlinedButton.icon(
                icon: const Icon(Icons.account_tree_outlined, size: 18),
                label: const Text('Where used'),
                onPressed: () => openScreen(context, const SubPage(title: 'Where used', body: _WhereUsed())),
              ),
            ]),
          ),
          ChipRow(children: [
            for (final t in _statusTabs)
              CountChip(t.$2, null, selected: _status == t.$1, onTap: () {
                setState(() => _status = t.$1);
                _list.currentState?.reload();
              }),
          ]),
        ]),
        load: (p, s) => Api.list('/design/boms', query: {'status': _status, 'search': s}),
        itemBuilder: (ctx, b, reload) => RecordCard(
          code: str(b['bom_number']),
          title: str(b['title']),
          subtitle: '${txt(b['product_item_code'])}${str(b['product_item_name']).isEmpty ? '' : ' — ${b['product_item_name']}'}',
          trailing: Padding(padding: const EdgeInsets.only(left: 8), child: bomStatusBadge(b['display_status'])),
          meta: [
            ('Project', txt(b['order_project_display'] ?? b['pm_project_label'] ?? b['erp_project_label'])),
            ('Released Rev', str(b['released_revision_label']).isEmpty ? 'Not released' : '${b['released_revision_label']} · ${fmtDate(b['released_at'])}'),
            if (str(b['open_revision_label']).isNotEmpty)
              (
                'Work in Progress',
                '${b['open_revision_label']} ${_openRevLabels[str(b['open_revision_status'])] ?? ''}'
                    '${str(b['pending_with_name']).isEmpty ? '' : ' · with ${b['pending_with_name']}'}'
              ),
            ('Lines', '${b['line_count'] ?? 0}'),
            ('Owner', txt(b['owner_name'])),
          ],
          onTap: () async {
            await Navigator.of(ctx).push(MaterialPageRoute(builder: (_) => DesignBomDetail(id: asInt(b['id'])!)));
            reload();
          },
        ),
      ),
    );
  }
}

class _NewItemRequests extends StatelessWidget {
  const _NewItemRequests();

  @override
  Widget build(BuildContext context) => ApiListView(
        emptyText: 'No new item codes are waiting on Store.',
        load: (p, s) => Api.list('/design/boms/new-item-requests'),
        itemBuilder: (ctx, r, reload) => RecordCard(
          code: '${r['bom_number']} ${r['revision_label']}',
          title: str(r['new_item_name']),
          subtitle: nullIfEmpty(str(r['new_item_spec'])),
          meta: [('UOM', txt(r['uom'])), ('Requested by', txt(r['requested_by_name'])), ('Requested', fmtDate(r['requested_at']))],
          onTap: () => openScreen(ctx, DesignBomDetail(id: asInt(r['bom_id'])!)),
        ),
      );
}

/// "Where used" finder - an Item Master item or a drawing.
class _WhereUsed extends StatefulWidget {
  const _WhereUsed();

  @override
  State<_WhereUsed> createState() => _WhereUsedState();
}

class _WhereUsedState extends State<_WhereUsed> {
  String _kind = 'item';
  int? _pick;
  String? _pickL;
  Json? _result;
  Object? _error;
  bool _busy = false;

  Future<void> _run(int id) async {
    setState(() => (_busy = true, _error = null, _result = null));
    try {
      final r = jsonMap(await Api.get('/design/where-used', query: _kind == 'item' ? {'store_item_id': id} : {'document_id': id}));
      if (mounted) setState(() => _result = r);
    } catch (e) {
      if (mounted) setState(() => _error = e);
    }
    if (mounted) setState(() => _busy = false);
  }

  @override
  Widget build(BuildContext context) {
    final r = _result;
    return ListView(padding: const EdgeInsets.all(16), children: [
      AppSelect<String>(
          label: 'Look up',
          clearable: false,
          value: _kind,
          options: const [Option('item', 'Item'), Option('drawing', 'Drawing')],
          onChanged: (o) => setState(() => (_kind = o?.value ?? _kind, _pick = null, _pickL = null, _result = null))),
      const SizedBox(height: 12),
      AppSelect<int>(
        key: ValueKey(_kind),
        label: _kind == 'item' ? 'Pick an Item Master item…' : 'Pick a drawing…',
        value: _pick,
        valueLabel: _pickL,
        loadOptions: (s) => _kind == 'item'
            ? designLookup('items', s, query: {'limit': 200}, sendSearch: true)
            : designLookup('documents', s, query: {'limit': 500}, sendSearch: true),
        onChanged: (o) {
          setState(() => (_pick = o?.value, _pickL = o?.label));
          if (o != null) _run(o.value);
        },
      ),
      const SizedBox(height: 12),
      if (_busy) const Text('Searching…', style: TextStyle(color: Brand.muted)),
      if (_error != null) ErrorBanner(ApiClient.describe(_error!)),
      if (r != null) ...[
        Text(str(r['subject']), style: const TextStyle(fontWeight: FontWeight.w700, color: Brand.heading)),
        if (strList(r['projects']).isNotEmpty) Text('Projects: ${strList(r['projects']).join(', ')}', style: const TextStyle(fontSize: 12.5)),
        const SizedBox(height: 8),
        if (jsonList(r['boms']).isEmpty) const Text('Not used in any BOM.', style: TextStyle(color: Brand.muted)),
        for (final w in jsonList(r['boms']))
          ListTile(
            contentPadding: EdgeInsets.zero,
            onTap: () => openScreen(context, DesignBomDetail(id: asInt(w['bom_id'])!)),
            title: Text('${w['bom_number']} · ${w['revision_label']} (${labelOf(bomStatusLabels, w['revision_status'])})',
                style: const TextStyle(fontWeight: FontWeight.w600, color: Brand.primaryActive)),
            subtitle: Text('${w['bom_title']} · Product ${txt(w['product_item_label'])} · Qty ${txt(w['quantity'])}'
                '${[str(w['pm_project_label']), str(w['erp_project_label'])].where((s) => s.isNotEmpty).map((s) => ' · $s').join()}'),
          ),
        for (final d in jsonList(r['drawings']))
          ListTile(
            contentPadding: EdgeInsets.zero,
            onTap: () => openScreen(context, DesignDocumentDetail(id: asInt(d['id'])!)),
            title: Text('Drawing ${d['doc_number']}', style: const TextStyle(fontWeight: FontWeight.w600)),
            subtitle: Text(str(d['title'])),
          ),
        for (final b in jsonList(r['own_boms']))
          ListTile(
            contentPadding: EdgeInsets.zero,
            onTap: () => openScreen(context, DesignBomDetail(id: asInt(b['id'])!)),
            title: Text('Own BOM ${b['bom_number']}', style: const TextStyle(fontWeight: FontWeight.w600)),
            subtitle: Text(str(b['title'])),
          ),
      ],
    ]);
  }
}

// ── New BOM ──────────────────────────────────────────────────────────────────

Future<int?> showNewBomForm(BuildContext context) async {
  final title = TextEditingController();
  final description = TextEditingController();
  int? productId, documentId, projectId, machineId, requestId, reviewerId, approverId;
  String? productL, documentL, projectL, machineL, requestL, reviewerL, approverL;
  final rows = <BomLineDraft>[];
  String? copyMsg;
  int? createdId;
  await showFormSheet(
    context,
    title: 'New Bill of Materials',
    saveLabel: 'Create BOM',
    builder: (ctx, setS) => [
      const InfoNote(
          'One BOM per product item, single level. Sub-assemblies are lines whose item has its own released BOM. It starts as draft R0.'),
      const Caps('Product'),
      AppSelect<int>(
          label: 'Product item (assembly)',
          required: true,
          value: productId,
          valueLabel: productL,
          loadOptions: (s) => designLookup('items', s, query: {'limit': 200}, sendSearch: true),
          onChanged: (o) => setS(() {
                productId = o?.value;
                productL = o?.label;
              })),
      const Caps('Basic Information'),
      AppTextField(label: 'Title', controller: title, required: true, hint: 'e.g. Bogie frame assembly — BOM'),
      AppSelect<int>(
          label: 'GA / assembly drawing',
          value: documentId,
          valueLabel: documentL,
          loadOptions: (s) => designLookup('documents', s, query: {'limit': 500}, sendSearch: true),
          onChanged: (o) => setS(() {
                documentId = o?.value;
                documentL = o?.label;
              })),
      AppTextField(label: 'Description', controller: description, maxLines: 3),
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
      AppSelect<int>(
          label: 'Design request',
          value: requestId,
          valueLabel: requestL,
          loadOptions: designOpenRequests,
          onChanged: (o) => setS(() {
                requestId = o?.value;
                requestL = o?.label;
              })),
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
          label: 'Approved (released) by',
          value: approverId,
          valueLabel: approverL,
          loadOptions: (s) => designUsers(s, excludeMe: true),
          onChanged: (o) => setS(() {
                approverId = o?.value;
                approverL = o?.label;
              })),
      ...bomLinesFields(ctx, setS, rows, extra: [
        AppSelect<int>(
          label: 'Copy lines from another BOM',
          value: null,
          loadOptions: (s) => designLookup('boms', s, query: {'released_only': false}),
          onChanged: (o) async {
            if (o == null) return;
            try {
              final src = jsonMap(await Api.get('/design/boms/${o.value}'));
              final revs = jsonList(src['revisions']);
              final rev = revs.where((r) => asInt(r['id']) == asInt(src['released_revision_id'])).firstOrNull ?? (revs.isEmpty ? null : revs.first);
              final lines = jsonList(rev?['lines']);
              setS(() {
                if (lines.isEmpty) {
                  copyMsg = '${src['bom_number']} has no lines to copy.';
                } else {
                  rows
                    ..clear()
                    ..addAll(lines.map(BomLineDraft.fromLine));
                  copyMsg = '${lines.length} line${lines.length == 1 ? '' : 's'} copied from ${src['bom_number']} ${rev?['revision_label']} — edit them below as needed.';
                }
              });
            } catch (e) {
              setS(() => copyMsg = 'Copying lines from that BOM failed: ${ApiClient.describe(e)}');
            }
          },
        ),
        if (copyMsg != null) Text(copyMsg!, style: const TextStyle(fontSize: 12, color: Brand.muted)),
      ]),
    ],
    onSave: () async {
      if (productId == null) throw 'Pick the product (assembly) item this BOM builds — it must exist in Item Master.';
      if (title.text.trim().length < 2) throw 'Give the BOM a title (at least 2 characters).';
      if (reviewerId != null && reviewerId == approverId) throw 'The checker and the approver must be two different people.';
      final lines = bomDraftsToPayload(rows);
      if (lines.any((l) => l['store_item_id'] == productId)) throw "A BOM can't list its own product item as a line.";
      final out = jsonMap(await Api.post('/design/boms', data: {
        'product_item_id': productId,
        'title': title.text.trim(),
        'description': nullIfEmpty(description.text),
        'document_id': documentId,
        'pm_project_id': projectId,
        'erp_project_id': machineId,
        'design_request_id': requestId,
        'reviewer_id': reviewerId,
        'approver_id': approverId,
        'lines': lines,
      }));
      createdId = asInt(out['id']);
    },
  );
  return createdId;
}

// ── Detail ───────────────────────────────────────────────────────────────────

const _openStatuses = ['draft', 'in_review', 'in_approval'];
const _resultLabels = {'ok': 'OK', 'not_ok': 'Not OK', 'na': 'N/A'};

class DesignBomDetail extends StatefulWidget {
  const DesignBomDetail({super.key, required this.id});
  final int id;

  @override
  State<DesignBomDetail> createState() => _DesignBomDetailState();
}

class _DesignBomDetailState extends State<DesignBomDetail> {
  Json? _bom;
  Object? _error;
  bool _busy = false;
  int? _selectedRevId;
  List<Json>? _explosion;
  bool _explosionOpen = false;
  int _approvalKey = 0;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    try {
      final d = jsonMap(await Api.get('/design/boms/${widget.id}'));
      if (mounted) _apply(d);
    } catch (e) {
      if (mounted) setState(() => _error = e);
    }
  }

  void _apply(Json d, {bool reset = false}) {
    setState(() {
      _bom = d;
      _error = null;
      _approvalKey++;
      _explosion = null;
      final revs = jsonList(d['revisions']);
      if (reset || _selectedRevId == null || !revs.any((r) => asInt(r['id']) == _selectedRevId)) {
        _selectedRevId = asInt(_openRev(d)?['id']) ?? asInt(d['released_revision_id']) ?? (revs.isEmpty ? null : asInt(revs.first['id']));
      }
    });
  }

  Json? _openRev(Json d) => jsonList(d['revisions']).where((r) => _openStatuses.contains(str(r['status']))).firstOrNull;

  bool _can(String a) => strList(_bom?['allowed_actions']).contains(a);

  String _ref(Json? rev) => '${_bom?['bom_number']} ${rev?['revision_label'] ?? ''}'.trim();

  Future<void> _act(Future<dynamic> Function() fn, String done, {bool reset = true}) async {
    setState(() => _busy = true);
    Json? out;
    final ok = await runAction(context, () async {
      final r = await fn();
      if (r is Map) out = jsonMap(r);
    }, success: done);
    if (!mounted) return;
    setState(() => _busy = false);
    if (ok) {
      if (out != null && out!.containsKey('bom_number')) {
        _apply(out!, reset: reset);
      } else {
        _load();
      }
    }
  }

  Future<void> _prompt(String which) async {
    final b = _bom!;
    final rev = _openRev(b);
    final (title, message, label, required) = switch (which) {
      'approve_pass' => (
          'Release this BOM revision',
          'It becomes the controlled BOM. Drawing revisions on every line are frozen into it, and any previously released revision is superseded.',
          'Release',
          false
        ),
      'approve_return' => ('Return to author', 'The revision goes back to draft. Say exactly what needs fixing.', 'Return', true),
      _ => ('Mark BOM obsolete', 'The BOM is withdrawn from use. Its revisions stay on record.', 'Mark Obsolete', true),
    };
    final v = await promptDialog(context,
        title: title,
        message: '${which == 'obsolete' ? b['bom_number'] : _ref(rev)} — $message',
        label: which == 'approve_pass' ? 'Release remarks' : (which == 'obsolete' ? 'Reason' : 'What needs fixing'),
        required: required,
        confirmLabel: label);
    if (v == null || !mounted) return;
    switch (which) {
      case 'approve_pass':
        await _act(() => Api.post('/design/boms/revisions/${rev?['id']}/approve', data: {'decision': 'pass', 'comment': nullIfEmpty(v)}),
            '${_ref(rev)} released — it is now the controlled BOM.');
      case 'approve_return':
        await _act(() => Api.post('/design/boms/revisions/${rev?['id']}/approve', data: {'decision': 'return', 'comment': v}),
            '${_ref(rev)} returned to ${rev?['created_by_name'] ?? 'the author'}.');
      default:
        await _act(() => Api.post('/design/boms/${b['id']}/obsolete', data: {'reason': v}), '${b['bom_number']} marked obsolete.');
    }
  }

  Future<void> _confirm(String which) async {
    final b = _bom!;
    final rev = _openRev(b);
    final (title, message, label) = switch (which) {
      'recall' => ('Recall to draft?', '${_ref(rev)} goes back to draft; the checker/approver is told no action is needed.', 'Recall'),
      'discard' => ('Discard this draft revision?', 'Draft ${rev?['revision_label']} and its lines are removed.', 'Discard'),
      'delete' => ('Delete this BOM?', "${b['bom_number']} has never been released, so it will be deleted. This can't be undone.", 'Delete'),
      _ => ('Reactivate this BOM?', '${b['bom_number']} becomes active again and can be revised.', 'Reactivate'),
    };
    if (!await confirmDialog(context, title: title, message: message, confirmLabel: label, danger: which == 'discard' || which == 'delete') || !mounted) {
      return;
    }
    switch (which) {
      case 'recall':
        await _act(() => Api.post('/design/boms/revisions/${rev?['id']}/recall'), '${_ref(rev)} recalled to draft.');
      case 'discard':
        await _act(() => Api.delete('/design/boms/revisions/${rev?['id']}'), 'Draft ${rev?['revision_label']} discarded.');
      case 'reactivate':
        await _act(() => Api.post('/design/boms/${b['id']}/reactivate'), '${b['bom_number']} is active again.');
      default:
        setState(() => _busy = true);
        final done = await runAction(context, () => Api.delete('/design/boms/${b['id']}'), success: '${b['bom_number']} deleted.');
        if (!mounted) return;
        setState(() => _busy = false);
        if (done) Navigator.of(context).pop();
    }
  }

  Future<void> _submit() async {
    final rev = _openRev(_bom!)!;
    int? reviewerId = asInt(rev['reviewer_id']), approverId = asInt(rev['approver_id']);
    String? reviewerL = nullIfEmpty(str(rev['reviewer_name'])), approverL = nullIfEmpty(str(rev['approver_name']));
    final note = TextEditingController();
    final saved = await showFormSheet(context, title: 'Submit ${rev['revision_label']} for check', saveLabel: 'Submit', builder: (ctx, setS) => [
          InfoNote('${_bom!['bom_number']} — the checker reviews the lines, then the approver releases it.'),
          const Caps('Signatories'),
          AppSelect<int>(
              label: 'Checked by',
              required: true,
              value: reviewerId,
              valueLabel: reviewerL,
              loadOptions: (s) => designUsers(s, excludeMe: true),
              onChanged: (o) => setS(() {
                    reviewerId = o?.value;
                    reviewerL = o?.label;
                  })),
          AppSelect<int>(
              label: 'Approved (released) by',
              required: true,
              value: approverId,
              valueLabel: approverL,
              loadOptions: (s) => designUsers(s, excludeMe: true),
              onChanged: (o) => setS(() {
                    approverId = o?.value;
                    approverL = o?.label;
                  })),
          AppTextField(label: 'Note', controller: note, hint: 'Optional'),
        ], onSave: () async {
      if (reviewerId == null || approverId == null) throw 'Name both a checker and an approver before submitting.';
      if (reviewerId == approverId) throw 'The checker and the approver must be two different people.';
      final out = await Api.post('/design/boms/revisions/${rev['id']}/submit',
          data: {'reviewer_id': reviewerId, 'approver_id': approverId, 'comment': nullIfEmpty(note.text)});
      if (mounted && out is Map) _apply(jsonMap(out), reset: true);
    });
    if (saved && mounted) showSnack(context, '${_ref(rev)} submitted — the checker has been notified.');
  }

  Future<void> _review() async {
    final b = _bom!;
    final rev = _openRev(b)!;
    final cl = b['checklist'] is Map ? jsonMap(b['checklist']) : null;
    final items = jsonList(cl?['items']);
    final answers = <int, String>{};
    final remarks = {for (final it in items) asInt(it['id'])!: TextEditingController()};
    final comment = TextEditingController();
    String decision = 'pass';
    final saved = await showFormSheet(context, title: 'Check ${_ref(rev)}', saveLabel: 'Save check', builder: (ctx, setS) => [
          InfoNote(cl != null
              ? 'Checklist “${cl['name']}” — answer every item. Any “Not OK” means the revision must be returned.'
              : 'No BOM checklist is set up in the Library — check the lines and record your remarks.'),
          if (cl != null) const Caps('Checklist'),
          for (var i = 0; i < items.length; i++)
            Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
              Text('${i + 1}. ${items[i]['text']}'),
              Wrap(spacing: 6, children: [
                for (final res in const ['ok', 'not_ok', 'na'])
                  ChoiceChip(
                      label: Text(_resultLabels[res]!),
                      selected: answers[asInt(items[i]['id'])] == res,
                      onSelected: (_) => setS(() => answers[asInt(items[i]['id'])!] = res)),
              ]),
              AppTextField(label: 'Remark', controller: remarks[asInt(items[i]['id'])], hint: 'Optional'),
            ]),
          const Caps('Remarks'),
          AppTextField(label: 'What you checked / what needs fixing…', controller: comment, maxLines: 3),
          AppSelect<String>(
              label: 'Decision',
              required: true,
              clearable: false,
              value: decision,
              options: const [Option('pass', 'Pass Check'), Option('return', 'Return to Author')],
              onChanged: (o) => setS(() => decision = o?.value ?? decision)),
        ], onSave: () async {
      final list = <Map<String, dynamic>>[];
      for (final it in items) {
        final a = answers[asInt(it['id'])];
        if (a == null) throw 'Answer every checklist item (OK / Not OK / N/A) — “${it['text']}” is not answered.';
        list.add({'checklist_item_id': asInt(it['id']), 'result': a, 'remark': nullIfEmpty(remarks[asInt(it['id'])]!.text)});
      }
      if (decision == 'pass' && list.any((a) => a['result'] == 'not_ok')) {
        throw "A check with any “Not OK” item can't pass — return it to the author with what needs fixing.";
      }
      if (decision == 'return' && comment.text.trim().isEmpty) throw 'Say what needs fixing — the author sees your comment.';
      final out = await Api.post('/design/boms/revisions/${rev['id']}/review',
          data: {'decision': decision, 'comment': nullIfEmpty(comment.text), 'checklist': list});
      if (mounted && out is Map) _apply(jsonMap(out), reset: true);
    });
    if (saved && mounted) {
      showSnack(
          context,
          decision == 'pass'
              ? '${_ref(rev)} checked — sent to ${rev['approver_name'] ?? 'the approver'} for release.'
              : '${_ref(rev)} returned to ${rev['created_by_name'] ?? 'the author'}.');
    }
  }

  List<Option<int>> _ecns() => [
        for (final e in jsonList(_bom!['open_ecns']))
          if (asInt(e['id']) != null) Option<int>(asInt(e['id'])!, '${e['ecn_number']} — ${str(e['title'])}'),
      ];

  Future<void> _newRevision() async {
    final b = _bom!;
    final summary = TextEditingController();
    int? ecnId, reviewerId, approverId;
    String? reviewerL, approverL;
    final saved = await showFormSheet(context, title: 'Start a new revision', saveLabel: 'Start Revision', builder: (ctx, setS) => [
          InfoNote('${b['bom_number']} — the new draft starts with the released lines; change them in “Edit revision”.'),
          const Caps('Change'),
          AppTextField(
              label: 'Change summary', controller: summary, required: true, maxLines: 3, hint: 'e.g. Fastener changed M12 → M16 per ECN-2026-0007'),
          if (_ecns().isNotEmpty) AppSelect<int>(label: 'Under change notice', value: ecnId, options: _ecns(), onChanged: (o) => setS(() => ecnId = o?.value)),
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
              label: 'Approved (released) by',
              value: approverId,
              valueLabel: approverL,
              loadOptions: (s) => designUsers(s),
              onChanged: (o) => setS(() {
                    approverId = o?.value;
                    approverL = o?.label;
                  })),
        ], onSave: () async {
      if (summary.text.trim().length < 3) throw 'Describe what is changing and why (the change summary is on the revision record).';
      if (reviewerId != null && reviewerId == approverId) throw 'The checker and the approver must be two different people.';
      final out = await Api.post('/design/boms/${b['id']}/revisions',
          data: {'change_summary': summary.text.trim(), 'reviewer_id': reviewerId, 'approver_id': approverId, 'ecn_id': ecnId});
      if (mounted && out is Map) _apply(jsonMap(out), reset: true);
    });
    if (saved && mounted) showSnack(context, 'New revision started.');
  }

  Future<void> _editRevision(Json rev) async {
    final summary = TextEditingController(text: str(rev['change_summary']));
    int? ecnId = asInt(rev['ecn_id']), reviewerId = asInt(rev['reviewer_id']), approverId = asInt(rev['approver_id']);
    String? reviewerL = nullIfEmpty(str(rev['reviewer_name'])), approverL = nullIfEmpty(str(rev['approver_name']));
    final rows = [for (final l in jsonList(rev['lines'])) BomLineDraft.fromLine(l)]
      ..sort((a, b) => (int.tryParse(a.position) ?? 0).compareTo(int.tryParse(b.position) ?? 0));
    final saved = await showFormSheet(context, title: 'Edit ${rev['revision_label']}', builder: (ctx, setS) => [
          const Caps('Change'),
          AppTextField(label: 'Change summary', controller: summary, maxLines: 3),
          AppSelect<int>(
              label: 'Under change notice', value: ecnId, valueLabel: nullIfEmpty(str(rev['ecn_number'])), options: _ecns(), onChanged: (o) => setS(() => ecnId = o?.value)),
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
              label: 'Approved (released) by',
              value: approverId,
              valueLabel: approverL,
              loadOptions: (s) => designUsers(s),
              onChanged: (o) => setS(() {
                    approverId = o?.value;
                    approverL = o?.label;
                  })),
          ...bomLinesFields(ctx, setS, rows),
        ], onSave: () async {
      if (reviewerId != null && reviewerId == approverId) throw 'The checker and the approver must be two different people.';
      final lines = bomDraftsToPayload(rows);
      if (lines.any((l) => l['store_item_id'] == asInt(_bom!['product_item_id']))) throw "A BOM can't list its own product item as a line.";
      final out = await Api.patch('/design/boms/revisions/${rev['id']}', data: {
        'change_summary': summary.text.trim(),
        'reviewer_id': reviewerId,
        'approver_id': approverId,
        'ecn_id': ecnId,
        'lines': lines,
      });
      if (mounted && out is Map) _apply(jsonMap(out));
    });
    if (saved && mounted) showSnack(context, '${rev['revision_label']} saved.');
  }

  Future<void> _editHeader() async {
    final b = _bom!;
    final title = TextEditingController(text: str(b['title']));
    final description = TextEditingController(text: str(b['description']));
    int? documentId = asInt(b['document_id']), projectId = asInt(b['pm_project_id']), machineId = asInt(b['erp_project_id']);
    int? requestId = asInt(b['design_request_id']), ownerId = asInt(b['owner_id']);
    String? documentL = nullIfEmpty(str(b['doc_number'])), projectL = nullIfEmpty(str(b['pm_project_label']));
    String? machineL = nullIfEmpty(str(b['erp_project_label'])), requestL = nullIfEmpty(str(b['request_number'])), ownerL = nullIfEmpty(str(b['owner_name']));
    final saved = await showFormSheet(context, title: 'Edit BOM details', builder: (ctx, setS) => [
          InfoNote("${b['bom_number']} — the product item can't change; a different product needs its own BOM."),
          const Caps('Basic Information'),
          AppTextField(label: 'Title', controller: title, required: true),
          AppSelect<int>(
              label: 'GA / assembly drawing',
              value: documentId,
              valueLabel: documentL,
              loadOptions: (s) => designLookup('documents', s, query: {'limit': 500}, sendSearch: true),
              onChanged: (o) => setS(() {
                    documentId = o?.value;
                    documentL = o?.label;
                  })),
          AppTextField(label: 'Description', controller: description, maxLines: 3),
          AppSelect<int>(
              label: 'Owner',
              value: ownerId,
              valueLabel: ownerL,
              loadOptions: (s) => designUsers(s),
              onChanged: (o) => setS(() {
                    ownerId = o?.value;
                    ownerL = o?.label;
                  })),
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
          AppSelect<int>(
              label: 'Design request',
              value: requestId,
              valueLabel: requestL,
              loadOptions: designOpenRequests,
              onChanged: (o) => setS(() {
                    requestId = o?.value;
                    requestL = o?.label;
                  })),
        ], onSave: () async {
      if (title.text.trim().length < 2) throw 'The title needs at least 2 characters.';
      final out = await Api.patch('/design/boms/${b['id']}', data: {
        'title': title.text.trim(),
        'description': nullIfEmpty(description.text),
        'document_id': documentId,
        'pm_project_id': projectId,
        'erp_project_id': machineId,
        'design_request_id': requestId,
        'owner_id': ownerId,
      });
      if (mounted && out is Map) _apply(jsonMap(out));
    });
    if (saved && mounted) showSnack(context, 'Details saved.');
  }

  Future<void> _toggleExplosion() async {
    if (_explosionOpen) {
      setState(() => _explosionOpen = false);
      return;
    }
    setState(() => _explosionOpen = true);
    if (_explosion != null) return;
    try {
      final rows = (await Api.list('/design/boms/${_bom!['id']}/explosion', query: {'revision_id': _selectedRevId})).rows;
      if (mounted) setState(() => _explosion = rows);
    } catch (e) {
      if (mounted) {
        showSnack(context, ApiClient.describe(e), error: true);
        setState(() => _explosionOpen = false);
      }
    }
  }

  List<DAction> _actions(Json b) {
    final rev = _openRev(b);
    final label = str(rev?['revision_label']);
    final engine = b['approval_engine'] == true;
    final selected = jsonList(b['revisions']).where((r) => asInt(r['id']) == _selectedRevId).firstOrNull;
    return [
      if (_can('submit') && str(rev?['status']) == 'draft') DAction('Submit $label for Check', _submit, primary: true),
      if (_can('review')) DAction('Check $label', _review, primary: true),
      if (_can('approve') && !engine) DAction('Release $label', () => _prompt('approve_pass'), primary: true),
      if (_can('approve') && !engine) DAction('Return to Author', () => _prompt('approve_return'), danger: true),
      if (_can('recall')) DAction('Recall to Draft', () => _confirm('recall')),
      if (_can('new_revision')) DAction('+ New Revision', _newRevision, primary: true),
      if (_can('discard_revision')) DAction('Discard $label', () => _confirm('discard'), danger: true),
      if (_can('export'))
        DAction(
            'Export ${selected?['revision_label'] ?? ''} (CSV)',
            () => openApiFile(context, '/design/boms/${b['id']}/export', '${b['bom_number']}_${selected?['revision_label'] ?? ''}.csv',
                query: {'revision_id': _selectedRevId})),
      if (_can('raise_ecr') && b['released_revision_id'] != null)
        DAction('Raise ECR', () async {
          if (await showCreateEcrForm(context, bomId: asInt(b['id'])) && mounted) _load();
        }),
      if (_can('obsolete')) DAction('Mark Obsolete', () => _prompt('obsolete'), danger: true),
      if (_can('reactivate')) DAction('Reactivate', () => _confirm('reactivate')),
      if (_can('delete')) DAction('Delete BOM', () => _confirm('delete'), danger: true),
      if (_can('edit')) DAction('Edit details', _editHeader),
    ];
  }

  @override
  Widget build(BuildContext context) {
    final b = _bom;
    return SubPage(
      title: b == null ? 'BOM' : str(b['bom_number']),
      bottom: b == null ? null : actionBar(context, _actions(b), busy: _busy),
      body: b == null ? (_error != null ? ErrorView(_error!, onRetry: _load) : const LoadingView()) : RefreshIndicator(onRefresh: _load, child: _body(b)),
    );
  }

  Widget _link(String text, VoidCallback onTap) =>
      InkWell(onTap: onTap, child: Text(text, style: const TextStyle(color: Brand.primaryActive, fontWeight: FontWeight.w600)));

  Widget _body(Json b) {
    final revs = jsonList(b['revisions']);
    final selected = revs.where((r) => asInt(r['id']) == _selectedRevId).firstOrNull;
    final openRev = _openRev(b);
    final isOpenSelected = selected != null && openRev != null && asInt(selected['id']) == asInt(openRev['id']);
    final lines = jsonList(selected?['lines'])..sort((x, y) => (asInt(x['position']) ?? 0).compareTo(asInt(y['position']) ?? 0));
    final blockers = lines.where((l) => str(l['release_blocker']).isNotEmpty).length;
    final whereUsed = jsonList(b['where_used']);
    final events = jsonList(b['events']);
    return ListView(padding: const EdgeInsets.only(top: 12, bottom: 24), children: [
      if (str(b['status']) == 'obsolete')
        Padding(padding: const EdgeInsets.fromLTRB(16, 0, 16, 12), child: ErrorBanner('Obsolete — not for use. ${txt(b['obsolete_reason'])}')),
      if (b['viewer_only'] == true)
        const Padding(
          padding: EdgeInsets.fromLTRB(16, 0, 16, 12),
          child: InfoNote("You're viewing released revisions only. Drafts and revisions in check are visible to the Design team. To ask for a change, raise an ECR."),
        ),
      DetailSection(str(b['title']), children: [
        if (str(b['description']).isNotEmpty) Text(str(b['description'])),
        const SizedBox(height: 6),
        Wrap(spacing: 8, runSpacing: 6, crossAxisAlignment: WrapCrossAlignment.center, children: [
          bomStatusBadge(b['display_status']),
          Text('Released ${str(b['released_revision_label']).isEmpty ? 'none yet' : b['released_revision_label']}', style: const TextStyle(fontSize: 12.5, color: Brand.muted)),
          if (str(b['open_revision_label']).isNotEmpty)
            Text('${b['open_revision_label']} ${_openRevLabels[str(b['open_revision_status'])] ?? ''}${str(b['pending_with_name']).isEmpty ? '' : ' with ${b['pending_with_name']}'}',
                style: const TextStyle(fontSize: 12.5, color: Brand.muted)),
          Text('Owner ${txt(b['owner_name'])}', style: const TextStyle(fontSize: 12.5, color: Brand.muted)),
        ]),
      ]),
      DetailSection('What it builds', children: [
        FieldRow('Product item',
            str(b['product_item_code']).isEmpty ? null : '${b['product_item_code']}${str(b['product_item_name']).isEmpty ? '' : ' — ${b['product_item_name']}'}'),
        FieldRow('GA / assembly drawing',
            b['document_id'] == null ? null : _link(txt(b['doc_number']), () => openScreen(context, DesignDocumentDetail(id: asInt(b['document_id'])!)))),
      ]),
      DetailSection('Linked to', children: [
        if (str(b['order_project_display']).isNotEmpty) FieldRow('Project', b['order_project_display']),
        FieldRow('Project', b['pm_project_label']),
        FieldRow('Machine', b['erp_project_label']),
        FieldRow('Design request',
            b['design_request_id'] == null ? null : _link(txt(b['request_number']), () => openScreen(context, DesignRequestDetail(id: asInt(b['design_request_id'])!)))),
        if (jsonList(b['open_ecns']).isNotEmpty)
          FieldRow(
              'Open change notices',
              Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                for (final e in jsonList(b['open_ecns']))
                  _link('${e['ecn_number']} — ${str(e['title'])}', () => openScreen(context, DesignChangeNoticeDetail(id: asInt(e['id'])!))),
              ])),
      ]),
      if (b['viewer_only'] != true)
        DesignApprovalPanel(
            key: ValueKey('ap$_approvalKey'), entityType: 'design_bom', entityId: asInt(b['id'])!, title: 'Check & release approval', onChanged: _load),
      DetailSection('Revision', children: [
        Wrap(spacing: 6, runSpacing: 6, children: [
          for (final r in revs)
            ChoiceChip(
              label: Text(str(r['revision_label'])),
              selected: asInt(r['id']) == _selectedRevId,
              onSelected: (_) => setState(() => (_selectedRevId = asInt(r['id']), _explosion = null, _explosionOpen = false)),
            ),
        ]),
        if (selected != null) ...[
          const SizedBox(height: 8),
          Wrap(spacing: 8, crossAxisAlignment: WrapCrossAlignment.center, children: [
            Text(str(selected['revision_label']), style: const TextStyle(fontSize: 18, fontWeight: FontWeight.w700, color: Brand.heading)),
            bomStatusBadge(selected['status']),
            if ((asInt(selected['returned_count']) ?? 0) > 0)
              Text('returned ${selected['returned_count']}×', style: const TextStyle(fontSize: 12, color: Color(0xFFB45309))),
            if (str(selected['ecn_number']).isNotEmpty)
              _link('under ${selected['ecn_number']}', () => openScreen(context, DesignChangeNoticeDetail(id: asInt(selected['ecn_id'])!))),
            if (isOpenSelected && _can('edit_revision') && str(openRev['status']) == 'draft')
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
              'Released by',
              selected['released_at'] != null
                  ? '${txt(selected['approved_by_name'])} · ${fmtDateTime(selected['released_at'])}'
                  : '${str(selected['approver_name']).isEmpty ? 'Not named yet' : selected['approver_name']} (pending)'),
          if (str(selected['review_comment']).isNotEmpty) FieldRow('Checker remarks', selected['review_comment']),
          if (str(selected['approval_comment']).isNotEmpty) FieldRow('Approver remarks', selected['approval_comment']),
        ],
      ]),
      if (selected != null)
        DetailSection('Lines (${lines.length})', children: [
          if (isOpenSelected && blockers > 0)
            ErrorBanner('$blockers line(s) block release — fix them before the approver can release ${selected['revision_label']}.'),
          if (lines.isEmpty) const Text('No lines on this revision.', style: TextStyle(color: Brand.muted)),
          for (final l in lines)
            Container(
              padding: const EdgeInsets.symmetric(vertical: 8),
              decoration: const BoxDecoration(border: Border(top: BorderSide(color: Color(0x140F172A)))),
              child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                Text(
                    '${l['position']}. ${l['store_item_id'] != null ? '${txt(l['item_code'])} — ${txt(l['item_name'])}' : '${txt(l['new_item_name'])} (new item code requested)'}',
                    style: const TextStyle(fontWeight: FontWeight.w600, color: Brand.heading, fontSize: 13.5)),
                if (str(l['new_item_spec']).isNotEmpty) Text(str(l['new_item_spec']), style: const TextStyle(fontSize: 12)),
                Text(
                    'Qty ${txt(l['quantity'])} ${str(l['uom'])} · ${str(l['make_buy']) == 'make' ? 'Make' : 'Buy'}'
                    '${str(l['doc_number']).isEmpty ? '' : ' · ${l['doc_number']} ${const ['released', 'superseded'].contains(str(selected['status'])) ? str(l['document_revision_label'] ?? l['current_drawing_revision']) : str(l['current_drawing_revision'])}'}'
                    '${strList(l['approved_makes']).isEmpty ? '' : ' · Makes: ${strList(l['approved_makes']).join(', ')}'}'
                    '${str(l['remarks']).isEmpty ? '' : ' · ${l['remarks']}'}',
                    style: const TextStyle(fontSize: 12, color: Brand.muted)),
                if (l['sub_bom_id'] != null)
                  _link('Sub-assembly ${l['sub_bom_number']}', () => openScreen(context, DesignBomDetail(id: asInt(l['sub_bom_id'])!))),
                if (str(l['release_blocker']).isNotEmpty)
                  Text('⚠ ${l['release_blocker']}', style: const TextStyle(fontSize: 11.5, color: Brand.danger, fontWeight: FontWeight.w600)),
              ]),
            ),
        ]),
      if (selected != null && designFeature('boms', 'explosion', 'view'))
        DetailSection('Multi-level explosion', action: TextButton(onPressed: _toggleExplosion, child: Text(_explosionOpen ? 'Hide' : 'Show')), children: [
          if (_explosionOpen && _explosion == null) const Text('Loading…', style: TextStyle(color: Brand.muted)),
          if (_explosionOpen && _explosion != null)
            for (final x in _explosion!)
              Padding(
                padding: EdgeInsets.only(left: 12.0 * ((asInt(x['level']) ?? 1) - 1), top: 4, bottom: 4),
                child: Text(
                    'L${x['level']} · ${x['store_item_id'] != null ? '${txt(x['item_code'])} — ${txt(x['item_name'])}' : txt(x['new_item_name'])}'
                    ' · ${txt(x['quantity'])} / assy · total ${txt(x['total_quantity'])} ${str(x['uom'])} · ${str(x['make_buy']) == 'make' ? 'Make' : 'Buy'}'
                    '${str(x['doc_number']).isEmpty ? '' : ' · ${x['doc_number']} ${str(x['drawing_revision'])}'}${str(x['bom_number']).isEmpty ? '' : ' · ${x['bom_number']}'}',
                    style: const TextStyle(fontSize: 12.5)),
              ),
        ]),
      DetailSection('Revision history (${revs.length})', children: [
        for (final r in revs)
          InkWell(
            onTap: () => setState(() => _selectedRevId = asInt(r['id'])),
            child: Padding(
              padding: const EdgeInsets.symmetric(vertical: 6),
              child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                Row(children: [
                  Text(str(r['revision_label']), style: const TextStyle(fontWeight: FontWeight.w700)),
                  const SizedBox(width: 8),
                  bomStatusBadge(r['status']),
                  const SizedBox(width: 8),
                  Text('${r['line_count'] ?? jsonList(r['lines']).length} lines', style: const TextStyle(fontSize: 12, color: Brand.muted)),
                ]),
                if (str(r['change_summary']).isNotEmpty) Text(str(r['change_summary']), style: const TextStyle(fontSize: 12.5)),
                Text(
                    'Prepared ${txt(r['created_by_name'])} · Checked ${r['reviewed_at'] != null ? txt(r['reviewed_by_name']) : '—'} · Released ${fmtDate(r['released_at'])}',
                    style: const TextStyle(fontSize: 12, color: Brand.muted)),
              ]),
            ),
          ),
      ]),
      if (designFeature('boms', 'where_used', 'view'))
        DetailSection('Where used', children: [
          if (whereUsed.isEmpty) Text("${str(b['product_item_code']).isEmpty ? 'This product' : b['product_item_code']} isn't a line on any other BOM.", style: const TextStyle(fontSize: 13, color: Brand.muted)),
          for (final w in whereUsed)
            ListTile(
              contentPadding: EdgeInsets.zero,
              onTap: () => openScreen(context, DesignBomDetail(id: asInt(w['bom_id'])!)),
              title: Text('${w['bom_number']} · ${w['revision_label']}', style: const TextStyle(fontWeight: FontWeight.w700, color: Brand.primaryActive)),
              subtitle: Text('${w['bom_title']} · Qty ${txt(w['quantity'])}'),
            ),
        ]),
      if (designFeature('boms', 'timeline', 'view'))
        DetailSection(
          'Timeline',
          action: _can('comment')
              ? TextButton.icon(
                  icon: const Icon(Icons.add_comment_outlined, size: 18),
                  label: const Text('Comment'),
                  onPressed: () async {
                    final t = await promptDialog(context, title: 'Add a comment', label: 'Comment', confirmLabel: 'Post');
                    if (t == null || t.isEmpty || !mounted) return;
                    await _act(() => Api.post('/design/boms/${b['id']}/comments', data: {'comment': t}), 'Comment added.', reset: false);
                  })
              : null,
          children: [
            if (events.isEmpty) const Text('No activity yet.', style: TextStyle(color: Brand.muted)),
            for (final ev in events)
              Padding(
                padding: const EdgeInsets.symmetric(vertical: 6),
                child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                  Text.rich(TextSpan(style: const TextStyle(fontSize: 13), children: [
                    TextSpan(text: str(ev['actor_name']).isEmpty ? 'System' : str(ev['actor_name']), style: const TextStyle(fontWeight: FontWeight.w700)),
                    TextSpan(text: ' ${str(ev['action']).replaceAll('_', ' ')}'),
                    if (str(ev['revision_label']).isNotEmpty) TextSpan(text: ' · ${ev['revision_label']}', style: const TextStyle(color: Brand.muted)),
                  ])),
                  if (str(ev['comment']).isNotEmpty) Text(str(ev['comment']), style: const TextStyle(fontSize: 12.5, color: Brand.muted)),
                  Text(fmtDateTime(ev['created_at']), style: const TextStyle(fontSize: 11, color: Brand.muted)),
                ]),
              ),
          ],
        ),
    ]);
  }
}
