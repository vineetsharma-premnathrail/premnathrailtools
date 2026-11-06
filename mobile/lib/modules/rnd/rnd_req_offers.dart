import 'package:dio/dio.dart';
import 'package:flutter/material.dart';

import '../../api/api.dart';
import '../../theme.dart';
import '../../ui/files.dart';
import '../../ui/form.dart';
import '../../ui/format.dart';
import '../../ui/widgets.dart';
import 'rnd_common.dart';

/// Requirement › Technical Offers (portal: RequirementTechnicalOffersTab +
/// TechnicalOfferUploadSheet). Offers are uploaded files; the R&D head
/// releases them to BD or returns them with a reason.
class TechnicalOffersTab extends StatefulWidget {
  const TechnicalOffersTab({super.key, required this.source, required this.recordId, required this.access, this.acceptedHint});
  final String source;
  final int recordId;
  final Json access;
  final String? acceptedHint;

  @override
  State<TechnicalOffersTab> createState() => _TechnicalOffersTabState();
}

const _statusLabels = {
  'draft': 'Upload needed',
  'submitted': 'Pending release',
  'released': 'Released to BD',
  'superseded': 'Superseded',
};
const _statusHex = {'draft': '#D97706', 'submitted': '#2563EB', 'released': '#16A34A', 'superseded': '#78716C'};

class _TechnicalOffersTabState extends State<TechnicalOffersTab> {
  List<Json>? _offers;
  Object? _error;

  bool get _isHead => boolOf(widget.access['is_head']);
  bool get _canPrepare => boolOf(widget.access['create_technical_offer']);
  bool get _canUpload =>
      _canPrepare && RndPerm.feature('requirements', 'technical_offers', 'create') && widget.acceptedHint == null;
  bool get _canDeleteDraft => _canPrepare && RndPerm.feature('requirements', 'technical_offers', 'delete');
  bool get _canApprove => _isHead && RndPerm.feature('requirements', 'technical_offers', 'approve');

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    try {
      final rows = jsonList(await Api.get('/rnd/requirement-work/${widget.source}/${widget.recordId}/technical-offers'));
      rows.sort((a, b) {
        final c = (str(a, 'offer_number') ?? '').compareTo(str(b, 'offer_number') ?? '');
        return c != 0 ? c : (intOf(a['revision']) ?? 0) - (intOf(b['revision']) ?? 0);
      });
      if (mounted) {
        setState(() {
          _offers = rows;
          _error = null;
        });
      }
    } catch (e) {
      if (mounted) {
        setState(() {
          _offers ??= [];
          _error = e;
        });
      }
    }
  }

  Future<void> _upload(Json? reviseOf) async {
    final hasReleased = (_offers ?? []).any((o) => o['status'] == 'released');
    final title = TextEditingController();
    DateTime? date = DateTime.now();
    final notes = TextEditingController();
    var files = <MultipartFile>[];
    final ok = await showFormSheet(
      context,
      title: reviseOf != null ? 'Upload Revision of ${reviseOf['offer_number']}' : 'Upload Technical Offer',
      saveLabel: 'Upload Offer',
      builder: (ctx, setS) => [
        Hint(
          reviseOf != null
              ? 'A corrected file becomes the next revision of this offer.'
              : 'The final Word or PDF file R&D sends to the BD team.',
        ),
        const FormHeading('Offer details'),
        AppTextField(label: 'Title', controller: title, required: true, hint: 'e.g. Technical Offer — 600 mm platform trolley'),
        DateField(label: 'Offer date', required: true, value: date, onChanged: (d) => setS(() => date = d)),
        AppTextField(
          label: 'Notes',
          controller: notes,
          maxLines: 3,
          hint: 'Context for the reviewer — what changed, assumptions, open points',
        ),
        const FormHeading('Offer file'),
        FilesField(
          label: 'Word or PDF',
          required: true,
          single: true,
          extensions: const ['docx', 'pdf'],
          files: files,
          onChanged: (f) => setS(() => files = f),
          hint:
              'After the upload it shows as “Pending release”. The R&D head releases it to the BD team'
              '${hasReleased ? '; an offer released earlier then becomes Superseded' : ''}, or returns it with a reason.',
        ),
      ],
      onSave: () async {
        if (title.text.trim().isEmpty) {
          throw 'Give the offer a title — it identifies the file in lists (e.g. “Technical Offer — 600 mm platform trolley”).';
        }
        if (date == null) throw 'Pick the offer date — it is printed on the quotation.';
        if (files.isEmpty) throw 'Choose the offer file — Word (.docx) or PDF.';
        final f = files.first;
        final name = f.filename ?? '';
        if (!RegExp(r'\.(docx|pdf)$', caseSensitive: false).hasMatch(name)) {
          throw '“$name” can\'t be uploaded — only Word (.docx) or PDF files are accepted as a Technical Offer.';
        }
        if (f.length == 0) throw '“$name” is empty — pick the final offer file and upload again.';
        await postForm(
          '/rnd/requirement-work/${widget.source}/${widget.recordId}/technical-offers',
          {'title': title.text.trim(), 'offer_date': apiDate(date!), 'notes': notes.text.trim(), 'revise_of_id': reviseOf?['id']},
          files: files,
          fileField: 'file',
        );
      },
    );
    if (ok) await _load();
  }

  Future<void> _release(Json o) async {
    final hasReleased = (_offers ?? []).any((x) => x['status'] == 'released');
    final ok = await confirmDialog(
      context,
      title: 'Release ${o['offer_number']} to the BD team?',
      message:
          'The BD team is notified and can quote against it. It is locked from now on.'
          '${hasReleased ? ' The offer released earlier becomes Superseded.' : ''}',
      confirmLabel: 'Release',
    );
    if (!ok || !mounted) return;
    if (await runAction(
      context,
      () => Api.post('/rnd/requirement-work/technical-offers/${o['id']}/release'),
      success: '${o['offer_number']} released to BD.',
    )) {
      await _load();
    }
  }

  Future<void> _return(Json o) async {
    final reason = await promptDialog(
      context,
      title: 'Return ${o['offer_number']} for changes?',
      message: 'Say what must be corrected (at least 10 characters). The uploader sees this on the offer and uploads a corrected file.',
      confirmLabel: 'Return',
    );
    if (reason == null || !mounted) return;
    if (reason.length < 10) {
      showSnack(
        context,
        'Enter what must be corrected (at least 10 characters) — the uploader sees it on the offer.',
        error: true,
      );
      return;
    }
    if (await runAction(
      context,
      () => Api.post('/rnd/requirement-work/technical-offers/${o['id']}/return', data: {'reason': reason}),
    )) {
      await _load();
    }
  }

  Future<void> _delete(Json o) async {
    final ok = await confirmDialog(
      context,
      title: 'Delete ${o['offer_number']}?',
      message: 'The offer record is removed. This cannot be undone.',
      confirmLabel: 'Delete',
      danger: true,
    );
    if (!ok || !mounted) return;
    if (await runAction(context, () => Api.delete('/rnd/requirement-work/technical-offers/${o['id']}'))) await _load();
  }

  @override
  Widget build(BuildContext context) {
    final offers = _offers;
    if (offers == null) return const LoadingView();
    return RefreshIndicator(
      onRefresh: _load,
      child: ListView(
        padding: const EdgeInsets.only(top: 12, bottom: 32),
        children: [
          const NoteBox(
            "R&D's answer to this requirement — upload the final Word or PDF file. The R&D head releases it to the BD team "
            '(they can then quote it) or returns it with a reason.',
            color: Brand.muted,
          ),
          if (_canPrepare)
            Padding(
              padding: const EdgeInsets.fromLTRB(16, 0, 16, 12),
              child: FilledButton.icon(
                onPressed: _canUpload ? () => _upload(null) : null,
                icon: const Icon(Icons.upload_file_rounded),
                label: const Text('Upload Technical Offer'),
              ),
            ),
          if (widget.acceptedHint != null) NoteBox(widget.acceptedHint!, color: const Color(0xFFD97706)),
          if (_error != null)
            Padding(padding: const EdgeInsets.fromLTRB(16, 0, 16, 12), child: ErrorBanner(ApiClient.describe(_error!))),
          if (offers.isEmpty)
            EmptyView(
              'No Technical Offer uploaded yet.'
              '${_canPrepare ? '' : ' The R&D head, or people given the Technical Offer team permission in Organization › Role & Permissions, upload it.'}',
            ),
          for (final o in offers) _offerCard(o),
        ],
      ),
    );
  }

  Widget _offerCard(Json o) {
    final status = str(o, 'status') ?? '';
    final size = jsonMap(o['file'])['file_size'] ?? o['file_size'];
    final canReplace = _canUpload && const ['draft', 'submitted', 'released'].contains(status);
    final quoted = (o['quoted_in'] is List) ? (o['quoted_in'] as List).join(', ') : '';
    return Padding(
      padding: const EdgeInsets.fromLTRB(16, 0, 16, 10),
      child: Card(
        child: Padding(
          padding: const EdgeInsets.all(12),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Wrap(
                spacing: 8,
                runSpacing: 4,
                crossAxisAlignment: WrapCrossAlignment.center,
                children: [
                  Text(
                    str(o, 'offer_number') ?? '',
                    style: const TextStyle(fontSize: 14, fontWeight: FontWeight.w700, color: Brand.heading),
                  ),
                  Pill(_statusLabels[status] ?? status, hexColor(_statusHex[status] ?? '#78716C')),
                  if (boolOf(o['based_on_earlier_revision'])) const Pill('Based on an earlier revision', Color(0xFF9A3412)),
                ],
              ),
              const SizedBox(height: 4),
              Text(str(o, 'title') ?? '', style: const TextStyle(fontSize: 13.5, color: Brand.body)),
              Text(
                'Dated ${fmtDate(o['offer_date'])} · by ${o['created_by'] ?? '—'}${o['created_at'] != null ? ' · ${fmtDateTime(o['created_at'])}' : ''}',
                style: const TextStyle(fontSize: 11.5, color: Brand.muted),
              ),
              const SizedBox(height: 4),
              Text(
                '${o['file_name'] != null ? '${o['file_name']}${size != null ? ' · ${fmtSize(size)}' : ''}' : 'No file attached'}'
                '${o['released_at'] != null ? ' · released by ${o['released_by']} on ${fmtDateTime(o['released_at'])}' : ''}',
                style: const TextStyle(fontSize: 12, color: Brand.muted),
              ),
              if (o['notes'] != null) Padding(padding: const EdgeInsets.only(top: 4), child: Text('Notes: ${o['notes']}')),
              if (quoted.isNotEmpty) Padding(padding: const EdgeInsets.only(top: 4), child: Text('Quoted in: $quoted')),
              if (o['returned_reason'] != null && (status == 'draft' || status == 'submitted'))
                NoteBox(
                  '${status == 'draft' ? 'Needs a new upload:' : 'Returned by the R&D head:'} ${o['returned_reason']}',
                  color: const Color(0xFFD97706),
                  margin: const EdgeInsets.only(top: 8),
                ),
              if (status == 'submitted' && o['returned_reason'] == null)
                NoteBox(
                  'Waiting for the R&D head to release it to the BD team${_isHead ? '' : ' or return it for changes'}.',
                  margin: const EdgeInsets.only(top: 8),
                ),
              const SizedBox(height: 8),
              Wrap(
                spacing: 8,
                runSpacing: 6,
                children: [
                  if (o['file_name'] != null)
                    OutlinedButton(
                      onPressed: () => runAction(
                        context,
                        () => Files.downloadAndOpen(
                          '/rnd/requirement-work/technical-offers/${o['id']}/file',
                          str(o, 'file_name') ?? '${o['offer_number']}.docx',
                        ),
                      ),
                      child: const Text('Download'),
                    ),
                  if (status == 'submitted' && _canApprove) ...[
                    FilledButton(
                      style: FilledButton.styleFrom(minimumSize: const Size(0, 40)),
                      onPressed: () => _release(o),
                      child: const Text('Release to BD'),
                    ),
                    OutlinedButton(onPressed: () => _return(o), child: const Text('Return for changes')),
                  ],
                  if (canReplace)
                    OutlinedButton(
                      onPressed: () => _upload(o),
                      child: Text(status == 'released' ? 'Upload revision' : 'Upload corrected file'),
                    ),
                  if (status == 'draft' && _canDeleteDraft)
                    OutlinedButton(
                      style: OutlinedButton.styleFrom(foregroundColor: Brand.danger),
                      onPressed: () => _delete(o),
                      child: const Text('Delete'),
                    ),
                ],
              ),
            ],
          ),
        ),
      ),
    );
  }
}
