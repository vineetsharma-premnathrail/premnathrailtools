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
import 'crm_common.dart';

/// Inquiry or tender - the two CRM records that share Documents, Technical
/// Offers, Follow Ups, Timeline and Send to R&D.
enum CrmKind {
  inquiry('inquiry', 'inquiries', 'Inquiry'),
  tender('tender', 'tenders', 'Tender');

  const CrmKind(this.key, this.plural, this.label);
  final String key;
  final String plural;
  final String label;

  String base(int id) => '/crm/$plural/$id';
}

/// A scrolling tab body with pull-to-refresh.
Widget tabList(Future<void> Function() onRefresh, List<Widget> children) => RefreshIndicator(
      onRefresh: onRefresh,
      child: ListView(padding: const EdgeInsets.only(top: 8, bottom: 96), children: children),
    );

Widget tabButtons(List<Widget> buttons) => Padding(
      padding: const EdgeInsets.fromLTRB(16, 4, 16, 12),
      child: Wrap(spacing: 8, runSpacing: 8, children: buttons),
    );

// ── R&D intake card (components/crm/RndIntakeCard.tsx) ───────────────────────

const _revLabel = {
  'submitted': 'Awaiting R&D review',
  'accepted': 'Accepted by R&D',
  'returned': 'Returned to BD',
  'responded': 'Responded',
  'closed': 'Closed by R&D',
  'superseded': 'Superseded',
};
const _revColor = {
  'submitted': Color(0xFF2563EB),
  'accepted': Color(0xFF16A34A),
  'returned': Color(0xFFDC2626),
  'responded': Color(0xFF0D9488),
  'closed': Color(0xFF78716C),
  'superseded': Color(0xFF78716C),
};

class RndIntakeCard extends StatelessWidget {
  const RndIntakeCard({super.key, required this.rnd, required this.canResend, required this.onResend});
  final Json? rnd;
  final bool canResend;
  final VoidCallback onResend;

  @override
  Widget build(BuildContext context) {
    final r = rnd;
    if (r == null) return const SizedBox.shrink();
    final status = str(r['status']);
    final returned = status == 'returned';
    final c = _revColor[status] ?? Brand.muted;
    final revs = jsonList(r['revisions'])..sort((a, b) => (asInt(a['revision_no']) ?? 0).compareTo(asInt(b['revision_no']) ?? 0));
    return Padding(
      padding: const EdgeInsets.fromLTRB(16, 0, 16, 12),
      child: Container(
        padding: const EdgeInsets.all(12),
        decoration: BoxDecoration(
          color: returned ? Brand.dangerSoft : Colors.white,
          borderRadius: BorderRadius.circular(12),
          border: Border(
            left: BorderSide(color: c, width: 4),
            top: BorderSide(color: returned ? Brand.danger.withValues(alpha: 0.25) : Brand.border),
            right: BorderSide(color: returned ? Brand.danger.withValues(alpha: 0.25) : Brand.border),
            bottom: BorderSide(color: returned ? Brand.danger.withValues(alpha: 0.25) : Brand.border),
          ),
        ),
        child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          Wrap(spacing: 8, runSpacing: 4, crossAxisAlignment: WrapCrossAlignment.center, children: [
            Text('R&D ID ${str(r['rd_number'])}', style: const TextStyle(fontWeight: FontWeight.w700, color: Brand.heading)),
            Text('Revision ${str(r['revision_code'])}', style: const TextStyle(fontSize: 12, color: Brand.muted)),
            pill(_revLabel[status] ?? humanize(status), c),
          ]),
          if (returned) ...[
            const SizedBox(height: 6),
            Text('Returned by R&D: ${str(r['return_reason']).isEmpty ? 'No reason was given.' : str(r['return_reason'])}',
                style: const TextStyle(color: Brand.danger, fontSize: 13)),
            if (str(r['reviewed_by']).isNotEmpty)
              Note('— ${str(r['reviewed_by'])}${r['reviewed_at'] != null ? ', ${fmtDateTime(r['reviewed_at'])}' : ''}'),
            const Note('Fix what R&D asked for (Edit the record or its documents), then send it again.'),
          ],
          if (status == 'accepted' && str(r['review_remarks']).isNotEmpty) ...[
            const SizedBox(height: 6),
            Note('R&D note: ${str(r['review_remarks'])}', color: Brand.body),
          ],
          if (revs.length > 1) ...[
            const SizedBox(height: 6),
            Wrap(spacing: 6, runSpacing: 6, children: [
              for (final v in revs)
                pill('R${str(v['revision_no'])} ${_revLabel[str(v['status'])] ?? str(v['status'])}',
                    _revColor[str(v['status'])] ?? Brand.muted),
            ]),
          ],
          if (returned && canResend) ...[
            const SizedBox(height: 10),
            primaryBtn('Re-send to R&D', onResend),
          ],
        ]),
      ),
    );
  }
}

// ── Send Technical Requirement to R&D (TechnicalOfferPickerDialog.tsx) ───────

/// Returns the updated record when sent, null when cancelled.
Future<Json?> sendToRnd(BuildContext context, CrmKind kind, int id) async {
  DateTime? due;
  final remarks = TextEditingController();
  final selected = <int>{};
  final seeDocs = CrmPerm.it('documents', 'view');
  List<Json>? clientDocs = seeDocs ? null : const [];
  Json? result;
  if (seeDocs) {
    try {
      final docs = (await Api.list('/crm/documents', query: {'related_module': kind.key, 'related_id': id})).rows;
      clientDocs = docs.where((d) => d['folder_type'] == 'client').toList();
    } catch (_) {
      clientDocs = const [];
    }
  }
  if (!context.mounted) return null;
  final ok = await showFormSheet(
    context,
    title: 'Send Technical Requirement to R&D',
    saveLabel: 'Send',
    builder: (ctx, setS) => [
      const Note('The whole R&D team sees the requirement under R&D › Requirements; whoever answers after the due date must give a reason.'),
      const FormSection('Response'),
      DateField(
          label: 'Response Due Date',
          required: true,
          value: due,
          firstDate: DateTime.now().subtract(const Duration(days: 1)),
          onChanged: (d) => setS(() => due = d)),
      AppTextField(
          label: 'Remarks to R&D (optional)',
          controller: remarks,
          maxLines: 3,
          hint: 'What you need back — e.g. feasibility + drawing, or a technical deviation list'),
      const FormSection('Reference client documents (optional)'),
      if (clientDocs == null)
        const LoadingView()
      else if (clientDocs.isEmpty)
        const Note('No client documents uploaded yet.')
      else
        for (final d in clientDocs)
          CheckField(
            label: str(d['file_name']),
            value: selected.contains(asInt(d['id'])),
            onChanged: (v) => setS(() => v ? selected.add(asInt(d['id'])!) : selected.remove(asInt(d['id']))),
          ),
    ],
    onSave: () async {
      if (due == null) throw 'Set the Response Due Date — the date R&D must reply by.';
      final today = DateTime.now();
      if (due!.isBefore(DateTime(today.year, today.month, today.day))) {
        throw 'Response Due Date is in the past — pick today or a later date.';
      }
      result = await guard(() async {
        final res = await Api.dio.post('${kind.base(id)}/technical-offer-request',
            data: {
              'document_ids': selected.toList(),
              'response_due_date': apiDate(due!),
              if (remarks.text.trim().isNotEmpty) 'remarks': remarks.text.trim(),
            },
            options: Options(receiveTimeout: const Duration(minutes: 2), sendTimeout: const Duration(minutes: 2)));
        return res.data is Map ? Map<String, dynamic>.from(res.data as Map) : <String, dynamic>{};
      });
    },
  );
  return ok ? result : null;
}

// ── Lost reason (LostReasonDialog.tsx) ───────────────────────────────────────

/// Asks why the inquiry was lost; null when cancelled.
Future<Json?> askLostReason(BuildContext context) async {
  List<Option<String>> reasons = const [];
  try {
    final m = await Api.get('/crm/opportunity/meta');
    reasons = [
      for (final r in jsonList(m is Map ? m['lost_reasons'] : null)) Option(str(r['value']), str(r['label'])),
    ];
  } catch (_) {
    reasons = [for (final e in CrmLists.lostReasonLabels.entries) Option(e.key, e.value)];
  }
  if (!context.mounted) return null;
  String? code;
  final competitor = TextEditingController();
  final remarks = TextEditingController();
  Json? out;
  final ok = await showFormSheet(
    context,
    title: 'Close inquiry as not ordered',
    saveLabel: 'Close as not ordered',
    builder: (ctx, setS) => [
      const Note('Why was it lost? This feeds the CRM win / loss report. If it was set by mistake, the status can be changed back later.'),
      AppSelect<String>(
          label: 'Lost reason', required: true, value: code, options: reasons, onChanged: (o) => setS(() => code = o?.value)),
      if (code == 'competitor') AppTextField(label: 'Lost to (competitor)', required: true, controller: competitor, hint: 'Competitor name'),
      AppTextField(
          label: code == 'other' ? 'Remarks' : 'Remarks (optional)',
          required: code == 'other',
          controller: remarks,
          maxLines: 2,
          hint: 'e.g. L1 was 9% lower'),
    ],
    onSave: () async {
      if (code == null) throw 'Pick the lost reason.';
      if (code == 'competitor' && competitor.text.trim().isEmpty) throw "Enter the competitor's name.";
      if (code == 'other' && remarks.text.trim().isEmpty) throw 'Describe the reason in the remarks.';
      out = {
        'lost_reason_code': code,
        'lost_to_competitor': competitor.text.trim().isEmpty ? null : competitor.text.trim(),
        'lost_remarks': remarks.text.trim().isEmpty ? null : remarks.text.trim(),
      };
    },
  );
  return ok ? out : null;
}

// ── Documents tab (CrmDocumentFolder.tsx) ────────────────────────────────────

class CrmDocumentsTab extends StatefulWidget {
  const CrmDocumentsTab({
    super.key,
    required this.kind,
    required this.record,
    required this.canModify,
  });
  final CrmKind kind;
  final Json record;
  final bool canModify;

  @override
  State<CrmDocumentsTab> createState() => _CrmDocumentsTabState();
}

class _CrmDocumentsTabState extends State<CrmDocumentsTab> {
  List<Json>? _docs;
  List<Json> _quotations = const [];
  Object? _error;
  String _q = '';

  int get _id => asInt(widget.record['id'])!;

  bool get _seeQuotationDocs =>
      widget.kind == CrmKind.inquiry &&
      CrmPerm.it('quotations', 'view') &&
      CrmPerm.it('quotations', 'print') &&
      CrmPerm.seesQuotePrices;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    try {
      final docs = (await Api.list('/crm/documents', query: {'related_module': widget.kind.key, 'related_id': _id})).rows;
      var quots = <Json>[];
      if (_seeQuotationDocs) quots = (await Api.list('/crm/inquiries/$_id/quotations')).rows;
      if (mounted) {
        setState(() {
        _docs = docs;
        _quotations = quots;
        _error = null;
        });
      }
    } catch (e) {
      if (mounted) setState(() => _error = e);
    }
  }

  Future<void> _upload(String folderType, String title) async {
    List<String> cats = const ['Other'];
    try {
      final rows = (await Api.list('/crm/document-categories')).rows.map((r) => str(r['label'])).where((s) => s.isNotEmpty).toList()
        ..sort((a, b) => a == 'Other' ? 1 : b == 'Other' ? -1 : a.compareTo(b));
      if (rows.isNotEmpty) cats = rows;
    } catch (e) {
      if (mounted) {
        showSnack(context, 'Could not load the document categories, so uploads will be filed as "Other". ${crmError(e)}', error: true);
      }
    }
    if (!mounted) return;
    var category = cats.contains('Other') ? 'Other' : cats.first;
    final files = <MultipartFile>[];
    final ok = await showFormSheet(
      context,
      title: 'Upload to $title',
      saveLabel: 'Upload',
      builder: (ctx, setS) => [
        Note("Files are filed under this ${widget.kind.key}'s $title with the category you pick."),
        AppSelect<String>(
            label: 'Category',
            value: category,
            options: opts(cats),
            clearable: false,
            onChanged: (o) => setS(() => category = o?.value ?? category)),
        const Note('Choices come from CRM › Settings › Lists › Document Categories.'),
        Row(children: [
          Expanded(
            child: secondaryBtn('Choose files', () async {
              final picked = await Files.pickFiles();
              setS(() => files.addAll(picked));
            }, icon: Icons.attach_file_rounded),
          ),
          const SizedBox(width: 8),
          Expanded(
            child: secondaryBtn('Take photo', () async {
              final p = await Files.takePhoto();
              if (p != null) setS(() => files.add(p));
            }, icon: Icons.photo_camera_outlined),
          ),
        ]),
        for (var i = 0; i < files.length; i++)
          ListTile(
            contentPadding: EdgeInsets.zero,
            leading: const Icon(Icons.insert_drive_file_outlined),
            title: Text(files[i].filename ?? 'File ${i + 1}'),
            trailing: IconButton(
                tooltip: 'Remove', icon: const Icon(Icons.close_rounded), onPressed: () => setS(() => files.removeAt(i))),
          ),
      ],
      onSave: () async {
        if (files.isEmpty) throw 'Pick at least one file to upload.';
        await guard(() async {
          final form = FormData.fromMap({
            'related_module': widget.kind.key,
            'related_id': _id,
            'folder_type': folderType,
            'doc_category': category,
            'universal_id': str(widget.record['universal_id']),
            'org_id': widget.record['org_id'],
          });
          for (final f in files) {
            form.files.add(MapEntry('files', f));
          }
          await Api.dio.post('/crm/documents',
              data: form, options: Options(receiveTimeout: const Duration(minutes: 10), sendTimeout: const Duration(minutes: 10)));
        });
      },
    );
    if (ok) {
      if (mounted) showSnack(context, 'Uploaded to $title.');
      _load();
    }
  }

  @override
  Widget build(BuildContext context) {
    if (_error != null && _docs == null) return ErrorView(crmError(_error!), onRetry: _load);
    if (_docs == null) return const LoadingView();
    final docs = _docs!;
    final client = docs.where((d) => d['folder_type'] == 'client').toList();
    final internal = docs.where((d) => d['folder_type'] == 'internal' || d['doc_category'] == 'rnd_response').toList();
    return tabList(_load, [
      Padding(
        padding: const EdgeInsets.fromLTRB(16, 0, 16, 12),
        child: SearchField(
            hint: 'Search documents by name, category, uploader or date…', onChanged: (v) => setState(() => _q = v.trim().toLowerCase())),
      ),
      _folder('Client Documents', 'client', client, const []),
      _folder('Internal Documents', 'internal', internal, _quotations),
    ]);
  }

  Widget _folder(String title, String folderType, List<Json> docs, List<Json> generated) {
    final rows = <({String name, String category, String? created, String? by, int? size, VoidCallback open})>[
      for (final q in generated)
        (
          name: '${str(q['quot_number']).isEmpty ? 'Quotation-${q['id']}' : str(q['quot_number'])}.pdf',
          category: 'Quotation${(asInt(q['revision_number']) ?? 0) > 0 ? ' · rev ${q['revision_number']}' : ''} · generated',
          created: q['created_at'] as String?,
          by: null,
          size: null,
          open: () => openApiFile(context, '/crm/inquiries/$_id/quotations/${q['id']}/pdf',
              '${str(q['quot_number']).isEmpty ? 'Quotation-${q['id']}' : str(q['quot_number'])}.pdf'),
        ),
      for (final d in docs)
        (
          name: str(d['file_name']),
          category: d['doc_category'] == 'rnd_response' ? 'R&D Response' : (str(d['doc_category']).isEmpty ? 'Other' : str(d['doc_category'])),
          created: d['created_at'] as String?,
          by: d['uploaded_by_name'] as String?,
          size: asInt(d['file_size']),
          open: () => openCrmDocument(context, d),
        ),
    ]..sort((a, b) => (b.created ?? '').compareTo(a.created ?? ''));
    final shown = _q.isEmpty
        ? rows
        : rows
            .where((r) => [r.name, r.category, r.by ?? '', r.created == null ? '' : fmtDateTime(r.created)]
                .any((v) => v.toLowerCase().contains(_q)))
            .toList();
    return DetailSection(
      '$title  ${_q.isEmpty ? rows.length : '${shown.length} of ${rows.length}'}',
      children: [
        if (shown.isEmpty)
          Note(rows.isEmpty ? 'No documents yet.' : 'No ${title.toLowerCase()} match "$_q".')
        else
          for (final r in shown)
            ListTile(
              contentPadding: EdgeInsets.zero,
              leading: _FileTypeIcon(r.name),
              title: Text(r.name, style: const TextStyle(fontSize: 14, fontWeight: FontWeight.w600)),
              subtitle: Text(
                  '${r.category}\n${joinNonEmpty([r.created == null ? null : fmtDateTime(r.created), r.by, r.size == null ? null : _size(r.size!)], ' · ')}',
                  style: const TextStyle(fontSize: 12)),
              isThreeLine: true,
              trailing: const Icon(Icons.open_in_new_rounded, size: 18),
              onTap: r.open,
            ),
        if (widget.canModify) ...[
          const SizedBox(height: 8),
          secondaryBtn('Upload to $title', () => _upload(folderType, title), icon: Icons.upload_rounded),
        ],
      ],
    );
  }

  static String _size(int b) =>
      b < 1024 ? '$b B' : b < 1024 * 1024 ? '${(b / 1024).round()} KB' : '${(b / (1024 * 1024)).toStringAsFixed(1)} MB';
}

class _FileTypeIcon extends StatelessWidget {
  const _FileTypeIcon(this.name);
  final String name;

  @override
  Widget build(BuildContext context) {
    final ext = name.contains('.') ? name.split('.').last.toLowerCase() : '';
    var (label, color) = switch (ext) {
      'pdf' => ('PDF', const Color(0xFFDC2626)),
      'doc' || 'docx' || 'rtf' => ('DOC', const Color(0xFF2563EB)),
      'xls' || 'xlsx' || 'csv' => ('XLS', const Color(0xFF16A34A)),
      'ppt' || 'pptx' => ('PPT', const Color(0xFFEA580C)),
      'png' || 'jpg' || 'jpeg' || 'gif' || 'webp' || 'bmp' => ('IMG', const Color(0xFF9333EA)),
      'dwg' || 'dxf' || 'step' || 'stp' || 'igs' => ('CAD', const Color(0xFF0891B2)),
      'zip' || 'rar' || '7z' => ('ZIP', const Color(0xFF78716C)),
      _ => (ext.isEmpty ? 'FILE' : ext.toUpperCase(), const Color(0xFF78716C)),
    };
    if (label.length > 4) label = label.substring(0, 4);
    return Container(
      width: 38,
      height: 38,
      alignment: Alignment.center,
      decoration: BoxDecoration(color: color.withValues(alpha: 0.1), borderRadius: BorderRadius.circular(9)),
      child: Text(label, style: TextStyle(color: color, fontSize: 10, fontWeight: FontWeight.w800)),
    );
  }
}

// ── Technical Offers tab (BdTechnicalOffers.tsx) ─────────────────────────────

class TechnicalOffersTab extends StatefulWidget {
  const TechnicalOffersTab({super.key, required this.kind, required this.recordId});
  final CrmKind kind;
  final int recordId;

  @override
  State<TechnicalOffersTab> createState() => _TechnicalOffersTabState();
}

class _TechnicalOffersTabState extends State<TechnicalOffersTab> {
  List<Json>? _offers;
  Object? _error;

  bool get _canUpload => CrmPerm.it('technical_offer', 'create');
  bool get _canRemove => CrmPerm.it('technical_offer', 'delete');

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    try {
      final rows = (await Api.list('${widget.kind.base(widget.recordId)}/technical-offers')).rows
        ..sort((a, b) => str(a['offer_number']).compareTo(str(b['offer_number'])));
      if (mounted) {
        setState(() {
        _offers = rows;
        _error = null;
        });
      }
    } catch (e) {
      if (mounted) setState(() => _error = e);
    }
  }

  Future<void> _uploadOffer() async {
    final title = TextEditingController();
    final notes = TextEditingController();
    DateTime? date = DateTime.now();
    MultipartFile? file;
    final ok = await showFormSheet(
      context,
      title: 'Upload Technical Offer',
      saveLabel: 'Upload',
      builder: (ctx, setS) => [
        Note('Your own offer for this ${widget.kind.key} — it needs no R&D requirement.'),
        AppTextField(label: 'Title', required: true, controller: title),
        DateField(label: 'Offer date', required: true, value: date, onChanged: (d) => setS(() => date = d)),
        AppTextField(label: 'Notes (optional)', controller: notes, maxLines: 3),
        Row(children: [
          Expanded(child: Text(file?.filename ?? 'No file chosen', style: const TextStyle(color: Brand.muted))),
          secondaryBtn('Choose file', () async {
            final f = await Files.pickFile();
            if (f != null) setS(() => file = f);
          }, icon: Icons.attach_file_rounded),
        ]),
        const Note('It is quotable at once and shows “Uploaded by BD, not reviewed by R&D” on the quotation. You can delete it only while no quotation uses it.'),
      ],
      onSave: () async {
        requireField(title.text, 'Title');
        if (date == null) throw 'Offer date is required - fill it in and save again.';
        if (file == null) throw 'Choose the offer file to upload (Word or PDF).';
        await guard(() => Api.dio.post('${widget.kind.base(widget.recordId)}/technical-offers',
            data: FormData.fromMap({
              'file': file,
              'title': title.text.trim(),
              'offer_date': apiDate(date!),
              if (notes.text.trim().isNotEmpty) 'notes': notes.text.trim(),
            }),
            options: Options(receiveTimeout: const Duration(minutes: 10), sendTimeout: const Duration(minutes: 10))));
      },
    );
    if (ok) _load();
  }

  Future<void> _delete(Json o) async {
    final yes = await confirmDialog(context,
        title: 'Delete ${str(o['offer_number'])}?',
        message: 'The uploaded offer is removed. This cannot be undone.',
        confirmLabel: 'Delete',
        danger: true);
    if (!yes || !mounted) return;
    if (await crmRun(context, () => Api.delete('/crm/technical-offers/${o['id']}'), success: 'Deleted.')) _load();
  }

  @override
  Widget build(BuildContext context) {
    if (_error != null && _offers == null) return ErrorView(crmError(_error!), onRetry: _load);
    if (_offers == null) return const LoadingView();
    final offers = _offers!;
    return tabList(_load, [
      const Note(
          'Offers you can quote: the ones R&D released, and the ones BD uploaded here. A BD offer is quotable at once and shows “Uploaded by BD, not reviewed by R&D” on the quotation.',
          padding: EdgeInsets.fromLTRB(16, 0, 16, 10)),
      if (_canUpload) tabButtons([primaryBtn('Upload Technical Offer', _uploadOffer, icon: Icons.upload_rounded)]),
      if (offers.isEmpty)
        EmptyView(_canUpload
            ? 'No Technical Offer yet. Upload one, or wait for R&D to release theirs.'
            : 'No Technical Offer yet. R&D releases theirs here once it is ready.'),
      for (final o in offers)
        RecordCard(
          code: str(o['offer_number']),
          title: str(o['title']),
          subtitle: joinNonEmpty([
            o['notes'],
            o['label'],
            if (o['based_on_earlier_revision'] == true) 'Based on an earlier requirement revision',
            if (o['status'] == 'superseded') 'Superseded by a newer offer',
          ], '\n'),
          trailing: Padding(
            padding: const EdgeInsets.only(left: 8),
            child: pill(o['origin'] == 'bd' ? 'BD upload' : 'R&D released',
                o['origin'] == 'bd' ? const Color(0xFF7C3AED) : const Color(0xFF16A34A)),
          ),
          meta: [
            ('Offer date', fmtDate(o['offer_date'])),
            ('File', txt(o['file_name'])),
            if (str(o['uploaded_by']).isNotEmpty) ('By', '${str(o['uploaded_by'])}${o['uploaded_at'] != null ? ' · ${fmtDateTime(o['uploaded_at'])}' : ''}'),
            ('Used in quotation', strList(o['quoted_in']).isEmpty ? '—' : strList(o['quoted_in']).join(', ')),
          ],
          onTap: () => _offerActions(o),
        ),
    ]);
  }

  void _offerActions(Json o) {
    final canDel = o['origin'] == 'bd' && _canRemove;
    showModalBottomSheet<void>(
      context: context,
      backgroundColor: Colors.white,
      builder: (ctx) => SafeArea(
        child: Column(mainAxisSize: MainAxisSize.min, children: [
          if (str(o['file_name']).isNotEmpty)
            ListTile(
              leading: const Icon(Icons.download_rounded),
              title: const Text('Download'),
              onTap: () {
                Navigator.pop(ctx);
                openApiFile(context, '${widget.kind.base(widget.recordId)}/technical-offers/${o['id']}/file',
                    str(o['file_name']).isEmpty ? '${o['offer_number']}.docx' : str(o['file_name']));
              },
            ),
          if (canDel)
            ListTile(
              enabled: o['can_delete'] == true,
              leading: const Icon(Icons.delete_outline_rounded, color: Brand.danger),
              title: const Text('Delete', style: TextStyle(color: Brand.danger)),
              subtitle: o['can_delete'] == true
                  ? null
                  : Text('Used by quotation ${strList(o['quoted_in']).join(', ')} — remove it from the quotation first.'),
              onTap: () {
                Navigator.pop(ctx);
                _delete(o);
              },
            ),
        ]),
      ),
    );
  }
}

// ── Follow Ups tab (ActivitiesTab + ActivityForm + MomExportDialog) ──────────

class FollowUpsTab extends StatefulWidget {
  const FollowUpsTab({super.key, required this.kind, required this.record, required this.orgName});
  final CrmKind kind;
  final Json record;
  final String? orgName;

  @override
  State<FollowUpsTab> createState() => _FollowUpsTabState();
}

class _FollowUpsTabState extends State<FollowUpsTab> {
  List<Json>? _rows;
  Object? _error;

  int get _id => asInt(widget.record['id'])!;
  int? get _orgId => asInt(widget.record['org_id']);

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    try {
      final rows = (await Api.list('/crm/activities', query: {'related_module': widget.kind.key, 'related_id': _id})).rows;
      if (mounted) {
        setState(() {
        _rows = rows;
        _error = null;
        });
      }
    } catch (e) {
      if (mounted) setState(() => _error = e);
    }
  }

  Future<void> _add() async {
    final saved = await showActivityForm(context, initial: {
      'org_id': _orgId,
      'related_module': widget.kind.key,
      'related_id': _id,
      'universal_id': widget.record['universal_id'],
    });
    if (saved) _load();
  }

  @override
  Widget build(BuildContext context) {
    if (_error != null && _rows == null) return ErrorView(crmError(_error!), onRetry: _load);
    if (_rows == null) return const LoadingView();
    final rows = _rows!;
    return tabList(_load, [
      tabButtons([
        if (CrmPerm.it('followups', 'create')) primaryBtn('+ Add Follow Up', _add),
        if (CrmPerm.it('followups', 'print'))
          secondaryBtn('Export Meeting MOM', () => exportMeetingMom(context, widget.kind, _id, _orgId, widget.orgName, rows)),
      ]),
      if (rows.isEmpty) const EmptyView('No follow-ups logged.'),
      for (final a in rows) ActivityCard(activity: a, orgName: widget.orgName, onChanged: _load),
    ]);
  }
}

/// One follow-up in a list; tap opens it (portal ActivityViewDialog + row buttons).
class ActivityCard extends StatelessWidget {
  const ActivityCard({super.key, required this.activity, required this.orgName, required this.onChanged});
  final Json activity;
  final String? orgName;
  final VoidCallback onChanged;

  @override
  Widget build(BuildContext context) {
    final a = activity;
    final mom = jsonList(a['mom_items']);
    final contacts = jsonList(a['contact_details'])
        .map((c) => joinNonEmpty(['${str(c['name'])}${str(c['designation']).isEmpty ? '' : ' (${str(c['designation'])})'}', c['mobile'], c['email']], ' · '))
        .join(' · ');
    final body = mom.isNotEmpty
        ? [
            for (var i = 0; i < mom.length; i++)
              '${i + 1}. ${txt(mom[i]['observation'])}${str(mom[i]['action_plan']).isEmpty ? '' : ' · Action Plan: ${mom[i]['action_plan']}'}'
                  ' · Responsibility: ${txt(mom[i]['responsibility'])} · Target: ${txt(mom[i]['target_date'])}',
          ].join('\n')
        : [
            stripHtml(a['remarks']).isEmpty ? '—' : stripHtml(a['remarks']),
            'Due: ${str(a['next_followup']).isEmpty ? 'To Be Decided' : fmtDate(a['next_followup'])}',
            if (stripHtml(a['action_plan']).isNotEmpty) 'Action Plan: ${stripHtml(a['action_plan'])}',
          ].join('\n');
    final photos = jsonList(a['attachments']).length;
    return RecordCard(
      title: '${str(a['activity_type']).isEmpty ? 'Activity' : str(a['activity_type'])}'
          '${str(a['assigned_to']).isEmpty ? '' : ' · ${str(a['assigned_to'])}'}',
      code: a['created_at'] == null ? null : fmtDateTime(a['created_at']),
      subtitle: joinNonEmpty([if (str(a['subject']).isNotEmpty) a['subject'], if (contacts.isNotEmpty) contacts, body], '\n'),
      status: a['status'],
      meta: [if (photos > 0) ('Photos', '$photos')],
      onTap: () => openScreen(context, ActivityScreen(activity: a, orgName: orgName, onChanged: onChanged)),
    );
  }
}

/// A follow-up on its own screen: everything logged + Edit / Change Status / Export MoM / Delete.
class ActivityScreen extends StatefulWidget {
  const ActivityScreen({super.key, required this.activity, required this.orgName, required this.onChanged});
  final Json activity;
  final String? orgName;
  final VoidCallback onChanged;

  @override
  State<ActivityScreen> createState() => _ActivityScreenState();
}

class _ActivityScreenState extends State<ActivityScreen> {
  late Json a = widget.activity;

  bool get _own => Perm.isAdmin || a['created_by_id'] == Perm.userId;
  bool get _canEdit => CrmPerm.it('followups', 'edit') && _own;
  bool get _canDelete =>
      CrmPerm.it('followups', 'delete') && (Perm.isAdmin || a['created_by_id'] == null || a['created_by_id'] == Perm.userId);

  Future<void> _refresh() async {
    try {
      final rows = (await Api.list('/crm/activities',
              query: {'related_module': a['related_module'], 'related_id': a['related_id'], 'limit': 10000}))
          .rows;
      final fresh = rows.firstWhere((r) => r['id'] == a['id'], orElse: () => a);
      if (mounted) setState(() => a = fresh);
    } catch (_) {}
    widget.onChanged();
  }

  Future<void> _changeStatus() async {
    final picked = await showModalBottomSheet<String>(
      context: context,
      backgroundColor: Colors.white,
      builder: (ctx) => SafeArea(
        child: Column(mainAxisSize: MainAxisSize.min, children: [
          const Padding(padding: EdgeInsets.all(16), child: Caps('Change Status')),
          for (final s in CrmLists.followUpStatuses)
            ListTile(
              title: Text(s),
              trailing: s == str(a['status']) ? const Icon(Icons.check_rounded, color: Brand.primary) : null,
              onTap: s == str(a['status']) ? null : () => Navigator.pop(ctx, s),
            ),
        ]),
      ),
    );
    if (picked == null || !mounted) return;
    if (await crmRun(context, () => Api.patch('/crm/activities/${a['id']}', data: {'status': picked}), success: 'Status changed to $picked.')) {
      _refresh();
    }
  }

  Future<void> _delete() async {
    final yes = await confirmDialog(context,
        title: 'Delete this follow-up?',
        message: 'Delete this follow-up entry? This action cannot be undone.',
        confirmLabel: 'Delete',
        danger: true);
    if (!yes || !mounted) return;
    if (await crmRun(context, () => Api.delete('/crm/activities/${a['id']}'), success: 'Follow-up deleted.')) {
      widget.onChanged();
      if (mounted) Navigator.pop(context);
    }
  }

  void _exportMom() {
    final org = (widget.orgName ?? 'Activity').replaceAll(RegExp(r'\s+'), '_').replaceAll('/', '-');
    final date = str(a['created_at']).length >= 10 ? str(a['created_at']).substring(0, 10).replaceAll('-', '') : 'undated';
    postAndOpenFile(context, '/crm/activities/${a['id']}/mom-docx', null, 'MOM_${org}_$date.docx');
  }

  @override
  Widget build(BuildContext context) {
    final mom = jsonList(a['mom_items']);
    final atts = jsonList(a['attachments']);
    return SubPage(
      title: str(a['subject']).isEmpty ? (str(a['activity_type']).isEmpty ? 'Follow Up' : str(a['activity_type'])) : str(a['subject']),
      body: ListView(padding: const EdgeInsets.only(top: 12, bottom: 24), children: [
        DetailSection('Follow Up Details', children: [
          row('Activity Type', a['activity_type']),
          row('Related', a['related_label'] ?? a['universal_id']),
          row('Customer Organization', a['org_name'] ?? widget.orgName),
          row('Activity Date', fmtDate(a['activity_date'])),
          row('Next Follow-up Date', str(a['next_followup']).isEmpty ? 'To Be Decided' : fmtDate(a['next_followup'])),
          row('Status', StatusBadge(a['status'])),
          row('Contact Person', a['assigned_to']),
          row('Created', '${fmtDateTime(a['created_at'])}${str(a['created_by_name']).isEmpty ? '' : ' by ${a['created_by_name']}'}'),
        ]),
        if (jsonList(a['contact_details']).isNotEmpty)
          DetailSection('Contact Person(s)', children: [
            for (final c in jsonList(a['contact_details']))
              row(str(c['name']), joinNonEmpty([c['designation'], c['mobile'], c['email']], ' · ')),
          ]),
        if (mom.isNotEmpty)
          DetailSection('Minutes', children: [
            for (var i = 0; i < mom.length; i++)
              FieldRow('${i + 1}.',
                  '${txt(mom[i]['observation'])}\nAction Plan: ${txt(mom[i]['action_plan'])}\nResponsibility: ${txt(mom[i]['responsibility'])}\nTarget: ${txt(mom[i]['target_date'])}'),
          ])
        else ...[
          DetailSection('Observation / Remarks', children: [Text(stripHtml(a['remarks']).isEmpty ? '—' : stripHtml(a['remarks']))]),
          DetailSection('Action Plan', children: [Text(stripHtml(a['action_plan']).isEmpty ? '—' : stripHtml(a['action_plan']))]),
        ],
        if (atts.isNotEmpty)
          DetailSection('Photos', children: [
            for (final p in atts)
              ListTile(
                contentPadding: EdgeInsets.zero,
                leading: const Icon(Icons.image_outlined),
                title: Text(str(p['filename'])),
                trailing: const Icon(Icons.open_in_new_rounded, size: 18),
                onTap: () => openApiFile(
                    context, '/crm/activities/${a['id']}/attachments/${p['id']}/content', str(p['filename']).isEmpty ? 'photo.jpg' : str(p['filename'])),
              ),
          ]),
      ]),
      bottom: actionBar([
        if (_canDelete) dangerBtn('Delete', _delete),
        if (CrmPerm.it('followups', 'print')) secondaryBtn('Export MoM', _exportMom),
        if (_canEdit) secondaryBtn('Change Status', _changeStatus),
        if (_canEdit)
          primaryBtn('Edit', () async {
            if (await showActivityForm(context, initial: a)) _refresh();
          }),
      ]),
    );
  }
}

/// Add / edit a follow-up (components/crm/ActivityForm.tsx). True when saved.
Future<bool> showActivityForm(BuildContext context, {required Json initial}) async {
  final isEdit = initial['id'] != null;
  final orgId = asInt(initial['org_id']);
  final me = str(Perm.user['name']);
  final subject = TextEditingController(text: str(initial['subject']));
  var type = CrmLists.activityTypes.contains(initial['activity_type']) ? str(initial['activity_type']) : CrmLists.activityTypes.first;
  DateTime? next = dateOf(initial['next_followup']);
  var status = str(initial['status']).isEmpty ? CrmLists.followUpStatuses.first : str(initial['status']);
  final remarks = TextEditingController(text: stripHtml(initial['remarks']));
  final actionPlan = TextEditingController(text: stripHtml(initial['action_plan']));
  final contactIds = <int>{
    ...strList(initial['contact_ids']).map(int.tryParse).whereType<int>(),
    if (strList(initial['contact_ids']).isEmpty && asInt(initial['org_contact_id']) != null) asInt(initial['org_contact_id'])!,
  };
  var contacts = <Json>[];
  if (orgId != null) {
    try {
      contacts = await loadContacts(orgId);
    } catch (_) {}
  }
  final photos = <MultipartFile>[];
  final existing = jsonList(initial['attachments']);
  if (!context.mounted) return false;

  Future<void> pickContacts(StateSetter setS) async {
    await showModalBottomSheet<void>(
      context: context,
      isScrollControlled: true,
      useSafeArea: true,
      backgroundColor: Colors.white,
      builder: (ctx) => StatefulBuilder(
        builder: (ctx, setL) => FractionallySizedBox(
          heightFactor: 0.8,
          child: Column(children: [
            Padding(
              padding: const EdgeInsets.fromLTRB(16, 16, 8, 8),
              child: Row(children: [
                const Expanded(
                    child: Text('Contact Person(s)', style: TextStyle(fontSize: 17, fontWeight: FontWeight.w700, color: Brand.heading))),
                TextButton(onPressed: () => Navigator.pop(ctx), child: const Text('Done')),
              ]),
            ),
            Expanded(
              child: ListView(children: [
                if (contacts.isEmpty) const Padding(padding: EdgeInsets.all(16), child: Note('No contacts saved for this customer organization yet.')),
                for (final c in contacts)
                  CheckboxListTile(
                    controlAffinity: ListTileControlAffinity.leading,
                    title: Text(str(c['name'])),
                    subtitle: str(c['designation']).isEmpty ? null : Text(str(c['designation'])),
                    value: contactIds.contains(asInt(c['id'])),
                    onChanged: (v) => setL(() => v == true ? contactIds.add(asInt(c['id'])!) : contactIds.remove(asInt(c['id']))),
                  ),
                ListTile(
                  leading: const Icon(Icons.person_add_alt_1_outlined, color: Brand.primary),
                  title: const Text('+ Add New Contact', style: TextStyle(color: Brand.primary, fontWeight: FontWeight.w600)),
                  onTap: orgId == null
                      ? null
                      : () async {
                          final created = await showQuickContactForm(context, orgId, existing: contacts, requireMobile: true, withDepartment: true);
                          if (created != null) {
                            setL(() {
                              if (!contacts.any((c) => c['id'] == created['id'])) contacts.add(created);
                              contactIds.add(asInt(created['id'])!);
                            });
                          }
                        },
                ),
              ]),
            ),
          ]),
        ),
      ),
    );
    setS(() {});
  }

  return showFormSheet(
    context,
    title: isEdit ? 'Edit Follow Up' : 'Add Follow Up',
    saveLabel: isEdit ? 'Save Changes' : 'Add Follow Up',
    builder: (ctx, setS) => [
      Note(isEdit
          ? 'Change this follow-up — remarks, action plan, next date or status.'
          : 'Log a meeting, call or visit with the customer and set when to follow up next.'),
      const FormSection('Follow Up Details'),
      AppTextField(label: 'Subject', controller: subject, hint: 'Brief subject of this activity'),
      AppSelect<String>(
          label: 'Activity Type', value: type, clearable: false, options: opts(CrmLists.activityTypes), onChanged: (o) => setS(() => type = o?.value ?? type)),
      DateField(label: 'Next Follow-up Date', value: next, onChanged: (d) => setS(() => next = d)),
      AppSelect<String>(
          label: 'Status', value: status, clearable: false, options: opts(CrmLists.followUpStatuses), onChanged: (o) => setS(() => status = o?.value ?? status)),
      const FormSection('Observation / Remarks'),
      AppTextField(label: 'Observation / Remarks', controller: remarks, maxLines: 5, hint: 'What was discussed or observed'),
      const FormSection('Action Plan'),
      AppTextField(label: 'Action Plan', controller: actionPlan, maxLines: 4, hint: 'What needs to be done next'),
      const FormSection('Contact Person(s) (optional)'),
      InkWell(
        onTap: () => pickContacts(setS),
        child: InputDecorator(
          isEmpty: contactIds.isEmpty,
          decoration: fieldDecoration('Contact Person(s)', suffix: const Icon(Icons.expand_more_rounded)),
          child: Wrap(spacing: 6, runSpacing: 6, children: [
            for (final id in contactIds)
              Chip(
                label: Text(str(contacts.firstWhere((c) => asInt(c['id']) == id, orElse: () => {'name': '#$id'})['name'])),
                onDeleted: () => setS(() => contactIds.remove(id)),
              ),
          ]),
        ),
      ),
      const Note('People of this customer organization who took part. Add a new contact here if they are not saved yet.'),
      const FormSection('Photos (optional)'),
      Row(children: [
        Expanded(
          child: secondaryBtn('Take Photo', () async {
            final p = await Files.takePhoto();
            if (p != null) setS(() => photos.add(p));
          }, icon: Icons.photo_camera_outlined),
        ),
        const SizedBox(width: 8),
        Expanded(
          child: secondaryBtn('Add Photo', () async {
            final p = await Files.pickPhoto();
            if (p != null) setS(() => photos.add(p));
          }, icon: Icons.add_photo_alternate_outlined),
        ),
      ]),
      for (final e in existing)
        ListTile(
          contentPadding: EdgeInsets.zero,
          leading: const Icon(Icons.image_outlined),
          title: Text(str(e['filename'])),
          trailing: IconButton(
            tooltip: 'Delete ${str(e['filename'])}',
            icon: const Icon(Icons.delete_outline_rounded, color: Brand.danger),
            onPressed: () async {
              final yes = await confirmDialog(ctx, title: 'Delete Photo', message: 'Delete this photo? This cannot be undone.', confirmLabel: 'Delete', danger: true);
              if (!yes || !ctx.mounted) return;
              if (await crmRun(ctx, () => Api.delete('/crm/activities/${initial['id']}/attachments/${e['id']}'))) {
                setS(() => existing.remove(e));
              }
            },
          ),
        ),
      for (var i = 0; i < photos.length; i++)
        ListTile(
          contentPadding: EdgeInsets.zero,
          leading: const Icon(Icons.image_rounded, color: Brand.primary),
          title: Text(photos[i].filename ?? 'Photo ${i + 1}'),
          subtitle: const Text('Uploads when you save'),
          trailing: IconButton(tooltip: 'Remove', icon: const Icon(Icons.close_rounded), onPressed: () => setS(() => photos.removeAt(i))),
        ),
    ],
    onSave: () async {
      final ids = contactIds.toList();
      final payload = <String, dynamic>{
        'activity_type': type,
        'subject': subject.text.trim(),
        'activity_date': str(initial['activity_date']).isEmpty ? todayIso() : str(initial['activity_date']),
        'next_followup': next == null ? null : apiDate(next!),
        'assigned_to': str(initial['assigned_to']).isEmpty ? me : str(initial['assigned_to']),
        'status': status,
        'remarks': toHtml(remarks.text),
        'action_plan': toHtml(actionPlan.text),
        'org_contact_id': ids.isEmpty ? null : ids.first,
        'contact_ids': ids.isEmpty ? null : ids,
      };
      if (!isEdit) {
        payload.addAll({
          'org_id': orgId,
          'related_module': initial['related_module'],
          'related_id': initial['related_id'],
          'universal_id': initial['universal_id'],
        });
      }
      payload.removeWhere((k, v) => v == null || (v is String && v.isEmpty) && k != 'remarks' && k != 'action_plan');
      if (!isEdit) payload.removeWhere((k, v) => v is String && v.isEmpty);
      await guard(() async {
        final saved = isEdit
            ? await Api.patch('/crm/activities/${initial['id']}', data: payload)
            : await Api.post('/crm/activities', data: payload);
        final id = saved is Map ? saved['id'] : initial['id'];
        if (photos.isNotEmpty && id != null) {
          final form = FormData();
          for (final p in photos) {
            form.files.add(MapEntry('files', p));
          }
          await Api.dio.post('/crm/activities/$id/attachments',
              data: form, options: Options(receiveTimeout: const Duration(minutes: 2), sendTimeout: const Duration(minutes: 2)));
        }
      });
    },
  );
}

/// Quick new contact for a customer organization (inquiry / tender / follow-up forms).
/// An existing contact with the same name is reused instead of creating a duplicate.
Future<Json?> showQuickContactForm(BuildContext context, int orgId,
    {List<Json> existing = const [], bool requireMobile = false, bool withDepartment = false, bool multiValues = false}) async {
  final name = TextEditingController();
  final designation = TextEditingController();
  final department = TextEditingController();
  final mobiles = MultiValues('', const []);
  final emails = MultiValues('', const []);
  Json? out;
  final ok = await showFormSheet(
    context,
    title: 'Add New Contact',
    saveLabel: 'Save Contact',
    builder: (ctx, setS) {
      final match = existing.where((c) {
        final n = name.text.trim().toLowerCase();
        return (n.isNotEmpty && str(c['name']).trim().toLowerCase() == n) ||
            (mobiles.first.isNotEmpty && str(c['mobile']).trim() == mobiles.first) ||
            (emails.first.isNotEmpty && str(c['email']).trim().toLowerCase() == emails.first.toLowerCase());
      }).firstOrNull;
      return [
        AppTextField(label: 'Name', required: true, controller: name, hint: 'Rajesh Kumar', onChanged: (_) => setS(() {})),
        AppTextField(label: 'Designation', controller: designation, hint: 'Purchase Head / DGM'),
        if (withDepartment) AppTextField(label: 'Department', controller: department, hint: 'Dept.'),
        if (multiValues)
          MultiValueField(label: 'Mobile', values: mobiles, setState: setS, keyboardType: TextInputType.phone, addTooltip: 'Add another mobile')
        else
          AppTextField(
              label: 'Mobile', required: requireMobile, controller: mobiles.main, keyboardType: TextInputType.phone, onChanged: (_) => setS(() {})),
        if (multiValues)
          MultiValueField(label: 'Email', values: emails, setState: setS, keyboardType: TextInputType.emailAddress, addTooltip: 'Add another email')
        else
          AppTextField(label: 'Email', controller: emails.main, keyboardType: TextInputType.emailAddress, hint: 'email@company.com'),
        if (match != null)
          InfoBox.warn('This matches the existing contact "${str(match['name'])}". Saving will link to that existing contact instead of creating a new one.'),
      ];
    },
    onSave: () async {
      if (name.text.trim().isEmpty) throw 'Please enter a name for the new contact.';
      if (requireMobile && mobiles.first.isEmpty) throw 'Please enter a mobile number for the contact.';
      final email = emails.first;
      if (email.isNotEmpty && !RegExp(r'^[^@\s]+@[^@\s]+\.[^@\s]+$').hasMatch(email)) {
        throw 'Please enter a valid email for the new contact.';
      }
      final n = name.text.trim().toLowerCase();
      final match = existing.where((c) =>
          str(c['name']).trim().toLowerCase() == n ||
          (mobiles.first.isNotEmpty && str(c['mobile']).trim() == mobiles.first) ||
          (email.isNotEmpty && str(c['email']).trim().toLowerCase() == email.toLowerCase())).firstOrNull;
      if (match != null) {
        out = match;
        return;
      }
      final body = <String, dynamic>{
        'name': name.text.trim(),
        if (designation.text.trim().isNotEmpty) 'designation': designation.text.trim(),
        if (department.text.trim().isNotEmpty) 'department': department.text.trim(),
        if (mobiles.first.isNotEmpty) 'mobile': mobiles.first,
        if (email.isNotEmpty) 'email': email,
        if (multiValues) 'additional_mobiles': mobiles.rest,
        if (multiValues) 'additional_emails': emails.rest,
      };
      final r = await guard(() => Api.post('/crm/organizations/$orgId/contacts', data: body));
      out = r is Map ? Map<String, dynamic>.from(r) : null;
    },
  );
  return ok ? out : null;
}

/// Export Meeting MOM (MomExportDialog.tsx): subject, date, attendees, follow-ups → Word or PDF.
Future<void> exportMeetingMom(BuildContext context, CrmKind kind, int id, int? orgId, String? orgName, List<Json> activities) async {
  final subject = TextEditingController();
  DateTime? date = DateTime.now();
  final pew = <int>{};
  final client = <int>{};
  final acts = <int>{for (final a in activities) asInt(a['id'])!};
  var format = 'docx';
  List<Json> contacts = const [];
  List<Json> people = const [];
  try {
    if (orgId != null) contacts = await loadContacts(orgId);
  } catch (_) {}
  try {
    people = await loadDirectory();
  } catch (_) {}
  if (!context.mounted) return;
  List<int> bytes = const [];
  final ok = await showFormSheet(
    context,
    title: 'Export Meeting MOM',
    saveLabel: 'Export',
    builder: (ctx, setS) => [
      Note('One Minutes of Meeting from the follow-ups you pick${orgName == null ? '' : ' — $orgName'}.'),
      const FormSection('Meeting'),
      AppTextField(label: 'Subject', required: true, controller: subject, hint: 'e.g. Technical discussion on signalling requirement'),
      DateField(label: 'Meeting Date', value: date, onChanged: (d) => setS(() => date = d)),
      const FormSection('Attendees'),
      const Caps('PEW Attendees'),
      if (people.isEmpty)
        const Note('No users found.')
      else
        Wrap(spacing: 6, runSpacing: 6, children: [
          for (final u in people)
            FilterChip(
              label: Text(str(u['name'])),
              selected: pew.contains(asInt(u['id'])),
              onSelected: (v) => setS(() => v ? pew.add(asInt(u['id'])!) : pew.remove(asInt(u['id']))),
            ),
        ]),
      const Caps('Client Attendees'),
      if (contacts.isEmpty)
        const Note('No contacts saved for this customer organization yet.')
      else
        Wrap(spacing: 6, runSpacing: 6, children: [
          for (final c in contacts)
            FilterChip(
              label: Text(str(c['name'])),
              selected: client.contains(asInt(c['id'])),
              onSelected: (v) => setS(() => v ? client.add(asInt(c['id'])!) : client.remove(asInt(c['id']))),
            ),
        ]),
      const FormSection('Follow-ups to Include'),
      if (activities.isEmpty) const Note('No follow-ups logged yet.'),
      for (final a in activities)
        CheckField(
          label: '${str(a['subject']).isNotEmpty ? str(a['subject']) : str(a['activity_type']).isNotEmpty ? str(a['activity_type']) : 'Follow-up #${a['id']}'}'
              '${a['created_at'] == null ? '' : ' · ${fmtDate(a['created_at'])}'}',
          value: acts.contains(asInt(a['id'])),
          onChanged: (v) => setS(() => v ? acts.add(asInt(a['id'])!) : acts.remove(asInt(a['id']))),
        ),
      AppSelect<String>(
        label: 'Format',
        value: format,
        clearable: false,
        options: const [Option('docx', 'Word (.docx)'), Option('pdf', 'PDF')],
        onChanged: (o) => setS(() => format = o?.value ?? format),
      ),
    ],
    onSave: () async {
      if (subject.text.trim().isEmpty) throw 'Enter the meeting subject — it is the title of the MOM document.';
      final res = await guard(() => Api.dio.post<List<int>>(
            '${kind.base(id)}/mom-${format == 'docx' ? 'docx' : 'pdf'}',
            data: {
              'subject': subject.text.trim(),
              'meeting_date': apiDate(date ?? DateTime.now()),
              'pew_member_ids': pew.toList(),
              'client_contact_ids': client.toList(),
              'activity_ids': acts.toList(),
            },
            options: Options(responseType: ResponseType.bytes, receiveTimeout: const Duration(minutes: 2)),
          ));
      bytes = res.data ?? const [];
    },
  );
  if (!ok || !context.mounted) return;
  final org = (orgName ?? 'Meeting').replaceAll(RegExp(r'\s+'), '_').replaceAll('/', '-');
  final d = apiDate(date ?? DateTime.now()).replaceAll('-', '');
  await crmRun(context, () => saveBytesAndOpen(bytes, 'MOM_${org}_$d.$format'));
}

// ── Timeline tab ─────────────────────────────────────────────────────────────

const _auditLabels = {
  'product_category': 'Category', 'product': 'Product', 'quantity': 'Quantity',
  'required_delivery_date': 'Required Delivery Date', 'delivery_location': 'Delivery Location',
  'inspection_req': 'Inspection Requirement', 'warranty_req': 'Warranty Requirement', 'product_spec': 'Customer Requirement',
  'requirement_desc': 'Requirement Summary', 'project_details': 'Project Details',
  'railway_zone': 'Railway Zone', 'division': 'Division', 'lead_source': 'Lead Source', 'bd_owner': 'BD Owner',
  'sales_engineer': 'Sales Engineer', 'status': 'Status', 'current_stage': 'Stage', 'current_status_note': 'Current Status', 'budget': 'Budget',
  'expected_value': 'Expected Value', 'probability': 'Probability', 'expected_order_date': 'Expected Order Date',
  'priority': 'Customer Requirement Priority', 'next_followup_date': 'Follow-up Date', 'followup_priority': 'Follow-up Priority',
  'followup_assigned_to': 'Follow-up Assigned To', 'followup_remarks': 'Follow-up Remarks',
  'org_id': 'Customer Organization', 'org_contact_id': 'Contact',
  'tender_details': 'Tender Details', 'tender_authority': 'Tender Authority', 'tender_portal': 'Tender Portal',
  'tender_type': 'Tender Type', 'tender_value': 'Tender Value', 'tender_number': 'Tender Number', 'tender_name': 'Tender Name',
};

String fieldLabel(String f) => _auditLabels[f] ?? f;

/// "old → new" lines of one revision.
String changesText(List<Json> changes, {String Function(String)? label}) {
  final single = changes.length == 1;
  return changes.map((c) {
    final o = str(c['old']).trim().isEmpty ? '(empty)' : str(c['old']);
    final n = str(c['new']).trim().isEmpty ? '(empty)' : str(c['new']);
    return single ? '$o → $n' : '${(label ?? fieldLabel)(str(c['field']))}: $o → $n';
  }).join('\n');
}

const _kindStyle = {
  'created': ('Created', Color(0xFF16A34A)),
  'updated': ('Updated', Color(0xFF1D4ED8)),
  'deleted': ('Deleted', Color(0xFFB91C1C)),
  'stage': ('Stage', Color(0xFF7C3AED)),
  'followup': ('Follow Up', Color(0xFFC2410C)),
  'quotation': ('Quotation', Color(0xFFA16207)),
  'info': ('Info Update', Color(0xFF4338CA)),
  'email': ('Email Sent', Color(0xFF0F766E)),
  'email_failed': ('Email Failed', Color(0xFFB91C1C)),
};

class TimelineTab extends StatefulWidget {
  const TimelineTab({super.key, required this.kind, required this.recordId});
  final CrmKind kind;
  final int recordId;

  @override
  State<TimelineTab> createState() => _TimelineTabState();
}

class _TimelineTabState extends State<TimelineTab> {
  List<({String kind, String title, String? detail, String? by, String? date})>? _entries;
  Object? _error;

  @override
  void initState() {
    super.initState();
    _load();
  }

  String? _cleanTitle(String? summary, String? actor) {
    if (summary == null || summary.isEmpty) return summary;
    var s = summary;
    if (actor != null && actor.isNotEmpty && s.startsWith(actor)) s = s.substring(actor.length).trimLeft();
    s = s.replaceFirst(RegExp(r'^updated:\s*', caseSensitive: false), '').replaceFirst(RegExp(r'\.\s*$'), '');
    s = s.replaceAllMapped(RegExp(r'\b[a-z][a-z0-9]*(?:_[a-z0-9]+)+\b', caseSensitive: false),
        (m) => _auditLabels[m[0]!.toLowerCase()] ?? m[0]!);
    if (s.isEmpty) return summary;
    return s[0].toUpperCase() + s.substring(1);
  }

  Future<void> _load() async {
    final base = widget.kind.base(widget.recordId);
    final seeQuot = widget.kind == CrmKind.inquiry && CrmPerm.it('quotations', 'view');
    final seeFu = CrmPerm.it('followups', 'view');
    try {
      final results = await Future.wait<dynamic>([
        Api.get('$base/audit'),
        Api.get('$base/stages'),
        seeFu
            ? Api.get('/crm/activities', query: {'related_module': widget.kind.key, 'related_id': widget.recordId})
            : Future.value(const []),
        seeQuot ? Api.get('$base/quotations') : Future.value(const []),
        Api.get('$base/spec-revisions'),
      ]);
      String kindOf(String action) => action == 'created'
          ? 'created'
          : action == 'deleted'
              ? 'deleted'
              : action.endsWith('_sent')
                  ? 'email'
                  : action.endsWith('_failed')
                      ? 'email_failed'
                      : 'updated';
      final list = <({String kind, String title, String? detail, String? by, String? date})>[
        for (final a in jsonList(results[0]))
          if (a['action'] != 'updated')
            (
              kind: kindOf(str(a['action'])),
              title: _cleanTitle(a['summary'] as String?, a['performed_by'] as String?) ?? '${widget.kind.label} ${a['action']}',
              detail: null,
              by: a['performed_by'] as String?,
              date: a['performed_at'] as String?,
            ),
        for (final r in jsonList(results[4]))
          (
            kind: 'info',
            title: jsonList(r['changes']).map((c) => fieldLabel(str(c['field']))).join(', '),
            detail: changesText(jsonList(r['changes'])),
            by: r['performed_by'] as String?,
            date: r['performed_at'] as String?,
          ),
        for (final s in jsonList(results[1]))
          if (s['stage'] != 'Inquiry created')
            (
              kind: 'stage',
              title: 'Moved to stage: ${str(s['stage'])}',
              detail: s['notes'] as String?,
              by: s['entered_by_name'] as String?,
              date: s['created_at'] as String?,
            ),
        for (final a in jsonList(results[2]))
          (
            kind: 'followup',
            title: str(a['subject']).isNotEmpty
                ? str(a['subject'])
                : strList(a['contact_names']).isNotEmpty
                    ? strList(a['contact_names']).join(', ')
                    : (str(a['activity_type']).isEmpty ? 'Follow Up' : str(a['activity_type'])),
            detail: stripHtml(a['remarks']),
            by: a['created_by_name'] as String?,
            date: (a['activity_date'] ?? a['created_at']) as String?,
          ),
        for (final q in jsonList(results[3]))
          (
            kind: 'quotation',
            title: 'Quotation ${str(q['quot_number']).isEmpty ? 'Rev ${q['revision_number']}' : str(q['quot_number'])} generated',
            detail: q['price'] != null ? '₹${fmtNumber(q['price'])}${str(q['delivery_time']).isEmpty ? '' : ' · Delivery: ${q['delivery_time']}'}' : null,
            by: null,
            date: (q['submitted_date'] ?? q['created_at']) as String?,
          ),
      ]..sort((a, b) => (b.date ?? '').compareTo(a.date ?? ''));
      if (mounted) {
        setState(() {
        _entries = list;
        _error = null;
        });
      }
    } catch (e) {
      if (mounted) setState(() => _error = e);
    }
  }

  @override
  Widget build(BuildContext context) {
    if (_error != null && _entries == null) return ErrorView(crmError(_error!), onRetry: _load);
    if (_entries == null) return const LoadingView();
    if (_entries!.isEmpty) return tabList(_load, [const EmptyView('No timeline history yet.')]);
    return tabList(_load, [
      for (final e in _entries!)
        Padding(
          padding: const EdgeInsets.fromLTRB(16, 0, 16, 10),
          child: Card(
            child: Padding(
              padding: const EdgeInsets.all(12),
              child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                Row(children: [
                  pill(_kindStyle[e.kind]?.$1 ?? e.kind, _kindStyle[e.kind]?.$2 ?? Brand.muted),
                  const Spacer(),
                  Text('${e.by ?? 'System'} · ${fmtDateTime(e.date)}', style: const TextStyle(fontSize: 11.5, color: Brand.muted)),
                ]),
                const SizedBox(height: 6),
                Text(e.title, style: const TextStyle(fontWeight: FontWeight.w600, color: Brand.heading)),
                if ((e.detail ?? '').trim().isNotEmpty) ...[
                  const SizedBox(height: 4),
                  Text(e.detail!, style: const TextStyle(fontSize: 12.5, color: Brand.body)),
                ],
              ]),
            ),
          ),
        ),
    ]);
  }
}
