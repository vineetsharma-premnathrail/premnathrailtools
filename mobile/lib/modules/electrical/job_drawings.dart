// Drawings tab - phone copy of frontend/src/components/electrical/DrawingsTab.tsx:
// the revision-controlled drawing register of a job (Schematics, Drawing /
// Revision, As-Built stages). R0, R1 … go draft → submitted → approved /
// rejected; files stream through the backend.
import 'package:dio/dio.dart';
import 'package:flutter/material.dart';

import '../../api/api.dart';
import '../../theme.dart';
import '../../ui/files.dart';
import '../../ui/form.dart';
import '../../ui/format.dart';
import '../../ui/perms.dart';
import '../../ui/widgets.dart';
import 'approval_panel.dart';
import 'common.dart';

const drawingExtensions = ['pdf', 'dwg', 'dxf', 'png', 'jpg', 'jpeg'];

class DrawingsTab extends StatefulWidget {
  const DrawingsTab({super.key, required this.job, required this.meta, required this.canEdit, required this.onChanged, this.focusId});
  final Json job;
  final ElecMeta meta;
  final bool canEdit;
  final VoidCallback onChanged;

  /// Revision to bring into view (approval link).
  final int? focusId;

  @override
  State<DrawingsTab> createState() => _DrawingsTabState();
}

class _DrawingsTabState extends State<DrawingsTab> {
  List<Json> _drawings = [];
  bool _loading = true;
  String? _error;
  bool _busy = false;
  final Set<int> _expanded = {};
  int _approvalSeq = 0;

  Json get job => widget.job;
  int get jobId => asInt(job['id'])!;
  String get jobNo => str(job['job_number']);
  bool get _isOpen => workingStatuses.contains(str(job['status']));
  String _typeLabel(Object? t) => widget.meta.drawingTypes[str(t)] ?? str(t).replaceAll('_', ' ');

  @override
  void initState() {
    super.initState();
    _load(first: true);
  }

  Future<void> _load({bool first = false}) async {
    try {
      final rows = rowsOf(await Api.get('/electrical/jobs/$jobId/drawings'));
      if (!mounted) return;
      setState(() {
        _drawings = rows;
        _error = null;
        _loading = false;
        _approvalSeq++;
        if (first && widget.focusId != null) {
          for (final d in rows) {
            if (rowsOf(d['revisions']).any((r) => asInt(r['id']) == widget.focusId)) _expanded.add(asInt(d['id'])!);
          }
        }
      });
    } catch (e) {
      if (mounted) {
        setState(() {
          _error = 'Could not load the drawings for $jobNo. ${ApiClient.describe(e)}';
          _loading = false;
        });
      }
    }
  }

  Future<bool> _run(Future<dynamic> Function() fn, String success) async {
    setState(() => _busy = true);
    try {
      await fn();
      await _load();
      widget.onChanged();
      if (mounted) showSnack(context, success);
      return true;
    } catch (e) {
      if (mounted) showSnack(context, ApiClient.describe(e), error: true);
      return false;
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  // ── Add / edit / new revision ──

  Future<void> _add() async {
    final title = TextEditingController();
    final number = TextEditingController();
    final description = TextEditingController();
    final summary = TextEditingController(text: 'First issue');
    var type = widget.meta.drawingTypes.containsKey('schematic') || widget.meta.drawingTypes.isEmpty
        ? 'schematic'
        : widget.meta.drawingTypes.keys.first;
    var asBuilt = false;
    PickedFile? file;
    Json? created;
    final ok = await showFormSheet(
      context,
      title: 'Add Drawing',
      saveLabel: 'Add Drawing',
      builder: (ctx, setS) => [
        Muted('New drawing on $jobNo — it starts as an R0 draft.'),
        const FormHeading('Drawing'),
        AppTextField(label: 'Title', controller: title, required: true, hint: 'e.g. Main 24V DC distribution schematic'),
        AppSelect<String>(
          label: 'Drawing type',
          value: type,
          clearable: false,
          options: optionsOf(widget.meta.drawingTypes),
          onChanged: (o) => setS(() => type = o?.value ?? type),
        ),
        AppTextField(label: 'Drawing number', controller: number, hint: 'Leave blank to auto-number'),
        CheckField(label: 'As-built drawing', value: asBuilt, onChanged: (v) => setS(() => asBuilt = v)),
        AppTextField(label: 'Description (optional)', controller: description, maxLines: 3),
        const FormHeading('First Revision (R0)'),
        AppTextField(label: 'R0 change summary', controller: summary),
        FilePickRow(label: 'File', picked: file, extensions: drawingExtensions, onPicked: (f) => setS(() => file = f)),
        const Muted('PDF, DWG, DXF or image. The drawing can be submitted for approval once a file is attached.', size: 12),
      ],
      onSave: () async {
        if (title.text.trim().isEmpty) throw 'Drawing title is required.';
        final fd = FormData.fromMap({
          'title': title.text.trim(),
          'drawing_type': type,
          if (number.text.trim().isNotEmpty) 'drawing_number': number.text.trim(),
          'is_as_built': asBuilt ? 'true' : 'false',
          if (description.text.trim().isNotEmpty) 'description': description.text.trim(),
          'change_summary': summary.text.trim().isEmpty ? 'First issue' : summary.text.trim(),
          if (file != null) 'file': file!.file,
        });
        created = asJson(await Api.post('/electrical/jobs/$jobId/drawings', data: fd));
      },
    );
    for (final c in [title, number, description, summary]) {
      c.dispose();
    }
    if (!ok) return;
    final id = asInt(created?['id']);
    if (id != null) _expanded.add(id);
    await _load();
    widget.onChanged();
    if (!mounted) return;
    final label = str(created?['drawing_number']).isNotEmpty ? 'Drawing ${created?['drawing_number']}' : 'Drawing';
    showSnack(context, file != null
        ? '$label added with its R0 file.'
        : '$label added as an R0 draft — attach the file before submitting it for approval.');
  }

  Future<void> _edit(Json d) async {
    final number = TextEditingController(text: str(d['drawing_number']));
    final title = TextEditingController(text: str(d['title']));
    final description = TextEditingController(text: str(d['description']));
    var type = str(d['drawing_type']);
    var asBuilt = asBool(d['is_as_built']);
    final ok = await showFormSheet(
      context,
      title: 'Edit ${d['drawing_number']}',
      saveLabel: 'Save Changes',
      builder: (ctx, setS) => [
        Muted('${d['title']} — $jobNo'),
        AppTextField(label: 'Drawing number', controller: number, required: true),
        AppSelect<String>(
          label: 'Drawing type',
          value: type,
          clearable: false,
          options: optionsOf(widget.meta.drawingTypes),
          onChanged: (o) => setS(() => type = o?.value ?? type),
        ),
        AppTextField(label: 'Title', controller: title, required: true),
        CheckField(label: 'As-built drawing', value: asBuilt, onChanged: (v) => setS(() => asBuilt = v)),
        AppTextField(label: 'Description (optional)', controller: description, maxLines: 3),
      ],
      onSave: () async {
        if (title.text.trim().isEmpty) throw 'Drawing title is required.';
        if (number.text.trim().isEmpty) throw 'Drawing number is required.';
        await Api.patch('/electrical/drawings/${d['id']}', data: {
          'drawing_number': number.text.trim(),
          'title': title.text.trim(),
          'drawing_type': type,
          'is_as_built': asBuilt,
          'description': strOrNull(description.text),
        });
      },
    );
    final no = number.text.trim().toUpperCase();
    for (final c in [number, title, description]) {
      c.dispose();
    }
    if (ok) {
      await _load();
      widget.onChanged();
      if (mounted) showSnack(context, 'Drawing $no updated.');
    }
  }

  Future<void> _newRevision(Json d) async {
    final summary = TextEditingController();
    PickedFile? file;
    final ok = await showFormSheet(
      context,
      title: 'New revision of ${d['drawing_number']}',
      saveLabel: 'Start Revision',
      builder: (ctx, setS) => [
        Muted('${d['title']} — currently ${str(d['latest_revision_label']).isEmpty ? 'no revisions' : d['latest_revision_label']}'
            '${str(d['approved_revision_label']).isNotEmpty ? ', approved ${d['approved_revision_label']}' : ''}'),
        const FormHeading('What Changed'),
        AppTextField(label: 'Change summary', controller: summary, required: true, maxLines: 3, hint: 'What changed in this revision?'),
        const Muted('The new revision starts as a draft; approving it supersedes the current approved one.', size: 12),
        const FormHeading('Revision File'),
        FilePickRow(label: 'Revision file', picked: file, extensions: drawingExtensions, onPicked: (f) => setS(() => file = f)),
        const Muted('Attach it now or later — it must be attached before the revision is submitted for approval.', size: 12),
      ],
      onSave: () async {
        if (summary.text.trim().isEmpty) throw 'Describe what changed in this revision.';
        await Api.post('/electrical/drawings/${d['id']}/revisions',
            data: FormData.fromMap({'change_summary': summary.text.trim(), if (file != null) 'file': file!.file}));
      },
    );
    summary.dispose();
    if (!ok) return;
    _expanded.add(asInt(d['id'])!);
    await _load();
    widget.onChanged();
    if (mounted) {
      showSnack(context,
          'New revision started on ${d['drawing_number']}.${file != null ? '' : ' Attach its file before submitting it for approval.'}');
    }
  }

  Future<void> _upload(Json rev) async {
    final f = await Files.pickFile(extensions: drawingExtensions);
    if (f == null) return;
    final name = f.filename ?? 'file';
    await _run(() => Api.post('/electrical/revisions/${rev['id']}/file', data: FormData.fromMap({'file': f})),
        'File "$name" attached to ${rev['revision_label']}.');
  }

  Future<void> _decide(Json d, Json rev, bool approve) async {
    final label = '${d['drawing_number']} ${rev['revision_label']}';
    final value = await promptDialog(
      context,
      title: '${approve ? 'Approve' : 'Reject'} $label?',
      message: approve
          ? 'Approving supersedes the previously approved revision of this drawing. Add an optional comment.'
          : 'Say why the revision is rejected so the author knows what to fix (required).',
      label: approve ? 'Comment' : 'Reason',
      required: !approve,
      confirmLabel: approve ? 'Approve' : 'Reject',
    );
    if (value == null) return;
    if (approve) {
      await _run(() => Api.post('/electrical/revisions/${rev['id']}/approve', data: {'comment': strOrNull(value)}),
          '$label approved.');
    } else {
      await _run(() => Api.post('/electrical/revisions/${rev['id']}/reject', data: {'comment': value.trim()}),
          '$label rejected and sent back to the author.');
    }
  }

  Future<void> _confirm(String title, String message, Future<dynamic> Function() fn, String success) async {
    if (await confirmDialog(context, title: title, message: message, confirmLabel: title.startsWith('Delete') ? 'Delete' : 'Discard', danger: true)) {
      await _run(fn, success);
    }
  }

  @override
  Widget build(BuildContext context) {
    final canAdd = _isOpen && Elec.jf('drawings', 'create');
    final awaiting = _drawings.where((d) => d['latest_revision_status'] == 'submitted').length;
    final asBuiltApproved =
        _drawings.where((d) => asBool(d['is_as_built']) && str(d['approved_revision_label']).isNotEmpty).length;
    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: 16),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          TabHeader(
            title: 'Drawings',
            summary: Text.rich(
              TextSpan(children: [
                TextSpan(text: '${_drawings.length} ${plural(_drawings.length, 'drawing')} · '),
                TextSpan(text: '$awaiting awaiting approval', style: TextStyle(color: awaiting > 0 ? const Color(0xFFB45309) : null)),
                TextSpan(text: ' · $asBuiltApproved as-built approved'),
              ]),
              style: const TextStyle(fontSize: 12.5, color: Brand.body),
            ),
            action: canAdd ? primaryBtn('Add Drawing', _busy ? null : _add) : null,
          ),
          const Padding(
            padding: EdgeInsets.only(bottom: 10),
            child: Muted('Schematics stage needs an approved schematic or single line diagram; As-Built stage needs approved '
                'drawings marked as-built.', size: 12),
          ),
          if (_error != null) Padding(padding: const EdgeInsets.only(bottom: 10), child: ErrorBanner(_error!)),
          if (_loading)
            const LoadingView()
          else if (_drawings.isEmpty)
            Padding(
              padding: const EdgeInsets.symmetric(vertical: 20),
              child: Muted('No drawings on this job yet.${widget.canEdit ? ' Add the schematic or single line diagram first — each drawing starts as an R0 draft.' : ''}',
                  size: 13),
            )
          else
            for (final d in _drawings) _drawingCard(d, canAdd),
        ],
      ),
    );
  }

  Widget _drawingCard(Json d, bool canAdd) {
    final id = asInt(d['id'])!;
    final open = _expanded.contains(id);
    final revisions = rowsOf(d['revisions']);
    final hasOpenRev = revisions.any((r) => r['status'] == 'draft' || r['status'] == 'submitted');
    final canRemove = _isOpen && Elec.jf('drawings', 'delete');
    final approved = str(d['approved_revision_label']);
    return ItemCard(
      children: [
        InkWell(
          onTap: () => setState(() => open ? _expanded.remove(id) : _expanded.add(id)),
          child: Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Icon(open ? Icons.expand_more_rounded : Icons.chevron_right_rounded, color: Brand.muted),
              const SizedBox(width: 4),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Wrap(spacing: 8, runSpacing: 4, crossAxisAlignment: WrapCrossAlignment.center, children: [
                      Text(str(d['drawing_number']),
                          style: const TextStyle(fontSize: 14, fontWeight: FontWeight.w700, color: Brand.heading)),
                      if (asBool(d['is_as_built'])) tagPill('As-built', cTeal),
                    ]),
                    Text(str(d['title']), style: const TextStyle(fontSize: 13.5, color: Brand.body)),
                    const SizedBox(height: 2),
                    Text.rich(TextSpan(children: [
                      TextSpan(text: '${_typeLabel(d['drawing_type'])} · ${revisions.length} ${plural(revisions.length, 'revision')}'),
                      approved.isNotEmpty
                          ? TextSpan(text: ' · Approved: $approved', style: const TextStyle(color: cGreenDark, fontWeight: FontWeight.w600))
                          : const TextSpan(text: ' · No approved revision', style: TextStyle(color: cRed, fontWeight: FontWeight.w600)),
                    ]), style: const TextStyle(fontSize: 12, color: Brand.muted)),
                  ],
                ),
              ),
              Column(crossAxisAlignment: CrossAxisAlignment.end, children: [
                if (str(d['latest_revision_label']).isNotEmpty) Muted(str(d['latest_revision_label']), size: 12),
                pill(d['latest_revision_status'], revisionStatusLabels, revisionStatusHex),
              ]),
            ],
          ),
        ),
        if (widget.canEdit) ...[
          const SizedBox(height: 8),
          btnWrap([
            if (!hasOpenRev && canAdd) smallBtn('New Revision', _busy ? null : () => _newRevision(d)),
            smallBtn('Edit', _busy ? null : () => _edit(d)),
            smallBtn(
                asBool(d['is_as_built']) ? 'Unmark as-built' : 'Mark as-built',
                _busy
                    ? null
                    : () => _run(() => Api.patch('/electrical/drawings/$id', data: {'is_as_built': !asBool(d['is_as_built'])}),
                        asBool(d['is_as_built'])
                            ? '${d['drawing_number']} is no longer marked as-built.'
                            : '${d['drawing_number']} marked as-built.')),
            if (canRemove && Elec.canDelete('drawings', d['created_by_id']))
              smallBtn(
                  'Delete',
                  _busy
                      ? null
                      : () => _confirm(
                          'Delete drawing ${d['drawing_number']}?',
                          '"${d['title']}" and all of its revisions will be removed. A drawing with an approved revision on '
                              "record can't be deleted — raise a new revision instead.",
                          () => Api.delete('/electrical/drawings/$id'),
                          'Drawing ${d['drawing_number']} deleted.'),
                  danger: true),
          ]),
        ],
        if (open) ...[
          if (str(d['description']).isNotEmpty)
            Padding(padding: const EdgeInsets.only(top: 8), child: Muted(str(d['description']))),
          const SizedBox(height: 8),
          for (final rev in revisions.reversed) _revision(d, rev, revisions.length),
          if (revisions.isNotEmpty)
            Padding(
              padding: const EdgeInsets.only(top: 4),
              child: ApprovalPanel(
                key: ValueKey('appr-${revisions.last['id']}-${revisions.last['status']}-$_approvalSeq'),
                entityType: 'electrical_drawing_revision',
                entityId: asInt(revisions.last['id'])!,
                title: 'Approval — ${d['drawing_number']} ${revisions.last['revision_label']}',
                onChanged: () {
                  _load();
                  widget.onChanged();
                },
              ),
            ),
        ],
      ],
    );
  }

  Widget _revision(Json d, Json rev, int revCount) {
    final status = str(rev['status']);
    final isPreparer = asInt(rev['prepared_by_id']) != null && asInt(rev['prepared_by_id']) == Perm.userId;
    final canPrepare = widget.canEdit && (Perm.isAdmin || rev['prepared_by_id'] == null || isPreparer);
    final canDiscard = canPrepare && _isOpen && Elec.jf('drawings', 'delete') && revCount > 1;
    final hasFile = asBool(rev['has_file']);
    final focused = asInt(rev['id']) == widget.focusId;
    final label = '${d['drawing_number']} ${rev['revision_label']}';
    final actions = <Widget>[
      if (status == 'draft' && canPrepare) ...[
        smallBtn(hasFile ? 'Replace file' : 'Upload file', _busy ? null : () => _upload(rev)),
        if (Elec.jf('drawings', 'submit'))
          smallBtn(
              'Submit for approval',
              _busy || !hasFile
                  ? null
                  : () => _run(() => Api.post('/electrical/revisions/${rev['id']}/submit'), '$label submitted for approval.')),
      ],
      if (status == 'submitted' &&
          asInt(rev['approval_request_id']) == null &&
          Elec.can('drawings', 'approve') &&
          (Perm.isAdmin || !isPreparer)) ...[
        smallBtn('Approve', _busy ? null : () => _decide(d, rev, true), color: cGreenDark),
        smallBtn('Reject', _busy ? null : () => _decide(d, rev, false), danger: true),
      ],
      if ((status == 'draft' || status == 'submitted') && canDiscard)
        smallBtn(
            'Discard',
            _busy
                ? null
                : () => _confirm(
                    'Discard $label?',
                    '${rev['revision_label']} (${status == 'submitted' ? 'awaiting approval' : 'draft'}) will be removed from the '
                        'register. Earlier revisions stay as they are.',
                    () => Api.delete('/electrical/revisions/${rev['id']}'),
                    '$label discarded.'),
            danger: true),
    ];
    return Container(
      margin: const EdgeInsets.only(bottom: 8),
      padding: const EdgeInsets.all(10),
      decoration: BoxDecoration(
        color: focused ? Brand.primarySoft : Brand.background,
        borderRadius: BorderRadius.circular(10),
        border: Border.all(color: focused ? Brand.primary : Brand.border),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(children: [
            Text(str(rev['revision_label']), style: const TextStyle(fontWeight: FontWeight.w700, color: Brand.heading)),
            const SizedBox(width: 8),
            pill(status, revisionStatusLabels, revisionStatusHex),
          ]),
          if (str(rev['change_summary']).isNotEmpty)
            Padding(padding: const EdgeInsets.only(top: 4), child: Text(str(rev['change_summary']))),
          const SizedBox(height: 4),
          if (hasFile)
            InkWell(
              onTap: () => openElecFile(context, '/electrical/revisions/${rev['id']}/content',
                  str(rev['file_name']).isEmpty ? '$label.pdf' : str(rev['file_name'])),
              child: Text(
                '${str(rev['file_name']).isEmpty ? 'Open file' : rev['file_name']}'
                '${fmtBytes(rev['file_size']).isNotEmpty ? ' · ${fmtBytes(rev['file_size'])}' : ''}',
                style: const TextStyle(fontSize: 13, fontWeight: FontWeight.w600, color: cOrange),
              ),
            )
          else
            const Muted('No file yet', size: 12),
          MetaWrap([
            ('Prepared by', txt(rev['prepared_by_name'])),
            ('Submitted', rev['submitted_at'] == null ? '—' : fmtDateTime(rev['submitted_at'])),
            ('Decision', str(rev['decided_by_name']).isEmpty && rev['decided_at'] == null
                ? '—'
                : '${txt(rev['decided_by_name'])}${rev['decided_at'] != null ? ' · ${fmtDateTime(rev['decided_at'])}' : ''}'),
          ]),
          if (str(rev['decision_comment']).isNotEmpty)
            Padding(
              padding: const EdgeInsets.only(top: 4),
              child: Text('“${rev['decision_comment']}”', style: const TextStyle(fontSize: 12.5, fontStyle: FontStyle.italic)),
            ),
          if (actions.isNotEmpty) ...[const SizedBox(height: 8), btnWrap(actions)],
        ],
      ),
    );
  }
}