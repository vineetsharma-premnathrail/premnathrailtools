import 'package:dio/dio.dart' show FormData, MultipartFile;
import 'package:flutter/material.dart';

import '../../api/api.dart';
import '../../theme.dart';
import '../../ui/files.dart';
import '../../ui/form.dart';
import '../../ui/format.dart';
import '../../ui/perms.dart';
import '../../ui/widgets.dart';
import 'hyd_common.dart';

// ── Documents (portal components/hydraulic/HydDocumentsPanel.tsx) ────────────

/// entity → the tab whose Documents feature governs its files.
const _editTab = {'system': 'systems', 'component': 'components', 'circuit': 'circuits', 'test': 'testing'};

String _fmtSize(Object? n) {
  final v = toNum(n);
  if (v == null) return '';
  if (v < 1024 * 1024) return '${(v / 1024).round().clamp(1, 1 << 30)} KB';
  return '${(v / 1024 / 1024).toStringAsFixed(1)} MB';
}

/// Files attached to one record (system, component, circuit revision, test).
class HydDocumentsPanel extends StatefulWidget {
  const HydDocumentsPanel({
    super.key,
    required this.entityType,
    required this.entityId,
    this.title = 'Documents',
    this.defaultDocType = 'other',
    this.readOnly = false,
    this.readOnlyNote,
    this.onCount,
  });

  final String entityType;
  final int entityId;
  final String title;
  final String defaultDocType;
  final bool readOnly;
  final String? readOnlyNote;
  final ValueChanged<int>? onCount;

  @override
  State<HydDocumentsPanel> createState() => _HydDocumentsPanelState();
}

class _HydDocumentsPanelState extends State<HydDocumentsPanel> {
  List<Json>? _docs;
  Object? _error;

  String? get _tab => _editTab[widget.entityType];
  bool get _hidden => _tab != null && hydCan(_tab!, 'view') && !hydCanFeature(_tab!, 'documents', 'view');
  bool get _canAdd => _tab != null && hydCanFeature(_tab!, 'documents', 'create');
  bool get _canRemove => _tab != null && hydCanFeature(_tab!, 'documents', 'delete');
  bool get _locked => widget.readOnly || _tab == null || (!_canAdd && !_canRemove);

  @override
  void initState() {
    super.initState();
    if (!_hidden) _load();
  }

  Future<void> _load() async {
    try {
      final rows = rowsOf(await Api.get('/hydraulic/documents',
          query: {'entity_type': widget.entityType, 'entity_id': widget.entityId}));
      if (!mounted) return;
      setState(() {
        _docs = rows;
        _error = null;
      });
      widget.onCount?.call(rows.length);
    } catch (e) {
      if (mounted) setState(() => _error = e);
    }
  }

  Future<void> _upload() async {
    var title = '';
    var docType = widget.defaultDocType;
    var description = '';
    var files = <MultipartFile>[];
    final ok = await showFormSheet(
      context,
      title: 'Upload to ${widget.title}',
      saveLabel: 'Upload',
      builder: (ctx, setS) => [
        const Hint('Files are stored in SharePoint against this record.'),
        AppTextField(label: 'Title', required: true, initialValue: title, onChanged: (v) => title = v,
            hint: 'e.g. Power pack circuit — sheet 1'),
        AppSelect<String>(
          label: 'Type',
          value: docType,
          required: true,
          options: optionsOf(documentTypeLabels),
          onChanged: (o) => setS(() => docType = o?.value ?? docType),
        ),
        AppTextField(label: 'Description', initialValue: description, onChanged: (v) => description = v),
        const FormHeading('Files *'),
        OutlinedButton.icon(
          icon: const Icon(Icons.attach_file_rounded),
          label: Text(files.isEmpty ? 'Choose files' : '${files.length} file${files.length == 1 ? '' : 's'} chosen'),
          onPressed: () async {
            final picked = await Files.pickFiles();
            if (picked.isNotEmpty) setS(() => files = picked);
          },
        ),
        for (final f in files) Text(f.filename ?? 'file', style: const TextStyle(fontSize: 13, color: Brand.body)),
        const Hint('PDF, image, Word/Excel, DWG/DXF, STEP or ZIP. Several files picked together are saved under the same title and type.'),
      ],
      onSave: () async {
        if (title.trim().isEmpty) throw 'Document title is required.';
        if (files.isEmpty) throw 'Choose at least one file to upload.';
        final fd = FormData.fromMap({
          'entity_type': widget.entityType,
          'entity_id': '${widget.entityId}',
          'doc_type': docType,
          'title': title.trim(),
          if (description.trim().isNotEmpty) 'description': description.trim(),
          'files': files,
        });
        await Api.post('/hydraulic/documents', data: fd);
      },
    );
    if (ok) _load();
  }

  Future<void> _delete(Json d) async {
    final yes = await confirmDialog(context,
        title: 'Delete this document?',
        message: 'This removes "${txt(d['title'])}" (${txt(d['file_name'])}) and deletes the file from SharePoint.',
        confirmLabel: 'Delete',
        danger: true);
    if (!yes || !mounted) return;
    if (await runAction(context, () => Api.delete('/hydraulic/documents/${d['id']}'), success: 'Document deleted.')) {
      _load();
    }
  }

  Future<void> _view(Json d) async {
    await runAction(context,
        () => Files.downloadAndOpen('/hydraulic/documents/${d['id']}/content', txt(d['file_name'])));
  }

  @override
  Widget build(BuildContext context) {
    if (_hidden) return const SizedBox.shrink();
    final docs = _docs;
    return DetailSection(
      '${widget.title} (${docs?.length ?? 0})',
      action: !_locked && _canAdd ? linkBtn('+ Upload', _upload) : null,
      children: [
        if (_locked && widget.readOnly && widget.readOnlyNote != null)
          Padding(padding: const EdgeInsets.only(bottom: 8), child: Hint(widget.readOnlyNote!)),
        if (_error != null) ErrorBanner(ApiClient.describe(_error!)),
        if (docs == null && _error == null)
          const Hint('Loading…')
        else if (docs != null && docs.isEmpty)
          const Hint('No files attached yet.')
        else if (docs != null)
          for (final d in docs) _docRow(d),
      ],
    );
  }

  Widget _docRow(Json d) {
    final mine = Perm.isAdmin || (Perm.userId != null && toInt(d['uploaded_by_id']) == Perm.userId);
    final canDelete = !_locked && _canRemove && mine;
    final created = d['created_at']?.toString();
    return Container(
      margin: const EdgeInsets.only(top: 8),
      padding: const EdgeInsets.all(10),
      decoration: BoxDecoration(borderRadius: BorderRadius.circular(10), border: Border.all(color: Brand.border)),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(children: [
            pill(documentTypeLabels, documentTypeHex, d['doc_type']),
            const Spacer(),
            linkBtn('View', () => _view(d)),
            if (canDelete) linkBtn('Delete', () => _delete(d), color: Brand.danger),
          ]),
          const SizedBox(height: 4),
          Text(txt(d['title']), style: const TextStyle(fontSize: 13.5, fontWeight: FontWeight.w600, color: Brand.heading)),
          Text('${txt(d['file_name'])}${_fmtSize(d['file_size']).isEmpty ? '' : ' · ${_fmtSize(d['file_size'])}'}',
              style: const TextStyle(fontSize: 12, color: Brand.muted)),
          Text(
              '${d['uploaded_by_name'] ?? '—'}${created != null && created.length >= 10 ? ' · ${created.substring(0, 10)}' : ''}',
              style: const TextStyle(fontSize: 12, color: Brand.muted)),
        ],
      ),
    );
  }
}

// ── Approval (portal components/shared/ApprovalPanel.tsx) ────────────────────

const _reqLabel = {
  'pending': 'Waiting for approval', 'approved': 'Approved', 'rejected': 'Rejected',
  'returned': 'Returned for changes', 'cancelled': 'Cancelled',
};
const _reqHex = {'pending': '#F59E0B', 'approved': '#16A34A', 'rejected': '#DC2626', 'returned': '#7c3aed', 'cancelled': '#78716c'};
const _stepLabel = {
  'waiting': 'Not yet', 'pending': 'Waiting', 'approved': 'Approved', 'rejected': 'Rejected',
  'returned': 'Returned', 'skipped': 'Not needed', 'cancelled': 'Cancelled',
};
const _stepHex = {
  'waiting': '#a8a29e', 'pending': '#F59E0B', 'approved': '#16A34A', 'rejected': '#DC2626',
  'returned': '#7c3aed', 'skipped': '#a8a29e', 'cancelled': '#a8a29e',
};
const _viaLabel = {'delegation': 'as delegate', 'escalation': 'after escalation', 'admin': 'admin stand-in'};

/// Approval status + Approve / Return / Reject from the central approval engine.
class HydApprovalPanel extends StatefulWidget {
  const HydApprovalPanel({super.key, required this.entityType, required this.entityId, required this.title, this.onChanged});
  final String entityType;
  final int entityId;
  final String title;
  final VoidCallback? onChanged;

  @override
  State<HydApprovalPanel> createState() => _HydApprovalPanelState();
}

class _HydApprovalPanelState extends State<HydApprovalPanel> {
  Json? _data;
  Object? _error;
  bool _busy = false;
  bool _showHistory = false;
  final _comment = TextEditingController();

  @override
  void initState() {
    super.initState();
    _load();
  }

  @override
  void dispose() {
    _comment.dispose();
    super.dispose();
  }

  Future<void> _load() async {
    try {
      final d = await Api.get('/approvals/entity/${widget.entityType}/${widget.entityId}');
      if (mounted) setState(() => _data = d is Map ? Map<String, dynamic>.from(d) : null);
    } catch (e) {
      if (mounted) setState(() => _error = e);
    }
  }

  Future<void> _act(Future<void> Function() fn) async {
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      await fn();
      _comment.clear();
      await _load();
      widget.onChanged?.call();
    } catch (e) {
      if (mounted) setState(() => _error = e);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  String _fmt(Object? d) => d == null ? '' : fmtDateTime(d);

  Widget _stages(Json req) {
    final groups = <int, List<Json>>{};
    for (final s in (req['steps'] as List? ?? const []).whereType<Map>()) {
      final m = Map<String, dynamic>.from(s);
      groups.putIfAbsent(toInt(m['sequence']) ?? 0, () => []).add(m);
    }
    final current = toInt(req['current_sequence']);
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        for (final e in groups.entries)
          Container(
            margin: const EdgeInsets.only(top: 8),
            padding: const EdgeInsets.only(left: 10),
            decoration: BoxDecoration(
                border: Border(
                    left: BorderSide(color: e.key == current ? Brand.warning : Brand.border, width: 3))),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                    '${e.key}. ${txt(e.value.first['stage_name'])}${e.value.length > 1 ? (e.value.first['approval_mode'] == 'all' ? ' — every one must approve' : ' — any one approves') : ''}',
                    style: const TextStyle(fontSize: 12.5, fontWeight: FontWeight.w700, color: Brand.heading)),
                for (final s in e.value)
                  Padding(
                    padding: const EdgeInsets.only(top: 4),
                    child: Wrap(spacing: 6, runSpacing: 2, crossAxisAlignment: WrapCrossAlignment.center, children: [
                      pill(_stepLabel, _stepHex, s['status']),
                      Text(txt(s['approver_name']), style: const TextStyle(fontSize: 12.5)),
                      if (s['decided_by_name'] != null && s['decided_by_id'] != s['approver_id'])
                        Text(
                            'decided by ${s['decided_by_name']}${_viaLabel[s['via']] != null ? ' (${_viaLabel[s['via']]})' : ''}',
                            style: const TextStyle(fontSize: 12, color: Brand.muted)),
                      if (s['decided_at'] != null)
                        Text(_fmt(s['decided_at']), style: const TextStyle(fontSize: 12, color: Brand.muted)),
                      if (s['status'] == 'pending' && s['due_at'] != null)
                        Text('escalates ${_fmt(s['due_at'])}', style: const TextStyle(fontSize: 12, color: Brand.muted)),
                      if (s['comment'] != null && s['comment'].toString().isNotEmpty)
                        Text('“${s['comment']}”', style: const TextStyle(fontSize: 12.5, fontStyle: FontStyle.italic)),
                    ]),
                  ),
              ],
            ),
          ),
      ],
    );
  }

  @override
  Widget build(BuildContext context) {
    final data = _data;
    final current = data?['current'] is Map ? Map<String, dynamic>.from(data!['current'] as Map) : null;
    final history = (data?['history'] as List? ?? const []).whereType<Map>().map((m) => Map<String, dynamic>.from(m)).toList();
    if (data == null || (current == null && history.isEmpty)) {
      return _error == null
          ? const SizedBox.shrink()
          : DetailSection(widget.title, children: [ErrorBanner(ApiClient.describe(_error!))]);
    }
    final req = current;
    final canAct = req != null && req['status'] == 'pending' && (req['can_decide'] == true || req['can_stand_in'] == true);
    return DetailSection(widget.title, children: [
      if (req != null) ...[
        Wrap(spacing: 8, runSpacing: 4, crossAxisAlignment: WrapCrossAlignment.center, children: [
          pill(_reqLabel, _reqHex, req['status']),
          Text(
              'Submitted by ${req['requester_name'] ?? '—'} on ${_fmt(req['submitted_at'])}${(toInt(req['revision']) ?? 1) > 1 ? ' · submission #${req['revision']}' : ''}',
              style: const TextStyle(fontSize: 12.5, color: Brand.muted)),
        ]),
        _stages(req),
      ],
      if (_error != null) Padding(padding: const EdgeInsets.only(top: 10), child: ErrorBanner(ApiClient.describe(_error!))),
      if (req != null && canAct) ...[
        const SizedBox(height: 12),
        if (req['acting_for'] != null) Hint('You are deciding on behalf of ${req['acting_for']}.'),
        if (req['can_decide'] != true && req['can_stand_in'] == true)
          const Hint('You are not an approver of this stage — as an admin you can stand in; a comment is required.'),
        const SizedBox(height: 6),
        TextField(
          controller: _comment,
          maxLines: 3,
          minLines: 2,
          decoration: fieldDecoration('Comment', hint: 'Comment (required to reject or return)'),
        ),
        const SizedBox(height: 8),
        Wrap(spacing: 8, runSpacing: 8, children: [
          primaryBtn('Approve', _busy ? null : () => _act(() => _decide(req, 'approve'))),
          secondaryBtn('Return for changes', _busy ? null : () => _act(() => _decide(req, 'return'))),
          dangerBtn('Reject', _busy ? null : () => _act(() => _decide(req, 'reject'))),
        ]),
      ],
      if (req != null && req['status'] == 'pending' && req['can_cancel'] == true) ...[
        const SizedBox(height: 10),
        secondaryBtn('Withdraw approval request', _busy
            ? null
            : () async {
                final yes = await confirmDialog(context,
                    title: 'Withdraw approval request?',
                    message: 'The approvers will no longer see it. You can submit it again later.',
                    confirmLabel: 'Withdraw');
                if (yes) _act(() => Api.post('/approvals/requests/${req['id']}/cancel', data: {}));
              }),
      ],
      if (history.isNotEmpty) ...[
        const SizedBox(height: 6),
        Align(
          alignment: Alignment.centerLeft,
          child: linkBtn('${_showHistory ? 'Hide' : 'Show'} earlier submissions (${history.length})',
              () => setState(() => _showHistory = !_showHistory)),
        ),
        if (_showHistory)
          for (final h in history) ...[
            const Divider(),
            Wrap(spacing: 8, crossAxisAlignment: WrapCrossAlignment.center, children: [
              pill(_reqLabel, _reqHex, h['status']),
              Text('Submission #${h['revision']} · ${_fmt(h['submitted_at'])}',
                  style: const TextStyle(fontSize: 12, color: Brand.muted)),
            ]),
            _stages(h),
          ],
      ],
    ]);
  }

  Future<void> _decide(Json req, String decision) =>
      Api.post('/approvals/requests/${req['id']}/decide', data: {'decision': decision, 'comment': _comment.text.trim()});
}
